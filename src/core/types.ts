import { SocketConfig, UserFacingSocketConfig } from 'baileys'
import { infer as yInfer, YabaiTypeAny } from '../validator/index.js'
import { Msg } from './message.js'

/** --- Type‑level Param Extraction (space‑delimited) --- **/
type SplitOnSpace<S extends string> = S extends `${infer Head} ${infer Rest}`
    ? [Head, ...SplitOnSpace<Rest>]
    : [S]

type ExtractParam<Seg extends string, Next> = Seg extends `:${infer P}?`
    ? { [K in P]?: string } & Next
    : Seg extends `:${infer P}`
      ? { [K in P]: string } & Next
      : Next

type ExtractParamsInternal<Parts extends readonly string[]> = Parts extends [
    infer First extends string,
    ...infer Rest extends string[]
]
    ? ExtractParam<First, ExtractParamsInternal<Rest>>
    : {}

export type ExtractParams<Pattern extends string> = ExtractParamsInternal<
    SplitOnSpace<Pattern>
>

/** --- Context & Middleware Types --- **/
export interface CommandContext<P = Record<string, any>> {
    msg: Msg
    raw: any
    params: P
    set: { status: number; headers: Record<string, string> }
    result?: unknown
    error?: unknown
}

export type Middleware<T = any> = (
    ctx: CommandContext<T>,
    next: () => Promise<void>
) => any

export type Handler<P = any> = (ctx: CommandContext<P>) => any | Promise<any>
export type ErrorHandler<P = any> = (arg: {
    error: any
    ctx: CommandContext<P>
}) => any
export type Hook = (ctx: CommandContext<any>) => any | Promise<any>

export interface CmdOptions<T extends YabaiTypeAny = YabaiTypeAny> {
    description?: string
    beforeHandle?: Middleware[] | Middleware<yInfer<T>>
    afterHandle?: Middleware<yInfer<T>>[] | Middleware<yInfer<T>>
    error?: ErrorHandler<yInfer<T>>[] | ErrorHandler<yInfer<T>>
    args?: T
}

export const HOOK_NAMES = [
    'pairing',
    'request',
    'parse',
    'transform',
    'afterResponse'
] as const

export const SCOPE_TYPES = {
    GLOBAL: 'global',
    SCOPED: 'scoped',
    LOCAL: 'local'
} as const

export type ScopesType = typeof SCOPE_TYPES
export type Scope = ScopesType[keyof ScopesType]
export type HooksType = typeof HOOK_NAMES
export type HookName = HooksType[number]
export type HookRecord = Record<HookName, Hook[]>

export interface AuthType {
    type: 'local' //TODO: mongodb? sql?
    path: string
}

export type Digit = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9'
export type DigitString = `${Digit}${string}`

export interface PairingConfig {
    number: DigitString
    callback?: (code: string) => void
}

export interface QRCodeConfig {
    small?: boolean
    timeout?: number // ms
}

export interface YabaiConfig
    extends Omit<UserFacingSocketConfig, 'auth' | 'qrTimeout'> {
    enableHelp?: boolean
    qrcode?: QRCodeConfig
    pairing?: PairingConfig
    auth: AuthType
    scope: Scope
    prefix: string
    description: string
}

export type PrefixType = string | RegExp

export interface IMiddlewares {
    beforeHandle: Middleware[]
    afterHandle: Middleware[]
    error: ErrorHandler[]
}

export type MiddlewareMap = {
    beforeHandle: Middleware
    afterHandle: Middleware
    error: ErrorHandler
}
