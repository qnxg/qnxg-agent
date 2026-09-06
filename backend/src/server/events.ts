/**
 * 会话事件通道：GET /api/sessions/:id/events?clientId=xxx
 *
 * 前端打开某个会话时建立的长驻 SSE 连接，作用：
 * 1. 会话池的"保鲜"信号：连接着的会话不会被淘汰（见 session-pool.ts）
 * 2. 写者锁通知：推送 role 事件 { writer: boolean }，
 *    多标签页打开同一会话时只有写者能发消息
 * 3. 以后服务端主动事件（其他标签页的活动、alert 通知等）也从这里推
 *
 * clientId 由前端按标签页生成（sessionStorage），刷新页面保持不变，
 * 配合服务端 3 秒宽限期，刷新后仍是写者。
 *
 * 空闲时每 15s 发一行 ping 注释帧，防止浏览器/中间代理掐断空闲连接。
 */

import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { SessionPool } from "./session-pool.js";

const KEEPALIVE_INTERVAL_MS = 15_000;

export function registerEventsRoute(app: Hono, pool: SessionPool) {
	app.get("/api/sessions/:id/events", async (c) => {
		const id = c.req.param("id");
		const clientId = c.req.query("clientId");
		if (!clientId) return c.json({ error: "缺少 clientId" }, 400);

		const pooled = await pool.acquire(id);
		if (!pooled) return c.json({ error: "会话不存在" }, 404);

		pool.connect(id, clientId);

		return streamSSE(c, async (stream) => {
			let aborted = false;

			const sendRole = async () => {
				try {
					await stream.writeSSE({
						event: "role",
						data: JSON.stringify({ writer: pool.isWriter(id, clientId) }),
					});
				} catch {
					cleanup();
				}
			};

			const offWriterChange = pool.onWriterChange(id, () => {
				if (!aborted) void sendRole();
			});

			const cleanup = () => {
				if (aborted) return;
				aborted = true;
				offWriterChange();
				pool.disconnect(id, clientId);
			};
			stream.onAbort(cleanup);

			// 初始角色（connect 时可能没有监听者，这里主动推一次）
			await sendRole();

			while (!aborted) {
				await stream.sleep(KEEPALIVE_INTERVAL_MS);
				if (aborted) break;
				try {
					// SSE 注释帧：仅保活，客户端 EventSource 不会触发事件
					await stream.write(": ping\n\n");
				} catch {
					cleanup();
				}
			}
		});
	});
}
