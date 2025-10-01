import {
    t,
    YabaiType,
    YabaiTypeAny,
    infer as yInfer
} from '../validator/index.js'
import makeWASocket, {
    ConnectionState,
    DisconnectReason,
    useMultiFileAuthState,
    UserFacingSocketConfig,
    WAMessage,
    WASocket
} from 'baileys'
import {
    isObject,
    escapeRegExp,
    cloneRecordOfArrays,
    isDigit,
    isEmpty
} from '../utils/index.js'
import { Msg, serialize } from './message.js'
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
} from './types.js'
import { MiddlewareEngine } from './middleware.js'
import { CommandDef } from './command.js'
import { Boom } from '@hapi/boom'
import P from 'pino'
import * as qrcode from '../lib/qrcode-terminal/main.js'

const DEFAULT_CONFIG: YabaiConfig = {
    scope: SCOPE_TYPES.LOCAL,
    prefix: '',
    description: '',
    auth: { type: 'local', path: '.auth_yabai' },
    qrcode: { small: true, timeout: 60_000 },
    logger: P({ level: 'silent' })
}

type Plugin =
    | Yabai
    | ((instance: Yabai) => any)
    | { install: (instance: Yabai) => any }

interface YabaiSnapshot {
    prefix: PrefixType[]
    middleware: MiddlewareEngine
    hooks: HookRecord
}

export class ConfigError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'ConfigError'
    }
}

/** --- Bot Class --- **/
export class Yabai {
    static GLOBAL = SCOPE_TYPES.GLOBAL
    static SCOPED = SCOPE_TYPES.SCOPED
    static LOCAL = SCOPE_TYPES.LOCAL

    config: YabaiConfig = DEFAULT_CONFIG
    private middleware: MiddlewareEngine = new MiddlewareEngine()
    private children: Set<Yabai> = new Set()
    private parent: Yabai | null = null
    public commands: CommandDef[] = []
    private prefixStack: PrefixType[] = [this.config.prefix]
    sock: WASocket | null = null

    private hooks: HookRecord = HOOK_NAMES.reduce<Record<HookName, Hook[]>>(
        (acc, name) => {
            acc[name] = []
            return acc
        },
        {} as Record<HookName, Hook[]>
    )

    /** Scoped group stack */
    private groups: { prefix: string[]; middleware: Middleware[] }[] = [
        { prefix: [], middleware: [] }
    ]

    logger: {
        warn(...data: any[]): void
        error(...data: any[]): void
        info(...data: any[]): void
    }

    constructor(config: Partial<YabaiConfig> = {}) {
        const extendConfig = Object.freeze({ ...DEFAULT_CONFIG, ...config })
        this.validateConfig(extendConfig)

        this.config = extendConfig
        this.logger = console //TODO: logger

        if (this.config.enableHelp) {
            this.cmd(
                'help',
                ({ msg }) => {
                    const helpLines = this.commands
                        .filter((cmd) => cmd.originalPattern)
                        .map((cmd) => {
                            const pattern = cmd
                                .originalPattern!.toString()
                                .replace(/\/|\^|\$/g, '')
                            const description =
                                cmd.options?.description || 'No description'
                            return `  - ${pattern}: ${description}`
                        })
                    msg.reply(`*Available Commands:*\n${helpLines.join('\n')}`)
                },
                { description: 'Displays this help message' }
            )
        }
    }

    private validateConfig(
        config: Partial<YabaiConfig>
    ): asserts config is YabaiConfig {
        if (!isEmpty(config.qrcode) && !isEmpty(config.pairing)) {
            throw new ConfigError(
                'Cannot set `config.qrcode` when config.pairing is set'
            )
        }

        if (config.pairing) {
            if (!('number' in config.pairing)) {
                throw new ConfigError(
                    '`config.pairing` missing required property `number`'
                )
            }
            if (!isDigit(config.pairing.number)) {
                throw new ConfigError(
                    'Expected valid number for `config.pairing.number`'
                )
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

        while (queue.length) {
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

    private createStateSnapshot(): YabaiSnapshot {
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
            throw new Error(`Invalid scope ${scope}`)
        }
        this.config = Object.freeze({ ...this.config, scope })
        return this
    }

    use(plugin: Plugin, options: { prefix?: string } = {}): Yabai {
        const { prefix = '' } = options

        this.group(prefix, (instance) => {
            if (plugin instanceof Yabai) {
                for (const command of plugin.commands) {
                    if (command.originalPattern) {
                        if (plugin.config.scope === SCOPE_TYPES.LOCAL) {
                            const options: CmdOptions = {
                                beforeHandle: [
                                    ...command.middleware.beforeHandle
                                ],
                                afterHandle: [
                                    ...command.middleware.afterHandle
                                ],
                                error: [...command.middleware.error]
                            }
                            instance.cmd(
                                //@ts-ignore
                                command.originalPattern,
                                command.handler,
                                options
                            )
                        }
                    }
                }
            } else if (typeof plugin === 'function') {
                plugin(instance)
            } else if (isObject(plugin) && 'install' in plugin) {
                plugin.install(instance)
            } else {
                this.logger.warn(
                    'Invalid plugin type. Must be Yabai instance, a function, or an object with an `install` property.'
                )
            }
        })

        return this
    }

    hears(
        predicate: (rawMessage: any) => boolean,
        handler: Handler,
        options: CmdOptions = {}
    ): this {
        const globalMiddleware = this.middleware
        const middleware: IMiddlewares = {
            beforeHandle: [],
            afterHandle: [],
            error: []
        }

        if (options.beforeHandle) {
            if (!Array.isArray(options.beforeHandle))
                options.beforeHandle = [options.beforeHandle]
            middleware.beforeHandle.push(...options.beforeHandle)
        }
        if (options.afterHandle) {
            if (!Array.isArray(options.afterHandle))
                options.afterHandle = [options.afterHandle]
            middleware.afterHandle.push(...options.afterHandle)
        }
        if (options.error) {
            if (!Array.isArray(options.error)) options.error = [options.error]
            middleware.error.push(...options.error)
        }

        this.commands.push({
            predicate,
            handler,
            middleware: MiddlewareEngine.mergeAll(globalMiddleware, middleware),
            options
        })

        return this
    }

    on(hookName: HookName, fn: Hook): this {
        if (!HOOK_NAMES.includes(hookName)) {
            throw new Error(
                `Invalid hook name: ${hookName}. Valid hooks: ${HOOK_NAMES.join(', ')}`
            )
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
        if (
            !this.config.pairing ||
            Object.keys(this.config.pairing).length === 0
        ) {
            throw new Error('This instance does not login using pairing code')
        }
        this.config.pairing.callback = fn
        return this
    }

    onRequest(fn: Hook): this {
        return this.on('request', fn)
    }
    onParse(fn: Hook): this {
        return this.on('parse', fn)
    }
    onTransform(fn: Hook): this {
        return this.on('transform', fn)
    }
    onAfterResponse(fn: Hook): this {
        return this.on('afterResponse', fn)
    }

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

    group(
        prefix: string,
        fn: (instance: this) => unknown,
        config: { sep: string } = { sep: ' ' }
    ): this {
        const existingPrefix = this.currentPrefix
            ? this.currentPrefix.toString()
            : ''
        const newPrefix = [existingPrefix, prefix || '']
            .filter(Boolean)
            .join(config.sep)
        this.prefixStack.unshift(newPrefix)

        const stateSnapshot = this.createStateSnapshot()
        fn(this)
        this.restoreState(stateSnapshot)

        return this
    }

    cmd<Pattern extends string, S extends YabaiTypeAny>(
        pattern: Pattern,
        schema: S,
        handler:
            | ((ctx: CommandContext<yInfer<S>>) => any | Promise<any>)
            | string,
        options?: CmdOptions<yInfer<S>>
    ): this

    cmd<Pattern extends string, S extends YabaiTypeAny>(
        pattern: Pattern,
        handler:
            | ((ctx: CommandContext<yInfer<S>>) => any | Promise<any>)
            | string,
        options: CmdOptions<yInfer<S>>
    ): this

    cmd<Pattern extends string>(
        pattern: Pattern,
        handler: Handler | string,
        options?: CmdOptions
    ): this

    cmd<Pattern extends RegExp>(
        pattern: Pattern,
        handler: Handler | string,
        options?: CmdOptions
    ): this

    cmd<Pattern extends RegExp, S extends YabaiType>(
        pattern: Pattern,
        schema: S,
        handler: Handler | string,
        options?: CmdOptions
    ): this

    cmd(pattern: string | RegExp, a: any, b?: any, c?: any): this {
        let args: YabaiTypeAny | undefined
        let handler: Handler
        let options: CmdOptions = {}

        if (a && typeof a.parse === 'function') {
            args = a
            handler = b
            options = c ?? {}
        } else if (typeof a === 'function') {
            handler = a
            options = b ?? {}
            if (options) {
                args = options.args
            }
        } else if (typeof a === 'string') {
            handler = async ({ msg }) => {
                await msg.reply(a)
            }
            options = b ?? {}
            if (options) {
                args = options.args
            }
        } else {
            throw new Error('Invalid cmd signature')
        }
        if (args && (args as any)._def?.shape) {
            const shape = (args as any)._def.shape as Record<string, any>
            const keys = Object.keys(shape) // preserves insertion order

            let seenOptionalish = false

            for (let i = 0; i < keys.length; i++) {
                const key = keys[i]
                const fieldSchema = shape[key]
                const fieldDef =
                    fieldSchema && fieldSchema._def ? fieldSchema._def : {}

                const isOptionalish =
                    fieldDef.optional === true ||
                    fieldDef.defaultValue !== undefined ||
                    fieldDef.nullable === true

                if (isOptionalish) {
                    seenOptionalish = true
                    continue
                }

                if (!isOptionalish && seenOptionalish) {
                    throw new ConfigError(
                        `Invalid args schema: property "${key}" is required but follows an optional/default/nullable property. ` +
                            'All optional/default/nullable properties must appear only as a trailing suffix in the object schema. ' +
                            `Schema order: [${keys.join(', ')}]`
                    )
                }
            }
        }

        const globalMiddleware = this.middleware
        const middleware: IMiddlewares = {
            beforeHandle: [],
            afterHandle: [],
            error: []
        }

        if (options.beforeHandle) {
            if (!Array.isArray(options.beforeHandle))
                options.beforeHandle = [options.beforeHandle]
            middleware.beforeHandle.push(...options.beforeHandle)
        }
        if (options.afterHandle) {
            if (!Array.isArray(options.afterHandle))
                options.afterHandle = [options.afterHandle]
            middleware.afterHandle.push(...options.afterHandle)
        }
        if (options.error) {
            if (!Array.isArray(options.error)) options.error = [options.error]
            middleware.error.push(...options.error)
        }

        const prefixSource =
            this.currentPrefix instanceof RegExp
                ? this.currentPrefix.source.replace(/^\^|\$$/g, '')
                : escapeRegExp(this.currentPrefix as string)
        let finalPattern: RegExp

        if (typeof pattern === 'string') {
            const patternParts = pattern.split(/\s+/).filter(Boolean)

            let regexString = ''

            for (let i = 0; i < patternParts.length; i++) {
                const part = patternParts[i]
                const sep = i === 0 ? '' : '\\s+'
                const isLast = i === patternParts.length - 1

                if (part.startsWith(':')) {
                    const raw = part.slice(1)
                    const paramName = raw.replace(/\?$/, '')
                    const explicitQuestion = raw.endsWith('?')

                    let isOptional = explicitQuestion

                    if (!isOptional && args && (args as any)._def?.shape) {
                        const shape = (args as any)._def.shape as Record<
                            string,
                            any
                        >
                        const propSchema = shape[paramName]
                        if (propSchema) {
                            const def = propSchema._def ?? {}
                            if (
                                def.defaultValue !== undefined ||
                                def.optional === true ||
                                def.nullable === true
                            ) {
                                isOptional = true
                            }
                        }
                    }

                    const capture = isLast
                        ? `(?<${paramName}>.+)`
                        : `(?<${paramName}>[^\\s]+)`

                    regexString += isOptional
                        ? `(?:${sep}${capture})?`
                        : `${sep}${capture}`

                    continue
                }

                // plain literal part
                regexString += `${sep}${escapeRegExp(part)}`
            }

            const separator = prefixSource && regexString ? '\\s+' : ''
            finalPattern = new RegExp(
                `^${prefixSource}${separator}${regexString}$`
            )
        } else {
            const separator = prefixSource && pattern.source ? '\\s+' : ''
            const source = pattern.source.replace(/^\^|\$$/g, '')
            finalPattern = new RegExp(
                `^${prefixSource}${separator}${source}$`,
                pattern.flags
            )
        }

        this.commands.push({
            originalPattern: pattern,
            pattern: finalPattern,
            handler,
            args,
            middleware: MiddlewareEngine.mergeAll(globalMiddleware, middleware),
            options
        })

        return this
    }

    /** --- Core Dispatcher --- **/
    async handle(message: { body: string; raw: any }) {
        if (!this.sock) {
            this.logger.error('Handler called before socket was initialized.')
            return
        }
        const msg = serialize(message.raw, this.sock)
        const ctx: CommandContext = {
            msg,
            raw: message.raw,
            params: {},
            set: {
                status: 200,
                headers: {}
            },
            result: null
        }

        await this.executeHooks('request', ctx)
        await this.executeHooks('parse', ctx)
        await this.executeHooks('transform', ctx)

        for (const cmd of this.commands) {
            let isMatch = false
            if (cmd.pattern) {
                const match = cmd.pattern.exec(message.body)
                if (match) {
                    isMatch = true
                    ctx.params = match.groups || {}
                }
                if (isMatch && cmd.args && (cmd.args as any)._def?.shape) {
                    const shape = (cmd.args as any)._def.shape as Record<
                        string,
                        any
                    >
                    for (const key of Object.keys(shape)) {
                        if (ctx.params[key] === undefined) {
                            const fieldDef = shape[key]._def ?? {}
                            if (fieldDef.nullable === true) {
                                ctx.params[key] = null
                            }
                        }
                    }
                }
            } else if (cmd.predicate) {
                if (cmd.predicate(message.raw)) {
                    isMatch = true
                }
            }

            if (isMatch) {
                try {
                    if (cmd.args) {
                        const parsedParams = cmd.args.parse(ctx.params)
                        ctx.params = parsedParams as Record<string, any>
                    }

                    const beforeResult = await cmd.middleware.executeBefore(ctx)
                    if (beforeResult) {
                        ctx.result = beforeResult
                        if (typeof ctx.result === 'string') {
                            await ctx.msg.reply(ctx.result)
                        }
                        return
                    }
                    const result = await cmd.handler(ctx)
                    ctx.result = result

                    await cmd.middleware.executeAfter(ctx, result)

                    if (result && typeof result === 'string') {
                        await ctx.msg.reply(result)
                    }

                    await this.executeHooks('afterResponse', ctx)
                } catch (err) {
                    await cmd.middleware.executeError(ctx, err)
                }
                return // Stop after the first matching command
            }
        }
    }

    /** --- Helpers --- **/
    private get currentGroup() {
        return this.groups[this.groups.length - 1]
    }

    async connect(callback?: (sock: WASocket) => any) {
        const connect = async (instance: this) => {
            const { state, saveCreds } = await useMultiFileAuthState(
                instance.config.auth.path
            )
            // TODO: another auth type
            const sock = makeWASocket({
                ...instance.config,
                auth: state,
                qrTimeout: instance.config.qrcode?.timeout
            })

            instance.sock = sock
            // Config already validated on instance.constructor
            if (!sock.authState.creds.registered) {
                setTimeout(async () => {
                    if (instance.config.pairing?.number) {
                        const code = await sock.requestPairingCode(
                            instance.config.pairing.number
                        )
                        if (instance.config.pairing.callback) {
                            instance.config.pairing.callback(code)
                        } else {
                            console.log(
                                'WARNING!! Implicit callback() for pairing, set onPairing() as console.log()'
                            )
                            console.log(code)
                        }
                    }
                }, 3000)
            }

            sock.ev.on('creds.update', saveCreds)

            sock.ev.on(
                'connection.update',
                async (update: Partial<ConnectionState>) => {
                    const { connection, lastDisconnect, qr } = update
                    if (instance.config.qrcode && qr) {
                        qrcode.generate(qr, instance.config.qrcode)
                    }

                    if (connection === 'close') {
                        const shouldReconnect =
                            (lastDisconnect?.error as Boom)?.output
                                ?.statusCode !== DisconnectReason.loggedOut
                        if (shouldReconnect) {
                            await connect(instance)
                        }
                    } else if (connection === 'open') {
                        if (callback) callback(sock)
                    }
                }
            )

            sock.ev.on(
                'messages.upsert',
                async (m: { messages: WAMessage[]; type: any }) => {
                    const msg = m.messages[0]
                    if (!msg.message) return

                    const messageBody =
                        msg.message.conversation ||
                        msg.message.extendedTextMessage?.text ||
                        ''
                    if (!messageBody) return

                    await instance.handle({
                        body: messageBody,
                        raw: msg
                    })
                }
            )
            return sock
        }
        await connect(this)
        return this
    }
}
