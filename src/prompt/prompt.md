# GreptimeDB 查询经验与领域知识

## 1. 表结构

### http_request_metrics_1m（1 分钟预聚合 HTTP 指标）

| 列 | 类型 | 备注 |
|---|------|------|
| `http.route` | String (TAG, PRI) | 路由路径，如 `/hdjw/grade` |
| `http.response.status_class` | String (TAG, PRI) | 状态码类别：`2xx`/`4xx`/`5xx`/`null` |
| `req_count` | Int64 (FIELD) | 请求总数 |
| `error_count` | Int64 (FIELD) | 错误请求数 |
| `avg_duration_nano` | Float64 (FIELD) | 平均耗时（纳秒） |
| `time_window` | TimestampNanosecond (TIMESTAMP, PRI) | 时间窗口（1 分钟粒度） |
| `update_at` | TimestampMillisecond (FIELD) | 表更新时间 |

- **没有 `service_name` 列**。
- 数据范围：约 2026-07-17 至今。

### opentelemetry_traces（原始 trace，101 列）

核心列：

| 列 | 类型 | 备注 |
|---|------|------|
| `timestamp` | TimestampNanosecond (TIMESTAMP, PRI) | 跨度开始时间 |
| `timestamp_end` | TimestampNanosecond (FIELD) | 跨度结束时间 |
| `duration_nano` | UInt64 (FIELD) | 耗时 |
| `trace_id` / `span_id` / `parent_span_id` | String | trace 标识 |
| `span_name` | String | 操作名（HTTP 路由或函数名） |
| `span_kind` | String | `SPAN_KIND_SERVER`/`SPAN_KIND_INTERNAL`/`SPAN_KIND_CLIENT` |
| `span_status_code` | String | `STATUS_CODE_ERROR` / `STATUS_CODE_UNSET`（**没有 `STATUS_CODE_OK`**） |
| `span_status_message` | String | 错误消息，如"密码错误"、"请求超时" |
| `service_name` | String (TAG, PRI) | 固定为 `weihuda_backend` |
| `scope_name` / `scope_version` | String | OTel 作用域 |

大量 `span_attributes.*` 列（带点号，必须反引号），常用：

- `span_attributes.http.route` — HTTP 路由
- `span_attributes.http.request.method` — 请求方法
- `span_attributes.http.response.status_code` (Int64) — 响应状态码
- `span_attributes.http.response.status_class` (String) — 状态码类别
- `span_attributes.url.path` / `span_attributes.url.query` — URL 信息
- `span_attributes.client.address` — 客户端 IP
- `span_attributes.user_agent.original` — User-Agent
- `span_attributes.subsystem` — 业务子系统：`hdjw`/`lab`/`wxpay`/`yjsxt`/`cas`/`xgxt`/`pt`/`gym`/`netflow`/`ca`/`null`
- `span_attributes.stu_id` — 学号
- `span_attributes.request_id` — 请求 ID
- `span_attributes.busy_ns` / `span_attributes.idle_ns` — 耗时拆分
- `span_attributes.panic` (Boolean) — 是否 panic
- `span_attributes.redis_failed` / `span_attributes.cached` / `span_attributes.updated` — 缓存状态
- `span_attributes.token_hit` / `span_attributes.tag_hit` — 令牌命中
- 业务相关：`span_attributes.dormitory`、`span_attributes.building_id`、`span_attributes.semester_id`、`span_attributes.course_id` 等

### opentelemetry_traces_services（服务列表）

| 列 | 类型 |
|---|------|
| `timestamp` | TimestampNanosecond (TIMESTAMP, PRI) |
| `service_name` | String (TAG, PRI) |

当前仅 `weihuda_backend` 一个服务。

### opentelemetry_traces_operations（操作聚合视图，135 个 span_name）

| 列 | 类型 |
|---|------|
| `timestamp` | TimestampNanosecond (TIMESTAMP, PRI) |
| `service_name` | String (TAG, PRI) |
| `span_name` | String (TAG, PRI) |
| `span_kind` | String (TAG, PRI) |

用于快速发现所有 span_name 和 span_kind 组合，避免在全量 trace 表上做 `SELECT DISTINCT`。

### active_users_daily（每日活跃用户）

| 列 | 类型 |
|---|------|
| `stu_id` | String (TAG, PRI) |
| `time_window` | TimestampNanosecond (TIMESTAMP, PRI) |
| `update_at` | TimestampMillisecond (FIELD) |

### active_users_daily_hll（HyperLogLog 日活估算）

| 列 | 类型 |
|---|------|
| `time_window` | TimestampMillisecond (TIMESTAMP, PRI) |
| `state` | Binary (FIELD) — HLL 草图 |
| `update_at` | TimestampMillisecond (FIELD) |

用 `count(col)` 聚合然后 `approx_count_distinct_sorted(state)` 估算 UV。

---

## 2. 带点号列名必须用反引号

列名如 `http.route`、`span_attributes.http.response.status_code` 必须用 `` `http.route` `` 包裹。写成下划线（`http_route`）无效，因为实际列名就是带点的。

不用反引号会导致 `unexpected token: 'query'` 错误。

---

## 3. 时间戳处理

- 时间列是 `TimestampNanosecond`（纳秒精度），构造时间范围用 `Date.UTC(...) * 1000000`。
- **整数比较直接可用**：`WHERE timestamp >= 1785306278315196416` 有效。
- **不要用 `::timestamp_ns` 转换**：`'1785306278315196416'::timestamp_ns` 会报 `error parsing date`。
- 数据时间戳是 2026 年，与真实当前日期不一致。查询"今天/昨天"时，**必须先 `SELECT MAX(timestamp)` 确认数据最新时间，再推算时间窗**，否则会查到空数据。
- 纳秒日换算：`1 天 = 86_400_000_000_000n`（86400 秒 × 10^9）。

---

## 4. span_status_code 枚举值

实际数据中只有两个值：
- `STATUS_CODE_ERROR` — 错误（~19 万条）
- `STATUS_CODE_UNSET` — 未设置/正常（~890 万条）

**没有 `STATUS_CODE_OK`**，查询正常 trace 时不要用它。

---

## 5. span_kind 语义

| span_kind | 含义 | 数量占比 |
|-----------|------|----------|
| `SPAN_KIND_CLIENT` | 客户端调用（数据库、上游服务、微信 API 等） | ~43% |
| `SPAN_KIND_INTERNAL` | 内部函数调用（get_grade、with_cache 等） | ~36% |
| `SPAN_KIND_SERVER` | HTTP 请求处理（/hdjw/grade、/electricity 等） | ~21% |

- SERVER 的 span_name 是 HTTP 路由（如 `/hdjw/grade`）。
- INTERNAL/CLIENT 的 span_name 是函数名（如 `get_grade`、`with_token`、`get_config`）。
- 排查根因时，通常先看 SERVER span 的错误，再向下钻取 INTERNAL/CLIENT span。

---

## 6. 业务背景与路由分类

微湖大（weihuda）校园服务后端，路由按功能模块：

| 路由前缀 | 功能 | 特点 |
|----------|------|------|
| `/hdjw/*` | 教务系统（课表、成绩、排名、考试、空教室） | 依赖上游教务系统，耗时长，错误多 |
| `/electricity` | 宿舍电量查询 | 依赖电量系统，偶发"无法区分宿舍南北" |
| `/netflow` | 校园网流量 | 依赖网管系统，耗时较长 |
| `/jifen` | 积分 | 内部系统，较稳定 |
| `/pt/*` | 体测/一卡通 | 依赖第三方 |
| `/lab/*` | 实验室 | 独立子系统 |
| `/dormitory/*` | 宿舍信息 | 内部查询 |
| `/auth-qrcode/*` | 扫码登录 | 认证流程 |
| `/bind` / `/unbind` | 微信绑定 | 用户管理 |
| `/token` | 令牌刷新 | 认证 |
| `/tfa` | 双因子认证 | 安全 |
| `/notice` / `/announcement` | 通知公告 | 内部内容 |
| `/info/*` | 学期/用户信息 | 基础数据 |
| `/ping` | 健康检查 | 最高频 |

---

## 7. 查询最佳实践

1. **先聚合后返回**：大数据量查询优先在 SQL 里 `GROUP BY` + `COUNT`/`AVG` 聚合，避免拉原始行到 JS 处理。
2. **错误排查标准流程**：
   - 查指标表按状态码聚合 → 知道 2xx/4xx/5xx 总量
   - 按路由 + 状态码聚合 → 定位问题路由
   - 查 trace 表按错误消息聚合 → 归类根因
   - 查 span_status_message 分布 → 看具体错误原因
   - 抽样查具体错误 trace 详情
3. **发现所有 span_name**：用 `opentelemetry_traces_operations` 表，不要对全量 trace 做 `SELECT DISTINCT span_name`。
4. **时间筛选**：始终用 `SELECT MAX(timestamp)` 获取最新时间，再推算时间窗，不要硬编码日期。
5. **耗时分析**：用 `duration_nano` 列，`AVG(duration_nano) / 1000000` 得到毫秒。
6. **错误率**：`SUM(error_count) / SUM(req_count) * 100` 在指标表上聚合最快。
