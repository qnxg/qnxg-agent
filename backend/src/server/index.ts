/**
 * Web UI 后端入口
 *
 * 多会话架构：SessionPool 管理所有 AgentSession（持久化在 sessions/ 目录），
 * 暴露 HTTP API 给前端：
 * - GET  /api/sessions               会话列表
 * - POST /api/sessions               新建会话
 * - DELETE /api/sessions/:id         删除会话（含磁盘文件）
 * - GET  /api/sessions/:id/info      会话元信息（模型等）
 * - GET  /api/sessions/:id/history   对话历史（页面刷新恢复）
 * - POST /api/sessions/:id/chat      发消息，SSE 流式返回
 * - GET  /api/sessions/:id/events    会话事件通道（长驻 SSE，兼作会话池保鲜信号）
 *
 * 开发时 vite proxy 把 /api 转发到这里；
 * 生产时通过 workspace 依赖定位 webui 构建产物，同一进程 serve 前端静态文件。
 */

import { loadRootEnv } from "../env.js";

loadRootEnv();

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { registerChatRoute } from "./chat.js";
import { registerEventsRoute } from "./events.js";
import { registerHistoryRoutes } from "./history.js";
import { SessionPool } from "./session-pool.js";

const PORT = Number(process.env.PORT ?? 3210);

/** 会话持久化目录（相对 backend/ 工作目录） */
const SESSIONS_DIR = "sessions";

const pool = new SessionPool(SESSIONS_DIR);

// 通过 workspace 依赖（@qnxg/webui）定位前端构建产物，不依赖 CWD
const webuiDist = path.join(
	path.dirname(
		createRequire(import.meta.url).resolve("@qnxg/webui/package.json"),
	),
	"dist",
);

const app = new Hono();

app.get("/api/sessions", async (c) => c.json(await pool.list()));

app.post("/api/sessions", async (c) => {
	const pooled = await pool.create();
	return c.json({ id: pooled.id });
});

app.delete("/api/sessions/:id", async (c) => {
	const removed = await pool.remove(c.req.param("id"));
	if (!removed) return c.json({ error: "会话不存在" }, 404);
	return c.json({ ok: true });
});

app.get("/api/sessions/:id/info", async (c) => {
	const pooled = await pool.acquire(c.req.param("id"));
	if (!pooled) return c.json({ error: "会话不存在" }, 404);
	return c.json({ model: pooled.session.model?.id ?? "unknown" });
});

registerChatRoute(app, pool);
registerHistoryRoutes(app, pool);
registerEventsRoute(app, pool);

// 生产模式：serve 前端构建产物 + SPA fallback（dev 模式由 vite proxy 接管）
if (existsSync(path.join(webuiDist, "index.html"))) {
	app.use("/*", serveStatic({ root: webuiDist }));
	app.get("*", serveStatic({ path: path.join(webuiDist, "index.html") }));
} else {
	console.warn(`[warn] 前端构建产物不存在：${webuiDist}，仅提供 API`);
	console.warn("[warn] 如需完整 Web UI，请运行: pnpm web（会自动构建前端）");
}

serve({ fetch: app.fetch, port: PORT }, (info) => {
	console.log(`Agent Web UI 已启动: http://localhost:${info.port}`);
});
