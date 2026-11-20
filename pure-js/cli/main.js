#!/usr/bin/env node
// The pure-js command: each stage on a file, its exit status the outcome's (EXIT in
// lib/diagnostic.js): 0 accepted, 1 excluded by design, 2 omitted from this version, 3
// ill-formed, 4 not JavaScript, 5 undefined behaviour in a run, 6 a run that ended in an error.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
	compile,
	compileModule,
	draft,
	EXIT,
	exitCodeOf,
	formatDiagnostics,
	Host,
	instantiate,
	parse,
	parseModule,
	print,
	read,
	run,
	runCompiled,
	runEntry,
	sieve,
	stdHost,
	verify,
	verifyModule,
} from "../lib/index.js";

const USAGE = `usage: pure-js <command> <file> [options]

commands:
  parse      print the tree as JSON
  sieve      check the program uses only the forms its profile admits
  check      parse, sieve and check it against a host and a signature
  print      print it again (JavaScript; with --types, TypeScript)
  compile    print the JavaScript it compiles to
  run        check it and run it, printing how the run ended as JSON

options:
  --host <file>        a host: a .json declaration, added to the standard host, or a module
                       whose default export is a Host
  --signature <json>   the entry signature, or a file with it:
                       {"this": "read Todo", "params": ["draft Todo", "[string]"], "result": "void"}
  --profile <name>     the profile: core, let, destructuring, forOf (default core)
  --types              print: keep the type annotations
  --deterministic      check: reject calls to members the host marks nondeterministic
  --this <json>        run: this
  --args <json>        run: the arguments, a JSON array
  --compiled           run: the compiled function instead of the interpreter
  --max-steps <n>      run: the interpreter's step limit
  --json               diagnostics as JSON
  --module             the file is a module (the module profile): check, print, compile and
                       run take its entries' signatures from --entries, run the one --entry names
  --entries <json>     the entries' signatures by path, a key ending in * matching what's under it:
                       {"Counter.on.*": {"this": "read State", "params": ["draft State", "[number]"]}}
  --entry <path>       run: the entry to run, Counter.on.add.run
`;

const fail = (message, code = EXIT.syntax) => {
	process.stderr.write(`pure-js: ${message}\n`);
	process.exit(code);
};

const parseArgs = (argv) => {
	const out = { _: [] };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (!a.startsWith("--")) {
			out._.push(a);
			continue;
		}
		const name = a.slice(2);
		if (["types", "deterministic", "compiled", "json", "help", "module"].includes(name))
			out[name] = true;
		else {
			if (i + 1 >= argv.length) fail(`--${name} needs a value`);
			out[name] = argv[++i];
		}
	}
	return out;
};

const jsonOrFile = (text) => {
	const t = text.trim();
	return JSON.parse(t.startsWith("{") || t.startsWith("[") ? t : readFileSync(t, "utf8"));
};
const entry = (s) => {
	if (typeof s !== "string") return s;
	const m = /^(read|draft)\s+(.+)$/.exec(s);
	return m === null ? s : m[1] === "read" ? read(m[2]) : draft(m[2]);
};
const signatureOf = (opts) => {
	if (opts.signature === undefined) return null;
	const s = jsonOrFile(opts.signature);
	return {
		this: s.this === undefined ? undefined : entry(s.this),
		params: (s.params ?? []).map(entry),
		result: s.result === undefined ? undefined : entry(s.result),
	};
};
const signatureFrom = (s) => ({
	this: s.this === undefined ? undefined : entry(s.this),
	params: s.params === undefined ? undefined : s.params.map(entry),
	result: s.result === undefined ? undefined : entry(s.result),
});
// An entry's signature: the most specific key of --entries matching its path.
const entriesOf = (opts) => {
	const table = opts.entries === undefined ? {} : jsonOrFile(opts.entries);
	return (path) => {
		const p = path.join(".");
		let best = null;
		for (const key of Object.keys(table)) {
			const hit = key.endsWith("*") ? p.startsWith(key.slice(0, -1)) : p === key;
			if (hit && (best === null || key.length > best.length)) best = key;
		}
		return best === null ? null : signatureFrom(table[best]);
	};
};
const resolveFrom = (file) => (spec) => {
	for (const ext of ["", ".ts", ".js"]) {
		try {
			return readFileSync(resolve(file, "..", `${spec}${ext}`), "utf8");
		} catch {}
	}
	return null;
};
// The commands on a module.
const moduleCommand = async (command, source, file, opts) => {
	const host = await hostOf(opts);
	const options = {
		host,
		resolve: resolveFrom(file),
		signatureOf: entriesOf(opts),
		deterministic: opts.deterministic,
	};
	switch (command) {
		case "parse":
		case "print": {
			const { module, diagnostics } = parseModule(source);
			report(diagnostics, source, file, opts);
			if (module !== null)
				process.stdout.write(
					command === "print"
						? `${print(module, { types: opts.types })}\n`
						: `${JSON.stringify(module, (k, v) => (k === "source" ? undefined : v), 2)}\n`,
				);
			return exitCodeOf(diagnostics);
		}
		case "sieve": {
			const { module, diagnostics } = parseModule(source);
			const all = module === null ? diagnostics : sieve(module, { profile: "module" }).diagnostics;
			report(all, source, file, opts);
			return exitCodeOf(all);
		}
		case "check": {
			const v = verifyModule(source, options);
			report(v.diagnostics, source, file, opts);
			if (v.diagnostics.length === 0)
				for (const e of v.entries)
					process.stdout.write(`${e.path.join(".")}: returns ${e.returnType}\n`);
			return exitCodeOf(v.diagnostics);
		}
		case "compile": {
			const c = compileModule(source, options);
			report(c.diagnostics, source, file, opts);
			if (c.ok) process.stdout.write(`${c.code}\n`);
			return exitCodeOf(c.diagnostics);
		}
		case "run": {
			if (opts.entry === undefined)
				fail("run --module needs --entry, the path of the entry to run");
			const v = verifyModule(source, options);
			report(v.diagnostics, source, file, opts);
			if (v.diagnostics.length > 0) return exitCodeOf(v.diagnostics);
			const thisValue = opts.this === undefined ? undefined : jsonOrFile(opts.this);
			const args = opts.args === undefined ? [] : jsonOrFile(opts.args);
			const maxSteps = opts["max-steps"] === undefined ? undefined : Number(opts["max-steps"]);
			const inst = instantiate(v.module, { host, resolve: options.resolve, maxSteps });
			const outcome = inst.ok
				? runEntry(inst, opts.entry.split("."), { this: thisValue, args })
				: inst.outcome;
			process.stdout.write(`${JSON.stringify({ ...outcome, error: undefined, args }, null, 2)}\n`);
			return outcome.kind === "finished"
				? EXIT.ok
				: outcome.kind === "undefined"
					? EXIT.undefined
					: EXIT.terminated;
		}
	}
	fail(`there is no command ${command}\n\n${USAGE}`);
};
const hostOf = async (opts) => {
	if (opts.host === undefined) return stdHost;
	const path = resolve(opts.host);
	if (path.endsWith(".json")) return stdHost.extend(JSON.parse(readFileSync(path, "utf8")));
	const mod = await import(pathToFileURL(path).href);
	if (!(mod.default instanceof Host)) fail(`${opts.host} must export a Host as its default`);
	return mod.default;
};

const report = (diagnostics, source, file, opts) => {
	if (diagnostics.length === 0) return;
	if (opts.json) process.stdout.write(`${JSON.stringify(diagnostics, null, 2)}\n`);
	else process.stderr.write(`${formatDiagnostics(diagnostics, source, file)}\n`);
};

const main = async () => {
	const opts = parseArgs(process.argv.slice(2));
	const [command, file] = opts._;
	if (opts.help || command === undefined) {
		process.stdout.write(USAGE);
		process.exit(command === undefined && !opts.help ? EXIT.syntax : EXIT.ok);
	}
	if (file === undefined) fail(`${command} needs a file\n\n${USAGE}`);
	const source = readFileSync(file, "utf8");
	if (opts.module) process.exit(await moduleCommand(command, source, file, opts));
	const profile = opts.profile ?? "core";
	switch (command) {
		case "parse": {
			const { program, diagnostics } = parse(source);
			report(diagnostics, source, file, opts);
			if (program !== null)
				process.stdout.write(
					`${JSON.stringify(program, (k, v) => (k === "source" ? undefined : v), 2)}\n`,
				);
			process.exit(exitCodeOf(diagnostics));
			break;
		}
		case "sieve": {
			const parsed = parse(source);
			const diagnostics =
				parsed.program === null
					? parsed.diagnostics
					: sieve(parsed.program, { profile }).diagnostics;
			report(diagnostics, source, file, opts);
			process.exit(exitCodeOf(diagnostics));
			break;
		}
		case "check": {
			const host = await hostOf(opts);
			const v = verify(source, {
				host,
				signature: signatureOf(opts),
				profile,
				deterministic: opts.deterministic,
			});
			report(v.diagnostics, source, file, opts);
			if (v.diagnostics.length === 0) process.stdout.write(`ok: returns ${v.returnType}\n`);
			process.exit(exitCodeOf(v.diagnostics));
			break;
		}
		case "print": {
			const parsed = parse(source);
			report(parsed.diagnostics, source, file, opts);
			if (parsed.program !== null)
				process.stdout.write(`${print(parsed.program, { types: opts.types })}\n`);
			process.exit(exitCodeOf(parsed.diagnostics));
			break;
		}
		case "compile": {
			const host = await hostOf(opts);
			const c = compile(source, {
				host,
				signature: signatureOf(opts),
				profile,
				deterministic: opts.deterministic,
			});
			report(c.diagnostics, source, file, opts);
			if (c.ok) process.stdout.write(`${c.code}\n`);
			process.exit(exitCodeOf(c.diagnostics));
			break;
		}
		case "run": {
			const host = await hostOf(opts);
			const signature = signatureOf(opts);
			const thisValue = opts.this === undefined ? undefined : jsonOrFile(opts.this);
			const args = opts.args === undefined ? [] : jsonOrFile(opts.args);
			let outcome;
			if (opts.compiled) {
				const c = compile(source, { host, signature, profile });
				report(c.diagnostics, source, file, opts);
				if (!c.ok) process.exit(exitCodeOf(c.diagnostics));
				outcome = runCompiled(c.fn, { this: thisValue, args });
			} else {
				const v = verify(source, { host, signature, profile });
				report(v.diagnostics, source, file, opts);
				if (v.diagnostics.length > 0) process.exit(exitCodeOf(v.diagnostics));
				const maxSteps = opts["max-steps"] === undefined ? undefined : Number(opts["max-steps"]);
				outcome = run(v.program, { host, this: thisValue, args, maxSteps });
			}
			const shown = { ...outcome, error: undefined, args };
			process.stdout.write(`${JSON.stringify(shown, null, 2)}\n`);
			process.exit(
				outcome.kind === "finished"
					? EXIT.ok
					: outcome.kind === "undefined"
						? EXIT.undefined
						: EXIT.terminated,
			);
			break;
		}
		default:
			fail(`there is no command ${command}\n\n${USAGE}`);
	}
};

await main();
