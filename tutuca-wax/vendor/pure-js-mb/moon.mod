// The LIBRARY: pure-js's lexer, parser, sieve, checker, printer and
// interpreter, a port of the JavaScript reference (pure-js/lib) held to its
// conformance goldens.
//
// Layering, as the reference's stages:
//
//   tables < diag < ast < lexer < parser          types < host
//                       sieve (ast, tables)        check (ast, types, host)
//                       write (ast)                value < eval (ast, host)
//                       `.` (facade)
name = "marianoguerra/pure-js"

version = "0.2.0"

readme = "README.mbt.md"

license = "MIT"

keywords = [
  "javascript",
  "typescript",
  "parser",
  "checker",
  "interpreter",
  "sandbox",
]

preferred_target = "native"

description = "pure-js: a statically checked, deterministic subset of JavaScript and TypeScript"
