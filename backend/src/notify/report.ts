/**
 * 报告消息构造
 *
 * 定义发往 RabbitMQ（队列 message.qqrobot）的消息契约，发送前由
 * renderQueueMessage 渲染为纯文本，QQ 机器人端直接转发展示。
 * 一个接口一条消息；报告随分析产出，恢复通知由闸门的 recovered 事件直接生成。
 */
import type { RouteAlert } from "../alert/types.js";

/** 接口告警报告：每个活跃接口一条 */
export interface AlertReportMessage {
	type: "alert_report";
	/** 报告生成时间（ISO 8601） */
	generatedAt: string;
	/** 接口路径 */
	route: string;
	/** 异常已持续的时长（ms，从首个信号被确认起算） */
	durationMs: number;
	/** 该接口当前活跃的信号（每规则一条） */
	signals: {
		rule: string;
		message: string;
		value?: number;
	}[];
	/** agent 的根因注释（可能尚无——分析未完成时也会先发一份报告） */
	annotation?: string;
}

/** 接口恢复通知 */
export interface RecoveredMessage {
	type: "recovered";
	generatedAt: string;
	route: string;
	/** 异常持续的的总时长（ms） */
	durationMs: number;
	/** 恢复前 agent 给的根因注释（如果有） */
	annotation?: string;
}

export type QueueMessage = AlertReportMessage | RecoveredMessage;

/** 构造某接口的告警报告消息 */
export function buildAlertReport(alert: RouteAlert): AlertReportMessage {
	return {
		type: "alert_report",
		generatedAt: new Date().toISOString(),
		route: alert.route,
		durationMs: alert.firstSeenAt ? Date.now() - alert.firstSeenAt : 0,
		signals: alert.signals.map((s) => ({
			rule: s.ruleId,
			message: s.message,
			value: s.value,
		})),
		annotation: alert.annotation,
	};
}

/** 构造某接口的恢复通知 */
export function buildRecoveredMessage(alert: RouteAlert): RecoveredMessage {
	return {
		type: "recovered",
		generatedAt: new Date().toISOString(),
		route: alert.route,
		durationMs: alert.firstSeenAt ? Date.now() - alert.firstSeenAt : 0,
		annotation: alert.annotation,
	};
}

function formatDuration(ms: number): string {
	if (ms < 60_000) return `${Math.round(ms / 1000)} 秒`;
	return `${Math.round(ms / 60000)} 分钟`;
}

/** 把队列消息渲染为纯文本（发往 QQ 机器人端直接展示） */
export function renderQueueMessage(msg: QueueMessage): string {
	const lines: string[] = [];
	if (msg.type === "alert_report") {
		lines.push("⚠️ 接口告警", `接口: ${msg.route}`, `已持续: ${formatDuration(msg.durationMs)}`, "", "活跃信号:");
		for (const s of msg.signals) {
			const value = s.value !== undefined ? `（当前值 ${s.value}）` : "";
			lines.push(`- ${s.message}${value}`);
		}
		if (msg.annotation) lines.push("", `根因分析: ${msg.annotation}`);
	} else {
		lines.push("✅ 接口已恢复", `接口: ${msg.route}`, `异常持续: ${formatDuration(msg.durationMs)}`);
		if (msg.annotation) lines.push(`根因分析: ${msg.annotation}`);
	}
	return lines.join("\n");
}
