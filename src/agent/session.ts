/**
 * Agent session 创建
 *
 * 装配 ModelRuntime + 资源加载器 + quickjs_exec 工具，返回可对话的 session。
 * 订阅事件把模型输出和工具调用过程打到 stdout。
 */
import { readFileSync } from "node:fs";
import {
  createAgentSession,
  DefaultResourceLoader,
  defineTool,
  getAgentDir,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { quickjsTool } from "./quickjs-tool.js";

export function formatToolIO(value: unknown): string {
  if (value == null) return String(value);
  // 自定义工具的 args: { code: string }，直接展示代码
  if (typeof value === "object" && "code" in (value as any)) {
    return String((value as any).code);
  }
  // 工具结果: { content: [{ type: "text", text: string }] }，提取文本
  if (typeof value === "object" && "content" in (value as any)) {
    const content = (value as any).content;
    if (Array.isArray(content)) {
      const text = content
        .filter((c: any) => c?.type === "text")
        .map((c: any) => c.text)
        .join("\n");
      return text;
    }
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export async function createAgent(
  extraTools: ReturnType<typeof defineTool>[] = [],
): Promise<AgentSession> {
  const modelRuntime = await ModelRuntime.create({
    authPath: "auth.json",
  });

  const promptMd = readFileSync("src/agent/prompt/prompt.md", "utf-8");

  const loader = new DefaultResourceLoader({
    cwd: process.cwd(),
    agentDir: getAgentDir(),
    noExtensions: true,
    systemPromptOverride: () =>
      `你是微生活 agent，负责查询和分析微湖大（weihuda）校园服务后端的观测数据。\n\n${promptMd}`,
  });
  await loader.reload();

  const { session } = await createAgentSession({
    sessionManager: SessionManager.inMemory(),
    modelRuntime,
    resourceLoader: loader,
    noTools: "all",
    customTools: [quickjsTool, ...extraTools],
    tools: ["quickjs_exec", ...extraTools.map((t) => t.name)],
  });



  return session;
}
