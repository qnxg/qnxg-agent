/**
 * Agent 会话池
 *
 * web 模式下每个浏览器会话对应一个 AgentSession，用 SessionManager.create/open
 * 持久化为 sessions/ 目录下的 JSONL 文件，淘汰和重启都不丢历史。
 *
 * 淘汰策略（TTL 1 分钟）：
 * - 有活跃 events SSE 连接 → 永不淘汰
 * - 无连接且不在跑 prompt → 距最后活跃超过 1 分钟由 sweeper 释放（dispose）
 * - 淘汰是透明的：下次 acquire 从磁盘重建，只是多几十毫秒加载
 *
 * 写者锁（多标签页打开同一会话时）：
 * - 每个标签页带自己的 clientId 连接 events 通道，按连接顺序排队
 * - 队首是"写者"，只有写者能发消息（chat 路由强制校验）
 * - 写者断开进入 3 秒宽限期（刷新页面能原样夺回锁），超时未归才移交给下一个
 * - 写者变更通过 onWriterChange 通知，events 通道把 role 事件推给各标签页
 *
 * 并发：同一 sessionId 的 acquire 用 pending map 去重，避免重复加载。
 */

import {
	type AgentSession,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { createAgent } from "../agent/session.js";
import { PromptQueue } from "./prompt-queue.js";

/** 无连接且空闲超过该时长即淘汰 */
const EVICT_TTL_MS = 60_000;
/** sweeper 扫描间隔 */
const SWEEP_INTERVAL_MS = 15_000;
/** 写者断开到移交的宽限期（刷新页面可在期内夺回锁） */
const WRITER_GRACE_MS = 3_000;

/** 一个标签页到会话的 events 通道连接 */
interface Connection {
	clientId: string;
	/** 连接顺序号，队首即写者 */
	seq: number;
	/** false 表示已断开、处于宽限期内 */
	connected: boolean;
	removeTimer?: NodeJS.Timeout;
}

export interface PooledSession {
	id: string;
	session: AgentSession;
	queue: PromptQueue;
	/** 按 seq 升序，第一个即当前写者（含宽限期内的） */
	connections: Connection[];
	lastActiveAt: number;
}

/** 会话列表项（GET /api/sessions） */
export interface SessionSummary {
	id: string;
	name?: string;
	firstMessage: string;
	messageCount: number;
	created: string;
	modified: string;
	/** 是否已加载在池子里 */
	resident: boolean;
}

export class SessionPool {
	private sessions = new Map<string, PooledSession>();
	/** 进行中的加载，按 sessionId 去重 */
	private pending = new Map<string, Promise<PooledSession | null>>();
	private nextSeq = 0;
	/** sessionId -> 写者变更监听（events 通道注册） */
	private writerListeners = new Map<
		string,
		Set<(writerId: string | null) => void>
	>();

	constructor(private sessionDir: string) {
		const timer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
		timer.unref();
	}

	/** 新建会话（消息首落盘），返回池内对象 */
	async create(): Promise<PooledSession> {
		const sm = SessionManager.create(process.cwd(), this.sessionDir);
		const session = await createAgent([], sm);
		return this.add(session);
	}

	/** 按 id 取会话：命中池子直接用，否则从磁盘加载；不存在返回 null */
	acquire(id: string): Promise<PooledSession | null> {
		const cached = this.sessions.get(id);
		if (cached) {
			cached.lastActiveAt = Date.now();
			return Promise.resolve(cached);
		}

		let p = this.pending.get(id);
		if (!p) {
			p = this.load(id);
			this.pending.set(id, p);
			p.finally(() => this.pending.delete(id));
		}
		return p;
	}

	private async load(id: string): Promise<PooledSession | null> {
		const infos = await SessionManager.list(process.cwd(), this.sessionDir);
		const info = infos.find((s) => s.id === id);
		if (!info) return null;
		const sm = SessionManager.open(info.path, this.sessionDir);
		const session = await createAgent([], sm);
		return this.add(session);
	}

	private add(session: AgentSession): PooledSession {
		const pooled: PooledSession = {
			id: session.sessionId,
			session,
			queue: new PromptQueue(),
			connections: [],
			lastActiveAt: Date.now(),
		};
		this.sessions.set(pooled.id, pooled);
		return pooled;
	}

	/** 当前写者：连接队列队首（含宽限期内已断开的，给它留位置） */
	getWriter(id: string): string | null {
		const p = this.sessions.get(id);
		return p?.connections[0]?.clientId ?? null;
	}

	/** chat 路由用：该 clientId 是否有发消息权限 */
	isWriter(id: string, clientId: string): boolean {
		return this.getWriter(id) === clientId;
	}

	/** events 通道建立：登记连接（宽限期内同 clientId 重连则原位复活） */
	connect(id: string, clientId: string): void {
		const p = this.sessions.get(id);
		if (!p) return;
		p.lastActiveAt = Date.now();

		const existing = p.connections.find(
			(c) => c.clientId === clientId && !c.connected,
		);
		if (existing) {
			clearTimeout(existing.removeTimer);
			existing.connected = true;
			return;
		}
		p.connections.push({ clientId, seq: this.nextSeq++, connected: true });
		this.emitWriterChange(p);
	}

	/** events 通道断开：宽限期后移除，若让出写者则通知 */
	disconnect(id: string, clientId: string): void {
		const p = this.sessions.get(id);
		if (!p) return;
		p.lastActiveAt = Date.now();

		const conn = p.connections.find(
			(c) => c.clientId === clientId && c.connected,
		);
		if (!conn) return;
		conn.connected = false;
		conn.removeTimer = setTimeout(() => {
			p.connections = p.connections.filter((c) => c !== conn);
			this.emitWriterChange(p);
		}, WRITER_GRACE_MS);
	}

	/** 订阅写者变更，返回取消函数 */
	onWriterChange(
		id: string,
		cb: (writerId: string | null) => void,
	): () => void {
		let set = this.writerListeners.get(id);
		if (!set) {
			set = new Set();
			this.writerListeners.set(id, set);
		}
		set.add(cb);
		return () => {
			set.delete(cb);
			if (set.size === 0) this.writerListeners.delete(id);
		};
	}

	private emitWriterChange(p: PooledSession): void {
		const writerId = p.connections[0]?.clientId ?? null;
		for (const cb of this.writerListeners.get(p.id) ?? []) cb(writerId);
	}

	/** prompt 完成后刷新活跃时间，避免跑完立刻被淘汰 */
	touch(id: string): void {
		const p = this.sessions.get(id);
		if (p) p.lastActiveAt = Date.now();
	}

	/** 磁盘上的会话列表 + 池内尚未落盘的（新建还没说过话的），按修改时间倒序 */
	async list(): Promise<SessionSummary[]> {
		const infos = await SessionManager.list(process.cwd(), this.sessionDir);
		const onDisk = new Set(infos.map((s) => s.id));
		const merged: SessionSummary[] = infos.map((s) => ({
			id: s.id,
			name: s.name,
			firstMessage: s.firstMessage,
			messageCount: s.messageCount,
			created: s.created.toISOString(),
			modified: s.modified.toISOString(),
			resident: this.sessions.has(s.id),
		}));
		for (const p of this.sessions.values()) {
			if (!onDisk.has(p.id)) {
				merged.push({
					id: p.id,
					firstMessage: "",
					messageCount: 0,
					created: new Date(p.lastActiveAt).toISOString(),
					modified: new Date(p.lastActiveAt).toISOString(),
					resident: true,
				});
			}
		}
		merged.sort((a, b) => b.modified.localeCompare(a.modified));
		return merged;
	}

	/** 释放无连接、空闲超时、且不在跑 prompt 的会话（内存可回收，历史在磁盘） */
	private sweep(): void {
		const now = Date.now();
		for (const p of this.sessions.values()) {
			if (p.connections.some((c) => c.connected)) continue;
			if (p.session.isStreaming) continue;
			if (now - p.lastActiveAt < EVICT_TTL_MS) continue;
			p.session.dispose();
			this.sessions.delete(p.id);
		}
	}
}
