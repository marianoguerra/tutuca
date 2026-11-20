/** A JSON value. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export type Stage = "parse" | "sieve" | "check";
export type Exclusion = "by-design" | "omitted";
export type Verdict = "accepted" | "excluded-by-design" | "omitted" | "ill-formed" | "not-javascript";
export type Profile = "core" | "let" | "destructuring" | "forOf" | "module";

/** A place in the source: offsets in UTF-16 code units, lines and columns from 1. */
export class Span {
	readonly start: number;
	readonly end: number;
	readonly line: number;
	readonly column: number;
	readonly endLine: number;
	readonly endColumn: number;
	/** The text the span covers. */
	slice(source: string): string;
	toString(): string;
}

/** One thing a stage found wrong with a program. */
export class Diagnostic {
	/** Kebab-case: "unknown-name", "loop-statement", "syntax-error", ... */
	readonly code: string;
	readonly stage: Stage;
	readonly message: string;
	readonly span: Span;
	/** How a form pure-js leaves out is left out; null for an error. */
	readonly exclusion: Exclusion | null;
	/** The profile that admits an omitted form, when there is one. */
	readonly profile: string | null;
	readonly help: string | null;
	readonly excludedByDesign: boolean;
	readonly omitted: boolean;
	readonly severity: "error" | "excluded";
	toString(): string;
}

/** A directive the module could not use: not JSON, a host that doesn't parse. */
export class Problem {
	readonly directive: string;
	readonly line: number;
	readonly message: string;
	toString(): string;
}

/** How a run ended. */
export abstract class Outcome {
	readonly kind: "finished" | "undefined" | "terminated";
	readonly finished: boolean;
}

/** The run returned: value is what, undefined when it returned nothing. */
export class Finished extends Outcome {
	readonly kind: "finished";
	readonly value: Json | undefined;
}

/** The run reached something pure-js doesn't define, or a limit, and aborted. */
export class UndefinedBehaviour extends Outcome {
	readonly kind: "undefined";
	readonly why: string;
}

/** An error ended the run. */
export class Terminated extends Outcome {
	readonly kind: "terminated";
	readonly error: string;
	readonly message: string;
}

/** A call a run made to a member of its host. */
export class HostCall {
	/** Qualified: "Ctx.notify". */
	readonly name: string;
	readonly args: Json[];
	toString(): string;
}

/** One @run of the source. */
export class Run {
	/** The entry's path, for a module's run; null for a program's. */
	readonly entry: string | null;
	readonly outcome: Finished | UndefinedBehaviour | Terminated;
	/** 0 finished, 5 undefined behaviour, 6 terminated. */
	readonly exit: 0 | 5 | 6;
	/** What the interpreter counted: the same in every implementation. */
	readonly steps: number;
	/** The arguments as the run left them. */
	readonly args: Json[];
	/** What the run asked its host, in order. */
	readonly calls: HostCall[];
	/** The run as the module's JSON has it. */
	readonly raw: { entry: string | null; outcome: object; exit: number; steps: number; args: Json[]; calls: object[] };
	readonly finished: boolean;
	/** What a finished run returned. */
	readonly value: Json | undefined;
}

/** A function of a module an embedder calls: a namespace's method or getter. */
export class Entry {
	readonly path: string;
	readonly getter: boolean;
	readonly returnType: string;
	readonly segments: string[];
	readonly name: string;
}

/** What checking a module's helper function found. */
export class Summary {
	readonly name: string;
	readonly params: { name: string; type: string; mutable: boolean }[];
	readonly result: string;
	/** Every value it returns is made in it, so a caller may change it. */
	readonly fresh: boolean;
	toString(): string;
}

/** What compiling the source gave: a WebAssembly module, or why there isn't one. */
export class Compiled {
	/** The module's binary; null when the compiler doesn't compile a form of the source yet. */
	readonly bytes: Uint8Array | null;
	/** The module's text. */
	readonly wat: string | null;
	/** Whether it exports init, which makes a module's constants. */
	readonly init: boolean;
	/** What it exports for an embedder; a program's is "main", a module's entries are their paths. */
	readonly exports: { name: string; params: number; getter: boolean }[];
	/** The form the compiler doesn't compile yet, or null. */
	readonly problem: { start: number; end: number; line: number; column: number; message: string } | null;
	readonly ok: boolean;
}

/** Everything the library found in one source. */
export class Analysis {
	readonly version: string;
	readonly kind: "program" | "module";
	readonly profile: string;
	/** No diagnostics and no problems. */
	readonly ok: boolean;
	/** 0 accepted, 1 excluded by design, 2 omitted, 3 ill-formed, 4 not JavaScript. */
	readonly exit: 0 | 1 | 2 | 3 | 4;
	readonly verdict: Verdict;
	readonly diagnostics: Diagnostic[];
	readonly problems: Problem[];
	/** The diagnostics, written for people, with the lines they point at. */
	readonly report: string;
	/** What a program returns; null for a module, or one that didn't get to the checker. */
	readonly returnType: string | null;
	/** The ESTree tree, with TypeScript's annotations; null when it doesn't parse. */
	readonly tree: { type: string; [key: string]: Json } | null;
	/** The source again, without its types. */
	readonly javascript: string | null;
	/** The source again, with them. */
	readonly typescript: string | null;
	readonly entries: Entry[];
	/** A module's helpers and what each calls. */
	readonly callGraph: Map<string, string[]>;
	readonly summaries: Summary[];
	readonly runs: Run[];
	/** The source compiled to WebAssembly; null when it isn't accepted. Run it with pure-js-run.js. */
	readonly compiled: Compiled | null;
	readonly isModule: boolean;
	entry(path: string): Entry | undefined;
	static fromJSON(json: string | object): Analysis;
}

/** `"T"`, `"read T"` or `"draft T"`. */
export type EntryType = string;

export interface Signature {
	this?: EntryType;
	params?: EntryType[];
	result?: EntryType;
}

/** A host declaration: TypeScript text, by name. */
export interface HostDeclaration {
	types?: { [name: string]: string };
	handles?: { [name: string]: string };
	modules?: { [name: string]: { [member: string]: string | string[] } };
	functions?: { [name: string]: string | string[] };
	nondeterministic?: string[];
	fresh?: string[];
	imports?: { [specifier: string]: string };
}

export interface RunSpec {
	/** A module's run names its entry. */
	entry?: string;
	this?: Json;
	/** `{ "$handle": "Name", ...fields }` is a handle of the host's. */
	args?: Json[];
	maxSteps?: number;
}

export interface Directives {
	types?: { [name: string]: string };
	handles?: { [name: string]: string };
	host?: HostDeclaration;
	signature?: Signature;
	/** By path; a key ending in * matches what is under it. */
	entries?: { [path: string]: Signature };
	data?: { [path: string]: string };
	profile?: Profile;
	deterministic?: boolean;
	/** What the host's members answer in a run, by qualified name. */
	answers?: { [qualified: string]: Json };
	runs?: RunSpec[];
	/** The modules the source imports, by specifier. */
	modules?: { [specifier: string]: string };
}

/** The specs of a source's // @run lines, in order, and its // @answers. */
export function runsOf(source: string): { runs: RunSpec[]; answers: { [qualified: string]: Json } };

/** A source with its directives written for it. */
export function withDirectives(code: string, options?: Directives): string;

/** The loaded module. */
export class PureJs {
	/** The module's own answer: JSON, as text. */
	analyzeJson(source: string): string;
	/** The answer as an Analysis. With options, the source gets their directives first. */
	analyze(source: string, options?: Directives): Analysis;
}

/**
 * Loads the wasm module: from pure-js.wasm beside this file, or from a URL,
 * a Response, bytes, or a compiled WebAssembly.Module.
 */
export function load(from?: string | URL | Response | BufferSource | WebAssembly.Module): Promise<PureJs>;
