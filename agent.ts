/**
 * GreptimeDB 观测数据查询 Agent
 *
 * 输入需求 -> 模型生成 QuickJS 代码 -> 沙箱执行 query + 分析 -> 输出全过程。
 */

import { readFileSync } from "node:fs";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

// 加载 .env（Node 20.12+ 原生支持，文件不存在则跳过）
try {
  process.loadEnvFile();
} catch {
  // 没有 .env，依赖外部环境变量
}

import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { quickjsTool } from "./src/quickjs-tool.js";

const modelRuntime = await ModelRuntime.create({
  authPath: "auth.json",
});

const promptMd = readFileSync("src/prompt/prompt.md", "utf-8");

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
  customTools: [quickjsTool],
  tools: ["quickjs_exec"],
});

// 订阅事件，输出整个过程
session.subscribe((event) => {
  switch (event.type) {
    case "message_update":
      if (event.assistantMessageEvent.type === "text_delta") {
        process.stdout.write(event.assistantMessageEvent.delta);
      }
      break;
    case "tool_execution_start": {
      console.log(`\n[tool] 调用 ${event.toolName}`);
      console.log("[tool 输入]");
      console.log(formatToolIO(event.args));

      break;
    }
    case "tool_execution_end": {
      console.log(`[tool 输出]`);
      // console.log(event.result)
      console.log(formatToolIO(event.result));
      break;
    }
    default:
      break;
  }

});

function formatToolIO(value: unknown): string {
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

console.log("GreptimeDB 查询 Agent 已就绪（输入 exit 退出）\n");

const rl = readline.createInterface({ input, output });
while (true) {
  let text: string;
  try {
    text = (await rl.question("需求> ")).trim();
  } catch {
    break; // stdin 关闭
  }
  if (!text) continue;
  if (text === "exit" || text === "quit") break;
  console.log();
  await session.prompt(text);
  console.log("\n");
}

session.dispose();
rl.close();
