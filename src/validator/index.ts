/* eslint-disable @typescript-eslint/no-explicit-any */

export class ZodError extends Error {
    issues: { message: string; path: (string | number)[] }[];

    constructor(issues: { message: string; path: (string | number)[] }[]) {
        super('Zod validation error');
        this.issues = issues;
        this.name = 'ZodError';
    }
}

export type ZodTypeAny = {
    parse(data: any): any;
    _def: any;
};

type ZodObjectDef<T extends Record<string, ZodTypeAny>> = {
    shape: T;
};

class ZodObject<T extends Record<string, ZodTypeAny>> {
    _def: ZodObjectDef<T>;

    constructor(shape: T) {
        this._def = { shape };
    }

    parse(data: any): { [k in keyof T]: ReturnType<T[k]['parse']> } {
        if (typeof data !== 'object' || data === null) {
            throw new ZodError([{ message: 'Expected an object', path: [] }]);
        }

        const parsed: any = {};
        const issues: { message: string; path: (string | number)[] }[] = [];

        for (const key in this._def.shape) {
            try {
                parsed[key] = this._def.shape[key].parse(data[key]);
            } catch (e) {
                if (e instanceof ZodError) {
                    issues.push(
                        ...e.issues.map((issue) => ({
                            ...issue,
                            path: [key, ...issue.path]
                        }))
                    );
                } else {
                    issues.push({ message: (e as Error).message, path: [key] });
                }
            }
        }

        if (issues.length > 0) {
            throw new ZodError(issues);
        }

        return parsed;
    }
}

class ZodCoercion {
    number() {
        return {
            parse(value: any): number {
                const num = Number(value);
                if (isNaN(num)) {
                    throw new ZodError([
                        { message: 'Expected a number', path: [] }
                    ]);
                }
                return num;
            },
            _def: {}
        };
    }
}

type infer<T extends ZodTypeAny> = ReturnType<T['parse']>;

const z = {
    object: <T extends Record<string, ZodTypeAny>>(shape: T) =>
        new ZodObject(shape),
    coerce: new ZodCoercion()
};

type ZodType = ZodObject<any> | { parse: (data: any) => any };

export { z };
export type { infer };
