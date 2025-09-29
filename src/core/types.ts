import { z, ZodTypeAny, infer as zInfer } from "../validator/index.js";
import { Msg } from "./message.js";

/** --- Type‑level Param Extraction (space‑delimited) --- **/
type SplitOnSpace<S extends string> = S extends `${infer Head} ${infer Rest}`
  ? [Head, ...SplitOnSpace<Rest>]
  : [S];

type ExtractParam<Seg extends string, Next> = Seg extends `:${infer P}?`
  ? { [K in P]?: string } & Next
  : Seg extends `:${infer P}`
  ? { [K in P]: string } & Next
  : Next;

type ExtractParamsInternal<Parts extends readonly string[]> = Parts extends [
  infer First extends string,
  ...infer Rest extends string[]
]
  ? ExtractParam<First, ExtractParamsInternal<Rest>>
  : {};

export type ExtractParams<Pattern extends string> = ExtractParamsInternal<
  SplitOnSpace<Pattern>
>;

/** --- Context & Middleware Types --- **/
export interface CommandContext<P = Record<string, any>> {
  msg: Msg;
  raw: any;
  params: P;
  set: { status: number; headers: Record<string, string> };
  result?: any,
  error?: unknown
}

export type Middleware<T = any> = (
  ctx: CommandContext<T>,
  next: () => Promise<void>
) => any;


export type Handler<P = any> = (ctx: CommandContext<P>) => any | Promise<any>;
export type ErrorHandler = ((arg: { error: any; ctx: CommandContext<any> }) => any)
export type Hook = (ctx: CommandContext<any>) => any | Promise<any>;

export interface CmdOptions<P = any> {
  description?: string;
  beforeHandle?: Middleware;
  afterHandle?: Middleware<P>;
  error?: ErrorHandler;
  schema?: ZodTypeAny;
}

export const HOOK_NAMES = ["request", "parse", "transform", "afterResponse"] as const;

export const SCOPE_TYPES = {
  GLOBAL: "global",
  SCOPED: "scoped",
  LOCAL: "local",
} as const;

export type ScopesType = typeof SCOPE_TYPES;
export type Scope = ScopesType[keyof ScopesType];

export type HooksType = typeof HOOK_NAMES;
export type HookName = HooksType[number];
export type HookRecord = Record<HookName, Hook[]>;

export interface YabaiConfig {
  enableHelp?: boolean;
  scope: Scope;
  prefix: string;
  description: string;
}

export type PrefixType = string | RegExp

export interface IMiddlewares {
  beforeHandle: Middleware[]
  afterHandle: Middleware[]
  error: ErrorHandler[]
}

export type MiddlewareMap = {
  beforeHandle: Middleware;
  afterHandle:  Middleware;
  error:        ErrorHandler;
}