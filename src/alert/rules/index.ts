/**
 * 告警规则注册表
 *
 * 新增规则时在这里登记。检测器从这里取规则执行。
 */
import { httpErrorRateRule } from "./http-error-rate.js";
import { slowHttpRule } from "./slow-http.js";
import type { AlertRule } from "../types.js";

/** 所有告警规则 */
export const rules: AlertRule[] = [httpErrorRateRule, slowHttpRule];
