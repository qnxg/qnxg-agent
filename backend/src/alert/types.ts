/**
 * 告警系统类型契约
 *
 * 以"接口（route）"为一等实体：所有规则产出的信号都挂在某个接口上，
 * 闸门按接口聚合管理，agent 按接口分节分析、打注释。
 */

/** 告警信号：检测器产出，闸门的输入。一个信号 = 某接口在某规则下异常 */
export interface Signal {
	/** 产生该信号的规则 ID */
	ruleId: string;
	/** 异常的接口路径，如 "/electricity"。信号归属的唯一维度 */
	route: string;
	/** 触发时观察到的值（如错误率 15.0） */
	value?: number;
	/** 人类可读描述 */
	message: string;
	/** 触发时间(ms) */
	timestamp: number;
}

/**
 * 告警规则接口（策略模式）
 *
 * 每条规则是一个实现此接口的对象，检测器只管调用 evaluate()，
 * 不关心规则内部如何查询和判断。
 */
export interface AlertRule {
	id: string;
	name: string;
	description?: string;
	/** 检测的执行间隔，单位：tick（loop 每 TICK_MS 一轮） */
	interval: number;
	/** 执行检测，返回零到多个信号（空数组表示当前未触发） */
	evaluate(): Promise<Signal[]>;
}

/**
 * 一个接口的告警状态：闸门（AlertGate）维护的实体。
 *
 * 条目的存在性由注册表驱动（sync 保证条目集合 == 注册表集合），
 * 内部状态由 updateEntry 维护：维度级去抖（进出对称）+ 接口级聚合。
 *
 * 维度级进出对称去抖：
 * - 去抖中维度（hitStreaks）：连续 DEBOUNCE_HITS 轮命中才确认活跃；单轮未命中即回退
 * - 活跃维度（signals + missStreaks）：连续 RECOVER_AFTER_MISS 轮未命中才移除；中途命中清零
 * - "未命中"= 该规则本轮激活（interval 对齐）且未给该接口产信号
 */
export interface RouteAlert {
	/** 接口路径，如 "/electricity" */
	route: string;
	/** 已确认活跃的信号（每规则维度保留最新一条） */
	signals: Signal[];
	/** 去抖中维度：ruleId -> 连续命中轮数（未确认） */
	hitStreaks: Map<string, number>;
	/** 活跃维度：ruleId -> 连续未命中轮数（恢复去抖） */
	missStreaks: Map<string, number>;
	/** 首个信号被确认（进入活跃）的时间(ms)，恢复重置时清零 */
	firstSeenAt: number;
	/** 最近一次 agent 分析完成的时间(ms) */
	lastAnalyzedAt?: number;
	/** agent 分析后打的简短注释（根因摘要，恢复重置时保留供下轮参考） */
	annotation?: string;
}
