import nodeSqlParser from "node-sql-parser";

const { Parser } = nodeSqlParser;

/**
 * GreptimeDB SQL 查询封装
 *
 * 通过 fetch 调用 GreptimeDB 的 HTTP SQL API。
 * 认证信息从环境变量读取：
 *   GREPTIME_URL      - SQL API 地址
 *   GREPTIME_USERNAME - 用户名
 *   GREPTIME_PASSWORD - 密码
 */

export function getGreptimeConfig() {
	const url = process.env.GREPTIME_URL;
	const username = process.env.GREPTIME_USERNAME;
	const password = process.env.GREPTIME_PASSWORD;
	if (!username || !password || !url) {
		throw new Error(
			"缺少 GreptimeDB 认证信息，请设置环境变量 GREPTIME_USERNAME 和 GREPTIME_PASSWORD",
		);
	}
	const auth = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
	return { url, auth };
}

/** 单次查询的超时时间（毫秒） */
const QUERY_TIMEOUT_MS = 30_000;

const sqlParser = new Parser();

/**
 * 只读校验：解析 SQL 并要求每条语句都是 SELECT。
 *
 * 解析失败同样拒绝（fail-closed）：不认识的语法一律不放行，
 * 避免方言差异或未知语句类型绕过校验。
 */
export function assertReadOnlySql(sql: string): void {
	let ast: unknown;
	try {
		ast = sqlParser.astify(sql);
	} catch (err) {
		throw new Error(
			`SQL 解析失败，已拒绝执行（只允许 SELECT 查询）: ${err instanceof Error ? err.message : String(err)}`,
		);
	}
	const statements = (Array.isArray(ast) ? ast : [ast]) as {
		type?: string;
	}[];
	for (const stmt of statements) {
		if (stmt?.type !== "select") {
			throw new Error(
				`只允许只读查询（SELECT），已拦截语句类型: ${stmt?.type ?? "unknown"}`,
			);
		}
	}
}

/**
 * 执行 GreptimeDB SQL 查询，注册到 quickjs 中。
 * @param sql SQL 语句
 * @returns 查询结果
 */
export async function greptimeQuery(sql: string): Promise<string> {
	assertReadOnlySql(sql);
	const { url, auth } = getGreptimeConfig();
	const body = `sql=${encodeURIComponent(sql)}`;
	let res: Response;
	try {
		res = await fetch(url, {
			method: "POST",
			headers: {
				Authorization: auth,
				"Content-Type": "application/x-www-form-urlencoded",
			},
			body,
			signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
		});
	} catch (err) {
		if (err instanceof DOMException && err.name === "TimeoutError") {
			throw new Error(
				`GreptimeDB 查询超时（超过 ${QUERY_TIMEOUT_MS / 1000} 秒）`,
			);
		}
		throw err;
	}
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(`GreptimeDB 请求失败 (${res.status}): ${text}`);
	}
	return res.text();
}

/**
 * 查询并解析为行对象数组，在告警规则中使用
 *
 * GreptimeDB 返回结构：{ output: [{ records: { schema: { column_schemas: [{name}] }, rows: [[...]] } }] }
 * 这里把列名和行数组配对成 [{ 列名: 值, ... }]，规则代码可直接按列名取值。
 */
export async function queryRows(
	sql: string,
): Promise<Record<string, unknown>[]> {
	const raw = await greptimeQuery(sql);
	const data = JSON.parse(raw) as {
		output?: {
			records?: {
				schema?: { column_schemas?: { name: string }[] };
				rows?: unknown[][];
			};
		}[];
	};
	const records = data.output?.[0]?.records;
	if (!records?.schema?.column_schemas || !records.rows) return [];
	const cols = records.schema.column_schemas.map((c) => c.name);
	return records.rows.map((row) => {
		const obj: Record<string, unknown> = {};
		cols.forEach((name, i) => {
			obj[name] = row[i];
		});
		return obj;
	});
}
