import { CommandContext, IMiddlewares, Middleware, ErrorHandler, MiddlewareMap } from "./types.js";

export class MiddlewareEngine {
  private handlers: { [K in keyof MiddlewareMap]: MiddlewareMap[K][] } = {
    beforeHandle: [],
    afterHandle:  [],
    error:        []
  };

  add<K extends keyof MiddlewareMap>(
    type: K,
    fn: MiddlewareMap[K]
  ): this {
    this.handlers[type].push(fn);
    return this;
  }

  get beforeHandle() { return this.handlers.beforeHandle }
  get afterHandle()  { return this.handlers.afterHandle }
  get error()        { return this.handlers.error }

  set beforeHandle(fn) { this.handlers.beforeHandle = fn }
  set afterHandle(fn)  { this.handlers.afterHandle = fn }
  set error(fn)        { this.handlers.error = fn }


  addBeforeHandle(fn: Middleware) {
    return this.add("beforeHandle", fn);
  }
  addAfterHandle(fn: Middleware) {
    return this.add("afterHandle", fn);
  }
  addErrorHandler(fn: ErrorHandler) {
    return this.add("error", fn);
  }

  merge(engine: MiddlewareEngine): MiddlewareEngine {
      const merged = new MiddlewareEngine()
      merged.beforeHandle = [...this.beforeHandle, ...engine.beforeHandle]
      merged.afterHandle = [...this.afterHandle, ...engine.afterHandle]
      merged.error = [...this.error, ...engine.error]
      return merged
  }

  static mergeAll(...engines: (IMiddlewares | undefined)[]) {
    const merged = new MiddlewareEngine();
    for (const eng of engines) {
      if (eng) {
        merged.beforeHandle.push(...eng.beforeHandle);
        merged.afterHandle.push(...eng.afterHandle);
        merged.error.push(...eng.error);
      }
    }
    return merged;
  }


  async executeBefore<T = any>(ctx: CommandContext<T>): Promise<T | null> {
    for (const fn of this.beforeHandle) {
      const res = await fn(ctx, async () => {});
      if (res) return res;
    }
    return null;
  }

  async executeAfter<T = any>(ctx: CommandContext<T>, result: any): Promise<T | null> {
    ctx.set = ctx.set; // no-op, placeholder
    ctx.result = result
    for (const fn of this.afterHandle) {
      const res = await fn(ctx, async () => {});
      if (res) return res;
    }
    return null;
  }

  async executeError(ctx: CommandContext<any>, error: any) {
    for (const fn of this.error) {
      const res = await fn({ error, ctx });
      if (res) return res;
    }
    return { text: "Internal server error", status: 500 };
  }
}