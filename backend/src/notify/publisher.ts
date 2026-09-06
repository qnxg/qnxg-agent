/**
 * RabbitMQ 报告发布器
 *
 * 把告警报告/恢复通知发到队列（默认 message.qqrobot，QQ 机器人端消费）。
 * 使用 amqplib 2.x 的 opt-in 自动重连：断线后按指数退避重连，
 * setup 在每次（重）连成功后重建 channel 并 assert 队列。
 *
 * 连接不阻塞启动：RabbitMQ 未就绪时主循环照常检测，消息在通道就绪前
 * 丢弃（demo 级实现，只打日志不做本地缓冲）。
 */
import amqp from "amqplib";
import { type QueueMessage, renderQueueMessage } from "./report.js";

export interface PublisherOptions {
	/** AMQP URL，如 amqp://localhost */
	url: string;
	/** 目标队列名 */
	queue: string;
}

export class ReportPublisher {
	private connPromise: Promise<amqp.RecoveringChannelModel> | null = null;
	private channel: amqp.Channel | null = null;
	private closed = false;

	constructor(private readonly opts: PublisherOptions) {}

	/**
	 * 发起连接（非阻塞）。amqplib 的 recovery 模式下 connect() 的 promise
	 * 只在首次连接成功时 resolve 且永不 reject（maxRetries=Infinity），
	 * 所以这里不 await，避免 RabbitMQ 未就绪时卡死整个启动流程。
	 */
	connect(): void {
		if (this.connPromise || this.closed) return;
		this.connPromise = amqp.connect(this.opts.url, {
			recovery: {
				initialDelay: 200,
				maxDelay: 5000,
				factor: 2,
				jitter: 0.2,
				maxRetries: Number.POSITIVE_INFINITY,
				// 每次（重）连成功后调用：重建 channel、assert 队列
				setup: async (model: amqp.ChannelModel) => {
					const ch = await model.createChannel();
					await ch.assertQueue(this.opts.queue, { durable: true });
					this.channel = ch;
					console.log(`[mq] 队列就绪: ${this.opts.queue}`);
				},
			},
		});

		this.connPromise
			.then((conn) => {
				// 首次连接事件已错过（在 promise resolve 前发出），只订阅后续事件
				conn.on("disconnect", (err: Error) => {
					this.channel = null;
					console.warn(`[mq] 连接断开，将自动重连: ${err.message}`);
				});
				conn.on("error", (err: Error) => {
					// 协议层错误；断线重连由 disconnect 事件跟踪
					console.error("[mq] 连接错误:", err.message);
				});
			})
			.catch((err: unknown) => {
				// 理论上 maxRetries=Infinity 不会走到这，防御性记录
				console.error("[mq] 连接失败:", err);
			});
	}

	/**
	 * 发布一条消息（渲染为纯文本，persistent 投递模式）。
	 * demo 级：无可用 channel 时丢弃并打日志。
	 * @returns 是否成功写入 channel
	 */
	publish(msg: QueueMessage): boolean {
		const text = renderQueueMessage(msg);
		console.log(`[mq] 发送消息:\n${text}\n`);
		if (!this.channel) {
			console.error(
				`[mq] 无可用通道，丢弃消息 type=${msg.type} route=${msg.route}`,
			);
			return false;
		}
		const ok = this.channel.sendToQueue(
			this.opts.queue,
			Buffer.from(text, "utf8"),
			{
				persistent: true,
				contentType: "text/plain",
			},
		);
		if (!ok) console.warn("[mq] channel 写缓冲已满，消息可能在排队");
		return ok;
	}

	async close(): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		this.channel = null;
		const p = this.connPromise;
		this.connPromise = null;
		if (p) {
			await p.then((conn) => conn.close()).catch(() => {});
		}
	}
}
