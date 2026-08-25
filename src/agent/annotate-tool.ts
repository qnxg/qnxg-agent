/**
 * annotate_alert 工具
 *
 * 让 agent 分析完告警后，给对应告警实例打上简短注释（根因摘要）。
 * 注释写到状态机的 AlertInstance.annotation，供运维一眼看明白。
 *
 * 用工厂函数 createAnnotateTool(stateMachine) 把状态机引用闭包进去，
 * 这样工具的 execute 才能访问到运行时的状态机实例。
 */
import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { AlertStateMachine } from "../alert/state-machine.js";

export function createAnnotateTool(stateMachine: AlertStateMachine) {
  return defineTool({
    name: "annotate_alert",
    label: "给告警打注释",
    description: `分析完一个告警后调用此工具，给它打上简短注释。

要求：
- 如果相较于上一轮的注释有新的发现，更新注释内容并标注。
- 控制在一行内
- 不要把完整分析过程塞进来，只写结论性摘要。
- 每个告警分析完都要调用一次。`,
    parameters: Type.Object({
      ruleId: Type.String({ description: "告警对应的规则 ID（从告警列表里取）" }),
      groupKey: Type.String({ description: "告警的分组键，如 route=/electricity" }),
      comment: Type.String({ description: "简短注释" }),
    }),
    execute: async (_toolCallId, params) => {
      const ok = stateMachine.annotate(
        params.ruleId,
        params.groupKey,
        params.comment,
      );
      return {
        content: [
          {
            type: "text",
            text: ok
              ? `已注释 ${params.groupKey}: ${params.comment}`
              : `未找到告警实例 ruleId=${params.ruleId} groupKey=${params.groupKey}`,
          },
        ],
        details: {},
      };
    },
  });
}
