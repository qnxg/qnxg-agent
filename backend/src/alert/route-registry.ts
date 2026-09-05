/**
 * 接口注册表
 *
 * 定期从 GreptimeDB 拉取近段有流量的接口列表（DISTINCT http.route），
 * 作为"已知接口"集合供闸门分拣信号。新上线的接口在下次刷新前会被
 * 归到未知桶（只打日志，见 gate.ts），刷新后自动转正走正常流程。
 *
 * 刷新由 loop 的独立定时器驱动（REGISTRY_REFRESH_MS，默认 10 分钟），
 * 不随 tick 每 30s 查询，避免 DISTINCT 开销占满 GreptimeDB 与网络。
 */
import { queryRows } from "../greptime-query.js";

/** 拉取接口列表时回看的窗口（天）：只关心近期有流量的接口 */
const LOOKBACK_DAYS = 7;

export class RouteRegistry {
	private routes = new Set<string>();

	/** 从指标表刷新接口列表（整体替换）。首次启动和定期刷新共用此逻辑。 */
	async refresh(): Promise<void> {
		const rows = await queryRows(`
			SELECT DISTINCT \`http.route\`
			FROM http_request_metrics_1m
			WHERE time_window > NOW() - INTERVAL '${LOOKBACK_DAYS}' DAY
		`);
		const next = new Set<string>();
		for (const r of rows) {
			const route = r["http.route"];
			if (typeof route === "string" && route) next.add(route);
		}
		const added = [...next].filter((r) => !this.routes.has(r));
		const removed = [...this.routes].filter((r) => !next.has(r));
		this.routes = next;
		if (added.length > 0)
			console.log(`[registry] 新增接口: ${added.join(", ")}`);
		if (removed.length > 0)
			console.log(`[registry] 移除接口: ${removed.join(", ")}`);
	}

	/** 当前是否为已知接口 */
	has(route: string): boolean {
		return this.routes.has(route);
	}

	/** 已知接口列表（快照） */
	list(): string[] {
		return [...this.routes];
	}

	get size(): number {
		return this.routes.size;
	}
}
