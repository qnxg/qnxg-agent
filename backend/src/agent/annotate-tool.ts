/**
 * annotate_alert 工具
 *
 * 让 agent 分析完一个接口后，给该接口的告警打上简短注释（根因摘要）。
 * 注释写到 AlertGate 的 RouteAlert.annotation，供报告/运维一眼看明白。
 *
 * 用工厂函数 createAnnotateTool(gate) 把闸门引用闭包进去，
 * 这样工具的 execute 才能访问到运行时的闸门实例。
 */

import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { AlertGate } from "../alert/gate.js";

export function createAnnotateTool(gate: AlertGate) {
	return defineTool({
		name: "annotate_alert",
		label: "给接口告警打注释",
		description: `分析完一个接口后调用此工具，给该接口的告警打上简短注释。

要求：
- 如果相较于上一轮的注释有新的发现，更新注释内容并标注。
- 控制在一行内
- 不要把完整分析过程塞进来，只写结论性摘要。
- 每个接口分析完都要调用一次。`,
		parameters: Type.Object({
			route: Type.String({
				description: "告警对应的接口路径（从告警列表里取），如 /electricity",
			}),
			comment: Type.String({ description: "简短注释" }),
		}),
		execute: async (_toolCallId, params) => {
			const ok = gate.annotate(params.route, params.comment);
			return {
				content: [
					{
						type: "text",
						text: ok
							? `已注释 ${params.route}: ${params.comment}`
							: `未找到该接口的活跃告警: ${params.route}`,
					},
				],
				details: {},
			};
		},
	});
}
