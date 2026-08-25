/**
 * 告警规则注册表
 *
 * 新增规则时在这里登记。检测器从这里取规则执行。
 */
import { httpErrorRateRule } from "./http-error-rate.js";
import { slowHttpRule } from "./slow-http.js";
import type { AlertRule } from "../types.js";

const MAX_TICK_COUNT = 100000;

class RulesManager {
  private rules: AlertRule[] = [];
  private tickCount: number = 0;

  constructor(rules: AlertRule[]) {
    this.rules = rules;
  }

  get length(): number {
    return this.rules.length;
  }

  activeRules(): AlertRule[] {
    return this.rules.filter((rule) => this.tickCount % rule.interval === 0);
  }

  activeRulesID(): string[] {
    return this.activeRules().map((rule) => rule.id);
  }

  nextTick() {
    this.tickCount++;
    if (this.tickCount >= MAX_TICK_COUNT) this.tickCount = 0;
  }
}

export const rulesManager = new RulesManager([httpErrorRateRule, slowHttpRule]);
