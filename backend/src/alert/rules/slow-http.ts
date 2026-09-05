/**
 * 规则：HTTP 接口慢请求告警
 *
 * 查询最近窗口内各接口的加权平均耗时，与"该接口配置的阈值"比较，
 * 超阈值的接口产出信号。不同接口可配不同阈值，未配置的接口走默认阈值。
 */
import { queryRows } from "../../greptime-query.js";
import type { AlertRule, Signal } from "../types.js";

/** 各接口耗时阈值（毫秒）。初始值参考近期 1 小时统计设定，可按需调整。 */
const THRESHOLDS_MS: Record<string, number> = {
	"/hdjw/grade-rank": 3000,
	"/netflow": 4000,
	"/hdjw/class-table": 1000,
	"/hdjw/exam-arrange": 1000,
	"/pt/card-info": 800,
	"/lab/grade": 600,
};

/** 未单独配置阈值的接口统一使用的阈值（毫秒） */
const DEFAULT_THRESHOLD_MS = 1000;

export const slowHttpRule: AlertRule = {
	id: "slow-http",
	name: "HTTP 接口慢请求告警",
	description: "接口平均耗时超过其配置的阈值",
	interval: 1,

	async evaluate(): Promise<Signal[]> {
		const WINDOW_MIN = 30; // 时间窗口（分钟）

		// 用请求数加权的平均耗时，避免小流量窗口拉偏
		const rows = await queryRows(`
      SELECT \`http.route\`,
             SUM(avg_duration_nano * req_count) / NULLIF(SUM(req_count), 0) / 1000000 AS avg_ms
      FROM http_request_metrics_1m
      WHERE time_window > NOW() - INTERVAL '${WINDOW_MIN}' MINUTE
      GROUP BY \`http.route\`
    `);

		const now = Date.now();
		return rows
			.filter((r) => {
				const route = String(r["http.route"]);
				const threshold = THRESHOLDS_MS[route] ?? DEFAULT_THRESHOLD_MS;
				return Number(r.avg_ms) > threshold;
			})
			.map((r) => {
				const route = String(r["http.route"]);
				const avgMs = Number(r.avg_ms);
				const threshold = THRESHOLDS_MS[route] ?? DEFAULT_THRESHOLD_MS;
				return {
					ruleId: this.id,
				route: route,
				value: avgMs,
				message: `接口 ${route} 平均耗时 ${avgMs.toFixed(0)}ms（阈值 ${threshold}ms）`,
				timestamp: now,
				};
			});
	},
};
