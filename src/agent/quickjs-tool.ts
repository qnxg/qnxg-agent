/**
 * quickjs_exec 工具定义
 *
 * 让 agent 能执行 QuickJS 代码来查询和分析 GreptimeDB 数据。
 */

import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { runQuickJS } from "./quickjs-runtime.js";

export const quickjsTool = defineTool({
	name: "quickjs_exec",
	label: "QuickJS 执行",
	description: `在 QuickJS 沙箱中执行 JavaScript 代码，用于查询和分析 GreptimeDB 观测平台数据。

沙箱内可用的全局函数：
- query(sql): 同步执行 SQL 查询，返回 GreptimeDB 的 JSON 结果字符串。
  返回结构为 { output: [{ records: { schema: { column_schemas: [{name}] }, rows: [[...]] } }] }
- log(...args): 打印调试信息，会收集起来随工具结果一起返回。

典型用法：
  var raw = query("SELECT ...");
  var data = JSON.parse(raw);
  var rows = data.output[0].records.rows;
  // 分析 rows ...
  JSON.stringify(results);  // 最后一行的表达式值作为返回值返回`,
	parameters: Type.Object({
		code: Type.String({ description: "要执行的 JavaScript 代码" }),
	}),
	execute: async (_toolCallId, params, _signal, onUpdate) => {
		// 实时流式输出：沙箱里每次 log() 都把截至目前累计的 logs
		// 作为 partial result 推给上层（webui 展开工具卡片能看到实时输出）
		const streamedLogs: string[] = [];
		const pushUpdate = (line: string) => {
			streamedLogs.push(line);
			onUpdate?.({
				content: [{ type: "text", text: streamedLogs.join("\n") }],
				details: {},
			});
		};

		const { result, error, logs } = await runQuickJS(params.code, {
			onLog: onUpdate ? pushUpdate : undefined,
		});
		const output = [...logs, error ?? result].join("\n");

		return {
			content: [{ type: "text", text: output }],
			details: {},
		};
	},
});
