// The standard host's declaration, as the reference's lib/std.js: what
// JavaScript gives every program that pure-js keeps, the parts whose results
// depend on their arguments alone. eval's std_runtime implements it.

///|
let unary : String = "(x: number) => number"

///|
let variadic : String = "(...values: number[]) => number"

///|
pub fn std_declaration() -> Declaration {
  {
    types: [],
    handles: [],
    modules: [
      (
        "Math",
        [
          ("max", [variadic]),
          ("min", [variadic]),
          ("abs", [unary]),
          ("floor", [unary]),
          ("ceil", [unary]),
          ("round", [unary]),
          ("trunc", [unary]),
          ("sign", [unary]),
        ],
      ),
      (
        "Number",
        [
          ("isInteger", ["(value: unknown) => boolean"]),
          ("isFinite", ["(value: unknown) => boolean"]),
          ("isNaN", ["(value: unknown) => boolean"]),
          ("parseInt", ["(text: string, radix: number) => number"]),
          ("parseFloat", ["(text: string) => number"]),
        ],
      ),
      (
        "JSON",
        [
          (
            "stringify",
            [
              "(value: unknown) => string | undefined", "(value: unknown, replacer: null, space: number) => string | undefined",
            ],
          ),
          ("parse", ["(text: string) => unknown"]),
        ],
      ),
      (
        "Object",
        [
          ("keys", ["(record: { [key: string]: unknown }) => string[]"]),
          ("entries", ["<V>(record: { [key: string]: V }) => [string, V][]"]),
          (
            "fromEntries",
            ["<V>(entries: [string, V][]) => { [key: string]: V }"],
          ),
          (
            "hasOwn",
            ["(record: { [key: string]: unknown }, key: string) => boolean"],
          ),
        ],
      ),
      ("Array", [("isArray", ["(value: unknown) => boolean"])]),
    ],
    functions: [
      ("String", ["(value: string | number | boolean) => string"]),
      ("Number", ["(value: string | number | boolean) => number"]),
    ],
    nondeterministic: [],
    fresh: ["Object.keys", "Object.entries", "Object.fromEntries"],
    imports: [],
  }
}

///|
pub fn std_host() -> Host {
  try! Host::new(std_declaration())
}
