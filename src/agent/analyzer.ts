/**
 * 告警分析器
 *
 * 低频（如每小时）把状态机当前 firing 的告警交给 agent 做深度分析，
 * agent 用 query() 自行查数据验证、判断根因，然后用 annotate_alert 工具
 * 给每个告警打上简短注释（写到 AlertInstance.annotation）。
 *
 * 复用长期 agent session，每次分析前清空历史，避免上下文污染。
 * 分析过程通过订阅 text_delta 打印到 stdout（调试可见）；结论靠工具写入。
 */
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { Signal } from "../alert/types.js";

/**
 * 从 firing 信号构造分析任务提示词。
 *
 * 提示词分工：领域知识（表结构/查询经验）在系统提示词里，这里只给
 * "本次有哪些告警 + 要做什么 + 分析完用 annotate_alert 打注释"，不重复领域知识。
 */
function buildPrompt(firingSignals: Signal[]): string {
  // 告警列表：每条给 ruleId / groupKey / 现象 / 当前值
  // ruleId 和 groupKey 是 agent 调用 annotate_alert 时定位告警实例的依据
  const alertLines = firingSignals
    .map((s, i) => {
      const valueLine =
        s.value !== undefined ? `   当前值: ${s.value}\n` : "";
      return `${i + 1}. ruleId: ${s.ruleId}
   groupKey: ${s.groupKey}
   现象: ${s.message}
${valueLine}`;
    })
    .join("\n");

  return `你是微湖大后端的告警分析助手。下面是当前正在告警（firing）的信号，请对每个告警做根因分析。

## 当前告警

${alertLines}
## 分析要求

- **必须用 query() 查数据，禁止仅凭告警描述推断根因。**
- 对每个告警：
  - 查指标表 http_request_metrics_1m 看趋势（错误率/耗时/请求量随时间变化）
  - 查 trace 表 opentelemetry_traces 看错误消息分布（span_status_message 的 COUNT）
  - 判断根因类别：上游系统故障 / 代码 bug / 流量异常 / 缓存失效 / 其它
- 时间筛选用 SELECT MAX(timestamp) 确认数据最新时间再推算窗口。
- 如果查到的数据与告警信号不符（如错误率已恢复），也要如实说明，可能意味着告警规则或检测链路有问题。

## 分析完必须做的操作

每个告警分析完后，调用 annotate_alert 工具给它打注释：
- 参数 ruleId / groupKey 从上面的告警列表取。
- comment 写一句话根因摘要，**尽量短，让人一眼能看明白情况**。不要把分析过程塞进 comment。
- 每个告警都要调用一次 annotate_alert。`;
}

/**
 * 用 agent 分析当前 firing 告警。
 * agent 在分析过程中调用 annotate_alert 工具，把简短注释写入状态机实例。
 *
 * @param session 复用的长期 agent session
 * @param firingSignals 状态机当前 firing 的信号列表
 */
export async function analyzeAlerts(
  session: AgentSession,
  firingSignals: Signal[],
): Promise<void> {
  // 每次分析前清空历史，避免上次分析的上下文污染本次
  session.agent.state.messages = [];

  // 打印 agent 分析过程到 stdout；结论靠 annotate_alert 工具写入状态机
  // const unsubscribe = session.subscribe((event) => {
  //   if (
  //     event.type === "message_update" &&
  //     event.assistantMessageEvent.type === "text_delta"
  //   ) {
  //     // process.stdout.write(event.assistantMessageEvent.delta);
  //   }
  // });

  try {
    await session.prompt(buildPrompt(firingSignals));
  } finally {
    // unsubscribe();
  }
}
