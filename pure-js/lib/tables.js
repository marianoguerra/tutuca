// Every fact about the language that is data: its features and their status, the names nothing
// may use, the operators, and the signatures of the built-in methods. The stages read these
// tables; adding support for something is adding or changing a row.

const core = (what) => ({ status: "core", what });
const omitted = (what, profile = null) => ({ status: "omitted", what, profile });
const byDesign = (what, why) => ({ status: "by-design", what, why });

// Syntax features by name. A form is in the language when its feature's status is core (or
// it is omitted and the active profile admits it). Omitted forms name the profile that will
// admit them, null when none is planned yet; by-design forms say why pure-js leaves them out.
export const FEATURES = Object.freeze({
	// Programs: one function.
	"function-program": core("a function expression"),
	"method-program": core("a method, as String(fn) prints one"),
	"getter-program": core("a getter, as String(fn) prints one"),
	"arrow-program": core("an arrow function"),
	// Modules: a program of declarations (the module profile).
	"module-program": omitted("modules: types, data, helper functions and namespaces", "module"),
	"import-declaration": omitted("import declarations", "module"),
	"export-declaration": omitted("export declarations", "module"),
	"helper-function": omitted("functions declared in a module, which code may call", "module"),
	"type-alias": omitted("type aliases", "module"),
	"interface-declaration": omitted("interfaces", "module"),
	"namespace-method": omitted(
		"methods and getters in a module's namespaces, which the embedder calls",
		"module",
	),
	"this-parameter": omitted("a this parameter, saying what this is", "module"),
	"module-statement": byDesign(
		"statements in a module outside a function",
		"a module only declares: running it does nothing but make its constants",
	),
	"module-let": byDesign("let in a module", "what a module declares is constant"),
	"default-export": byDesign("export default and export lists", "an export is a declaration"),
	"namespace-import": byDesign("import * and side-effect imports", "an import names what it takes"),
	"recursive-call": byDesign(
		"functions that call themselves, directly or through others",
		"a program must terminate: the calls between a module's functions can't form a cycle",
	),
	// Statements.
	"const-declaration": core("const declarations"),
	"expression-statement": core("expression statements"),
	"if-statement": core("if and else"),
	"block-statement": core("blocks"),
	"return-statement": core("return"),
	"let-declaration": omitted("let declarations", "let"),
	"let-assignment": omitted("assigning to a let", "let"),
	"multiple-declarators": omitted("several declarations in one const", "destructuring"),
	"destructuring-declaration": omitted("destructuring in const", "destructuring"),
	"for-of-statement": omitted("for-of loops", "forOf"),
	"loop-control": omitted("break and continue", "forOf"),
	"try-statement": omitted("try and catch", "tryCatch"),
	"switch-statement": omitted("switch"),
	"var-declaration": byDesign("var declarations", "var is function-scoped and hoisted"),
	"loop-statement": byDesign(
		"while, do-while and C-style for loops",
		"a program must terminate: it can only iterate through the methods of lists",
	),
	"for-in-statement": byDesign("for-in loops", "it walks inherited properties"),
	"throw-statement": byDesign("throw", "errors are not values in pure-js; only hosts abort a run"),
	"labeled-statement": byDesign("labels", "there are no loops to break out of"),
	"empty-statement": byDesign("empty statements", "a lone semicolon does nothing"),
	"function-declaration": byDesign(
		"nested functions",
		"a program is one function; a callback is an arrow passed to a call",
	),
	"class-declaration": byDesign("classes", "values are plain data"),
	"with-statement": byDesign("with", "it changes what names mean at run time"),
	"debugger-statement": byDesign("debugger", "it reaches outside the program"),
	"module-syntax": byDesign("import and export", "a program can only use what its host provides"),
	"useless-expression": byDesign(
		"expression statements that are not a call or an assignment",
		"they compute a value and drop it",
	),
	"line-break-after-return": byDesign(
		"a line break between return and its value",
		"JavaScript would return undefined there",
	),
	"missing-semicolon": byDesign(
		"statements without a semicolon",
		"semicolons are required, so no statement depends on where lines break",
	),
	// Expressions.
	identifier: core("names"),
	"string-literal": core("strings"),
	"number-literal": core("numbers"),
	"boolean-literal": core("true and false"),
	"null-literal": core("null"),
	"template-literal": core("template literals"),
	member: core("property access"),
	"computed-member": core("indexing"),
	"optional-member": core("optional chaining"),
	call: core("calls"),
	this: core("this"),
	"array-literal": core("array literals"),
	"object-literal": core("object literals"),
	spread: core("spread"),
	conditional: core("the conditional operator"),
	logical: core("&&, || and ??"),
	not: core("!"),
	negate: core("unary minus"),
	typeof: core("typeof"),
	"strict-equality": core("=== and !=="),
	comparison: core("<, >, <= and >="),
	arithmetic: core("+, -, *, / and %"),
	assignment: core("assignment"),
	"add-assignment": core("+= and -="),
	"callback-arrow": core(
		"arrow functions as the callback of a list method (map, filter, sort, ...)",
	),
	"array-pattern-param": core("array patterns of names as parameters"),
	"type-annotation": core("type annotations"),
	"compound-assignment": omitted("compound assignments other than += and -="),
	"computed-compound-assignment": omitted("+= and -= on an indexed place"),
	update: omitted("++ and --"),
	bitwise: omitted("bitwise operators"),
	"optional-call": omitted("optional calls, f?.()"),
	"optional-computed-member": omitted("indexing in an optional chain, x?.[k] or x?.y[k]"),
	"computed-key": omitted("computed keys in object literals"),
	"numeric-key": omitted("numeric keys in object literals"),
	"block-arrow": omitted("arrow functions with a block body", "module"),
	"object-pattern": omitted("object patterns", "destructuring"),
	"default-value": omitted("default values", "destructuring"),
	"rest-element": omitted("rest elements", "destructuring"),
	"nested-pattern": omitted("nested patterns", "destructuring"),
	"destructuring-assignment": omitted("destructuring assignment"),
	"loose-equality": byDesign("== and !=", "they convert their operands"),
	exponent: byDesign("**", "its result is implementation-approximated"),
	"in-operator": byDesign("in", "it sees inherited properties"),
	instanceof: byDesign("instanceof", "values have no classes"),
	"unary-plus": byDesign("unary +", "it converts its operand"),
	void: byDesign("void", "it computes a value and drops it"),
	delete: byDesign("delete", "a field is set, not removed"),
	sequence: byDesign("the comma operator", "it drops values"),
	"assignment-expression": byDesign(
		"assignments used as expressions",
		"an assignment is a statement",
	),
	reassignment: byDesign("assigning to a name", "a name is bound once"),
	"arrow-not-callback": byDesign(
		"arrow functions other than as the callback of a list method",
		"functions are not values, so nothing can recurse or be called after the program ends",
	),
	"function-expression": byDesign(
		"nested function expressions",
		"a callback is an arrow passed to a call",
	),
	"array-hole": byDesign("holes in array literals", "arrays are dense"),
	"object-method": byDesign("methods, getters and setters in object literals", "records are data"),
	new: byDesign("new", "values are plain data, made by literals and host functions"),
	class: byDesign("classes", "values are plain data"),
	"tagged-template": byDesign("tagged templates", "a tag is a function value"),
	regex: byDesign("regular expressions", "matching is left to hosts"),
	bigint: byDesign("BigInt literals", "numbers are doubles"),
	"legacy-octal": byDesign("legacy octal literals and escapes", "strict mode has none"),
	async: byDesign("async functions and await", "a run is one synchronous call"),
	generator: byDesign("generators and yield", "a run is one synchronous call"),
	super: byDesign("super", "values have no classes"),
	"private-name": byDesign("private names", "values have no classes"),
	decorator: byDesign("decorators", "they are function values"),
	"dynamic-import": byDesign("import()", "a program can only use what its host provides"),
	"meta-property": byDesign("new.target and import.meta", "they reach outside the program"),
	"identifier-escape": byDesign(
		"escapes and non-ASCII letters in names",
		"a name is spelled one way",
	),
	"dollar-name": byDesign("names that start with $", "they are the compiler's"),
	"reserved-name": byDesign(
		"properties that reach the machinery of JavaScript objects",
		"no value has them in pure-js",
	),
	// Types (TypeScript annotations).
	"any-type": byDesign("any", "it turns checking off"),
	"type-assertion": byDesign("type assertions (as, satisfies, !)", "they turn checking off"),
	"function-type": omitted("function types in annotations"),
	"generic-type": omitted("generic types such as Array<T>; write T[]"),
	"readonly-type": omitted(
		"readonly and Readonly<T> in annotations; mutability comes from the signature",
		"module",
	),
	"method-type": omitted(
		"method signatures in annotations; a module's interfaces have them",
		"module",
	),
	"type-keyword": omitted("this type keyword"),
	"arrow-return-type": omitted("return types on callbacks; the call says what they return"),
	"optional-parameter": omitted("optional parameters"),
});

// The profiles this version offers: core is pure-js as specified. A profile adds the omitted
// features that name it, and module adds those of let, destructuring and forOf too: a module's
// functions are longer than a handler, and keep terminating (for-of walks a snapshot, the calls
// between functions form no cycle). tryCatch is named by try but not offered yet.
const featuresOf = (profile) =>
	Object.entries(FEATURES)
		.filter(([, f]) => f.status === "omitted" && f.profile === profile)
		.map(([name]) => name);
const LET = featuresOf("let");
const DESTRUCTURING = featuresOf("destructuring");
const FOR_OF = featuresOf("forOf");
export const PROFILES = Object.freeze({
	core: Object.freeze([]),
	let: Object.freeze(LET),
	destructuring: Object.freeze(DESTRUCTURING),
	forOf: Object.freeze(FOR_OF),
	module: Object.freeze([...featuresOf("module"), ...LET, ...DESTRUCTURING, ...FOR_OF]),
});

// Property names that would reach the machinery of JavaScript objects: no record, list, handle
// or module may have them, whatever its type says. call, apply and bind are also names of
// host members (tutuca.apply), so the checker decides them: only a module member may have them.
export const RESERVED_NAMES = Object.freeze([
	"constructor",
	"prototype",
	"__proto__",
	"__defineGetter__",
	"__defineSetter__",
	"__lookupGetter__",
	"__lookupSetter__",
	"hasOwnProperty",
	"isPrototypeOf",
	"propertyIsEnumerable",
	"toString",
	"toLocaleString",
	"valueOf",
	"caller",
	"callee",
	"arguments",
]);
export const MODULE_ONLY_NAMES = Object.freeze(["call", "apply", "bind"]);

// The methods that take a callback, as their first argument: the only place an arrow may be.
// The sieve holds to it without types, so no arrow becomes a value (an element, a field, a host
// function's argument) and nothing but these methods ever calls one. METHODS says the same
// (a unit test keeps the two together).
export const CALLBACK_METHODS = Object.freeze([
	"map",
	"filter",
	"flatMap",
	"find",
	"findLast",
	"findIndex",
	"findLastIndex",
	"some",
	"every",
	"forEach",
	"reduce",
	"sort",
]);

// Keywords: a name that is one is never an identifier.
export const KEYWORDS = Object.freeze([
	"break",
	"case",
	"catch",
	"class",
	"const",
	"continue",
	"debugger",
	"default",
	"delete",
	"do",
	"else",
	"enum",
	"export",
	"extends",
	"false",
	"finally",
	"for",
	"function",
	"if",
	"import",
	"in",
	"instanceof",
	"new",
	"null",
	"return",
	"super",
	"switch",
	"this",
	"throw",
	"true",
	"try",
	"typeof",
	"var",
	"void",
	"while",
	"with",
]);

// The feature of each binary and logical operator.
export const OPERATORS = Object.freeze({
	"===": "strict-equality",
	"!==": "strict-equality",
	"<": "comparison",
	">": "comparison",
	"<=": "comparison",
	">=": "comparison",
	"+": "arithmetic",
	"-": "arithmetic",
	"*": "arithmetic",
	"/": "arithmetic",
	"%": "arithmetic",
	"&&": "logical",
	"||": "logical",
	"??": "logical",
	"==": "loose-equality",
	"!=": "loose-equality",
	"**": "exponent",
	in: "in-operator",
	instanceof: "instanceof",
	"&": "bitwise",
	"|": "bitwise",
	"^": "bitwise",
	"<<": "bitwise",
	">>": "bitwise",
	">>>": "bitwise",
});
export const UNARY_OPERATORS = Object.freeze({
	"!": "not",
	"-": "negate",
	typeof: "typeof",
	"+": "unary-plus",
	"~": "bitwise",
	void: "void",
	delete: "delete",
});
export const ASSIGNMENT_OPERATORS = Object.freeze({
	"=": "assignment",
	"+=": "add-assignment",
	"-=": "add-assignment",
});

// Type keywords and their feature: core ones are types of the language.
export const TYPE_KEYWORDS = Object.freeze({
	number: "core",
	string: "core",
	boolean: "core",
	null: "core",
	undefined: "core",
	unknown: "core",
	void: "core",
	any: "any-type",
	never: "type-keyword",
	object: "type-keyword",
	symbol: "type-keyword",
	bigint: "type-keyword",
});

// The built-in methods, by the kind of their receiver, as TypeScript signatures in which T is
// the type of a list's elements. mutates: it changes its receiver, which must be mutable.
// fresh: it returns a new list, which the program may change. self: it returns its receiver.
// primitive: the list's elements must be strings, numbers or booleans (it converts them).
const cb = (result) => `(value: T, index: number) => ${result}`;
export const METHODS = Object.freeze({
	list: Object.freeze({
		map: { sig: `<U>(f: ${cb("U")}) => U[]`, fresh: true },
		filter: { sig: `(f: ${cb("boolean")}) => T[]`, fresh: true },
		flatMap: { sig: `<U>(f: ${cb("U[]")}) => U[]`, fresh: true },
		find: { sig: `(f: ${cb("boolean")}) => T | undefined` },
		findLast: { sig: `(f: ${cb("boolean")}) => T | undefined` },
		findIndex: { sig: `(f: ${cb("boolean")}) => number` },
		findLastIndex: { sig: `(f: ${cb("boolean")}) => number` },
		some: { sig: `(f: ${cb("boolean")}) => boolean` },
		every: { sig: `(f: ${cb("boolean")}) => boolean` },
		forEach: { sig: `(f: ${cb("unknown")}) => void` },
		reduce: { sig: "<U>(f: (acc: U, value: T, index: number) => U, initial: U) => U" },
		includes: { sig: "(value: T) => boolean" },
		indexOf: { sig: "(value: T) => number" },
		lastIndexOf: { sig: "(value: T) => number" },
		slice: { sig: "(start?: number, end?: number) => T[]", fresh: true },
		concat: { sig: "(...lists: T[][]) => T[]", fresh: true },
		at: { sig: "(index: number) => T | undefined" },
		join: { sig: "(separator: string) => string", primitive: true },
		push: { sig: "(...items: T[]) => number", mutates: true },
		unshift: { sig: "(...items: T[]) => number", mutates: true },
		pop: { sig: "() => T | undefined", mutates: true },
		shift: { sig: "() => T | undefined", mutates: true },
		splice: {
			sig: "(start: number, count: number, ...items: T[]) => T[]",
			mutates: true,
			fresh: true,
		},
		sort: { sig: "(compare: (a: T, b: T) => number) => T[]", mutates: true, self: true },
		reverse: { sig: "() => T[]", mutates: true, self: true },
	}),
	string: Object.freeze({
		trim: { sig: "() => string" },
		trimStart: { sig: "() => string" },
		trimEnd: { sig: "() => string" },
		toLowerCase: { sig: "() => string" },
		toUpperCase: { sig: "() => string" },
		split: { sig: "(separator: string) => string[]", fresh: true },
		startsWith: { sig: "(search: string) => boolean" },
		endsWith: { sig: "(search: string) => boolean" },
		includes: { sig: "(search: string) => boolean" },
		indexOf: { sig: "(search: string) => number" },
		lastIndexOf: { sig: "(search: string) => number" },
		slice: { sig: "(start?: number, end?: number) => string" },
		at: { sig: "(index: number) => string | undefined" },
		replaceAll: { sig: "(search: string, replacement: string) => string" },
	}),
	number: Object.freeze({
		toFixed: { sig: "(digits: number) => string" },
	}),
});
// Properties of lists and strings.
export const PROPERTIES = Object.freeze({
	list: Object.freeze({ length: "number" }),
	string: Object.freeze({ length: "number" }),
});
