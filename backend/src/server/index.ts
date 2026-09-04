/**
 * Web UI 后端入口
 *
 * 启动时创建 agent session（与 CLI 模式共用 createAgent），
 * 暴露 HTTP API 给前端：
 * - POST   /api/chat     发消息，SSE 流式返回
 * - GET    /api/history  对话历史（页面刷新恢复）
 * - DELETE /api/history  清空对话
 * - GET    /api/info     模型等元信息
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
import { createAgent } from "../agent/session.js";
import { registerChatRoute } from "./chat.js";
import { registerHistoryRoutes } from "./history.js";
import { PromptQueue } from "./prompt-queue.js";

const PORT = Number(process.env.PORT ?? 3210);

const session = await createAgent();
const queue = new PromptQueue();

// 通过 workspace 依赖（@qnxg/webui）定位前端构建产物，不依赖 CWD
const webuiDist = path.join(
	path.dirname(
		createRequire(import.meta.url).resolve("@qnxg/webui/package.json"),
	),
	"dist",
);

const app = new Hono();

app.get("/api/info", (c) => c.json({ model: session.model?.id ?? "unknown" }));
registerChatRoute(app, session, queue);
registerHistoryRoutes(app, session);

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
