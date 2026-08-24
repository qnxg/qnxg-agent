/**
 * 交互式 REPL：手动与 agent 对话的接口
 *
 * 从 stdin 读一行输入 -> session.prompt -> 输出回复，循环直到 exit 或 stdin 关闭。
 * 抽成函数，便于以后手动调用接入（比如告警系统低频分析想复用对话能力）。
 */
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { formatToolIO } from "./session.js";
export async function startRepl(session: AgentSession): Promise<void> {
  console.log("GreptimeDB 查询 Agent 已就绪（输入 exit 退出）\n");

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
        console.log(formatToolIO(event.result));
        break;
      }
      default:
        break;
    }
  });

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
}
