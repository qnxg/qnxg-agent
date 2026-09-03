/**
 * GreptimeDB 观测数据查询 Agent 入口
 *
 * 输入需求 -> 模型生成 QuickJS 代码 -> 沙箱执行 query + 分析 -> 输出全过程。
 */

import { loadRootEnv } from "./src/env.js";

loadRootEnv();

import { startRepl } from "./src/agent/repl.js";
import { createAgent } from "./src/agent/session.js";

const session = await createAgent();
await startRepl(session);
