// Every fact about the language that is data, as the reference's lib/tables.js
// has them: features (features.mbt, generated), the names nothing may use, the
// operators, and the built-in methods' signatures. Adding support for something
// is adding a row.

///|
/// A feature's status: in the language, planned, or never.
#derive(Eq, Debug)
pub(all) enum Status {
  Core
  Omitted
  ByDesign
}

///|
/// The profiles this version offers: core is pure-js as specified; a profile
/// adds the omitted features that name it, and module those of let,
/// destructuring and forOf too.
pub let profiles : Array[String] = [
  "core", "let", "destructuring", "forOf", "module",
]

///|
/// Property names that would reach the machinery of JavaScript objects.
pub let reserved_names : Array[String] = [
  "constructor", "prototype", "__proto__", "__defineGetter__", "__defineSetter__",
  "__lookupGetter__", "__lookupSetter__", "hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable",
  "toString", "toLocaleString", "valueOf", "caller", "callee", "arguments",
]

///|
/// Names only a host module's member may have.
pub let module_only_names : Array[String] = ["call", "apply", "bind"]

///|
/// The methods that take a callback, as their first argument: the only place an
/// arrow may be, so no arrow becomes a value and nothing but these methods ever
/// calls one.
pub let callback_methods : Array[String] = [
  "map", "filter", "flatMap", "find", "findLast", "findIndex", "findLastIndex", "some",
  "every", "forEach", "reduce", "sort",
]

///|
pub fn is_callback_method(name : String) -> Bool {
  callback_methods.contains(name)
}

///|
pub fn is_reserved(name : String) -> Bool {
  reserved_names.contains(name)
}

///|
pub fn is_module_only(name : String) -> Bool {
  module_only_names.contains(name)
}

///|
/// Keywords: a name that is one is never an identifier.
pub let keywords : Array[String] = [
  "break", "case", "catch", "class", "const", "continue", "debugger", "default",
  "delete", "do", "else", "enum", "export", "extends", "false", "finally", "for",
  "function", "if", "import", "in", "instanceof", "new", "null", "return", "super",
  "switch", "this", "throw", "true", "try", "typeof", "var", "void", "while", "with",
]

///|
pub fn is_keyword(name : String) -> Bool {
  keywords.contains(name)
}

///|
/// The feature of each binary and logical operator.
pub fn operator_feature(op : String) -> Feature? {
  match op {
    "===" | "!==" => Some(StrictEquality)
    "<" | ">" | "<=" | ">=" => Some(Comparison)
    "+" | "-" | "*" | "/" | "%" => Some(Arithmetic)
    "&&" | "||" | "??" => Some(Logical)
    "==" | "!=" => Some(LooseEquality)
    "**" => Some(Exponent)
    "in" => Some(InOperator)
    "instanceof" => Some(Instanceof)
    "&" | "|" | "^" | "<<" | ">>" | ">>>" => Some(Bitwise)
    _ => None
  }
}

///|
pub fn unary_feature(op : String) -> Feature? {
  match op {
    "!" => Some(Not)
    "-" => Some(Negate)
    "typeof" => Some(Typeof)
    "+" => Some(UnaryPlus)
    "~" => Some(Bitwise)
    "void" => Some(Void)
    "delete" => Some(Delete)
    _ => None
  }
}

///|
pub fn assignment_feature(op : String) -> Feature? {
  match op {
    "=" => Some(Assignment)
    "+=" | "-=" => Some(AddAssignment)
    _ => None
  }
}

///|
/// A type keyword's feature: None for the core ones.
pub fn type_keyword_feature(name : String) -> Feature? {
  match name {
    "number"
    | "string"
    | "boolean"
    | "null"
    | "undefined"
    | "unknown"
    | "void" => None
    "any" => Some(AnyType)
    _ => Some(TypeKeyword)
  }
}

///|
/// A built-in method: its signature (TypeScript text, T the list's elements),
/// and what it does to its receiver and returns.
#derive(Debug)
pub(all) struct Method {
  name : String
  sig : String
  mutates : Bool
  fresh : Bool
  self_ : Bool
  primitive : Bool
}

///|
fn m(
  name : String,
  sig : String,
  mutates~ : Bool = false,
  fresh~ : Bool = false,
  self_~ : Bool = false,
  primitive~ : Bool = false,
) -> Method {
  { name, sig, mutates, fresh, self_, primitive, }
}

///|
let cb_bool = "(value: T, index: number) => boolean"

///|
/// The kinds of receivers built-in methods have.
#derive(Eq, Debug)
pub(all) enum Receiver {
  ListReceiver
  StringReceiver
  NumberReceiver
}

///|
pub let list_methods : Array[Method] = [
  m("map", "<U>(f: (value: T, index: number) => U) => U[]", fresh=true),
  m("filter", "(f: \{cb_bool}) => T[]", fresh=true),
  m("flatMap", "<U>(f: (value: T, index: number) => U[]) => U[]", fresh=true),
  m("find", "(f: \{cb_bool}) => T | undefined"),
  m("findLast", "(f: \{cb_bool}) => T | undefined"),
  m("findIndex", "(f: \{cb_bool}) => number"),
  m("findLastIndex", "(f: \{cb_bool}) => number"),
  m("some", "(f: \{cb_bool}) => boolean"),
  m("every", "(f: \{cb_bool}) => boolean"),
  m("forEach", "(f: (value: T, index: number) => unknown) => void"),
  m("reduce", "<U>(f: (acc: U, value: T, index: number) => U, initial: U) => U"),
  m("includes", "(value: T) => boolean"),
  m("indexOf", "(value: T) => number"),
  m("lastIndexOf", "(value: T) => number"),
  m("slice", "(start?: number, end?: number) => T[]", fresh=true),
  m("concat", "(...lists: T[][]) => T[]", fresh=true),
  m("at", "(index: number) => T | undefined"),
  m("join", "(separator: string) => string", primitive=true),
  m("push", "(...items: T[]) => number", mutates=true),
  m("unshift", "(...items: T[]) => number", mutates=true),
  m("pop", "() => T | undefined", mutates=true),
  m("shift", "() => T | undefined", mutates=true),
  m(
    "splice",
    "(start: number, count: number, ...items: T[]) => T[]",
    mutates=true,
    fresh=true,
  ),
  m(
    "sort",
    "(compare: (a: T, b: T) => number) => T[]",
    mutates=true,
    self_=true,
  ),
  m("reverse", "() => T[]", mutates=true, self_=true),
]

///|
pub let string_methods : Array[Method] = [
  m("trim", "() => string"),
  m("trimStart", "() => string"),
  m("trimEnd", "() => string"),
  m("toLowerCase", "() => string"),
  m("toUpperCase", "() => string"),
  m("split", "(separator: string) => string[]", fresh=true),
  m("startsWith", "(search: string) => boolean"),
  m("endsWith", "(search: string) => boolean"),
  m("includes", "(search: string) => boolean"),
  m("indexOf", "(search: string) => number"),
  m("lastIndexOf", "(search: string) => number"),
  m("slice", "(start?: number, end?: number) => string"),
  m("at", "(index: number) => string | undefined"),
  m("replaceAll", "(search: string, replacement: string) => string"),
]

///|
pub let number_methods : Array[Method] = [
  m("toFixed", "(digits: number) => string"),
]

///|
pub fn methods_of(receiver : Receiver) -> Array[Method] {
  match receiver {
    ListReceiver => list_methods
    StringReceiver => string_methods
    NumberReceiver => number_methods
  }
}

///|
pub fn find_method(receiver : Receiver, name : String) -> Method? {
  for meth in methods_of(receiver) {
    if meth.name == name {
      return Some(meth)
    }
  }
  None
}

///|
/// Properties of lists and strings: length, a number.
pub fn has_length(receiver : Receiver) -> Bool {
  receiver is (ListReceiver | StringReceiver)
}
