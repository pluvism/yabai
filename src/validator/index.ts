/* eslint-disable @typescript-eslint/no-explicit-any */

export class ValidationError extends Error {
    issues: { message: string; path: (string | number)[] }[]

    constructor(issues: { message: string; path: (string | number)[] }[]) {
        const message =
            issues.length === 1
                ? `${issues[0].message} at path "${issues[0].path.join('.')}"`
                : `${issues.length} issues found`
        super(message)
        this.issues = issues
        this.name = 'ValidationError'
    }

    format(): string {
        return this.issues
            .map((issue) => `• ${issue.message} at "${issue.path.join('.')}"`)
            .join('\n')
    }
}

export interface YabaiType<T = any> {
    parse(data: any): T
    optional(): YabaiType<T | undefined>
    nullable(): YabaiType<T | null>
    default(value: T): YabaiType<T>
    refine(validator: (value: T) => boolean, message?: string): YabaiType<T>
    _def: any
}

export interface YabaiTypeAny<T = any> {
    parse(data: any): T
    _def: any
}

type YabaiObjectDef<T extends Record<string, YabaiType>> = {
    shape: T
    strict: boolean
}

class YabaiObject<T extends Record<string, YabaiType>> {
    _def: YabaiObjectDef<T>

    constructor(shape: T, strict: boolean = true) {
        this._def = { shape, strict }
    }

    parse(data: any): { [k in keyof T]: ReturnType<T[k]['parse']> } {
        if (typeof data !== 'object' || data === null) {
            throw new ValidationError([
                { message: 'Expected an object', path: [] }
            ])
        }

        const parsed: any = {}
        const issues: { message: string; path: (string | number)[] }[] = []

        if (this._def.strict) {
            const knownKeys = new Set(Object.keys(this._def.shape))
            const unknownKeys = Object.keys(data).filter(
                (key) => !knownKeys.has(key)
            )

            if (unknownKeys.length > 0) {
                issues.push(
                    ...unknownKeys.map((key) => ({
                        message: `Unknown property '${key}'`,
                        path: [key]
                    }))
                )
            }
        }

        for (const key in this._def.shape) {
            try {
                const value = data[key]
                const schema = this._def.shape[key]

                if (value === undefined && schema._def?.optional) {
                    if (schema._def?.defaultValue !== undefined) {
                        parsed[key] = schema._def.defaultValue
                    } else {
                        parsed[key] = undefined
                    }
                    continue
                }

                if (value === null && schema._def?.nullable) {
                    parsed[key] = null
                    continue
                }

                parsed[key] = schema.parse(value)
            } catch (e) {
                if (e instanceof ValidationError) {
                    issues.push(
                        ...e.issues.map((issue) => ({
                            ...issue,
                            path: [key, ...issue.path]
                        }))
                    )
                } else {
                    issues.push({
                        message: (e as Error).message,
                        path: [key]
                    })
                }
            }
        }

        if (issues.length > 0) {
            throw new ValidationError(issues)
        }

        return parsed
    }

    strict(strict: boolean = true): YabaiObject<T> {
        return new YabaiObject(this._def.shape, strict)
    }

    partial(): YabaiObject<{
        [K in keyof T]: YabaiType<ReturnType<T[K]['parse']> | undefined>
    }> {
        const partialShape: any = {}
        for (const key in this._def.shape) {
            partialShape[key] = this._def.shape[key].optional()
        }
        return new YabaiObject(partialShape, this._def.strict)
    }

    extend<U extends Record<string, YabaiType>>(shape: U): YabaiObject<T & U> {
        return new YabaiObject(
            { ...this._def.shape, ...shape },
            this._def.strict
        )
    }
}

function raiseError(message: string, path?: (string | number)[]): never
function raiseError(
    issues: { message: string; path: (string | number)[] }[]
): never
function raiseError(
    arg1: string | { message: string; path: (string | number)[] }[],
    arg2?: (string | number)[]
): never {
    if (typeof arg1 === 'string') {
        if (!Array.isArray(arg2)) {
            arg2 = []
        }
        throw new ValidationError([{ message: arg1, path: arg2 }])
    }
    if (!Array.isArray(arg1)) {
        throw new TypeError('raiseError expects an array of issues')
    }
    throw new ValidationError(arg1)
}

class YabaiBaseType<T> implements YabaiType<T> {
    _def: any = {}

    constructor(def: any = {}) {
        this._def = def
    }

    parse(value: any): T {
        throw new Error('parse method must be implemented')
    }

    optional(): YabaiType<T | undefined> {
        return new YabaiOptional(this)
    }

    nullable(): YabaiType<T | null> {
        return new YabaiNullable(this)
    }

    default(value: T): YabaiType<T> {
        return new YabaiDefault(this, value)
    }

    refine(
        validator: (value: T) => boolean,
        message: string = 'Validation failed'
    ): YabaiType<T> {
        return new YabaiRefine(this, validator, message)
    }
}

class YabaiOptional<T> extends YabaiBaseType<T | undefined> {
    constructor(private type: YabaiType<T>) {
        super({ ...type._def, optional: true })
    }

    parse(value: any): T | undefined {
        if (value === undefined) return undefined
        return this.type.parse(value)
    }
}

class YabaiNullable<T> extends YabaiBaseType<T | null> {
    constructor(private type: YabaiType<T>) {
        super({ ...type._def, nullable: true })
    }

    parse(value: any): T | null {
        if (value === null) return null
        return this.type.parse(value)
    }
}

class YabaiDefault<T> extends YabaiBaseType<T> {
    constructor(
        private type: YabaiType<T>,
        private defaultValue: T
    ) {
        super({ ...type._def, defaultValue })
    }

    parse(value: any): T {
        if (value === undefined) return this.defaultValue
        return this.type.parse(value)
    }
}

class YabaiRefine<T> extends YabaiBaseType<T> {
    constructor(
        private type: YabaiType<T>,
        private validator: (value: T) => boolean,
        private message: string
    ) {
        super({ ...type._def, refine: { validator, message } })
    }

    parse(value: any): T {
        const parsed = this.type.parse(value)
        if (!this.validator(parsed)) {
            raiseError(this.message)
        }
        return parsed
    }
}

class YabaiArray<T> extends YabaiBaseType<T[]> {
    constructor(private elementType: YabaiType<T>) {
        super()
    }

    parse(value: any): T[] {
        if (!Array.isArray(value)) {
            raiseError('Expected an array')
        }

        const parsed: T[] = []
        const issues: { message: string; path: (string | number)[] }[] = []

        for (let i = 0; i < value.length; i++) {
            try {
                parsed[i] = this.elementType.parse(value[i])
            } catch (e) {
                if (e instanceof ValidationError) {
                    issues.push(
                        ...e.issues.map((issue) => ({
                            ...issue,
                            path: [i, ...issue.path]
                        }))
                    )
                } else {
                    issues.push({
                        message: (e as Error).message,
                        path: [i]
                    })
                }
            }
        }

        if (issues.length > 0) {
            throw new ValidationError(issues)
        }

        return parsed
    }
}

class YabaiUnion<T extends YabaiType[]> extends YabaiBaseType<
    ReturnType<T[number]['parse']>
> {
    constructor(private types: T) {
        super()
    }

    parse(value: any): ReturnType<T[number]['parse']> {
        const issues: { message: string; path: (string | number)[] }[] = []

        for (const type of this.types) {
            try {
                return type.parse(value)
            } catch (e) {
                if (e instanceof ValidationError) {
                    issues.push(...e.issues)
                } else {
                    issues.push({
                        message: (e as Error).message,
                        path: []
                    })
                }
            }
        }

        throw new ValidationError([
            ...issues,
            {
                message: 'Value did not match any of the expected types',
                path: []
            }
        ])
    }
}

const YabaiTypePrimitive = {
    number() {
        return new (class extends YabaiBaseType<number> {
            parse(value: any): number {
                const num = Number(value)
                if (typeof num !== 'number' || isNaN(num)) {
                    raiseError('Expected a number')
                }
                return num
            }
        })()
    },

    string(max?: number, min?: number) {
        return new (class extends YabaiBaseType<string> {
            parse(value: any): string {
                if (typeof value !== 'string') {
                    raiseError('Expected a string')
                }

                const str = value
                if (min !== undefined && str.length < min) {
                    raiseError(`String too short, min ${min} characters`)
                }
                if (max !== undefined && str.length > max) {
                    raiseError(`String too long, max ${max} characters`)
                }
                return str
            }
        })()
    },

    boolean() {
        return new (class extends YabaiBaseType<boolean> {
            parse(value: any): boolean {
                if (typeof value !== 'boolean') {
                    raiseError('Expected a boolean')
                }
                return value
            }
        })()
    },

    literal<T extends string | number | boolean>(expected: T) {
        return new (class extends YabaiBaseType<T> {
            parse(value: any): T {
                if (value !== expected) {
                    raiseError(
                        `Expected literal value: ${expected}, received: ${value}`
                    )
                }
                return value
            }
        })()
    },

    array<T extends YabaiType>(elementType: T) {
        return new YabaiArray(elementType)
    },

    union<T extends YabaiType[]>(...types: T) {
        return new YabaiUnion(types)
    }
}

export type infer<T extends YabaiTypeAny> = ReturnType<T['parse']>

export const t = {
    object: <T extends Record<string, YabaiType>>(shape: T) =>
        new YabaiObject(shape),
    ...YabaiTypePrimitive
}

export const desu = {
    email() {
        return t
            .string()
            .refine(
                (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
                'Invalid email format'
            )
    },

    url() {
        return t.string().refine((value) => {
            try {
                new URL(value)
                return true
            } catch {
                return false
            }
        }, 'Invalid URL')
    },

    uuid() {
        return t
            .string()
            .refine(
                (value) =>
                    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
                        value
                    ),
                'Invalid UUID format'
            )
    },

    dateString() {
        return t
            .string()
            .refine((value) => !isNaN(Date.parse(value)), 'Invalid date string')
    }
}
