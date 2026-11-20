// The printer: a tree back to source, parenthesized by precedence. Compiling prints the
// checked tree and compiles that, never the text it was given, so what runs is what was
// checked. With types: true it prints the annotations too (TypeScript); without, JavaScript.

import { isTypeItem } from "./ast.js";

const BINARY_PREC = {
	"??": 4,
	"||": 4,
	"&&": 5,
	"|": 6,
	"^": 7,
	"&": 8,
	"==": 9,
	"!=": 9,
	"===": 9,
	"!==": 9,
	"<": 10,
	">": 10,
	"<=": 10,
	">=": 10,
	in: 10,
	instanceof: 10,
	"<<": 11,
	">>": 11,
	">>>": 11,
	"+": 12,
	"-": 12,
	"*": 13,
	"/": 13,
	"%": 13,
	"**": 14,
};
const UNARY = 15;
const POSTFIX = 16;
const CALL = 17;

const precOf = (e) => {
	switch (e.type) {
		case "AssignmentExpression":
		case "ArrowFunctionExpression":
		case "FunctionExpression":
			return 1;
		case "ConditionalExpression":
			return 2;
		case "LogicalExpression":
		case "BinaryExpression":
			return BINARY_PREC[e.operator];
		case "UnaryExpression":
			return UNARY;
		case "UpdateExpression":
			return e.prefix ? UNARY : POSTFIX;
		case "CallExpression":
		case "MemberExpression":
		case "ChainExpression":
			return CALL;
		default:
			return 18;
	}
};

// Whether an object literal holds methods or getters, itself or in the object literals it holds.
const hasMethods = (e) =>
	e.properties.some(
		(p) =>
			p.type === "Property" &&
			(p.method ||
				p.kind === "get" ||
				(p.value.type === "ObjectExpression" && hasMethods(p.value))),
	);

class Printer {
	constructor(types) {
		this.types = types;
		this.indent = ""; // where the statement being printed starts, for nested blocks
	}
	ann(node) {
		return this.types && node.typeAnnotation ? `: ${this.type(node.typeAnnotation)}` : "";
	}
	pattern(p) {
		if (p === null) return "";
		switch (p.type) {
			case "Identifier":
				return `${p.name}${this.ann(p)}`;
			case "ArrayPattern":
				return `[${p.elements.map((e) => this.pattern(e)).join(", ")}${p.elements.at(-1) === null ? "," : ""}]${this.ann(p)}`;
			case "ObjectPattern":
				return `{ ${p.properties
					.map((q) => {
						if (q.type === "RestElement") return this.pattern(q);
						if (q.shorthand) return this.pattern(q.value);
						return `${this.key(q)}: ${this.pattern(q.value)}`;
					})
					.join(", ")} }${this.ann(p)}`;
			case "RestElement":
				return `...${this.pattern(p.argument)}${this.ann(p)}`;
			case "AssignmentPattern":
				return `${this.pattern(p.left)} = ${this.expr(p.right, 1)}`;
		}
		throw new Error(`can't print the pattern ${p.type}`);
	}
	key(p) {
		if (p.computed) return `[${this.expr(p.key, 1)}]`;
		if (p.key.type === "Identifier") return p.key.name;
		return this.literal(p.key);
	}
	literal(e) {
		if (typeof e.value === "string") return JSON.stringify(e.value);
		if (typeof e.value === "number") return e.raw ?? String(e.value);
		return String(e.value);
	}
	params(fn) {
		const thisParam = this.types && fn.thisType ? [`this: ${this.type(fn.thisType)}`] : [];
		return `(${[...thisParam, ...fn.params.map((p) => this.pattern(p))].join(", ")})`;
	}
	returnType(fn) {
		return this.types && fn.returnType ? `: ${this.type(fn.returnType)}` : "";
	}
	function(fn, indent, form = "function", name = null) {
		if (fn.type === "ArrowFunctionExpression") {
			const body = fn.expression ? this.arrowBody(fn.body) : this.block(fn.body, indent);
			const bare =
				fn.params.length === 1 &&
				fn.params[0].type === "Identifier" &&
				!(this.types && (fn.params[0].typeAnnotation || fn.returnType));
			return `${bare ? fn.params[0].name : this.params(fn)}${this.returnType(fn)} => ${body}`;
		}
		const head =
			form === "method"
				? name
				: form === "getter"
					? `get ${name}`
					: fn.id
						? `function ${fn.id.name}`
						: "function ";
		return `${head}${this.params(fn)}${this.returnType(fn)} ${this.block(fn.body, indent)}`;
	}
	arrowBody(body) {
		const text = this.expr(body, 1);
		return body.type === "ObjectExpression" ? `(${text})` : text;
	}
	block(b, indent) {
		if (b.body.length === 0) return "{}";
		const inner = `${indent}\t`;
		const saved = this.indent;
		this.indent = inner;
		const body = b.body.map((s) => `${inner}${this.statement(s, inner)}`).join("\n");
		this.indent = saved;
		return `{\n${body}\n${indent}}`;
	}
	statement(s, indent) {
		switch (s.type) {
			case "VariableDeclaration":
				return `${this.declaration(s)};`;
			case "ExpressionStatement": {
				const text = this.expr(s.expression, 0);
				return /^(\{|function\b|let\s*\[)/.test(text) ||
					(s.directive === undefined &&
						s.expression.type === "Literal" &&
						typeof s.expression.value === "string")
					? `(${text});`
					: `${text};`;
			}
			case "IfStatement": {
				let out = `if (${this.expr(s.test, 0)}) ${this.nested(s.consequent, indent)}`;
				if (s.alternate !== null) {
					out += s.consequent.type === "BlockStatement" ? " " : `\n${indent}`;
					out += `else ${this.nested(s.alternate, indent)}`;
				}
				return out;
			}
			case "BlockStatement":
				return this.block(s, indent);
			case "ReturnStatement":
				return s.argument === null ? "return;" : `return ${this.expr(s.argument, 0)};`;
			case "ForOfStatement":
				return `for (${this.declaration(s.left)} of ${this.expr(s.right, 1)}) ${this.nested(s.body, indent)}`;
			case "BreakStatement":
				return "break;";
			case "ContinueStatement":
				return "continue;";
			case "ThrowStatement":
				return `throw ${this.expr(s.argument, 0)};`;
			case "TryStatement": {
				let out = `try ${this.block(s.block, indent)}`;
				if (s.handler !== null) {
					const param = s.handler.param === null ? "" : `(${this.pattern(s.handler.param)}) `;
					out += ` catch ${param}${this.block(s.handler.body, indent)}`;
				}
				if (s.finalizer !== null) out += ` finally ${this.block(s.finalizer, indent)}`;
				return out;
			}
		}
		throw new Error(`can't print the statement ${s.type}`);
	}
	nested(s, indent) {
		return s.type === "BlockStatement" ? this.block(s, indent) : this.statement(s, indent);
	}
	declaration(d) {
		return `${d.kind} ${d.declarations
			.map((x) =>
				x.init === null ? this.pattern(x.id) : `${this.pattern(x.id)} = ${this.expr(x.init, 1)}`,
			)
			.join(", ")}`;
	}
	// An expression printed where at least precedence min is needed.
	expr(e, min) {
		const text = this.exprText(e);
		return precOf(e) < min ? `(${text})` : text;
	}
	exprText(e) {
		switch (e.type) {
			case "Identifier":
				return e.name;
			case "ThisExpression":
				return "this";
			case "Literal":
				return this.literal(e);
			case "TemplateLiteral": {
				let out = "`";
				e.quasis.forEach((q, i) => {
					out += q.value.raw;
					if (i < e.expressions.length) out += `\${${this.expr(e.expressions[i], 0)}}`;
				});
				return `${out}\``;
			}
			case "ArrayExpression":
				return `[${e.elements.map((x) => (x === null ? "" : this.expr(x, 1))).join(", ")}${e.elements.at(-1) === null ? "," : ""}]`;
			case "ObjectExpression":
				if (e.properties.length === 0) return "{}";
				if (hasMethods(e)) return this.namespace(e);
				return `{ ${e.properties
					.map((p) => {
						if (p.type === "SpreadElement") return this.expr(p, 1);
						if (p.shorthand) return p.key.name;
						return `${this.key(p)}: ${this.expr(p.value, 1)}`;
					})
					.join(", ")} }`;
			case "SpreadElement":
				return `...${this.expr(e.argument, 1)}`;
			case "MemberExpression": {
				const object = this.callee(e.object);
				if (e.computed) return `${object}${e.optional ? "?." : ""}[${this.expr(e.property, 0)}]`;
				return `${object}${e.optional ? "?." : "."}${e.property.name}`;
			}
			case "CallExpression":
				return `${this.callee(e.callee)}${e.optional ? "?." : ""}(${e.arguments.map((a) => this.expr(a, 1)).join(", ")})`;
			case "ChainExpression":
				return this.exprText(e.expression);
			case "UnaryExpression": {
				const arg = this.expr(e.argument, UNARY);
				const word = /^[a-z]/.test(e.operator);
				const clash =
					(e.operator === "-" && arg.startsWith("-")) ||
					(e.operator === "+" && arg.startsWith("+"));
				return `${e.operator}${word ? " " : ""}${clash ? `(${arg})` : arg}`;
			}
			case "UpdateExpression":
				return e.prefix
					? `${e.operator}${this.expr(e.argument, UNARY)}`
					: `${this.expr(e.argument, POSTFIX)}${e.operator}`;
			case "BinaryExpression":
			case "LogicalExpression": {
				const p = BINARY_PREC[e.operator];
				const right = e.operator === "**";
				const side = (x, extra) => {
					const mix =
						x.type === "LogicalExpression" &&
						(e.operator === "??") !== (x.operator === "??") &&
						e.type === "LogicalExpression";
					const text = this.expr(x, p + extra);
					return mix && !text.startsWith("(") ? `(${text})` : text;
				};
				return `${side(e.left, right ? 1 : 0)} ${e.operator} ${side(e.right, right ? 0 : 1)}`;
			}
			case "ConditionalExpression":
				return `${this.expr(e.test, 3)} ? ${this.expr(e.consequent, 1)} : ${this.expr(e.alternate, 1)}`;
			case "AssignmentExpression":
				return `${this.expr(e.left, CALL)} ${e.operator} ${this.expr(e.right, 1)}`;
			case "ArrowFunctionExpression":
			case "FunctionExpression":
				return this.function(e, this.indent);
		}
		throw new Error(`can't print the expression ${e.type}`);
	}
	// An object literal with methods and getters (a module's namespace): one member a line.
	namespace(e) {
		const outer = this.indent;
		const inner = `${outer}\t`;
		this.indent = inner;
		const members = e.properties.map((p) => {
			if (p.type === "SpreadElement") return this.expr(p, 1);
			if (p.method) return this.function(p.value, inner, "method", this.key(p));
			if (p.kind === "get") return this.function(p.value, inner, "getter", this.key(p));
			if (p.shorthand) return p.key.name;
			return `${this.key(p)}: ${this.expr(p.value, 1)}`;
		});
		this.indent = outer;
		return `{\n${members.map((m) => `${inner}${m},`).join("\n")}\n${outer}}`;
	}
	// A module's item.
	item(i) {
		switch (i.type) {
			case "ExportNamedDeclaration":
				return `export ${this.item(i.declaration)}`;
			case "ImportDeclaration": {
				const names = i.specifiers
					.map((sp) =>
						sp.imported.name === sp.local.name
							? sp.local.name
							: `${sp.imported.name} as ${sp.local.name}`,
					)
					.join(", ");
				return `import ${i.importKind === "type" ? "type " : ""}{ ${names} } from ${JSON.stringify(i.source.value)};`;
			}
			case "VariableDeclaration":
				return `${this.declaration(i)};`;
			case "FunctionDeclaration":
				return this.function(i, "");
			case "TypeAlias":
				return `type ${i.id.name} = ${this.type(i.typeAnnotation)};`;
			case "InterfaceDeclaration":
				return `interface ${i.id.name} ${this.type(i.body)}`;
		}
		throw new Error(`can't print the item ${i.type}`);
	}
	// The object of a member or the callee of a call: a parenthesized chain stays one (a?.b).c
	// is not a?.b.c), a number gets parentheses so its dot isn't a decimal point.
	callee(e) {
		if (e.type === "ChainExpression") return `(${this.exprText(e)})`;
		if (e.type === "Literal" && typeof e.value === "number") return `(${this.literal(e)})`;
		return this.expr(e, CALL);
	}

	// Types, as TypeScript writes them.
	type(t) {
		switch (t.type) {
			case "TypeKeyword":
				return t.name;
			case "TypeLiteral":
				return typeof t.value === "string" ? JSON.stringify(t.value) : String(t.value);
			case "TypeArray": {
				const inner = this.type(t.element);
				return t.element.type === "TypeUnion" || t.element.type === "TypeFunction"
					? `(${inner})[]`
					: `${inner}[]`;
			}
			case "TypeTuple":
				return `[${t.elements.map((x) => this.type(x)).join(", ")}]`;
			case "TypeUnion":
				return t.types
					.map((x) => (x.type === "TypeFunction" ? `(${this.type(x)})` : this.type(x)))
					.join(" | ");
			case "TypeRef":
				return t.args.length === 0
					? t.name
					: `${t.name}<${t.args.map((x) => this.type(x)).join(", ")}>`;
			case "TypeReadonly":
				return `readonly ${this.type(t.operand)}`;
			case "TypeObject":
				if (t.members.length === 0) return "{}";
				return `{ ${t.members.map((m) => this.member(m)).join("; ")} }`;
			case "TypeFunction":
				return `${this.typeParams(t)}(${t.params.map((p) => this.typeParam(p)).join(", ")}) => ${this.type(t.result)}`;
		}
		throw new Error(`can't print the type ${t.type}`);
	}
	typeParams(t) {
		return t.typeParams.length === 0 ? "" : `<${t.typeParams.join(", ")}>`;
	}
	typeParam(p) {
		return `${p.rest ? "..." : ""}${p.name}${p.optional ? "?" : ""}: ${this.type(p.value)}`;
	}
	member(m) {
		const name = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(m.name) ? m.name : JSON.stringify(m.name);
		switch (m.type) {
			case "TypeProperty":
				return `${m.readonly ? "readonly " : ""}${name}${m.optional ? "?" : ""}: ${this.type(m.value)}`;
			case "TypeMethod":
				return `${name}${m.optional ? "?" : ""}${this.typeParams(m)}(${m.params.map((p) => this.typeParam(p)).join(", ")}): ${this.type(m.result)}`;
			case "TypeIndex":
				return `[${m.keyName}: ${this.type(m.key)}]: ${this.type(m.value)}`;
		}
		throw new Error(`can't print the type member ${m.type}`);
	}
}

// A program in the form it was written (a function, a method, a getter, an arrow), or a module
// (without types: without its type items and type imports).
export const print = (program, { types = false } = {}) => {
	const p = new Printer(types);
	if (program.type === "PureModule")
		return program.items
			.filter((i) => types || !isTypeItem(i))
			.map((i) => p.item(i))
			.join("\n");
	return p.function(program.function, "", program.form, program.name);
};
// Any node: an expression, a statement, a type.
export const printNode = (node, { types = false } = {}) => {
	const p = new Printer(types);
	if (node.type.startsWith("Type")) return p.type(node);
	if (node.type.endsWith("Statement") || node.type === "VariableDeclaration")
		return p.statement(node, "");
	return p.expr(node, 0);
};
// A program as a function expression, whatever its form: what compiling wraps.
export const printFunction = (program, { types = false } = {}) =>
	new Printer(types).function(program.function, "");
