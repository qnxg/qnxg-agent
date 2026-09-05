/**
 * 告警闸门（AlertGate）
 *
 * 站在"异常信号"和"agent 分析/报告"之间的触发决策器，只回答三个问题：
 * 1. 这个异常是真的吗？      —— 维度级去抖（连续 DEBOUNCE_HITS 轮命中才确认）
 * 2. 这个问题恢复了吗？      —— 维度级恢复去抖（连续 RECOVER_AFTER_MISS 轮未命中才移除）
 * 3. 这个接口该被重新关注吗？—— new-problem 事件（新接口异常 / 已活跃接口长出新维度）
 *
 * 条目管理与状态更新分离：
 * - 条目存在性由注册表驱动（sync）：条目集合 == 注册表集合，updateEntry 不做增删
 * - updateEntry 是纯状态更新：计数 → 确认 → 恢复 → 重置（recovered 后条目保留）
 *
 * 信号分拣：
 * - 已知接口：正常路径（去抖/聚合/恢复）
 * - 未知接口（新上线、注册表尚未刷新）：信号直接以 unknown-routes 决策返回
 *   （消费方打日志即可），刷新转正后自动走正常路径
 * - 注册表为空（启动刷新失败）：退化为信号驱动建条目（全部视为已知）
 *
 * 注意：只有"本轮激活的规则"（interval 对齐）产生的信号才参与计数；
 * 规则激活但未给某接口产信号才算"未命中"。当前所有规则每轮都覆盖全量接口。
 */
import type { RouteAlert, Signal } from "./types.js";

/** 闸门产出的决策事件，消费方据此决定后续动作 */
export type GateDecision =
	/** 新问题确认：新接口的信号去抖通过，或已活跃接口长出新维度的信号 → 建议唤醒 agent */
	| { type: "new-problem"; alert: RouteAlert }
	/** 接口恢复：全部活跃维度被移除 → 发恢复通知（模板即可，不需要 LLM） */
	| { type: "recovered"; alert: RouteAlert }
	/** 未知接口出现异常信号（注册表里还没有它）→ 打日志，等注册表刷新转正 */
	| { type: "unknown-routes"; routes: string[] };

export interface GateOptions {
	/** 维度确认：连续命中 N 轮才确认活跃（默认 2） */
	debounceHits: number;
	/** 维度恢复：连续 N 轮未命中才移除活跃信号（默认 3） */
	recoverAfterMiss: number;
}

export class AlertGate {
	private entries = new Map<string, RouteAlert>();
	private readonly opts: GateOptions;

	constructor(opts: Partial<GateOptions> = {}) {
		this.opts = {
			debounceHits: Math.max(1, opts.debounceHits ?? 2),
			recoverAfterMiss: Math.max(1, opts.recoverAfterMiss ?? 3),
		};
	}

	/**
	 * 每轮喂入检测结果，返回本轮产生的决策事件。
	 *
	 * @param signals 本轮检测产出的信号
	 * @param activeRulesID 本轮激活的规则 ID（未激活规则的信号直接忽略，不参与计数）
	 * @param knownRoutes 已知接口集合（来自 RouteRegistry；空集 = 退化为信号驱动）
	 */
	update(
		signals: Signal[],
		activeRulesID: string[],
		knownRoutes: ReadonlySet<string>,
	): GateDecision[] {
		const decisions: GateDecision[] = [];
		const activeRules = new Set(activeRulesID);

		// 1. 按照在线拉取的接口列表及逆行更新：新增接口建空条目，移除接口删条目
		//    注册表为空时跳过（启动刷新失败的退化模式，靠信号驱动建条目）
		if (knownRoutes.size === 0) {
      console.log("警告：已知接口集合为空");
      process.exit(0); // 一般来讲应该不会有这种问题，真遇到就直接杀了进程
    }
    for (const route of knownRoutes) { // 添加新的
  		if (!this.entries.has(route)) {
  			this.entries.set(route, this.newEntry(route));
  		}
  	}
  	for (const route of [...this.entries.keys()]) { // 删除旧的
  		if (!knownRoutes.has(route)) this.entries.delete(route);
  	}

		// 2. 分拣：已知接口的信号按 route 分桶；未知接口只记 route
		const signalsByRoute = new Map<string, Signal[]>();
		const unknownRoute = new Set<string>();
		for (const s of signals) {
			if (!activeRules.has(s.ruleId)) continue;
			if (knownRoutes.size > 0 && !knownRoutes.has(s.route)) {
				unknownRoute.add(s.route);
				continue;
			}
			const arr = signalsByRoute.get(s.route);
			if (arr) arr.push(s);
			else signalsByRoute.set(s.route, [s]);
		}

		// 3. 统一遍历所有条目：有信号的喂信号，无信号的走恢复判定
		for (const entry of this.entries.values()) {
			this.updateEntry(
				entry,
				signalsByRoute.get(entry.route) ?? [],
				activeRules,
				decisions,
			);
		}

		// 4. 未知接口的信号：直接返回给消费方（打日志），刷新转正后自动走正常路径
		if (unknownRoute.size > 0) {
			decisions.push({ type: "unknown-routes", routes: [...unknownRoute] });
		}

		return decisions;
	}

	/** 新建空条目（注册表收录 / 退化模式动态创建） */
	private newEntry(route: string): RouteAlert {
		return {
			route,
			signals: [],
			hitStreaks: new Map(),
			missStreaks: new Map(),
			firstSeenAt: 0,
		};
	}

	/**
	 * 条目纯状态更新（不做条目增删，存在性由注册表 sync 管理）：
	 * - 未命中维度：去抖中的单轮即回退；活跃的累积 missStreaks，达阈值移除
	 * - 命中维度：累积 hitStreaks，达阈值确认活跃（新维度 → new-problem）
	 * - 全部活跃维度被移除 → recovered + 重置条目（annotation 保留）
	 */
	private updateEntry(
		entry: RouteAlert,
		routeSignals: Signal[],
		activeRules: Set<string>,
		decisions: GateDecision[],
	): void {
		// 空条目且本轮无信号：快速返回（全量条目模式下的大多数情况）
		if (
			routeSignals.length === 0 &&
			entry.signals.length === 0 &&
			entry.hitStreaks.size === 0
		) {
			return;
		}


		// 1. 未命中维度处理（只看本轮激活的规则；未激活规则的轮次完全不动计数）
		for (const ruleId of new Set([
			...entry.hitStreaks.keys(),
			...entry.signals.map((s) => s.ruleId),
		])) {
      if (!activeRules.has(ruleId) || routeSignals.some(s => s.ruleId === ruleId))
        continue;
			// 该规则本轮激活但未给此接口产信号
			if (entry.signals.some((s) => s.ruleId === ruleId)) {
				// 活跃维度：恢复去抖
				const miss = (entry.missStreaks.get(ruleId) ?? 0) + 1;
				if (miss >= this.opts.recoverAfterMiss) {
					entry.signals = entry.signals.filter((s) => s.ruleId !== ruleId);
					entry.missStreaks.delete(ruleId);
				} else {
					entry.missStreaks.set(ruleId, miss);
				}
			} else {
				// 去抖中维度：单轮回退（防毛刺确认）
				entry.hitStreaks.delete(ruleId);
			}
		}

		// 2. 命中维度处理
		let newSignalType = false;
		for (const s of routeSignals) {
			entry.missStreaks.delete(s.ruleId); // 命中，恢复计数清零
			const streak = (entry.hitStreaks.get(s.ruleId) ?? 0) + 1;
			entry.hitStreaks.set(s.ruleId, streak);

			const existing = entry.signals.find((sig) => sig.ruleId === s.ruleId);
			if (existing) {
				// 已活跃：刷新最新值/描述
				existing.value = s.value;
				existing.message = s.message;
				existing.timestamp = s.timestamp;
			} else if (streak >= this.opts.debounceHits) {
				// 去抖通过，新确认的维度
				entry.signals.push(s);
				newSignalType = true;
				if (entry.signals.length === 1) {
					entry.firstSeenAt = Date.now();
				}
			}
		}

		// 3. 全部活跃维度被移除：发 recovered（需有活跃历史），重置条目
		if (entry.signals.length === 0) {
			if (entry.firstSeenAt > 0) {
				decisions.push({ type: "recovered", alert: entry });
				this.resetEntry(entry);
			}
			return;
		}

		// 4. 新维度确认 → new-problem
		if (newSignalType) {
			decisions.push({ type: "new-problem", alert: entry });
		}
	}

	/** 重置条目状态（保留 annotation 供下轮分析参考） */
	private resetEntry(entry: RouteAlert): void {
		entry.signals = [];
		entry.hitStreaks.clear();
		entry.missStreaks.clear();
		entry.firstSeenAt = 0;
		entry.lastAnalyzedAt = undefined;
	}

	/** agent 给某接口的告警打注释（根因摘要） */
	annotate(route: string, comment: string): boolean {
		const entry = this.entries.get(route);
		if (!entry) return false;
		entry.annotation = comment;
		return true;
	}

	/** 当前活跃的告警列表（有确认信号的接口），供定时分析/报告用 */
	getActiveAlerts(): RouteAlert[] {
		return [...this.entries.values()].filter((e) => e.signals.length > 0);
	}

	/** 调试用：条目统计（空条目不计入） */
	getStats(): { debouncing: number; active: number } {
		let debouncing = 0;
		let active = 0;
		for (const e of this.entries.values()) {
			if (e.signals.length > 0) active++;
			else if (e.hitStreaks.size > 0 || e.missStreaks.size > 0)
				debouncing++;
		}
		return { debouncing, active };
	}
}
