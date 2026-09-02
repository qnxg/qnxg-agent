/**
 * 对话接口：POST /api/chat
 *
 * body: { message: string }
 * 响应是 SSE 流，订阅 session 事件并转发给浏览器：
 * - text_delta  模型逐字输出
 * - tool_start  工具调用开始（quickjs 的代码入参）
 * - tool_update 工具执行中的实时输出（沙箱内 log() 的累计文本）
 * - tool_end    工具调用结束（执行结果）
 * - done        本轮结束
 * - error       出错
 *
 * 通过 PromptQueue 串行化：请求先排队，排到时才订阅事件，
 * 保证这个连接只收到自己这轮 prompt 的事件，不会和前面排队的串台。
 */

import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { formatToolIO } from "../agent/session.js";
import type { PromptQueue } from "./prompt-queue.js";

export function registerChatRoute(
	app: Hono,
	session: AgentSession,
	queue: PromptQueue,
) {
	app.post("/api/chat", async (c) => {
		const body = await c.req.json<{ message?: string }>().catch(() => null);
		const message = body?.message?.trim();
		if (!message) {
			return c.json({ error: "message 不能为空" }, 400);
		}

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
					await session.prompt(message);
					await send("done", {});
				} catch (e) {
					await send("error", {
						message: e instanceof Error ? e.message : String(e),
					});
				} finally {
					unsubscribe();
				}
			});
		});
	});
}
