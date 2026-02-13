import { describe, it, expect } from 'vitest';
import { AsyncQueue } from '../src/utils/queue';

describe('AsyncQueue', () => {
  it('should push and consume items', async () => {
    const queue = new AsyncQueue<number>();

    queue.push(1);
    queue.push(2);
    queue.push(3);
    queue.close();

    const results: number[] = [];
    for await (const item of queue) {
      results.push(item);
    }

    expect(results).toEqual([1, 2, 3]);
  });

  it('should wait for items when empty', async () => {
    const queue = new AsyncQueue<string>();

    // Push after a small delay
    setTimeout(() => {
      queue.push('hello');
      queue.close();
    }, 10);

    const results: string[] = [];
    for await (const item of queue) {
      results.push(item);
    }

    expect(results).toEqual(['hello']);
  });

  it('should track size', () => {
    const queue = new AsyncQueue<number>();
    expect(queue.size).toBe(0);

    queue.push(1);
    queue.push(2);
    expect(queue.size).toBe(2);
  });

  it('should report closed state', () => {
    const queue = new AsyncQueue<number>();
    expect(queue.isClosed).toBe(false);

    queue.close();
    expect(queue.isClosed).toBe(true);
  });

  it('should ignore pushes after close', () => {
    const queue = new AsyncQueue<number>();
    queue.push(1);
    queue.close();
    queue.push(2); // should be ignored

    expect(queue.size).toBe(1);
  });

  it('should resolve pending consumers on close', async () => {
    const queue = new AsyncQueue<number>();

    const iter = queue[Symbol.asyncIterator]();
    const promise = iter.next();

    queue.close();

    const result = await promise;
    expect(result.done).toBe(true);
  });
});
