// The ESTree node types a renders.js can use (ES2022, https://github.com/estree/estree), and the checks
// both validation layers share: tags.js runs them on what a view says when it's built, lower.js
// on the tree it renders to. One table, so the two can't disagree.
//
// Each type says:
// - is: the categories it belongs to (Expression, Statement, Pattern, ...). A slot accepts a node
//   whose type, or one of whose categories, it names.
// - scalars: its non-node fields, the tag's attrs, by name: a kind, and whether it may be left out
//   (booleans may; absent, they're false).
// - slots: its node fields, in ESTree order, each one(accepts), opt(accepts), many(accepts) or
//   holes(accepts): an array that can hold nulls (js.Hole()).

// A slot's arity: one node, an optional one, an array, an array with holes.
const slot = (arity) => (accepts) => ({ arity, accepts });
const one = slot("one");
const opt = slot("opt");
const many = slot("many");
const holes = slot("holes");

const str = { kind: "string" };
const optStr = { kind: "string", optional: true };
const bool = { kind: "boolean", optional: true };
const oneOf = (values, optional = false) => ({ kind: "enum", values, optional });

export const BINARY_OPERATORS = [
	"==",
	"!=",
	"===",
	"!==",
	"<",
	"<=",
	">",
	">=",
	"<<",
	">>",
	">>>",
	"+",
	"-",
	"*",
	"/",
	"%",
	"**",
	"|",
	"^",
	"&",
	"in",
	"instanceof",
];
export const LOGICAL_OPERATORS = ["||", "&&", "??"];
export const ASSIGNMENT_OPERATORS = [
	"=",
	"+=",
	"-=",
	"*=",
	"/=",
	"%=",
	"**=",
	"<<=",
	">>=",
	">>>=",
	"|=",
	"^=",
	"&=",
	"||=",
	"&&=",
	"??=",
];
export const UNARY_OPERATORS = ["-", "+", "!", "~", "typeof", "void", "delete"];
export const UPDATE_OPERATORS = ["++", "--"];

const E = "Expression";
const S = "Statement";
const P = "Pattern";
const EXPR = [E];
const STMT = [S];
const FUNCTION = (is) => ({
	is,
	scalars: { async: bool, generator: bool },
	slots: { id: opt(["Identifier"]), params: many([P]), body: one(["BlockStatement"]) },
});
const CLASS = (is) => ({
	is,
	slots: { id: opt(["Identifier"]), superClass: opt(EXPR), body: one(["ClassBody"]) },
});
const SOURCE = one(["Literal"]);
const MODULE_NAME = ["Identifier", "Literal"];

export const SCHEMA = {
	Program: {
		is: [],
		scalars: { sourceType: oneOf(["script", "module"], true) },
		slots: { body: many([S, "ModuleDeclaration"]) },
	},
	Identifier: { is: [E, P], scalars: { name: str } },
	PrivateIdentifier: { is: [], scalars: { name: str } },
	Literal: {
		is: [E],
		scalars: {
			value: { kind: "literal", optional: true },
			regex: { kind: "regex", optional: true },
			bigint: { kind: "bigint", optional: true },
			raw: optStr,
		},
		// One of them says what it is.
		check: (n) =>
			n.value === undefined && n.regex === undefined && n.bigint === undefined
				? "needs a value, regex or bigint"
				: null,
	},

	// Statements
	ExpressionStatement: {
		is: STMT,
		scalars: { directive: optStr },
		slots: { expression: one(EXPR) },
	},
	BlockStatement: { is: STMT, slots: { body: many(STMT) } },
	EmptyStatement: { is: STMT },
	DebuggerStatement: { is: STMT },
	WithStatement: { is: STMT, slots: { object: one(EXPR), body: one(STMT) } },
	ReturnStatement: { is: STMT, slots: { argument: opt(EXPR) } },
	LabeledStatement: { is: STMT, slots: { label: one(["Identifier"]), body: one(STMT) } },
	BreakStatement: { is: STMT, slots: { label: opt(["Identifier"]) } },
	ContinueStatement: { is: STMT, slots: { label: opt(["Identifier"]) } },
	IfStatement: {
		is: STMT,
		slots: { test: one(EXPR), consequent: one(STMT), alternate: opt(STMT) },
	},
	SwitchStatement: {
		is: STMT,
		slots: { discriminant: one(EXPR), cases: many(["SwitchCase"]) },
	},
	SwitchCase: { is: [], slots: { test: opt(EXPR), consequent: many(STMT) } },
	ThrowStatement: { is: STMT, slots: { argument: one(EXPR) } },
	TryStatement: {
		is: STMT,
		slots: {
			block: one(["BlockStatement"]),
			handler: opt(["CatchClause"]),
			finalizer: opt(["BlockStatement"]),
		},
		check: (n) =>
			n.handler === null && n.finalizer === null ? "needs a handler or a finalizer" : null,
	},
	CatchClause: { is: [], slots: { param: opt([P]), body: one(["BlockStatement"]) } },
	WhileStatement: { is: STMT, slots: { test: one(EXPR), body: one(STMT) } },
	DoWhileStatement: { is: STMT, slots: { body: one(STMT), test: one(EXPR) } },
	ForStatement: {
		is: STMT,
		slots: {
			init: opt(["VariableDeclaration", E]),
			test: opt(EXPR),
			update: opt(EXPR),
			body: one(STMT),
		},
	},
	ForInStatement: {
		is: STMT,
		slots: { left: one(["VariableDeclaration", P]), right: one(EXPR), body: one(STMT) },
	},
	ForOfStatement: {
		is: STMT,
		scalars: { await: bool },
		slots: { left: one(["VariableDeclaration", P]), right: one(EXPR), body: one(STMT) },
	},

	// Declarations
	FunctionDeclaration: FUNCTION([S, "Declaration"]),
	VariableDeclaration: {
		is: [S, "Declaration"],
		scalars: { kind: oneOf(["var", "let", "const"]) },
		slots: { declarations: many(["VariableDeclarator"]) },
		check: (n) => (n.declarations.length === 0 ? "needs at least one declarator" : null),
	},
	VariableDeclarator: { is: [], slots: { id: one([P]), init: opt(EXPR) } },
	ClassDeclaration: CLASS([S, "Declaration"]),
	ClassBody: {
		is: [],
		slots: { body: many(["MethodDefinition", "PropertyDefinition", "StaticBlock"]) },
	},
	MethodDefinition: {
		is: [],
		scalars: { kind: oneOf(["constructor", "method", "get", "set"]), computed: bool, static: bool },
		slots: { key: one([E, "PrivateIdentifier"]), value: one(["FunctionExpression"]) },
	},
	PropertyDefinition: {
		is: [],
		scalars: { computed: bool, static: bool },
		slots: { key: one([E, "PrivateIdentifier"]), value: opt(EXPR) },
	},
	StaticBlock: { is: [], slots: { body: many(STMT) } },

	// Expressions
	ThisExpression: { is: EXPR },
	Super: { is: [] },
	ArrayExpression: { is: EXPR, slots: { elements: holes([E, "SpreadElement"]) } },
	ObjectExpression: { is: EXPR, slots: { properties: many(["Property", "SpreadElement"]) } },
	Property: {
		is: [],
		scalars: {
			kind: oneOf(["init", "get", "set"], true),
			method: bool,
			shorthand: bool,
			computed: bool,
		},
		// value is a Pattern when the property is in an ObjectPattern.
		slots: { key: one(EXPR), value: one([E, P]) },
	},
	FunctionExpression: FUNCTION(EXPR),
	ArrowFunctionExpression: {
		is: EXPR,
		scalars: { async: bool, expression: bool },
		slots: { params: many([P]), body: one(["BlockStatement", E]) },
	},
	UnaryExpression: {
		is: EXPR,
		scalars: { operator: oneOf(UNARY_OPERATORS), prefix: bool },
		slots: { argument: one(EXPR) },
	},
	UpdateExpression: {
		is: EXPR,
		scalars: { operator: oneOf(UPDATE_OPERATORS), prefix: bool },
		slots: { argument: one(EXPR) },
	},
	BinaryExpression: {
		is: EXPR,
		scalars: { operator: oneOf(BINARY_OPERATORS) },
		// #x in obj: a private name is a left operand only of in.
		slots: { left: one([E, "PrivateIdentifier"]), right: one(EXPR) },
	},
	AssignmentExpression: {
		is: EXPR,
		scalars: { operator: oneOf(ASSIGNMENT_OPERATORS) },
		slots: { left: one([P]), right: one(EXPR) },
	},
	LogicalExpression: {
		is: EXPR,
		scalars: { operator: oneOf(LOGICAL_OPERATORS) },
		slots: { left: one(EXPR), right: one(EXPR) },
	},
	MemberExpression: {
		is: [E, P],
		scalars: { computed: bool, optional: bool },
		slots: { object: one([E, "Super"]), property: one([E, "PrivateIdentifier"]) },
	},
	ChainExpression: {
		is: EXPR,
		slots: { expression: one(["CallExpression", "MemberExpression"]) },
	},
	ConditionalExpression: {
		is: EXPR,
		slots: { test: one(EXPR), consequent: one(EXPR), alternate: one(EXPR) },
	},
	CallExpression: {
		is: EXPR,
		scalars: { optional: bool },
		slots: { callee: one([E, "Super"]), arguments: many([E, "SpreadElement"]) },
	},
	NewExpression: {
		is: EXPR,
		slots: { callee: one(EXPR), arguments: many([E, "SpreadElement"]) },
	},
	SequenceExpression: {
		is: EXPR,
		slots: { expressions: many(EXPR) },
		check: (n) => (n.expressions.length === 0 ? "needs at least one expression" : null),
	},
	YieldExpression: { is: EXPR, scalars: { delegate: bool }, slots: { argument: opt(EXPR) } },
	AwaitExpression: { is: EXPR, slots: { argument: one(EXPR) } },
	TemplateLiteral: {
		is: EXPR,
		slots: { quasis: many(["TemplateElement"]), expressions: many(EXPR) },
		check: (n) =>
			n.quasis.length === n.expressions.length + 1
				? null
				: `needs one more quasi than expressions, has ${n.quasis.length} and ${n.expressions.length}`,
	},
	TaggedTemplateExpression: {
		is: EXPR,
		slots: { tag: one(EXPR), quasi: one(["TemplateLiteral"]) },
	},
	TemplateElement: {
		is: [],
		scalars: { tail: bool, value: { kind: "templateValue" } },
	},
	ClassExpression: CLASS(EXPR),
	MetaProperty: {
		is: EXPR,
		slots: { meta: one(["Identifier"]), property: one(["Identifier"]) },
	},
	ImportExpression: { is: EXPR, slots: { source: one(EXPR) } },
	SpreadElement: { is: [], slots: { argument: one(EXPR) } },

	// Patterns
	ObjectPattern: { is: [P], slots: { properties: many(["Property", "RestElement"]) } },
	ArrayPattern: { is: [P], slots: { elements: holes([P]) } },
	RestElement: { is: [P], slots: { argument: one([P]) } },
	AssignmentPattern: { is: [P], slots: { left: one([P]), right: one(EXPR) } },

	// Modules
	ImportDeclaration: {
		is: ["ModuleDeclaration"],
		slots: {
			specifiers: many(["ImportSpecifier", "ImportDefaultSpecifier", "ImportNamespaceSpecifier"]),
			source: SOURCE,
		},
	},
	ImportSpecifier: {
		is: [],
		slots: { imported: one(MODULE_NAME), local: one(["Identifier"]) },
	},
	ImportDefaultSpecifier: { is: [], slots: { local: one(["Identifier"]) } },
	ImportNamespaceSpecifier: { is: [], slots: { local: one(["Identifier"]) } },
	ExportNamedDeclaration: {
		is: ["ModuleDeclaration"],
		slots: {
			declaration: opt(["Declaration"]),
			specifiers: many(["ExportSpecifier"]),
			source: opt(["Literal"]),
		},
	},
	ExportSpecifier: { is: [], slots: { local: one(MODULE_NAME), exported: one(MODULE_NAME) } },
	ExportDefaultDeclaration: {
		is: ["ModuleDeclaration"],
		slots: { declaration: one(["Declaration", E]) },
	},
	ExportAllDeclaration: {
		is: ["ModuleDeclaration"],
		slots: { exported: opt(MODULE_NAME), source: SOURCE },
	},
};
for (const spec of Object.values(SCHEMA)) {
	spec.scalars ??= {};
	spec.slots ??= {};
}

// The tag that stands for a null in an array slot that has holes.
export const HOLE = "Hole";
// Node types are PascalCase, slots camelCase: js.BinaryExpression, js.left.
export const isTypeName = (name) => /^[A-Z]/.test(name);

const isPlainObject = (v) =>
	v !== null && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype;
const show = (v) => (typeof v === "string" ? JSON.stringify(v) : String(v));
// What's wrong with value as the scalar name of a type, or null.
export const scalarIssue = (type, name, value) => {
	const spec = SCHEMA[type].scalars[name];
	if (spec === undefined) {
		const known = Object.keys(SCHEMA[type].scalars);
		const which = known.length === 0 ? "none" : known.join(", ");
		return `${type} has no attr ${name} (its attrs: ${which})`;
	}
	if (value === undefined) return spec.optional ? null : `${type} needs attr ${name}`;
	switch (spec.kind) {
		case "string":
			return typeof value === "string"
				? null
				: `${type} ${name} must be a string, not ${show(value)}`;
		case "boolean":
			return typeof value === "boolean"
				? null
				: `${type} ${name} must be true or false, not ${show(value)}`;
		case "enum":
			return spec.values.includes(value)
				? null
				: `${type} ${name} must be one of ${spec.values.join(" ")}, not ${show(value)}`;
		case "literal":
			if (typeof value === "number") {
				// The printer writes a number as is: -1 would read back as a UnaryExpression.
				return Number.isFinite(value) && !Object.is(value, -0) && value >= 0
					? null
					: `Literal value ${show(value)} has no literal: use a UnaryExpression for a negative number`;
			}
			return value === null || typeof value === "string" || typeof value === "boolean"
				? null
				: `Literal value must be a string, number, boolean or null, not ${show(value)}`;
		case "regex":
			return isPlainObject(value) &&
				typeof value.pattern === "string" &&
				typeof value.flags === "string"
				? null
				: "Literal regex must be { pattern, flags }, both strings";
		case "bigint":
			return typeof value === "string" && /^\d+$/.test(value)
				? null
				: `Literal bigint must be a string of digits, not ${show(value)}`;
		case "templateValue":
			return isPlainObject(value) && typeof value.raw === "string"
				? null
				: "TemplateElement value must be { raw, cooked }, raw a string";
		default:
			throw new Error(`unknown scalar kind ${spec.kind}`);
	}
};
// Whether a node of type (or a hole, for HOLE) can go in the slot.
export const accepts = (slotSpec, type) =>
	type === HOLE
		? slotSpec.arity === "holes"
		: slotSpec.accepts.some((a) => a === type || SCHEMA[type].is.includes(a));
const article = (word) => (/^[AEIOU]/.test(word) ? `an ${word}` : `a ${word}`);
// What a slot takes, said: "an Expression or a SpreadElement", "an Identifier or a hole".
export const describeAccepts = (slotSpec) => {
	const words = slotSpec.accepts.map(article);
	if (slotSpec.arity === "holes") words.push("a hole");
	return words.join(" or ");
};
export const describeType = (type) => (type === HOLE ? "a hole" : type);
