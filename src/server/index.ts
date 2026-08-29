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
 * 生产时若 web/dist 存在，直接用同一进程 serve 前端静态文件。
 */

// 加载 .env（Node 20.12+ 原生支持，文件不存在则跳过）
try {
  process.loadEnvFile();
} catch {
  // 没有 .env，依赖外部环境变量
}

import { existsSync } from "node:fs";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { createAgent } from "../agent/session.js";
import { PromptQueue } from "./prompt-queue.js";
import { registerChatRoute } from "./chat.js";
import { registerHistoryRoutes } from "./history.js";

const PORT = Number(process.env.PORT ?? 3210);

const session = await createAgent();
const queue = new PromptQueue();

const app = new Hono();

app.get("/api/info", (c) =>
  c.json({ model: session.model?.id ?? "unknown" }),
);
registerChatRoute(app, session, queue);
registerHistoryRoutes(app, session);

// 生产模式：webui/dist 存在时 serve 前端构建产物 + SPA fallback
if (existsSync("webui/dist/index.html")) {
  app.use("/*", serveStatic({ root: "./webui/dist" }));
  app.get("*", serveStatic({ path: "./webui/dist/index.html" }));
}

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`Agent Web UI 已启动: http://localhost:${info.port}`);
});
