/**
 * 信号处理器：分组
 *
 * 按 groupKey 聚合信号，不做组内抑制，保留全部信号。
 * 这一层与 agent 无关，是纯信号处理，在检测之后、状态机/推送之前。
 */
import type { AlertGroup, Signal } from "./types.js";

export function processSignals(signals: Signal[]): AlertGroup[] {
	// 1. 按 groupKey 分组
	const groups = new Map<string, Signal[]>();
	for (const s of signals) {
		const arr = groups.get(s.groupKey);
		if (arr) {
			arr.push(s);
		} else {
			groups.set(s.groupKey, [s]);
		}
	}

	// 2. 转换为 AlertGroup
	const result: AlertGroup[] = [];
	for (const [groupKey, sigs] of groups) {
		result.push({ groupKey, signals: sigs });
	}
	return result;
}
