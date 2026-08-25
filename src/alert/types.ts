/**
 * 告警系统类型契约
 *
 * 所有模块依赖这里的类型定义，先把契约定下来避免后续反复改。
 */

/** 信号级别：高级抑制低级（critical > warning > info） */
export type Severity = "info" | "warning" | "critical";

/** 告警信号：检测器产出，状态机的输入 */
export interface Signal {
  /** 产生该信号的规则 ID */
  ruleId: string;
  /** 分组键值，如 "route=/electricity"，用于分组/去重 */
  groupKey: string;
  /** 触发时观察到的值（如错误率 15.0） */
  value?: number;
  /** 人类可读描述 */
  message: string;
  /** 触发时间(ms) */
  timestamp: number;
  /** 检测的执行间隔，(或许是以分钟为单位，具体看loop.ts实现)**/
  interval: number,

}

/**
 * 告警规则接口（策略模式）
 *
 * 每条规则是一个实现此接口的对象，检测器只管调用 evaluate()，
 * 不关心具体规则内部如何查询和判断。
 */
export interface AlertRule {
  id: string;
  name: string;
  description?: string;
  /** 分组维度元数据，给人看/WebUI 展示用，如 ["http.route"] */
  groupBy?: string[];
  /** 检测的执行间隔，(或许是以分钟为单位，具体看loop.ts实现)**/
  interval: number,
  /** 执行检测，返回零到多个信号（空数组表示当前未触发） */
  evaluate(): Promise<Signal[]>;
}

/**
 * 处理后的告警组：同一 groupKey 的信号经分组+抑制后的结果。
 * 后续状态机以 groupKey 为单元维护生命周期（每个 groupKey 一个实例）。
 */
export interface AlertGroup {
  groupKey: string;
  /** 该组保留的信号（已抑制掉低于最高级的） */
  signals: Signal[];
}
