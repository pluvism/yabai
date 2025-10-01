// command.ts
import { YabaiTypeAny, infer as yInfer } from '../validator/index.js'
import { MiddlewareEngine } from './middleware.js'
import { CmdOptions, Handler } from './types.js'

/** --- Internal Command Definition --- **/
export interface CommandDef<E extends YabaiTypeAny = YabaiTypeAny> {
    predicate?: (rawMessage: any) => boolean
    originalPattern?: string | RegExp
    pattern?: RegExp
    prefix?: string | RegExp
    handler: Handler<yInfer<E>>
    args?: E
    middleware: MiddlewareEngine
    options?: CmdOptions<E>
}
