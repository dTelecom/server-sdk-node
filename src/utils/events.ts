import { EventEmitter } from 'events';

/**
 * A typed EventEmitter that provides type-safe event handling.
 * Usage:
 *   interface MyEvents {
 *     data: (payload: string) => void;
 *     error: (err: Error) => void;
 *   }
 *   class MyClass extends TypedEmitter<MyEvents> {}
 */
export type EventMap = { [key: string]: (...args: any[]) => void };

export class TypedEmitter<T extends { [key: string]: (...args: any[]) => void }> {
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(50);
  }

  on<K extends keyof T & string>(event: K, listener: T[K]): this {
    this.emitter.on(event, listener as (...args: any[]) => void);
    return this;
  }

  once<K extends keyof T & string>(event: K, listener: T[K]): this {
    this.emitter.once(event, listener as (...args: any[]) => void);
    return this;
  }

  off<K extends keyof T & string>(event: K, listener: T[K]): this {
    this.emitter.off(event, listener as (...args: any[]) => void);
    return this;
  }

  emit<K extends keyof T & string>(event: K, ...args: Parameters<T[K]>): boolean {
    return this.emitter.emit(event, ...args);
  }

  removeAllListeners<K extends keyof T & string>(event?: K): this {
    if (event) {
      this.emitter.removeAllListeners(event);
    } else {
      this.emitter.removeAllListeners();
    }
    return this;
  }

  listenerCount<K extends keyof T & string>(event: K): number {
    return this.emitter.listenerCount(event);
  }
}
