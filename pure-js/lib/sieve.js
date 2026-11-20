// The sieve: whether a parsed program uses only the forms its profile admits. It walks the tree
// once, finds each node's feature (tables.js) and reports those the profile doesn't enable,
// with the rules of where a form may appear: an arrow only as a list method's callback, an
// assignment only as a statement, a statement only if it does something.

import { boundNames } from "./ast.js";
import { Diagnostic } from "./diagnostic.js";
import { exclusionMessage } from "./lex.js";
import {
	ASSIGNMENT_OPERATORS,
	CALLBACK_METHODS,
	FEATURES,
	OPERATORS,
	PROFILES,
	RESERVED_NAMES,
	TYPE_KEYWORDS,
	UNARY_OPERATORS,
} from "./tables.js";

const RESERVED = new Set(RESERVED_NAMES);
const CALLBACKS = new Set(CALLBACK_METHODS);

// Whether an arrow is where a callback goes: the first argument of xs.m(...), m a method that
// takes one. Anywhere else (another argument, a host function's, concat's or push's) it would
// be a function value.
const isCallback = (arrow, call) =>
	call.type === "CallExpression" &&
	call.arguments[0] === arrow &&
	call.callee.type === "MemberExpression" &&
	!call.callee.computed &&
	CALLBACKS.has(call.callee.property.name);

// The features a profile enables: the core ones and those it adds.
export const profileFeatures = (profile = "core") => {
	const names = [profile].flat();
	const enabled = new Set(Object.keys(FEATURES).filter((f) => FEATURES[f].status === "core"));
	for (const name of names) {
		if (!Object.hasOwn(PROFILES, name)) {
			const known = Object.keys(PROFILES).join(", ");
			throw new Error(`there is no profile ${name} in this version of pure-js (there is ${known})`);
		}
		for (const f of PROFILES[name]) enabled.add(f);
	}
	return enabled;
};

class Sieve {
	constructor(enabled) {
		this.enabled = enabled;
		this.diagnostics = [];
		this.lets = []; // the let names in scope, innermost last, for assignments to names
		this.namespaces = new Set(); // the object literals that are a module's namespaces
	}
	use(feature, node) {
		if (this.enabled.has(feature)) return;
		const f = FEATURES[feature];
		this.diagnostics.push(
			new Diagnostic({
				code: feature,
				stage: "sieve",
				message: exclusionMessage(feature),
				start: node.start,
				end: node.end,
				exclusion: f.status === "core" ? null : f.status,
				profile: f.profile ?? null,
			}),
		);
	}
	name(id) {
		if (id.name.startsWith("$")) this.use("dollar-name", id);
	}
	propertyName(name, node) {
		if (RESERVED.has(name)) this.use("reserved-name", node);
	}
	program(p) {
		if (p.type === "PureModule") return this.module(p);
		this.use(`${p.form}-program`, p);
		this.function(p.function);
	}
	// A module: its items, a top-level const's object literal a namespace whose methods and
	// getters (and those of the object literals it holds) are entries.
	module(m) {
		this.use("module-program", m);
		for (const item of m.items) {
			let d = item;
			if (item.type === "ExportNamedDeclaration") {
				this.use("export-declaration", item);
				d = item.declaration;
			}
			switch (d.type) {
				case "ImportDeclaration":
					this.use("import-declaration", d);
					for (const sp of d.specifiers) this.name(sp.local);
					break;
				case "VariableDeclaration":
					for (const x of d.declarations)
						if (x.init?.type === "ObjectExpression") this.namespaces.add(x.init);
					this.statement(d);
					break;
				case "FunctionDeclaration":
					this.use("helper-function", d);
					this.name(d.id);
					this.function(d);
					break;
				case "TypeAlias":
					this.use("type-alias", d);
					this.type(d.typeAnnotation);
					break;
				case "InterfaceDeclaration":
					this.use("interface-declaration", d);
					this.type(d.body);
					break;
			}
		}
	}
	function(fn) {
		this.lets.push(new Set());
		if (fn.thisType) {
			this.use("this-parameter", fn.thisType);
			this.type(fn.thisType);
		}
		for (const param of fn.params) this.param(param);
		if (fn.returnType) this.type(fn.returnType);
		if (fn.body.type === "BlockStatement") this.statements(fn.body.body);
		else this.expression(fn.body, fn, "body");
		this.lets.pop();
	}
	isLet(name) {
		return this.lets.some((s) => s.has(name));
	}
	// A parameter: a name, or an array pattern of names (and holes).
	param(p) {
		switch (p.type) {
			case "Identifier":
				this.name(p);
				break;
			case "ArrayPattern":
				this.use("array-pattern-param", p);
				for (const e of p.elements) {
					if (e === null) continue;
					if (e.type === "Identifier") this.name(e);
					else this.pattern(e, "nested-pattern");
				}
				break;
			default:
				this.pattern(p, null);
		}
		if (p.typeAnnotation) this.type(p.typeAnnotation);
	}
	// A pattern where the profile may not admit one; feature names what it is there.
	pattern(p, feature) {
		switch (p.type) {
			case "Identifier":
				this.name(p);
				return;
			case "ArrayPattern":
				if (feature) this.use(feature, p);
				for (const e of p.elements) if (e !== null) this.pattern(e, "nested-pattern");
				return;
			case "ObjectPattern":
				this.use(feature ?? "object-pattern", p);
				for (const prop of p.properties) {
					if (prop.type === "RestElement") this.pattern(prop, "rest-element");
					else {
						if (prop.computed) this.use("computed-key", prop.key);
						this.pattern(prop.value, "nested-pattern");
					}
				}
				return;
			case "RestElement":
				this.use("rest-element", p);
				this.pattern(p.argument, "nested-pattern");
				return;
			case "AssignmentPattern":
				this.use("default-value", p);
				this.pattern(p.left, null);
				this.expression(p.right, p, "right");
				return;
		}
	}
	statements(list) {
		for (const s of list) this.statement(s);
	}
	statement(s) {
		switch (s.type) {
			case "VariableDeclaration":
				this.use(s.kind === "const" ? "const-declaration" : "let-declaration", s);
				if (s.declarations.length > 1) this.use("multiple-declarators", s);
				for (const d of s.declarations) {
					if (s.kind === "let" && this.lets.length > 0)
						for (const n of boundNames(d.id)) this.lets.at(-1).add(n);
					if (d.id.type === "Identifier") this.name(d.id);
					else this.pattern(d.id, "destructuring-declaration");
					if (d.id.typeAnnotation) this.type(d.id.typeAnnotation);
					if (d.init !== null) this.expression(d.init, d, "init");
				}
				return;
			case "ExpressionStatement": {
				this.use("expression-statement", s);
				const e = s.expression;
				const effect =
					e.type === "CallExpression" ||
					e.type === "AssignmentExpression" ||
					e.type === "UpdateExpression" ||
					(e.type === "ChainExpression" && e.expression.type === "CallExpression");
				this.expression(e, s, "expression");
				if (!effect) this.use("useless-expression", s);
				return;
			}
			case "IfStatement":
				this.use("if-statement", s);
				this.expression(s.test, s, "test");
				this.statement(s.consequent);
				if (s.alternate !== null) this.statement(s.alternate);
				return;
			case "BlockStatement":
				this.use("block-statement", s);
				this.lets.push(new Set());
				this.statements(s.body);
				this.lets.pop();
				return;
			case "ReturnStatement":
				this.use("return-statement", s);
				if (s.argument !== null) this.expression(s.argument, s, "argument");
				return;
			case "ForOfStatement":
				this.use("for-of-statement", s);
				this.statement(s.left);
				this.expression(s.right, s, "right");
				this.statement(s.body);
				return;
			case "BreakStatement":
			case "ContinueStatement":
				this.use("loop-control", s);
				return;
			case "TryStatement":
				this.use("try-statement", s);
				this.statement(s.block);
				if (s.handler !== null) {
					if (s.handler.param !== null) this.pattern(s.handler.param, null);
					this.statement(s.handler.body);
				}
				if (s.finalizer !== null) this.statement(s.finalizer);
				return;
			case "ThrowStatement":
				this.use("throw-statement", s);
				this.expression(s.argument, s, "argument");
				return;
		}
	}
	expression(e, parent, key) {
		switch (e.type) {
			case "Identifier":
				this.use("identifier", e);
				this.name(e);
				return;
			case "Literal":
				this.use(
					e.value === null
						? "null-literal"
						: typeof e.value === "string"
							? "string-literal"
							: typeof e.value === "number"
								? "number-literal"
								: "boolean-literal",
					e,
				);
				return;
			case "TemplateLiteral":
				this.use("template-literal", e);
				for (const x of e.expressions) this.expression(x, e, "expressions");
				return;
			case "ThisExpression":
				this.use("this", e);
				return;
			case "ArrayExpression":
				this.use("array-literal", e);
				for (const el of e.elements) {
					if (el === null) this.use("array-hole", e);
					else this.expression(el, e, "elements");
				}
				return;
			case "ObjectExpression":
				this.use("object-literal", e);
				for (const p of e.properties) {
					if (p.type === "SpreadElement") {
						this.expression(p, e, "properties");
						continue;
					}
					if (p.method || p.kind === "get") {
						this.use(this.namespaces.has(e) ? "namespace-method" : "object-method", p);
						this.propertyName(p.key.type === "Identifier" ? p.key.name : p.key.value, p.key);
						this.function(p.value);
						continue;
					}
					if (this.namespaces.has(e) && p.value.type === "ObjectExpression")
						this.namespaces.add(p.value);
					if (p.computed) {
						this.use("computed-key", p.key);
						this.expression(p.key, p, "key");
					} else if (p.key.type === "Literal" && typeof p.key.value === "number") {
						this.use("numeric-key", p.key);
					} else {
						this.propertyName(p.key.type === "Identifier" ? p.key.name : p.key.value, p.key);
					}
					this.expression(p.value, p, "value");
				}
				return;
			case "SpreadElement":
				this.use("spread", e);
				this.expression(e.argument, e, "argument");
				return;
			case "MemberExpression":
				if (e.computed) {
					this.use("computed-member", e);
					this.expression(e.property, e, "property");
				} else {
					this.use(e.optional ? "optional-member" : "member", e);
					this.propertyName(e.property.name, e.property);
				}
				this.expression(e.object, e, "object");
				return;
			case "ChainExpression": {
				// Indexing inside an optional chain would have to short-circuit through the runtime's
				// guard: left for a later version.
				for (
					let link = e.expression;
					link.type === "MemberExpression" || link.type === "CallExpression";
				) {
					if (link.type === "MemberExpression" && link.computed)
						this.use("optional-computed-member", link);
					link = link.type === "MemberExpression" ? link.object : link.callee;
				}
				this.expression(e.expression, e, "expression");
				return;
			}
			case "CallExpression":
				this.use(e.optional ? "optional-call" : "call", e);
				this.expression(e.callee, e, "callee");
				for (const a of e.arguments) this.expression(a, e, "arguments");
				return;
			case "ArrowFunctionExpression":
				if (!(key === "arguments" && isCallback(e, parent))) this.use("arrow-not-callback", e);
				else this.use("callback-arrow", e);
				if (!e.expression) this.use("block-arrow", e);
				if (e.returnType) this.use("arrow-return-type", e.returnType);
				this.function(e);
				return;
			case "UnaryExpression":
				this.use(UNARY_OPERATORS[e.operator], e);
				this.expression(e.argument, e, "argument");
				return;
			case "UpdateExpression":
				this.use("update", e);
				this.expression(e.argument, e, "argument");
				return;
			case "BinaryExpression":
			case "LogicalExpression":
				this.use(OPERATORS[e.operator], e);
				this.expression(e.left, e, "left");
				this.expression(e.right, e, "right");
				return;
			case "ConditionalExpression":
				this.use("conditional", e);
				this.expression(e.test, e, "test");
				this.expression(e.consequent, e, "consequent");
				this.expression(e.alternate, e, "alternate");
				return;
			case "AssignmentExpression":
				if (parent.type !== "ExpressionStatement") this.use("assignment-expression", e);
				this.use(ASSIGNMENT_OPERATORS[e.operator] ?? "compound-assignment", e);
				if (e.left.type === "Identifier")
					this.use(this.isLet(e.left.name) ? "let-assignment" : "reassignment", e.left);
				else if (e.left.computed && e.operator !== "=") this.use("computed-compound-assignment", e);
				this.expression(e.left, e, "left");
				this.expression(e.right, e, "right");
				return;
		}
	}
	type(t) {
		this.use("type-annotation", t);
		switch (t.type) {
			case "TypeKeyword": {
				const f = TYPE_KEYWORDS[t.name];
				if (f !== "core") this.use(f, t);
				return;
			}
			case "TypeLiteral":
				return;
			case "TypeArray":
				this.type(t.element);
				return;
			case "TypeTuple":
				for (const e of t.elements) this.type(e);
				return;
			case "TypeUnion":
				for (const u of t.types) this.type(u);
				return;
			case "TypeObject":
				for (const m of t.members) {
					if (m.type === "TypeMethod") this.use("method-type", m);
					else if (m.type === "TypeIndex") {
						if (!(m.key.type === "TypeKeyword" && m.key.name === "string"))
							this.use("type-keyword", m.key);
						this.type(m.value);
					} else {
						if (m.readonly) this.use("readonly-type", m);
						this.propertyName(m.name, m);
						this.type(m.value);
					}
				}
				return;
			case "TypeRef":
				if (t.name === "Readonly" && t.args.length === 1) {
					this.use("readonly-type", t);
					this.type(t.args[0]);
				} else if (t.args.length > 0) this.use("generic-type", t);
				return;
			case "TypeFunction":
				this.use("function-type", t);
				return;
			case "TypeReadonly":
				this.use("readonly-type", t);
				this.type(t.operand);
				return;
		}
	}
}

// The diagnostics of the forms in program that profile doesn't admit.
export const sieve = (program, { profile = "core" } = {}) => {
	const s = new Sieve(profileFeatures(profile));
	s.program(program);
	return { diagnostics: s.diagnostics };
};
