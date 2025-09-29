import { ZodTypeAny } from '../validator/index.js'
import { MiddlewareEngine } from './middleware.js'
import { CmdOptions, Handler } from './types.js'

/** --- Internal Command Definition --- **/
export interface CommandDef<P = any, E = any> {
    predicate?: (rawMessage: any) => boolean
    originalPattern?: string | RegExp
    pattern?: RegExp
    prefix?: string | RegExp
    handler: Handler<P>
    schema?: ZodTypeAny
    middleware: MiddlewareEngine
    options?: CmdOptions<E>
}
