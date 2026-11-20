// pure-js: a subset of JavaScript (and of TypeScript, with annotations TypeScript can erase)
// that can be checked to do nothing but what its host allows, deterministically, and to end.
//
//   const { ok, fn, diagnostics } = compile(source, { host, signature });
//   const { ok, namespaces } = compileModule(moduleSource, { host, signatureOf, resolve });
//
// The stages, each its own call: parse (source to tree), sieve (only the forms the profile
// admits), check (names, types, mutation, against a host and an entry signature), then compile
// (a JavaScript function) or run (the interpreter). See spec/ for the language.

export { boundNames, CHILDREN, erase, eraseModule, walk } from "./ast.js";
export { check } from "./check.js";
export { audit, compile, compileModule, lower, verify } from "./compile.js";
export { Diagnostic, EXIT, exitCodeOf, lineColumn } from "./diagnostic.js";
export { formatDiagnostic, formatDiagnostics } from "./formatters.js";
export { draft, Host, read } from "./host.js";
export { instantiate, run, runCompiled, runEntry } from "./interp.js";
export { checkModule, entriesOf, isNamespaceLiteral, verifyModule } from "./module.js";
export { parse, parseModule, parseType } from "./parse.js";
export { print, printFunction, printNode } from "./print.js";
export { PureLimit, PureUndefined, runtime } from "./runtime.js";
export { profileFeatures, sieve } from "./sieve.js";
export { stdDeclaration, stdHost, stdImplementations } from "./std.js";
export { CALLBACK_METHODS, FEATURES, METHODS, PROFILES, RESERVED_NAMES } from "./tables.js";
export { typeToString } from "./types.js";
