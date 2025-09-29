import { z, ZodTypeAny, infer as zInfer } from "../validator/index.js";
import makeWASocket, { ConnectionState, DisconnectReason, useMultiFileAuthState, UserFacingSocketConfig, WAMessage, WASocket } from "baileys";
import { isObject, escapeRegExp, cloneRecordOfArrays, isDigit } from "../utils/index.js";
import { Msg, serialize } from "./message.js";
import {
    CommandContext,
    Middleware,
    Handler,
    ErrorHandler,
    CmdOptions,
    Hook,
    YabaiConfig,
    PrefixType,
    Scope,
    HookName,
    HookRecord,
    IMiddlewares,
    SCOPE_TYPES,
    HOOK_NAMES,
    ExtractParams
} from "./types.js";
import { MiddlewareEngine } from "./middleware.js";
import { CommandDef } from "./command.js";
import { Boom } from "@hapi/boom";
import P from 'pino'

const DEFAULT_CONFIG: YabaiConfig  = {
  scope: SCOPE_TYPES.LOCAL,
  prefix: "",
  description: "",
  auth: { type: 'local', path: '.auth_yabai' },
  logger: P({ level: 'warn'})
};

type Plugin =
  | Yabai
  | ((instance: Yabai) => any)
  | { install: (instance: Yabai) => any };

interface YabaiSnapshot {
    prefix: PrefixType[];
    middleware: MiddlewareEngine;
    hooks: HookRecord
}

class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

/** --- Bot Class --- **/
export class Yabai {
  static GLOBAL = SCOPE_TYPES.GLOBAL;
  static SCOPED = SCOPE_TYPES.SCOPED;
  static LOCAL  = SCOPE_TYPES.LOCAL;

  config:      YabaiConfig      = DEFAULT_CONFIG;
  private middleware:  MiddlewareEngine = new MiddlewareEngine()
  private children:    Set<Yabai>       = new Set()
  private parent:      Yabai | null     = null
  public commands:    CommandDef[]     = []
  private prefixStack: PrefixType[]     = [this.config.prefix]
  sock: WASocket | null = null;
  
  private hooks: HookRecord = HOOK_NAMES.reduce<Record<HookName, Hook[]>>((acc, name) => {
      acc[name] = [];
      return acc;
    }, {} as Record<HookName, Hook[]>);

  /** Scoped group stack */
  private groups: { prefix: string[]; middleware: Middleware[] }[] = [
    { prefix: [], middleware: [] },
  ];

  logger: {
    warn(...data: any[]): void;
    error(...data: any[]): void;
    info(...data: any[]): void;
  };

  constructor(config: Partial<YabaiConfig> = {}) {
    

    const extendConfig = Object.freeze({ ...DEFAULT_CONFIG, ...config });
    this.validateConfig(extendConfig)

    this.config = extendConfig
    this.logger = console; //TODO: logger

    if (this.config.enableHelp) {
        this.cmd('help', ({ msg }) => {
            const helpLines = this.commands
                .filter(cmd => cmd.originalPattern)
                .map(cmd => {
                    const pattern = cmd.originalPattern!.toString().replace(/\/|\^|\$/g, '');
                    const description = cmd.options?.description || 'No description';
                    return `  - ${pattern}: ${description}`;
                });
            msg.reply(`*Available Commands:*\n${helpLines.join('\n')}`);
        }, { description: 'Displays this help message' });
    }
  }

  private validateConfig(config: Partial<YabaiConfig>): asserts config is YabaiConfig {
    if (config.printQRCode && config.pairing) {
      throw new ConfigError('Cannot set `config.printQRCode` when config.pairing is set')
    }

    if (config.pairing) {
      if (!("number" in config.pairing)) {
        throw new ConfigError('`config.pairing` missing required property `number`')
      }
      if (!isDigit(config.pairing.number)) {
        throw new ConfigError('Expected valid number for `config.pairing.number`')
      }
    }

  }

  private setParent(instance: Yabai): this {
    if (instance === this) throw new Error('Cannot set self as parent')
    if (this.parent) this.parent.children.delete(this)

    this.parent = instance
    if (instance) instance.children.add(this)
    return this
  }

  private applyGlobally(hookName: HookName, fn: Hook) {
    const root = this.getRootInstance()
    const queue: Yabai[] = [root]

    while(queue.length) {
      const instance = queue.shift()
      if (instance) {
        instance.hooks[hookName].push(fn)
        queue.push(...instance.children)
      }
      
    }
  }

  private getRootInstance(): Yabai {
    let root: Yabai = this
    while (root.parent) root = root.parent
    return root
  }

  get currentPrefix(): string | RegExp {
    return this.prefixStack[0] || ''
  }

  private createStateSnapshot():  YabaiSnapshot {
    return {
      prefix: [...this.prefixStack],
      middleware: new MiddlewareEngine().merge(this.middleware),
      hooks: cloneRecordOfArrays(this.hooks)
    }
  }

  private restoreState(snapshot: YabaiSnapshot) {
    this.prefixStack = [...snapshot.prefix]
    this.middleware = snapshot.middleware
    this.hooks = cloneRecordOfArrays(snapshot.hooks)
  }

  private async executeHooks(hookName: HookName, ctx: CommandContext) {
    for (const fn of this.hooks[hookName]) {
      try {
        const result = await fn(ctx)
        if (result) return result
      } catch (error) {
        this.logger.error(`Error in ${hookName} hook:`, error)
      }
    }
  }

  /** --- Public API --- **/
  as(scope: Scope) {
    if (!Object.values(SCOPE_TYPES).includes(scope)) {
      throw new Error(`Invalid scope ${scope}`);
    }
    this.config = Object.freeze({ ...this.config, scope });
    return this;
  }

  use(plugin: Plugin, options: { prefix?: string } = {}): Yabai {
    const { prefix = '' } = options;

    this.group(prefix, (instance) => {
      if (plugin instanceof Yabai) {
        for (const command of plugin.commands) {
          if (command.originalPattern) {
            if (typeof command.originalPattern === 'string') {
              instance.cmd(command.originalPattern, command.handler, command.options);
            } else {
              instance.cmd(command.originalPattern, command.handler, command.options);
            }
          }
        }
      } else if (typeof plugin === "function") {
        plugin(instance);
      } else if (isObject(plugin) && "install" in plugin) {
        plugin.install(instance);
      } else {
        this.logger.warn(
          "Invalid plugin type. Must be Yabai instance, a function, or an object with an `install` property."
        );
      }
    });

    return this;
  }

  hears(predicate: (rawMessage: any) => boolean, handler: Handler, options: CmdOptions = {}): this {
    const globalMiddleware = this.middleware
    const middleware: IMiddlewares = {
      beforeHandle: [],
      afterHandle: [],
      error: []
    }

    if (options.beforeHandle) middleware.beforeHandle.push(options.beforeHandle)
    if (options.afterHandle) middleware.afterHandle.push(options.afterHandle)
    if (options.error) middleware.error.push(options.error)

    this.commands.push({
      predicate,
      handler,
      middleware: MiddlewareEngine.mergeAll(
        globalMiddleware,
        middleware
      ),
      options,
    });

    return this;
  }
  
  on(hookName: HookName, fn: Hook): this {
    if (!HOOK_NAMES.includes(hookName)) {
      throw new Error(`Invalid hook name: ${hookName}. Valid hooks: ${HOOK_NAMES.join(', ')}`)
    }

    switch (this.config.scope) {
      case SCOPE_TYPES.LOCAL:
        this.hooks[hookName].push(fn)
        break
      case SCOPE_TYPES.SCOPED:
        this.hooks[hookName].push(fn)
        if (this.parent) this.parent.hooks[hookName].push(fn)
        break
      case SCOPE_TYPES.GLOBAL:
        this.applyGlobally(hookName, fn)
        break
    }
    return this
  }

  onPairing(fn: (code: string) => void) {
     if (!this.config.pairing || Object.keys(this.config.pairing).length === 0) {
      throw new Error('This instance does not login using pairing code')
     }
     this.config.pairing.callback = fn
     return this
  }
  

  onRequest(fn: Hook): this { return this.on('request', fn) }
  onParse(fn: Hook): this { return this.on('parse', fn) }
  onTransform(fn: Hook): this { return this.on('transform', fn) }
  onAfterResponse(fn: Hook): this { return this.on('afterResponse', fn) }



  onBeforeHandle(fn: Middleware): this {
    this.middleware.addBeforeHandle(fn)
    return this
  }

  onAfterHandle(fn: Middleware): this {
    this.middleware.addAfterHandle(fn)
    return this
  }

  onError(fn: ErrorHandler): this {
    this.middleware.addErrorHandler(fn)
    return this
  }

  group(prefix: string, fn: (instance: this) => unknown, config: { sep: string } = { sep: ' ' }): this {
    const existingPrefix = this.currentPrefix ? this.currentPrefix.toString() : '';
    const newPrefix = [existingPrefix, prefix || ''].filter(Boolean).join(config.sep);
    this.prefixStack.unshift(newPrefix);

    const stateSnapshot = this.createStateSnapshot()
    fn(this)
    this.restoreState(stateSnapshot)

    return this
  }

  cmd<Pattern extends string>(
    pattern: Pattern,
    handler: ((
      ctx: CommandContext<ExtractParams<Pattern>>
    ) => any | Promise<any>) | string,
    options?: CmdOptions<ExtractParams<Pattern>>
  ): this;
  cmd<Pattern extends string, S extends ZodTypeAny>(
    pattern: Pattern,
    schema: S,
    handler: ((ctx: CommandContext<zInfer<S>>) => any | Promise<any>) | string,
    options?: Omit<CmdOptions<zInfer<S>>, "schema">
  ): this;

  cmd<Pattern extends RegExp>(
    pattern: Pattern,
    handler: Handler | string,
    options?: CmdOptions
  ): this
  cmd<Pattern extends RegExp, S extends ZodTypeAny>(
    pattern: Pattern,
    schema: S,
    handler: Handler | string,
    options?: Omit<CmdOptions<zInfer<S>>, "schema">
  ): this

  cmd(pattern: string | RegExp, a: any, b?: any, c?: any): this {
    let schema: ZodTypeAny | undefined;
    let handler: Handler;
    let opts: CmdOptions = {};

    if (a && typeof a.parse === 'function') {
      schema = a;
      handler = b;
      opts = c ?? {};
    }
    else if (typeof a === 'function') {
      handler = a;
      opts = b ?? {};
      if (opts) {
        schema = opts.schema;
      }
    }
    else if (typeof a === 'string') {
        handler = async ({ msg }) => {
            await msg.reply(a)
        }
        opts = b ?? {};
        if (opts) {
            schema = opts.schema;
        }
    } else {
      throw new Error("Invalid cmd signature");
    }

    const globalMiddleware = this.middleware
    const middleware: IMiddlewares = {
      beforeHandle: [],
      afterHandle: [],
      error: []
    }

    if (opts.beforeHandle) middleware.beforeHandle.push(opts.beforeHandle)
    if (opts.afterHandle) middleware.afterHandle.push(opts.afterHandle)
    if (opts.error) middleware.error.push(opts.error)

    const prefixSource = this.currentPrefix instanceof RegExp ? this.currentPrefix.source.replace(/^\^|\$$/g, '') : escapeRegExp(this.currentPrefix as string);
    let finalPattern: RegExp;

    if (typeof pattern === 'string') {
        const patternParts = pattern.split(/\s+/).filter(Boolean);
        const regexString = patternParts.map(part => {
            if (part.startsWith(':')) {
                const paramName = part.slice(1).replace(/\?$/, '');
                if (part.endsWith('?')) {
                    return `(?:\\s+(?<${paramName}>.+))?`;
                }
                return `(?<${paramName}>.+)`;
            }
            return escapeRegExp(part);
        }).join('\\s+');

        const separator = prefixSource && regexString ? '\\s+' : '';
        finalPattern = new RegExp(`^${prefixSource}${separator}${regexString}$`);

    } else {
        const separator = prefixSource && pattern.source ? '\\s+' : '';
        const source = pattern.source.replace(/^\^|\$$/g, '');
        finalPattern = new RegExp(`^${prefixSource}${separator}${source}$`, pattern.flags);
    }

    

    this.commands.push({
      originalPattern: pattern,
      pattern: finalPattern,
      handler,
      schema,
      middleware: MiddlewareEngine.mergeAll(
        globalMiddleware,
        middleware
      ),
      options: opts,
    });
  
    return this;
  }

  /** --- Core Dispatcher --- **/
  async handle(message: { body: string; raw: any; }) {
    if (!this.sock) {
        this.logger.error("Handler called before socket was initialized.");
        return;
    }
    const msg = serialize(message.raw, this.sock);
    const ctx: CommandContext = {
      msg,
      raw: message.raw,
      params: {},
      set: {
        status: 200,
        headers: {}
      },
      result: null
    };
    

    await this.executeHooks('request', ctx);
    await this.executeHooks('parse', ctx);
    await this.executeHooks('transform', ctx);

    for (const cmd of this.commands) {
      let isMatch = false;
      if (cmd.pattern) {
        const match = cmd.pattern.exec(message.body);
        if (match) {
          isMatch = true;
          ctx.params = match.groups || {};
        }
      } else if (cmd.predicate) {
        if (cmd.predicate(message.raw)) {
          isMatch = true;
        }
      }

      if (isMatch) {
        if (cmd.schema) {
          try {
            const parsedParams = cmd.schema.parse(ctx.params);
            ctx.params = parsedParams as Record<string, any>;
          } catch (e) {
            await this.handleError(ctx, e);
            return;
          }
        }

        try {
          const beforeResult = await cmd.middleware.executeBefore(ctx);
          if (beforeResult) {
            ctx.result = beforeResult;
            if (typeof ctx.result === 'string') {
              await ctx.msg.reply(ctx.result);
            }
            return;
          }

          const result = await cmd.handler(ctx);
          ctx.result = result;

          await cmd.middleware.executeAfter(ctx, result);

          if (result && typeof result === 'string') {
              await ctx.msg.reply(result);
          }

          await this.executeHooks('afterResponse', ctx);
        } catch (err) {
          await this.handleError(ctx, err);
        }
        return; // Stop after the first matching command
      }
    }
  }

  /** --- Helpers --- **/
  private get currentGroup() {
    return this.groups[this.groups.length - 1];
  }

  private async handleError(ctx: CommandContext, error: unknown) {
    this.logger.error('Request error:', error)
    return this.middleware.executeError(ctx, error)
  }


  async connect(callback?: (sock: WASocket) => any) {

    const connect = async(instance: this) => {
    const { state, saveCreds } = await useMultiFileAuthState(this.config.auth.path);
    // TODO: another auth type
    const sock = makeWASocket({
      ...this.config,
      auth: state,
    });

    this.sock = sock;
    // Config already validated on this.constructor
    if (!sock.authState.creds.registered) {
      setTimeout(async() => {
        if (this.config.pairing?.number) {
         const code = await sock.requestPairingCode(this.config.pairing.number)
         if (this.config.pairing.callback) {
          this.config.pairing.callback(code)
         } else {
          console.log('WARNING!! Implicit callback() for pairing, set onPairing() as console.log()')
          console.log(code)
         }
        }
      }, 3000)
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update: Partial<ConnectionState>) => {
      const { connection, lastDisconnect } = update;
      if (connection === 'close') {
        const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
        this.logger.info('connection closed due to ', lastDisconnect?.error, ', reconnecting ', shouldReconnect);
        if (shouldReconnect) {
          connect(instance);
        }
      } else if (connection === 'open') {
        this.logger.info('opened connection');
      }
    });

    sock.ev.on('messages.upsert', async (m: { messages: WAMessage[], type: any }) => {
      const msg = m.messages[0];
      if (!msg.message) return;

      const messageBody = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
      if (!messageBody) return;

      await this.handle({
        body: messageBody,
        raw: msg,
      });
    });
      return sock
    }
    const sock = await connect(this)
    if (callback) callback(sock)
    return this
  }
}