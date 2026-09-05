/**
 * 示例规则：HTTP 接口错误率告警
 *
 * 查询最近窗口内各接口的总错误率，对超阈值的每个接口产出一个信号。
 * 展示了"一条规则产出多个信号"（每个超阈接口一个）的用法。
 */
import { queryRows } from "../../greptime-query.js";
import type { AlertRule, Signal } from "../types.js";

export const httpErrorRateRule: AlertRule = {
	id: "http-error-rate",
	name: "HTTP 接口错误率告警",
	description: "最近窗口内各接口错误率超阈值",
	interval: 1,

	async evaluate(): Promise<Signal[]> {
		const WINDOW_MIN = 30; // 时间窗口（分钟）
		const THRESHOLD = 20; // 错误率阈值（%）

		// SQL 只负责把"各接口的错误率"算出来，阈值过滤交给 TS
		const rows = await queryRows(`
      SELECT \`http.route\`,
             SUM(req_count) AS total,
             SUM(error_count) AS errors,
             SUM(error_count) * 1.0 / NULLIF(SUM(req_count), 0) * 100 AS err_rate
      FROM http_request_metrics_1m
      WHERE time_window > NOW() - INTERVAL '${WINDOW_MIN}' MINUTE
      GROUP BY \`http.route\`
    `);

		const now = Date.now();
		return rows
			.filter((r) => Number(r.err_rate) > THRESHOLD)
			.map((r) => ({
				ruleId: this.id,
				route: String(r["http.route"]),
				value: Number(r.err_rate),
				message: `接口 ${r["http.route"]} 错误率 ${Number(r.err_rate).toFixed(1)}%`,
				timestamp: now,
			}));
	},
};
