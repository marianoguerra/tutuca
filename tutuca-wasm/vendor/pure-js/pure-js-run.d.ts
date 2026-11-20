import type { Json, RunSpec } from "./pure-js.js";

/** How a compiled run ended. */
export type RunOutcome =
	| { kind: "finished"; value?: Json }
	| { kind: "undefined"; why: string }
	| { kind: "terminated"; error: string; message: string };

export interface RunResult {
	outcome: RunOutcome;
	/** The arguments as the run left them. */
	args: Json[];
	/** What the run asked the embedder's host, in order. */
	calls: { name: string; args: Json[] }[];
}

export interface HostOptions {
	/** What the host's members answer, by qualified name; the rest answer undefined. */
	answers?: { [qualified: string]: Json };
	/** Functions for the host's members, by qualified name: (this, ...args) => result. */
	host?: { [qualified: string]: (self: Json | undefined, ...args: Json[]) => Json | undefined };
	/**
	 * An embedder that works on the module's own values, asked before host and answers (and after
	 * the standard host): the qualified name, this and the list of arguments as values; what it
	 * gives is a value, or undefined for "not mine".
	 */
	rawHost?: ((name: string, self: unknown, args: unknown) => unknown) | null;
}

/** How compiled code ends a run: thrown by the host to end one too. kind 0 is undefined behaviour (a is why), 1 an error (a its kind, b its message). */
export class Fail extends Error {
	constructor(kind: 0 | 1, a: string, b?: string);
	readonly outcome: RunOutcome;
}

/** A compiled module, made: its entries can be run. */
export class Instance {
	constructor(module: WebAssembly.Module, options?: HostOptions);
	/** The functions an embedder can run: a program's is "main", a module's entries are their paths. */
	readonly entries: string[];
	/** The module's exports as they are: its entries, and the functions that make and read its values. */
	readonly exports: { [name: string]: (...args: unknown[]) => unknown };
	/** Runs an entry ("main" when the spec names none). this is frozen. */
	run(spec?: RunSpec): RunResult;
	/** A JSON value as a value of the module's; { $handle: name, ...fields } is a handle. */
	toValue(value: Json | undefined): unknown;
	/** A value of the module's as JavaScript's. */
	fromValue(value: unknown): Json | undefined;
}

/** The bytes pure-js compiled, as a WebAssembly.Module. */
export function compileBytes(bytes: BufferSource): Promise<WebAssembly.Module>;

/** Makes a compiled module: bytes (or a WebAssembly.Module) to an Instance. */
export function instantiate(bytes: BufferSource | WebAssembly.Module, options?: HostOptions): Promise<Instance>;
