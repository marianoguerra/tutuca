// pure-js for JavaScript: the wasm-gc module's one function, and its JSON
// answer as class instances.
//
//   import { load } from "./pure-js.js";
//   const purejs = await load();
//   const analysis = purejs.analyze("(a: number, b: number): number => a + b");
//   analysis.ok;            // true
//   analysis.returnType;    // "number"
//
// The module needs an engine with WebAssembly GC and JS string builtins
// (Chrome 131+, Firefox 134+, Safari 18.4+, Node 24+).

/** A place in the source: offsets in UTF-16 code units, lines and columns from 1. */
export class Span {
	constructor({ start, end, line, column, endLine, endColumn }) {
		this.start = start;
		this.end = end;
		this.line = line;
		this.column = column;
		this.endLine = endLine;
		this.endColumn = endColumn;
	}

	/** The text the span covers. */
	slice(source) {
		return source.slice(this.start, this.end);
	}

	toString() {
		return `line ${this.line}, column ${this.column}`;
	}
}

/** One thing a stage found wrong with a program. */
export class Diagnostic {
	constructor(d) {
		/** Kebab-case: "unknown-name", "loop-statement", "syntax-error", ... */
		this.code = d.code;
		/** "parse" | "sieve" | "check" */
		this.stage = d.stage;
		this.message = d.message;
		this.span = new Span(d);
		/** "by-design" | "omitted" | null: how a form pure-js leaves out is left out. */
		this.exclusion = d.exclusion;
		/** The profile that admits an omitted form, when there is one. */
		this.profile = d.profile;
		this.help = d.help;
	}

	/** The form is one pure-js will never have. */
	get excludedByDesign() {
		return this.exclusion === "by-design";
	}

	/** The form is one this version leaves out. */
	get omitted() {
		return this.exclusion === "omitted";
	}

	/** "error" for what is wrong, "excluded" for what is left out. */
	get severity() {
		return this.exclusion === null ? "error" : "excluded";
	}

	toString() {
		const help = this.help ? ` (${this.help})` : "";
		return `${this.severity}[purejs::${this.code}] ${this.span}: ${this.message}${help}`;
	}
}

/** A directive the module could not use: not JSON, a host that doesn't parse. */
export class Problem {
	constructor({ directive, line, message }) {
		this.directive = directive;
		this.line = line;
		this.message = message;
	}

	toString() {
		return this.line > 0 ? `@${this.directive}, line ${this.line}: ${this.message}` : this.message;
	}
}

/** How a run ended. One of Finished, UndefinedBehaviour, Terminated. */
export class Outcome {
	constructor(kind) {
		/** "finished" | "undefined" | "terminated" */
		this.kind = kind;
	}

	get finished() {
		return this.kind === "finished";
	}

	static from(o) {
		switch (o.kind) {
			case "finished":
				return new Finished(o.value);
			case "undefined":
				return new UndefinedBehaviour(o.why);
			case "terminated":
				return new Terminated(o.error, o.message);
			default:
				throw new TypeError(`there is no outcome ${o.kind}`);
		}
	}
}

/** The run returned: value is what, undefined when it returned nothing. */
export class Finished extends Outcome {
	constructor(value) {
		super("finished");
		this.value = value;
	}

	toString() {
		return this.value === undefined ? "finished" : `finished: ${JSON.stringify(this.value)}`;
	}
}

/** The run reached something pure-js doesn't define, or a limit, and aborted. */
export class UndefinedBehaviour extends Outcome {
	constructor(why) {
		super("undefined");
		this.why = why;
	}

	toString() {
		return `undefined behaviour: ${this.why}`;
	}
}

/** An error ended the run. */
export class Terminated extends Outcome {
	constructor(error, message) {
		super("terminated");
		this.error = error;
		this.message = message;
	}

	toString() {
		return `terminated: ${this.error}: ${this.message}`;
	}
}

/** A call a run made to a member of its host. */
export class HostCall {
	constructor({ name, args }) {
		/** Qualified: "Ctx.notify". */
		this.name = name;
		this.args = args;
	}

	toString() {
		return `${this.name}(${this.args.map((a) => JSON.stringify(a)).join(", ")})`;
	}
}

/** One @run of the source. */
export class Run {
	constructor(r) {
		/** The run as the module's JSON has it. */
		this.raw = r;
		/** The entry's path, for a module's run; null for a program's. */
		this.entry = r.entry;
		this.outcome = Outcome.from(r.outcome);
		/** As the command's: 0 finished, 5 undefined behaviour, 6 terminated. */
		this.exit = r.exit;
		/** What the interpreter counted: the same in every implementation. */
		this.steps = r.steps;
		/** The arguments as the run left them: what it changed is here. */
		this.args = r.args;
		/** What the run asked its host, in order. */
		this.calls = r.calls.map((c) => new HostCall(c));
	}

	get finished() {
		return this.outcome.finished;
	}

	/** What a finished run returned. */
	get value() {
		return this.outcome.value;
	}
}

/** A function of a module an embedder calls: a namespace's method or getter. */
export class Entry {
	constructor({ path, getter, returnType }) {
		/** "Cart.on.add.run" */
		this.path = path;
		this.getter = getter;
		this.returnType = returnType;
	}

	get segments() {
		return this.path.split(".");
	}

	get name() {
		return this.segments.at(-1);
	}
}

/** What checking a module's helper function found. */
export class Summary {
	constructor(name, { params, result, fresh }) {
		this.name = name;
		/** { name, type, mutable }: mutable when the helper may change it (written draft). */
		this.params = params;
		this.result = result;
		/** Every value it returns is made in it, so a caller may change it. */
		this.fresh = fresh;
	}

	toString() {
		const params = this.params.map((p) => `${p.name}: ${p.mutable ? "draft " : ""}${p.type}`);
		return `${this.name}(${params.join(", ")}): ${this.fresh ? "fresh " : ""}${this.result}`;
	}
}

/** What compiling the source gave: a WebAssembly module, or why there isn't one. */
export class Compiled {
	constructor(c) {
		/** The module's binary; null when the compiler doesn't compile a form of the source yet. */
		this.bytes = c.wasm === null ? null : Uint8Array.from(atob(c.wasm), (ch) => ch.charCodeAt(0));
		/** The module's text. */
		this.wat = c.wat;
		/** Whether it exports init, which makes a module's constants. */
		this.init = c.init;
		/** What it exports for an embedder: { name, params, getter }; a program's is "main". */
		this.exports = c.exports;
		/** { start, end, line, column, message }: the form the compiler doesn't compile yet, or null. */
		this.problem = c.problem;
	}

	get ok() {
		return this.bytes !== null;
	}
}

/** Everything the library found in one source. */
export class Analysis {
	constructor(a) {
		/** The library's version. */
		this.version = a.version;
		/** "program" (one function) | "module" (declarations). */
		this.kind = a.kind;
		this.profile = a.profile;
		/** No diagnostics and no problems. */
		this.ok = a.ok;
		/** 0 accepted, 1 excluded by design, 2 omitted, 3 ill-formed, 4 not JavaScript. */
		this.exit = a.exit;
		/** "accepted" | "excluded-by-design" | "omitted" | "ill-formed" | "not-javascript" */
		this.verdict = a.verdict;
		this.diagnostics = a.diagnostics.map((d) => new Diagnostic(d));
		this.problems = a.problems.map((p) => new Problem(p));
		/** The diagnostics, written for people, with the lines they point at. */
		this.report = a.report;
		/** What a program returns; null for a module, or one that didn't get to the checker. */
		this.returnType = a.returnType ?? null;
		/** The ESTree tree, with TypeScript's annotations; null when it doesn't parse. */
		this.tree = a.tree;
		/** The source again, without its types. */
		this.javascript = a.javascript;
		/** The source again, with them. */
		this.typescript = a.typescript;
		/** A module's entries. */
		this.entries = (a.entries ?? []).map((e) => new Entry(e));
		/** A module's helpers and what each calls. */
		this.callGraph = new Map(Object.entries(a.callGraph ?? {}));
		/** A module's helpers, checked. */
		this.summaries = Object.entries(a.summaries ?? {}).map(([name, s]) => new Summary(name, s));
		this.runs = a.runs.map((r) => new Run(r));
		/** The source compiled to WebAssembly; null when it isn't accepted. Run it with pure-js-run.js. */
		this.compiled = a.compiled ? new Compiled(a.compiled) : null;
	}

	get isModule() {
		return this.kind === "module";
	}

	/** The entry at a path, or undefined. */
	entry(path) {
		return this.entries.find((e) => e.path === path);
	}

	/** From the module's JSON, as text or parsed. */
	static fromJSON(json) {
		return new Analysis(typeof json === "string" ? JSON.parse(json) : json);
	}
}

/**
 * What a source's header says of its runs: the specs of its // @run lines, in order, and its
 * // @answers. What pure-js-run.js needs to run the compiled module as analyze ran the source.
 */
export function runsOf(source) {
	const runs = [];
	let answers = {};
	for (const text of source.split("\n")) {
		const t = text.trim();
		if (t === "") continue;
		if (!t.startsWith("//")) break;
		const m = t.match(/^\/\/\s*@(run|answers)\s*(.*)$/);
		if (!m) continue;
		try {
			const value = m[2] === "" ? {} : JSON.parse(m[2]);
			if (m[1] === "run") runs.push(value);
			else answers = { ...answers, ...value };
		} catch {
			// analyze reports it as a problem.
		}
	}
	return { runs, answers };
}

const line = (key, value) =>
	`// @${key}${value === undefined ? "" : ` ${typeof value === "string" ? value : JSON.stringify(value)}`}\n`;

/**
 * A source with its directives written for it: what analyze reads from the
 * header's comments, from an object. Positions in the analysis are positions
 * in the string this returns.
 */
export function withDirectives(code, options = {}) {
	let head = "";
	for (const [name, type] of Object.entries(options.types ?? {})) head += line("type", `${name} ${type}`);
	for (const [name, type] of Object.entries(options.handles ?? {})) head += line("handle", `${name} ${type}`);
	if (options.host) head += line("host", options.host);
	if (options.signature) head += line("signature", options.signature);
	if (options.entries) head += line("entries", options.entries);
	if (options.data) head += line("data", options.data);
	if (options.profile) head += line("profile", options.profile);
	if (options.deterministic) head += line("deterministic");
	if (options.answers) head += line("answers", options.answers);
	for (const run of options.runs ?? []) head += line("run", run);
	let tail = "";
	for (const [specifier, source] of Object.entries(options.modules ?? {})) {
		tail += `\n// @module ${specifier}\n${source}`;
	}
	return head + code + tail;
}

/** The loaded module. */
export class PureJs {
	#analyze;

	constructor(exports) {
		this.#analyze = exports.analyze;
	}

	/** The module's own answer: JSON, as text. */
	analyzeJson(source) {
		return this.#analyze(source);
	}

	/** The answer as an Analysis. With options, the source gets their directives first. */
	analyze(source, options) {
		return Analysis.fromJSON(this.#analyze(options ? withDirectives(source, options) : source));
	}
}

const COMPILE_OPTIONS = { builtins: ["js-string"], importedStringConstants: "_" };

async function bytesOf(from) {
	if (from instanceof ArrayBuffer || ArrayBuffer.isView(from)) return from;
	if (typeof Response !== "undefined" && from instanceof Response) return from.arrayBuffer();
	const url = from instanceof URL ? from : new URL(from, import.meta.url);
	if (url.protocol === "file:") {
		const { readFile } = await import("node:fs/promises");
		return readFile(url);
	}
	const response = await fetch(url);
	if (!response.ok) throw new Error(`pure-js: ${url} answered ${response.status}`);
	return response.arrayBuffer();
}

/**
 * Loads the wasm module: from pure-js.wasm beside this file, or from a URL,
 * a Response, bytes, or a compiled WebAssembly.Module.
 */
export async function load(from = new URL("./pure-js.wasm", import.meta.url)) {
	let module = from;
	if (!(from instanceof WebAssembly.Module)) {
		try {
			module = await WebAssembly.compile(await bytesOf(from), COMPILE_OPTIONS);
		} catch (e) {
			if (e instanceof WebAssembly.CompileError) {
				throw new Error(
					`pure-js needs WebAssembly GC and JS string builtins (Chrome 131+, Firefox 134+, Safari 18.4+, Node 24+): ${e.message}`,
					{ cause: e },
				);
			}
			throw e;
		}
	}
	const { exports } = await WebAssembly.instantiate(module, {});
	return new PureJs(exports);
}
