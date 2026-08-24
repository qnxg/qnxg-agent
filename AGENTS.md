# AGENTS.md

GreptimeDB 观测数据查询 agent：用户提问 → 模型生成 QuickJS 代码 → 沙箱内 `query(sql)` 查询并分析 → 返回结果。基于 `@earendil-works/pi-coding-agent`。

## 外部文档

- **GreptimeDB SQL 参考**：https://docs.greptime.cn/SKILL.md
- **Pi SDK 参考**：https://pi.dev/docs/latest/sdk
- **quickjs-emscripten 参考**：https://www.npmjs.com/package/quickjs-emscripten
- 涉及 GreptimeDB SQL 语法、Pi SDK API 或 QuickJS 沙箱 API 时，**优先查阅上述在线文档**，不要翻本地 `node_modules` 源码。

## 运行

```bash
npm install
npm start          # 实际执行 tsx agent.ts
```

- 需要 Node 20.12+（`process.loadEnvFile()` 原生 env 加载）。
- 复制 `.env.example` 为 `.env` 并填入 `GREPTIME_USERNAME` / `GREPTIME_PASSWORD` / `GREPTIME_URL`。前两者缺失会抛错；`GREPTIME_URL` 缺失时 fetch 会失败（`src/greptime-query.ts` 里的 `DEFAULT_URL` 是死代码，未实际使用）。
- `auth.json` 当前为空 `{}`，真正的模型配置由 pi 从 `getAgentDir()` 指向的系统目录加载，不在本仓库内。
- `package.json` 的 `quickstart` 脚本指向不存在的 `quickstart.ts`，是失效脚本，忽略即可。
- 依赖 `pi-coding-agent` 用的是 `latest`，`npm install` 可能拉到不兼容版本；行为有变化时先查 `package-lock.json` 里实际锁定的版本。

## 工具链与约定

- 纯 ESM（`"type": "module"`）。相对导入必须带 `.js` 扩展名，即使源文件是 `.ts`（如 `./quickjs-runtime.js`）。
- 没有构建步骤、没有 lint / typecheck / test 脚本。改完代码直接 `npm start` 跑一下验证即可。
- TS 仅靠 `tsx` 即时执行，无 `tsc` 校验；类型错误不会在运行前暴露。

## 架构要点

- `agent.ts` 是唯一入口：加载 env → 创建 `ModelRuntime`（读 `auth.json`）→ `DefaultResourceLoader`（`noExtensions: true`，工具走自定义）→ `createAgentSession`（禁用所有内置工具，只挂 `quickjs_exec`）→ REPL 循环。
- `src/quickjs-tool.ts`：定义 `quickjs_exec` 工具，参数为 `{ code: string }`。
- `src/quickjs-runtime.ts`：用 `quickjs-emscripten` 的 asyncify 构建沙箱。宿主端 `query()` 是 async fetch，QuickJS 内部同步调用。沙箱有内存/栈上限。最后一行表达式求值结果作为返回值，约定用 `JSON.stringify(...)` 转字符串。
- `src/greptime-query.ts`：POST 到 GreptimeDB HTTP SQL API（`application/x-www-form-urlencoded`，`sql=...`）。

## QuickJS 沙箱约定（改 prompt 或工具时遵守）

沙箱内可用全局：`query(sql)` 返回 JSON 字符串；`log(...args)` 收集调试输出。返回结构为 `{ output: [{ records: { schema, rows } }] }`。
