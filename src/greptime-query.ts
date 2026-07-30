/**
 * GreptimeDB SQL 查询封装
 *
 * 通过 fetch 调用 GreptimeDB 的 HTTP SQL API。
 * 认证信息从环境变量读取：
 *   GREPTIME_URL      - SQL API 地址
 *   GREPTIME_USERNAME - 用户名
 *   GREPTIME_PASSWORD - 密码
 */

const DEFAULT_URL = "https://trace.qnxg.cn/v1/sql";

export function getGreptimeConfig() {
  const url = process.env.GREPTIME_URL;
  const username = process.env.GREPTIME_USERNAME;
  const password = process.env.GREPTIME_PASSWORD;
  if (!username || !password || !url) {
    throw new Error(
      "缺少 GreptimeDB 认证信息，请设置环境变量 GREPTIME_USERNAME 和 GREPTIME_PASSWORD",
    );
  }
  const auth = "Basic " + Buffer.from(`${username}:${password}`).toString("base64");
  return { url, auth };
}

export async function greptimeQuery(sql: string): Promise<string> {
  const { url, auth } = getGreptimeConfig();
  const body = "sql=" + encodeURIComponent(sql);
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
