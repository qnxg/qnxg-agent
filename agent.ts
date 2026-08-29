/**
 * GreptimeDB 观测数据查询 Agent 入口
 *
 * 输入需求 -> 模型生成 QuickJS 代码 -> 沙箱执行 query + 分析 -> 输出全过程。
 */

// 加载 .env（Node 20.12+ 原生支持，文件不存在则跳过）
try {
	process.loadEnvFile();
} catch {
	// 没有 .env，依赖外部环境变量
}

import { startRepl } from "./src/agent/repl.js";
import { createAgent } from "./src/agent/session.js";

const session = await createAgent();
await startRepl(session);
