// TypeScript declarations of a host and of a program's entry signature: what tsc checks a
// program against (the oracle that every program pure-js accepts TypeScript accepts too, as
// PurePy's programs are mypy's) and what an editor shows. Each host record has two
// declarations, Name and Name$R, mutable and deeply read-only, as the signature says
// which one a parameter is; with lib, a lib of exactly the built-ins pure-js has, for tsc's
// noLib, so nothing JavaScript has and pure-js leaves out type checks.

import { typeOf } from "./parse.js";
import { METHODS } from "./tables.js";

const RO = "$R";

class Writer {
	constructor(host) {
		this.host = host;
	}
	// A type node as TypeScript; readonly: the read-only variant.
	type(n, readonly, tvars = new Set()) {
		const t = (x) => this.type(x, readonly, tvars);
		switch (n.type) {
			case "TypeKeyword":
				return n.name;
			case "TypeLiteral":
				return typeof n.value === "string" ? JSON.stringify(n.value) : String(n.value);
			case "TypeArray": {
				const inner = t(n.element);
				const wrapped =
					n.element.type === "TypeUnion" ||
					n.element.type === "TypeFunction" ||
					inner.startsWith("readonly ")
						? `(${inner})`
						: inner;
				return readonly ? `readonly ${wrapped}[]` : `${wrapped}[]`;
			}
			case "TypeTuple":
				return `${readonly ? "readonly " : ""}[${n.elements.map(t).join(", ")}]`;
			case "TypeUnion":
				return n.types.map((x) => (x.type === "TypeFunction" ? `(${t(x)})` : t(x))).join(" | ");
			case "TypeReadonly":
				return this.type(n.operand, true, tvars);
			case "TypeRef": {
				if (tvars.has(n.name)) return n.name;
				const named = this.host?.named.get(n.name);
				return named?.kind === "record" && readonly ? `${n.name}${RO}` : n.name;
			}
			case "TypeObject":
				if (n.members.length === 0) return "{}";
				return `{ ${n.members.map((m) => this.member(m, readonly, tvars)).join("; ")} }`;
			case "TypeFunction":
				return this.signature(n, tvars, " =>");
		}
		throw new Error(`no TypeScript for ${n.type}`);
	}
	member(m, readonly, tvars) {
		switch (m.type) {
			case "TypeProperty":
				return `${readonly || m.readonly ? "readonly " : ""}${m.name}${m.optional ? "?" : ""}: ${this.type(m.value, readonly, tvars)}`;
			case "TypeIndex":
				return `${readonly ? "readonly " : ""}[${m.keyName}: string]: ${this.type(m.value, readonly, tvars)}`;
			case "TypeMethod":
				return `${m.name}${this.signature(m, tvars, ":")}`;
		}
		throw new Error(`no TypeScript for ${m.type}`);
	}
	// Parameters take read-only values (pure-js passes either kind), results are read-only.
	signature(n, tvars, arrow, fresh = false) {
		const vars = new Set([...tvars, ...n.typeParams]);
		const tp = n.typeParams.length > 0 ? `<${n.typeParams.join(", ")}>` : "";
		const params = n.params.map(
			(p) =>
				`${p.rest ? "..." : ""}${p.name}${p.optional ? "?" : ""}: ${this.type(p.value, true, vars)}`,
		);
		return `${tp}(${params.join(", ")})${arrow} ${this.type(n.result, !fresh, vars)}`;
	}
}

// A lib of the built-in methods (tables.js), for noLib.
export const libDeclarations = () => {
	const w = new Writer(null);
	const T = new Set(["T"]);
	const methods = (kind, keep) =>
		Object.entries(METHODS[kind])
			.filter(([, row]) => keep(row))
			.map(([name, row]) => {
				if (row.self)
					return `\t${name}${w.signature(typeOf(row.sig), T, ":", true).replace(/\): T\[\]$/, "): this")};`;
				return `\t${name}${w.signature(typeOf(row.sig), T, ":", row.fresh)};`;
			})
			.join("\n");
	return [
		"interface Array<T> {",
		"\tlength: number;",
		"\t[n: number]: T;",
		methods("list", () => true),
		"}",
		"interface ReadonlyArray<T> {",
		"\treadonly length: number;",
		"\treadonly [n: number]: T;",
		methods("list", (row) => !row.mutates),
		"}",
		"interface String {",
		"\treadonly length: number;",
		methods("string", () => true),
		"}",
		"interface Number {",
		methods("number", () => true),
		"}",
		"type Readonly<T> = { readonly [P in keyof T]: T[P] };",
		"interface Boolean {}",
		"interface Object {}",
		"interface Function {}",
		"interface CallableFunction extends Function {}",
		"interface NewableFunction extends Function {}",
		"interface IArguments {}",
		"interface RegExp {}",
		"interface TemplateStringsArray extends ReadonlyArray<string> {",
		"\treadonly raw: readonly string[];",
		"}",
		"",
	].join("\n");
};

// The host's types, handles, modules and functions.
export const hostDeclarations = (host) => {
	const w = new Writer(host);
	const out = [];
	for (const [name, entry] of host.named) {
		if (entry.kind === "record") {
			out.push(`type ${name} = ${w.type(entry.node, false)};`);
			out.push(`type ${name}${RO} = ${w.type(entry.node, true)};`);
		} else {
			out.push(`interface ${name} ${w.type(entry.node, true)}`);
		}
	}
	const sigText = (nodes, name, fresh) =>
		nodes.map((n) =>
			n.type === "TypeFunction"
				? `${name}${w.signature(n, new Set(), ":", fresh)}`
				: `readonly ${name}: ${w.type(n, true)}`,
		);
	for (const name of host.names()) {
		const ms = host.modules.get(name);
		const f = host.functions.get(name);
		if (ms === undefined) {
			for (const s of sigText(f.nodes, "", host.fresh.has(name)))
				out.push(`declare function ${name}${s};`);
			continue;
		}
		const members = [];
		if (f !== undefined) members.push(...sigText(f.nodes, "", host.fresh.has(name)));
		for (const [m, entry] of ms)
			members.push(...sigText(entry.nodes, m, host.fresh.has(entry.qualified)));
		out.push(`declare const ${name}: {\n${members.map((m) => `\t${m};`).join("\n")}\n};`);
	}
	return `${out.join("\n")}\n`;
};

// A program's entry signature as the type of a const it is assigned to.
export const signatureType = (host, signature, form) => {
	const w = new Writer(host);
	// read(T) is T's read-only variant, draft(T) and a plain T the mutable one: pure-js reads
	// a plain entry as read-only too, which is stricter, so tsc can only agree.
	const entry = (e) => {
		const isEntry = typeof e === "object" && e !== null && "mode" in e;
		const src = isEntry ? e.type : e;
		const node = typeof src === "string" ? typeOf(src) : src;
		return w.type(node, isEntry && e.mode === "read");
	};
	if (signature === null) return null;
	const params = (signature.params ?? []).map((p, i) => `p${i}: ${entry(p)}`);
	if (signature.this !== undefined && signature.this !== null && form !== "arrow")
		params.unshift(`this: ${entry(signature.this)}`);
	const result =
		signature.result === undefined || signature.result === null
			? "unknown"
			: entry(signature.result);
	return `(${params.join(", ")}) => ${result}`;
};
