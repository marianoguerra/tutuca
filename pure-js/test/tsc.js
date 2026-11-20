// tsc as an oracle: type checks programs, each as the value of a const typed by its entry
// signature, against the host's declarations and a lib of exactly pure-js's built-ins (noLib),
// in strict mode with noUncheckedIndexedAccess. TypeScript is a development dependency: the
// library never loads it.

import ts from "typescript";
import { libDeclarations, signatureType } from "../lib/declarations.js";
import { entriesOf, isNamespaceLiteral, parseModule, print, printFunction } from "../lib/index.js";
import { typeOf } from "../lib/parse.js";

const OPTIONS = {
	strict: true,
	noUncheckedIndexedAccess: true,
	noLib: true,
	noEmit: true,
	target: ts.ScriptTarget.ES5, // without iterators, which noLib has none of
	ignoreDeprecations: "6.0",
	types: [],
	allowUnreachableCode: false,
	noImplicitReturns: true,
};

// programs: [{ id, program, signature }] against host: Map(id -> [message, ...]), the
// programs tsc rejects and why.
export const typecheck = (programs, host) => {
	const files = new Map([
		["/lib.d.ts", libDeclarations()],
		["/host.d.ts", host.declarations({ lib: false })],
	]);
	const ids = new Map();
	programs.forEach(({ id, program, signature }, i) => {
		const type = signatureType(host, signature, program.form);
		const text = printFunction(program, { types: true });
		const name = `/program${i}.ts`;
		files.set(name, `{\n\tconst program${type === null ? "" : `: ${type}`} = ${text};\n}\n`);
		ids.set(name, id);
	});
	const compilerHost = {
		getSourceFile: (name, version) =>
			files.has(name) ? ts.createSourceFile(name, files.get(name), version, true) : undefined,
		getDefaultLibFileName: () => "/lib.d.ts",
		writeFile: () => {},
		getCurrentDirectory: () => "/",
		getCanonicalFileName: (f) => f,
		useCaseSensitiveFileNames: () => true,
		getNewLine: () => "\n",
		fileExists: (f) => files.has(f),
		readFile: (f) => files.get(f),
	};
	const program = ts.createProgram([...files.keys()], OPTIONS, compilerHost);
	const out = new Map();
	for (const d of ts.getPreEmitDiagnostics(program)) {
		const file = d.file?.fileName ?? "(global)";
		const id = ids.get(file) ?? file;
		const text = ts.flattenDiagnosticMessageText(d.messageText, "\n");
		const where =
			d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start) : null;
		const line =
			where === null
				? ""
				: ` (line ${where.line + 1}: ${files.get(file).split("\n")[where.line].trim()})`;
		out.set(id, [...(out.get(id) ?? []), `${text}${line}`]);
	}
	return { rejected: out, files };
};

// Modules: each its own TypeScript module, its entries annotated with the signature the
// embedder gives them (a getter entry written as a method, as TypeScript gives a getter no
// this parameter), the host's specifiers declared as ambient modules.
const annotateEntries = (module, signatureOf) => {
	const copy = structuredClone(module);
	const typeText = (e, readonly) => {
		const isEntry = typeof e === "object" && e !== null && "mode" in e;
		const t = isEntry ? e.type : e;
		return readonly && (!isEntry || e.mode === "read") ? `Readonly<${t}>` : t;
	};
	for (const item of copy.items) {
		const d = item.type === "ExportNamedDeclaration" ? item.declaration : item;
		if (d.type !== "VariableDeclaration") continue;
		for (const x of d.declarations)
			if (isNamespaceLiteral(x.init))
				for (const e of entriesOf(x.init, [x.id.name])) {
					const s = signatureOf(e.path);
					if (e.kind === "getter") {
						e.property.kind = "init";
						e.property.method = true;
					}
					if (s === null) continue;
					if (s.this !== undefined && !e.node.thisType)
						e.node.thisType = typeOf(typeText(s.this, true));
					(s.params ?? []).forEach((p, i) => {
						const param = e.node.params[i];
						if (param !== undefined && !param.typeAnnotation)
							param.typeAnnotation = typeOf(typeText(p, false));
					});
					if (s.result !== undefined && !e.node.returnType)
						e.node.returnType = typeOf(typeText(s.result, false));
				}
	}
	return copy;
};

export const typecheckModules = (cases, host) => {
	const ambient = [...host.imports]
		.map(
			([spec, m]) =>
				`declare module ${JSON.stringify(spec)} {\n${[...host.modules.get(m).keys()].map((n) => `\texport const ${n}: typeof ${m}.${n};`).join("\n")}\n}`,
		)
		.join("\n");
	const files = new Map([
		["/lib.d.ts", libDeclarations()],
		["/host.d.ts", `${host.declarations({ lib: false })}${ambient}\n`],
	]);
	const ids = new Map();
	cases.forEach(({ id, module, files: siblings, signatureOf }, i) => {
		const main = `/m${i}/main.ts`;
		files.set(
			main,
			`${print(annotateEntries(module, signatureOf), { types: true })}\nexport {};\n`,
		);
		ids.set(main, id);
		for (const [spec, text] of Object.entries(siblings)) {
			const name = `/m${i}/${spec.slice(2)}.ts`;
			files.set(name, `${print(parseModule(text).module, { types: true })}\nexport {};\n`);
			ids.set(name, id);
		}
	});
	const compilerHost = {
		getSourceFile: (name, version) =>
			files.has(name) ? ts.createSourceFile(name, files.get(name), version, true) : undefined,
		getDefaultLibFileName: () => "/lib.d.ts",
		writeFile: () => {},
		getCurrentDirectory: () => "/",
		getCanonicalFileName: (f) => f,
		useCaseSensitiveFileNames: () => true,
		getNewLine: () => "\n",
		fileExists: (f) => files.has(f),
		readFile: (f) => files.get(f),
	};
	const options = {
		...OPTIONS,
		module: ts.ModuleKind.ESNext,
		moduleResolution: ts.ModuleResolutionKind.Bundler,
		allowImportingTsExtensions: true,
	};
	const program = ts.createProgram([...files.keys()], options, compilerHost);
	const out = new Map();
	for (const d of ts.getPreEmitDiagnostics(program)) {
		const file = d.file?.fileName ?? "(global)";
		const id = ids.get(file) ?? file;
		const text = ts.flattenDiagnosticMessageText(d.messageText, "\n");
		const where =
			d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start) : null;
		const line =
			where === null
				? ""
				: ` (${file} line ${where.line + 1}: ${files.get(file).split("\n")[where.line].trim()})`;
		out.set(id, [...(out.get(id) ?? []), `${text}${line}`]);
	}
	return { rejected: out, files };
};
