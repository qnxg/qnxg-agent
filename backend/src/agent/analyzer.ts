/**
 * 告警分析器
 *
 * 把闸门当前活跃的接口告警（RouteAlert[]）交给 agent 做深度分析。
 * 单次会话批量分析所有接口（prompt 按接口分节），agent 用 query() 自行查数据
 * 验证、判断根因，然后用 annotate_alert 工具给每个接口打上简短注释。
 *
 * 复用长期 agent session，每次分析前清空历史，避免上下文污染。
 * 分析过程通过订阅 text_delta 打印到 stdout（调试可见）；结论靠工具写入。
 */
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { RouteAlert } from "../alert/types.js";

/** 已持续时长格式化为 "37 分钟" / "2.1 小时" */
function formatDuration(ms: number): string {
	const min = Math.round(ms / 60000);
	if (min < 60) return `${min} 分钟`;
	return `${(min / 60).toFixed(1)} 小时`;
}

/**
 * 从活跃告警构造分析任务提示词。
 *
 * 提示词分工：领域知识（表结构/查询经验）在系统提示词里，这里只给
 * "本次哪些接口异常 + 要做什么 + 分析完用 annotate_alert 打注释"，不重复领域知识。
 */
function buildPrompt(alerts: RouteAlert[], now: number): string {
	// 按接口分节：一节 = 一个接口的全部信号 + 持续时长 + 上次注释
	const sections = alerts
		.map((a, i) => {
			const signalLines = a.signals
				.map(
					(s) =>
						`   - [${s.ruleId}] ${s.message}${s.value !== undefined ? `（当前值: ${s.value}）` : ""}`,
				)
				.join("\n");
			const duration = a.firstSeenAt
				? `（已持续 ${formatDuration(now - a.firstSeenAt)}）`
				: "";
			const prev = a.annotation ? `\n   💬 上次分析: ${a.annotation}` : "";
			return `### ${i + 1}. ${a.route} ${duration}\n${signalLines}${prev}`;
		})
		.join("\n\n");

	return `你是微湖大后端的告警分析助手。下面是当前正在告警的接口（按接口分组），
请对每个接口做根因分析。多个接口同时异常时，注意判断它们是否同根因。

## 当前异常接口

${sections}

## 分析要求

- **必须用 query() 查数据，禁止仅凭告警描述推断根因。**
- 对每个接口：
  - 查指标表 http_request_metrics_1m 看趋势（错误率/耗时/请求量随时间变化）
  - 查 trace 表 opentelemetry_traces 看错误消息分布（span_status_message 的 COUNT）
  - 判断根因类别：上游系统故障 / 代码 bug / 流量异常 / 缓存失效 / 其它
- 时间筛选：先用 SELECT MAX(time_window) FROM http_request_metrics_1m 确认数据最新时间再推算窗口；对 traces 的任何查询都必须带 timestamp >= 下限。
- 如果查到的数据与告警信号不符（如错误率已恢复），也要如实说明，可能意味着告警规则或检测链路有问题。

## 分析完必须做的操作

每个接口分析完后，调用 annotate_alert 工具给它打注释：
- 参数 route 从上面的接口列表取。
- comment 写根因分析，让人明白情况，分析要以具体的证据为基础。
- 你的作用是辅助开发者发现问题，分析应当以推测为主，无法百分百确定的事情不要下结论。
- 不要使用黑话，降低阅读者的理解负担。
- 每个接口都要调用一次 annotate_alert。`;
}

/**
 * 用 agent 批量分析当前活跃的接口告警（单次会话）。
 * agent 在分析过程中调用 annotate_alert 工具，把简短注释写入闸门的 RouteAlert。
 *
 * @param session 复用的长期 agent session
 * @param alerts 闸门当前活跃的接口告警列表
 */
export async function analyzeAlerts(
	session: AgentSession,
	alerts: RouteAlert[],
): Promise<void> {
	// 每次分析前清空历史，避免上次分析的上下文污染本次
	session.agent.state.messages = [];

	await session.prompt(buildPrompt(alerts, Date.now()));
}
