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

export async function greptimeQuery(sql: string): Promise<string> {
	const { url, auth } = getGreptimeConfig();
	const body = `sql=${encodeURIComponent(sql)}`;
	const res = await fetch(url, {
		method: "POST",
		headers: {
			Authorization: auth,
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body,
	});
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(`GreptimeDB 请求失败 (${res.status}): ${text}`);
	}
	return res.text();
}

/**
 * 查询并解析为行对象数组
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
