/**
 * Async queue for passing items between producer and consumer.
 * Implements AsyncIterable for for-await-of consumption.
 */
export class AsyncQueue<T> implements AsyncIterable<T> {
  private buffer: T[] = [];
  private resolvers: Array<(result: IteratorResult<T>) => void> = [];
  private closed = false;

  /** Push an item into the queue. */
  push(item: T): void {
    if (this.closed) return;

    if (this.resolvers.length > 0) {
      const resolve = this.resolvers.shift()!;
      resolve({ value: item, done: false });
    } else {
      this.buffer.push(item);
    }
  }

  /** Close the queue. Pending consumers receive done. */
  close(): void {
    this.closed = true;
    for (const resolve of this.resolvers) {
      resolve({ value: undefined as any, done: true });
    }
    this.resolvers.length = 0;
  }

  /** Number of buffered items. */
  get size(): number {
    return this.buffer.length;
  }

  /** Whether the queue is closed. */
  get isClosed(): boolean {
    return this.closed;
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        if (this.buffer.length > 0) {
          return Promise.resolve({ value: this.buffer.shift()!, done: false });
        }

        if (this.closed) {
          return Promise.resolve({ value: undefined as any, done: true });
        }

        return new Promise<IteratorResult<T>>((resolve) => {
          this.resolvers.push(resolve);
        });
      },
    };
  }
}
