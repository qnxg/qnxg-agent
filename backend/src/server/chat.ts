/**
 * 对话相关接口：
 * - POST /api/sessions/:id/chat   发消息，SSE 流式返回
 * - POST /api/sessions/:id/abort  中断当前回复
 * - POST /api/sessions/:id/edit   编辑最后一条用户消息并重发，SSE 流式返回
 *
 * chat/edit 的响应都是 SSE 流，订阅 session 事件并转发给浏览器：
 * - text_delta  模型逐字输出
 * - tool_start  工具调用开始（quickjs 的代码入参）
 * - tool_update 工具执行中的实时输出（沙箱内 log() 的累计文本）
 * - tool_end    工具调用结束（执行结果）
 * - done        本轮结束
 * - error       出错
 *
 * 每个会话有自己的 PromptQueue 串行化：请求先排队，排到时才订阅事件，
 * 保证这个连接只收到自己这轮 prompt 的事件，不会和前面排队的串台。
 *
 * 三个接口都要求锁（多标签页同会话只有队首标签页能操作）。
 */

import { writeFileSync } from "node:fs";
import type { Context, Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { formatToolIO } from "../agent/session.js";
import type { PooledSession, SessionPool } from "./session-pool.js";

/**
 * 编辑重发后重写会话文件：只保留当前 leaf 路径上的 entry，
 * 丢弃被编辑掉的分支（append-only 文件上实现"覆盖"语义）。
 * 必须在 prompt 成功后调用：此时新消息已落盘，
 * 内存里被丢弃的旧 entry 不会再被持久化，重写后文件保持干净。
 * gc 失败不影响本轮结果（文件里多留个分支而已），只记日志。
 */
function gcAbandonedBranches(pooled: PooledSession): void {
	try {
		const sm = pooled.session.sessionManager;
		const file = sm.getSessionFile();
		if (!file) return;
		const header = sm.getHeader();
		const lines = [header, ...sm.getBranch()]
			.filter((e) => e != null)
			.map((e) => JSON.stringify(e));
		writeFileSync(file, `${lines.join("\n")}\n`);
	} catch (e) {
		console.error("[edit] 清理旧分支失败（不影响本轮结果）:", e);
	}
}

/** chat / edit 共用的 SSE 流式执行：排队 → （可选前置）→ 订阅事件 → prompt → 转发 */
function streamPrompt(
	c: Context,
	pool: SessionPool,
	pooled: PooledSession,
	message: string,
	hooks?: {
		/** 排到时、prompt 前执行（如编辑重发的 navigateTree），抛错则本轮直接报错 */
		beforeRun?: () => Promise<void>;
		/** prompt 成功后执行（如编辑重发后的旧分支清理） */
		afterSuccess?: () => void;
	},
) {
	const { session, queue } = pooled;

	return streamSSE(c, async (stream) => {
		// 客户端断连后 writeSSE 会抛错（在 subscribe 回调里会变成 unhandled
		// rejection 打崩进程），用 aborted 标志拦截，断连后的事件直接丢弃。
		// 注意：prompt 本身会跑完，只是结果不再推给已断开的连接。
		let aborted = false;
		stream.onAbort(() => {
			aborted = true;
		});

		const send = async (event: string, data: unknown) => {
			if (aborted) return;
			try {
				await stream.writeSSE({ event, data: JSON.stringify(data) });
			} catch {
				aborted = true;
			}
		};

		await queue.enqueue(async () => {
			const unsubscribe = session.subscribe((event) => {
				switch (event.type) {
					case "message_update":
						if (event.assistantMessageEvent.type === "text_delta") {
							void send("text_delta", {
								delta: event.assistantMessageEvent.delta,
							});
						}
						break;
					case "tool_execution_start":
						void send("tool_start", {
							toolCallId: event.toolCallId,
							toolName: event.toolName,
							args: formatToolIO(event.args),
						});
						break;
					case "tool_execution_update":
						void send("tool_update", {
							toolCallId: event.toolCallId,
							result: formatToolIO(event.partialResult),
						});
						break;
					case "tool_execution_end":
						void send("tool_end", {
							toolCallId: event.toolCallId,
							result: formatToolIO(event.result),
							isError: event.isError,
						});
						break;
				}
			});

			try {
				// 前置（如编辑重发的 navigateTree）在队列内执行，与 prompt 串行，
				// 避免和上一轮在跑的 prompt 竞争会话树
				await hooks?.beforeRun?.();
				await session.prompt(message);
				await send("done", {});
				hooks?.afterSuccess?.();
			} catch (e) {
				await send("error", {
					message: e instanceof Error ? e.message : String(e),
				});
			} finally {
				unsubscribe();
				// 跑完刷新活跃时间，避免无连接时被 sweeper 立刻淘汰
				pool.touch(pooled.id);
			}
		});
	});
}

export function registerChatRoute(app: Hono, pool: SessionPool) {
	app.post("/api/sessions/:id/chat", async (c) => {
		const pooled = await pool.acquire(c.req.param("id"));
		if (!pooled) return c.json({ error: "会话不存在" }, 404);

		const body = await c.req
			.json<{ message?: string; clientId?: string }>()
			.catch(() => null);
		const message = body?.message?.trim();
		if (!message) {
			return c.json({ error: "message 不能为空" }, 400);
		}

		// 锁：多标签页打开同一会话时，只有队首标签页能发消息
		if (!body?.clientId || !pool.isWriter(pooled.id, body.clientId)) {
			return c.json({ error: "另一个页面正在使用此会话，无发送权限" }, 409);
		}

		return streamPrompt(c, pool, pooled, message);
	});

	app.post("/api/sessions/:id/abort", async (c) => {
		const pooled = await pool.acquire(c.req.param("id"));
		if (!pooled) return c.json({ error: "会话不存在" }, 404);

		const body = await c.req.json<{ clientId?: string }>().catch(() => null);
		if (!body?.clientId || !pool.isWriter(pooled.id, body.clientId)) {
			return c.json({ error: "另一个页面正在使用此会话，无操作权限" }, 409);
		}

		// abort 等 agent 变 idle；不在跑时是 no-op。
		// 中断后 chat 流的 prompt 正常结束，客户端会收到 done。
		await pooled.session.abort();
		pool.touch(pooled.id);
		return c.json({ ok: true });
	});

	/**
	 * 编辑最后一条用户消息并重发：
	 * navigateTree(entryId) 把 leaf 移到该消息的父节点并重建上下文
	 * （在队列内执行，与在跑的 prompt 串行），prompt 成功后
	 * gcAbandonedBranches 重写会话文件，把被编辑掉的旧尾部从磁盘上
	 * 彻底删除（覆盖语义，不保留分支）；prompt 失败则不动文件。
	 * 更早的消息不支持编辑（entryId 不是最后一条 user 消息时 400）。
	 */
	app.post("/api/sessions/:id/edit", async (c) => {
		const pooled = await pool.acquire(c.req.param("id"));
		if (!pooled) return c.json({ error: "会话不存在" }, 404);

		const body = await c.req
			.json<{ entryId?: string; message?: string; clientId?: string }>()
			.catch(() => null);
		const message = body?.message?.trim();
		if (!body?.entryId || !message) {
			return c.json({ error: "entryId 和 message 不能为空" }, 400);
		}
		if (!body?.clientId || !pool.isWriter(pooled.id, body.clientId)) {
			return c.json({ error: "另一个页面正在使用此会话，无操作权限" }, 409);
		}
		if (pooled.session.isStreaming) {
			return c.json({ error: "正在生成回复，请先中断" }, 409);
		}

		// 只允许编辑当前分支最后一条用户消息（排队后 navigate 前会话不会变，
		// 因为同会话的所有写操作都走这个队列）
		const lastUser = pooled.session.sessionManager
			.buildContextEntries()
			.filter(
				(e) =>
					e.type === "message" &&
					(e.message as { role?: string }).role === "user",
			)
			.at(-1);
		if (!lastUser || lastUser.id !== body.entryId) {
			return c.json({ error: "只能编辑最后一条消息" }, 400);
		}
		const entryId = body.entryId;

		return streamPrompt(c, pool, pooled, message, {
			beforeRun: async () => {
				await pooled.session.navigateTree(entryId);
			},
			afterSuccess: () => gcAbandonedBranches(pooled),
		});
	});
}
