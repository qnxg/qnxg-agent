/**
 * Prompt 串行队列
 *
 * pi session 同一时间只能跑一个 prompt，并发调用会打乱对话上下文。
 * 用 promise 链把 prompt 串起来：后到的请求等前面的跑完再执行。
 */
export class PromptQueue {
  private tail: Promise<unknown> = Promise.resolve();

  enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn);
    // 单个任务失败不能断链：错误已通过 result 传给调用方，这里吞掉即可
    this.tail = result.catch(() => {});
    return result;
  }
}
