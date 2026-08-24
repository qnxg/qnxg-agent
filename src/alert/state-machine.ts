/**
 * 告警状态机
 *
 * 维护每个 (ruleId + groupKey) 告警实例的生命周期：pending -> firing -> resolved。
 * 每轮接收检测器产出的 Signal[]，更新各实例状态，返回当前 firing 实例的最新信号。
 *
 * 状态转移（方案A，前后对比推断 resolve）：
 * - 信号命中：consecutiveHits++、consecutiveMisses=0
 *   - 新实例建为 pending
 *   - pending 且 hits >= N -> firing
 * - 信号未命中：consecutiveMisses++、consecutiveHits=0
 *   - firing 且 misses >= M -> resolved（删除实例）
 *   - pending 抖动消失 -> 清理（删除实例）
 * - resolved 实例已删除，再次触发会新建 pending，等价于"回 pending 重新等 N 轮"
 */
import type { Signal } from "./types.js";

export type AlertStatus = "pending" | "firing" | "resolved";

/** 状态机维护的告警实例 */
export interface AlertInstance {
  ruleId: string;
  groupKey: string;
  status: AlertStatus;
  /** 连续触发轮数（用于 pending -> firing） */
  consecutiveHits: number;
  /** 连续未触发轮数（用于 firing -> resolved） */
  consecutiveMisses: number;
  /** 最近触发信号 */
  lastSignal: Signal;
}

/** pending -> firing 需要的连续触发轮数 */
const FIRE_AFTER_HITS = 2;
/** firing -> resolved 需要的连续未触发轮数 */
const RESOLVE_AFTER_MISSES = 3;

export class AlertStateMachine {
  /** key = `${ruleId}|${groupKey}` */
  private instances = new Map<string, AlertInstance>();

  private key(ruleId: string, groupKey: string): string {
    return `${ruleId}|${groupKey}`;
  }

  /**
   * 每轮更新状态。
   * @param signals 本轮检测产出的信号
   * @returns 当前 firing 实例的最新信号列表（给下游抑制/分组/推送用）
   */
  update(signals: Signal[]): Signal[] {
    const hitKeys = new Set<string>();

    // 处理本轮命中的信号
    for (const s of signals) {
      const k = this.key(s.ruleId, s.groupKey);
      hitKeys.add(k);

      const inst = this.instances.get(k);
      if (!inst) {
        // 新实例：pending
        const newInst: AlertInstance = {
          ruleId: s.ruleId,
          groupKey: s.groupKey,
          status: "pending",
          consecutiveHits: 1,
          consecutiveMisses: 0,
          lastSignal: s,
        };
        if (newInst.consecutiveHits >= FIRE_AFTER_HITS) {
          newInst.status = "firing";
        }
        this.instances.set(k, newInst);
      } else {
        // 已有实例命中：更新计数
        inst.consecutiveHits += 1;
        inst.consecutiveMisses = 0;
        inst.lastSignal = s;
        if (
          inst.status === "pending" &&
          inst.consecutiveHits >= FIRE_AFTER_HITS
        ) {
          inst.status = "firing";
        }
      }
    }

    // 处理未命中的实例
    for (const [k, inst] of this.instances) {
      if (hitKeys.has(k)) continue;
      inst.consecutiveMisses += 1;
      inst.consecutiveHits = 0;
      if (
        inst.status === "firing" &&
        inst.consecutiveMisses >= RESOLVE_AFTER_MISSES
      ) {
        this.instances.delete(k); // resolved
      } else if (inst.status === "pending") {
        this.instances.delete(k); // pending 抖动清理
      }
    }

    // 返回 firing 实例的最新信号
    const firingSignals: Signal[] = [];
    for (const inst of this.instances.values()) {
      if (inst.status === "firing") {
        firingSignals.push(inst.lastSignal);
      }
    }
    return firingSignals;
  }

  /** 调试用：当前实例统计 */
  getStats(): { pending: number; firing: number } {
    let pending = 0;
    let firing = 0;
    for (const inst of this.instances.values()) {
      if (inst.status === "pending") pending++;
      else if (inst.status === "firing") firing++;
    }
    return { pending, firing };
  }
}
