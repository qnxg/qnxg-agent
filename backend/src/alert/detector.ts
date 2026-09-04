/**
 * 检测器
 *
 * 遍历所有规则，调用其 evaluate()，收集产出的信号。
 * 单条规则抛错不影响其它规则，保证检测循环健壮。
 */
import type { AlertRule, Signal } from "./types.js";

export async function runDetection(rules: AlertRule[]): Promise<Signal[]> {
	const signals: Signal[] = [];
	for (const rule of rules) {
		try {
			// 用 rule.evaluate() 调用，保证对象字面量方法里的 this 正确绑定
			const res = await rule.evaluate();
			signals.push(...res);
		} catch (e) {
			console.error(`[detector] 规则 ${rule.id} 执行失败:`, e);
		}
	}
	return signals;
}
