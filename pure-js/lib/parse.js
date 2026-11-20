// The parser: pure-js source to a PureProgram. It parses the subset, what profiles may admit
// (let, for-of, try, destructuring, ...) and the annotations TypeScript allows, making the nodes
// acorn makes. Forms it can't represent and pure-js leaves out it reports by their feature
// (tables.js); the sieve decides the rest. It stops at the first problem, as parsers do.

import { Diagnostic, Stop } from "./diagnostic.js";
import { excluded, Lexer, syntaxError } from "./lex.js";
import { KEYWORDS } from "./tables.js";

const KEYWORD_SET = new Set(KEYWORDS);
const STRICT_UNBINDABLE = new Set([
	"eval",
	"arguments",
	"implements",
	"interface",
	"let",
	"package",
	"private",
	"protected",
	"public",
	"static",
	"yield",
	"await",
]);
const PREC = {
	"??": 1,
	"||": 1,
	"&&": 2,
	"|": 3,
	"^": 4,
	"&": 5,
	"==": 6,
	"!=": 6,
	"===": 6,
	"!==": 6,
	"<": 7,
	">": 7,
	"<=": 7,
	">=": 7,
	in: 7,
	instanceof: 7,
	"<<": 8,
	">>": 8,
	">>>": 8,
	"+": 9,
	"-": 9,
	"*": 10,
	"/": 10,
	"%": 10,
	"**": 11,
};
const ASSIGN = new Set([
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
	"&=",
	"|=",
	"^=",
	"&&=",
	"||=",
	"??=",
]);
const TYPE_KEYWORD_NAMES = new Set([
	"number",
	"string",
	"boolean",
	"undefined",
	"unknown",
	"void",
	"any",
	"never",
	"object",
	"symbol",
	"bigint",
]);

class Parser {
	constructor(source, { module = false } = {}) {
		this.src = source;
		this.lex = new Lexer(source);
		this.tok = this.lex.next();
		this.prevEnd = 0;
		this.parenthesized = new WeakSet();
		this.scope = null;
		this.loops = 0;
		// A module's goal: its items, methods and getters in object literals (the sieve says
		// where they may be), and this parameters.
		this.moduleGoal = module;
	}
	// Tokens.
	next() {
		this.prevEnd = this.tok.end;
		this.tok = this.lex.next();
	}
	is(p) {
		return this.tok.kind === "punct" && this.tok.value === p;
	}
	isName(n) {
		return this.tok.kind === "name" && this.tok.value === n;
	}
	eat(p) {
		if (!this.is(p)) return false;
		this.next();
		return true;
	}
	expect(p) {
		if (!this.eat(p)) throw this.unexpected(`expected ${p}`);
	}
	unexpected(message = null) {
		const t = this.tok;
		const what =
			t.kind === "eof" ? "the end of the program" : JSON.stringify(this.src.slice(t.start, t.end));
		return syntaxError(
			message === null ? `unexpected ${what}` : `${message}, found ${what}`,
			t.start,
			t.end,
		);
	}
	// What the tokens after the current one are, without consuming them.
	lookahead(fn) {
		const saved = { lex: this.lex.save(), tok: this.tok, prevEnd: this.prevEnd };
		try {
			return fn();
		} catch (error) {
			if (error instanceof Stop) return false;
			throw error;
		} finally {
			this.lex.restore(saved.lex);
			this.tok = saved.tok;
			this.prevEnd = saved.prevEnd;
		}
	}
	peek() {
		return this.lookahead(() => {
			this.next();
			return this.tok;
		});
	}
	// Whether the ( here closes with a ) followed by =>.
	parenArrowAhead() {
		return this.lookahead(() => {
			let depth = 0;
			for (;;) {
				const t = this.tok;
				if (t.kind === "eof") return false;
				if (t.kind === "punct") {
					if (t.value === "(" || t.value === "[" || t.value === "{") depth++;
					if (t.value === ")" || t.value === "]" || t.value === "}") depth--;
				}
				this.next();
				if (depth === 0) {
					// (a: T): R => ...: an arrow with a return type.
					if (this.eat(":")) this.type();
					return this.is("=>");
				}
			}
		});
	}
	finish(node, start) {
		node.start = start;
		node.end = this.prevEnd;
		return node;
	}
	// Scopes, for the declarations JavaScript rejects twice.
	pushScope(isFunction) {
		this.scope = { names: new Set(), params: isFunction ? new Set() : null, parent: this.scope };
	}
	popScope() {
		this.scope = this.scope.parent;
	}
	checkBindable(id) {
		if (STRICT_UNBINDABLE.has(id.name))
			throw syntaxError(`${id.name} can't be bound in strict mode`, id.start, id.end);
	}
	declare(id, asParam) {
		this.checkBindable(id);
		const s = this.scope;
		const taken = s.names.has(id.name) || (s.params?.has(id.name) ?? false);
		if (taken) throw syntaxError(`${id.name} is already declared`, id.start, id.end);
		(asParam ? s.params : s.names).add(id.name);
	}
	declarePattern(pattern, asParam) {
		if (pattern === null) return;
		switch (pattern.type) {
			case "Identifier":
				this.declare(pattern, asParam);
				break;
			case "ArrayPattern":
				for (const e of pattern.elements) this.declarePattern(e, asParam);
				break;
			case "ObjectPattern":
				for (const p of pattern.properties)
					this.declarePattern(p.type === "RestElement" ? p.argument : p.value, asParam);
				break;
			case "RestElement":
				this.declarePattern(pattern.argument, asParam);
				break;
			case "AssignmentPattern":
				this.declarePattern(pattern.left, asParam);
				break;
		}
	}

	// The program: one function, as a function expression, a method, a getter or an arrow.
	program() {
		const start = this.tok.start;
		let form;
		let name = null;
		let fn;
		const nextTok = this.peek();
		if (this.isName("async") && nextTok && !nextTok.newlineBefore && nextTok.kind !== "punct")
			throw excluded("async", start, nextTok.end);
		if (this.isName("function")) {
			this.next();
			if (this.is("*")) throw excluded("generator", start, this.tok.end);
			let id = null;
			if (this.tok.kind === "name" && !this.is("(")) id = this.bindingIdentifier();
			fn = this.functionRest(start, id);
			form = "function";
		} else if (this.is("*")) {
			throw excluded("generator", start, this.tok.end);
		} else if ((this.isName("get") || this.isName("set")) && nextTok?.kind === "name") {
			const kind = this.tok.value;
			this.next();
			name = this.tok.value;
			this.next();
			if (kind === "set") throw excluded("object-method", start, this.prevEnd);
			fn = this.functionRest(this.tok.start, null);
			if (fn.params.length > 0) throw syntaxError("a getter takes no parameters", fn.start, fn.end);
			form = "getter";
		} else if (this.tok.kind === "name" && nextTok?.kind === "punct" && nextTok.value === "(") {
			name = this.tok.value;
			this.next();
			fn = this.functionRest(this.tok.start, null);
			form = "method";
		} else if (this.arrowAhead()) {
			fn = this.arrow();
			form = "arrow";
		} else {
			throw this.unexpected("expected a function");
		}
		if (this.tok.kind !== "eof") throw this.unexpected("expected the end of the program");
		return { type: "PureProgram", form, name, function: fn, start, end: fn.end, source: this.src };
	}

	// A module: imports and declarations (const, function, type, interface), each maybe
	// exported. Types live apart from values, as in TypeScript: a type and a const may share a
	// name.
	module() {
		const start = this.tok.start;
		this.pushScope(true);
		this.typeNames = new Set();
		const items = [];
		while (this.tok.kind !== "eof") items.push(this.item());
		this.popScope();
		return { type: "PureModule", items, start, end: this.prevEnd, source: this.src };
	}
	item() {
		const start = this.tok.start;
		if (this.isName("import")) return this.importDeclaration();
		if (this.isName("export")) {
			this.next();
			if (this.isName("default") || this.is("{") || this.is("*"))
				throw excluded("default-export", start, this.tok.end);
			const declaration = this.declarationItem();
			return this.finish(
				{
					type: "ExportNamedDeclaration",
					declaration,
					specifiers: [],
					source: null,
					attributes: [],
				},
				start,
			);
		}
		return this.declarationItem();
	}
	declarationItem() {
		const t = this.tok;
		if (t.kind === "name") {
			const n = this.peek();
			switch (t.value) {
				case "const":
					return this.declaration("const");
				case "let":
					throw excluded("module-let", t.start, t.end);
				case "var":
					throw excluded("var-declaration", t.start, t.end);
				case "function": {
					this.next();
					if (this.is("*")) throw excluded("generator", t.start, this.tok.end);
					const id = this.bindingIdentifier();
					this.declare(id, false);
					return this.functionRest(t.start, id, "FunctionDeclaration");
				}
				case "async":
					throw excluded("async", t.start, n?.end ?? t.end);
				case "class":
					throw excluded("class-declaration", t.start, t.end);
				case "type":
					if (n?.kind === "name") return this.typeAlias();
					break;
				case "interface":
					if (n?.kind === "name") return this.interfaceDeclaration();
					break;
			}
		}
		const s = this.lookahead(() => this.statement(false)) || { start: t.start, end: t.end };
		throw excluded("module-statement", t.start, s.end ?? t.end);
	}
	typeName() {
		const t = this.tok;
		if (t.kind !== "name" || KEYWORD_SET.has(t.value) || TYPE_KEYWORD_NAMES.has(t.value))
			throw this.unexpected("expected a type name");
		this.next();
		if (this.typeNames.has(t.value))
			throw syntaxError(`the type ${t.value} is already declared`, t.start, t.end);
		this.typeNames.add(t.value);
		if (this.is("<")) throw excluded("generic-type", t.start, this.tok.end);
		return this.finish({ type: "Identifier", name: t.value }, t.start);
	}
	typeAlias() {
		const start = this.tok.start;
		this.next(); // type
		const id = this.typeName();
		this.expect("=");
		const typeAnnotation = this.type();
		this.semicolon();
		return this.finish({ type: "TypeAlias", id, typeAnnotation }, start);
	}
	interfaceDeclaration() {
		const start = this.tok.start;
		this.next(); // interface
		const id = this.typeName();
		if (this.isName("extends")) throw excluded("generic-type", this.tok.start, this.tok.end);
		if (!this.is("{")) throw this.unexpected("expected {");
		const body = this.objectType();
		return this.finish({ type: "InterfaceDeclaration", id, body }, start);
	}
	importDeclaration() {
		const start = this.tok.start;
		this.next(); // import
		let importKind = "value";
		if (this.isName("type") && this.peek()?.kind === "punct" && this.peek().value === "{") {
			this.next();
			importKind = "type";
		}
		if (this.tok.kind === "string" || this.is("*"))
			throw excluded("namespace-import", start, this.tok.end);
		if (!this.is("{")) throw excluded("default-export", start, this.tok.end);
		this.next();
		const specifiers = [];
		while (!this.is("}")) {
			const sstart = this.tok.start;
			const it = this.tok;
			if (it.kind !== "name") throw this.unexpected("expected a name to import");
			this.next();
			const imported = this.finish({ type: "Identifier", name: it.value }, it.start);
			let local = { ...imported };
			if (this.isName("as")) {
				this.next();
				local = this.bindingIdentifier();
			}
			if (importKind === "type") {
				if (this.typeNames.has(local.name))
					throw syntaxError(`the type ${local.name} is already declared`, local.start, local.end);
				this.typeNames.add(local.name);
			} else this.declare(local, false);
			specifiers.push(this.finish({ type: "ImportSpecifier", imported, local }, sstart));
			if (!this.is("}")) this.expect(",");
		}
		this.next();
		if (!this.isName("from")) throw this.unexpected("expected from");
		this.next();
		const s = this.tok;
		if (s.kind !== "string") throw this.unexpected("expected where to import from");
		this.next();
		const source = this.finish({ type: "Literal", value: s.value, raw: s.raw }, s.start);
		this.semicolon();
		return this.finish(
			{ type: "ImportDeclaration", importKind, specifiers, source, attributes: [] },
			start,
		);
	}
	functionRest(start, id, type = "FunctionExpression") {
		this.pushScope(true);
		const thisType = this.thisParam();
		const params = this.params(thisType !== null);
		const returnType = this.eat(":") ? this.type() : null;
		const body = this.functionBody();
		this.popScope();
		const node = {
			type,
			id,
			expression: false,
			generator: false,
			async: false,
			params,
			body,
		};
		if (thisType !== null) node.thisType = thisType;
		if (returnType !== null) node.returnType = returnType;
		return this.finish(node, start);
	}
	// TypeScript's this parameter, (this: T, ...): what this is, erased as types are. Only a
	// module's functions have one.
	thisParam() {
		if (!this.moduleGoal || !this.is("(")) return null;
		const at = this.lookahead(() => {
			this.next();
			return this.isName("this") ? this.tok : null;
		});
		if (!at) return null;
		this.next(); // (
		this.next(); // this
		if (!this.eat(":")) throw this.unexpected("expected : after this");
		const t = this.type();
		if (!this.is(")")) this.expect(",");
		return t;
	}
	params(open = false) {
		if (!open) this.expect("(");
		const params = [];
		while (!this.is(")")) {
			params.push(this.bindingElement(true));
			if (!this.is(")")) this.expect(",");
		}
		this.next();
		for (const p of params) this.declarePattern(p, true);
		return params;
	}
	functionBody() {
		const start = this.tok.start;
		this.expect("{");
		const loops = this.loops;
		this.loops = 0;
		const body = [];
		let prologue = true;
		while (!this.is("}")) {
			if (this.tok.kind === "eof") throw this.unexpected("expected }");
			const stmt = this.statement(false);
			if (
				prologue &&
				stmt.type === "ExpressionStatement" &&
				stmt.expression.type === "Literal" &&
				typeof stmt.expression.value === "string" &&
				!this.parenthesized.has(stmt.expression)
			) {
				stmt.directive = stmt.expression.raw.slice(1, -1);
			} else prologue = false;
			body.push(stmt);
		}
		this.next();
		this.loops = loops;
		return this.finish({ type: "BlockStatement", body }, start);
	}

	// Statements.
	statement(single) {
		const t = this.tok;
		const start = t.start;
		if (t.kind === "punct") {
			if (t.value === "{") return this.block();
			if (t.value === ";") throw excluded("empty-statement", start, t.end);
		}
		if (t.kind === "name") {
			switch (t.value) {
				case "const":
					if (single) throw syntaxError("a declaration can't be a single statement", start, t.end);
					return this.declaration("const");
				case "let": {
					const n = this.peek();
					if (
						n &&
						(n.kind === "name" || (n.kind === "punct" && (n.value === "[" || n.value === "{")))
					) {
						if (single)
							throw syntaxError("a declaration can't be a single statement", start, t.end);
						return this.declaration("let");
					}
					break;
				}
				case "var":
					throw excluded("var-declaration", start, t.end);
				case "if":
					return this.ifStatement();
				case "return":
					return this.returnStatement();
				case "for":
					return this.forStatement();
				case "while":
				case "do":
					throw excluded("loop-statement", start, t.end);
				case "switch":
					throw excluded("switch-statement", start, t.end);
				case "try":
					return this.tryStatement();
				case "throw":
					return this.throwStatement();
				case "break":
				case "continue":
					return this.loopControl();
				case "function":
					throw excluded("function-declaration", start, t.end);
				case "class":
					throw excluded("class-declaration", start, t.end);
				case "export":
					throw excluded("module-syntax", start, t.end);
				case "import": {
					const n = this.peek();
					if (!(n?.kind === "punct" && (n.value === "(" || n.value === ".")))
						throw excluded("module-syntax", start, t.end);
					break;
				}
				case "with":
					throw excluded("with-statement", start, t.end);
				case "debugger":
					throw excluded("debugger-statement", start, t.end);
				case "async": {
					const n = this.peek();
					if (n?.kind === "name" && n.value === "function" && !n.newlineBefore)
						throw excluded("async", start, n.end);
					break;
				}
				default: {
					const n = this.peek();
					if (!KEYWORD_SET.has(t.value) && n?.kind === "punct" && n.value === ":")
						throw excluded("labeled-statement", start, n.end);
				}
			}
		}
		const expression = this.expression();
		this.semicolon();
		return this.finish({ type: "ExpressionStatement", expression }, start);
	}
	semicolon() {
		if (this.eat(";")) return;
		const t = this.tok;
		if (t.kind === "eof" || this.is("}") || t.newlineBefore)
			throw excluded("missing-semicolon", this.prevEnd, this.prevEnd);
		throw this.unexpected("expected ;");
	}
	block() {
		const start = this.tok.start;
		this.expect("{");
		this.pushScope(false);
		const body = [];
		while (!this.is("}")) {
			if (this.tok.kind === "eof") throw this.unexpected("expected }");
			body.push(this.statement(false));
		}
		this.next();
		this.popScope();
		return this.finish({ type: "BlockStatement", body }, start);
	}
	declaration(kind) {
		const start = this.tok.start;
		this.next();
		const declarations = [];
		do {
			const dstart = this.tok.start;
			const id = this.bindingTarget();
			if (this.eat(":")) id.typeAnnotation = this.type();
			let init = null;
			if (this.eat("=")) init = this.assign();
			else if (kind === "const") throw syntaxError("a const needs a value", dstart, this.prevEnd);
			declarations.push(this.finish({ type: "VariableDeclarator", id, init }, dstart));
			this.declarePattern(id, false);
		} while (this.eat(","));
		this.semicolon();
		return this.finish({ type: "VariableDeclaration", declarations, kind }, start);
	}
	ifStatement() {
		const start = this.tok.start;
		this.next();
		this.expect("(");
		const test = this.expression();
		this.expect(")");
		const consequent = this.statement(true);
		let alternate = null;
		if (this.isName("else")) {
			this.next();
			alternate = this.statement(true);
		}
		return this.finish({ type: "IfStatement", test, consequent, alternate }, start);
	}
	returnStatement() {
		const start = this.tok.start;
		this.next();
		let argument = null;
		if (!this.is(";")) {
			if (this.tok.kind === "eof" || this.is("}"))
				throw excluded("missing-semicolon", this.prevEnd, this.prevEnd);
			if (this.tok.newlineBefore) throw excluded("line-break-after-return", start, this.tok.start);
			argument = this.expression();
		}
		this.semicolon();
		return this.finish({ type: "ReturnStatement", argument }, start);
	}
	forStatement() {
		const start = this.tok.start;
		this.next();
		if (this.isName("await")) throw excluded("async", start, this.tok.end);
		this.expect("(");
		const kind = this.tok.kind === "name" ? this.tok.value : null;
		const isDecl = kind === "const" || kind === "let" || kind === "var";
		const isOf =
			isDecl &&
			this.lookahead(() => {
				this.next();
				this.bindingTarget();
				return this.isName("of");
			});
		const isIn =
			isDecl &&
			this.lookahead(() => {
				this.next();
				this.bindingTarget();
				return this.isName("in");
			});
		if (isIn) throw excluded("for-in-statement", start, this.tok.end);
		if (!isOf) throw excluded("loop-statement", start, this.tok.end);
		if (kind === "var") throw excluded("var-declaration", this.tok.start, this.tok.end);
		this.pushScope(false);
		const lstart = this.tok.start;
		this.next();
		const dstart = this.tok.start;
		const id = this.bindingTarget();
		this.declarePattern(id, false);
		const declarator = this.finish({ type: "VariableDeclarator", id, init: null }, dstart);
		const left = this.finish(
			{ type: "VariableDeclaration", declarations: [declarator], kind },
			lstart,
		);
		this.next(); // of
		const right = this.assign();
		this.expect(")");
		this.loops++;
		const body = this.statement(true);
		this.loops--;
		this.popScope();
		return this.finish({ type: "ForOfStatement", await: false, left, right, body }, start);
	}
	tryStatement() {
		const start = this.tok.start;
		this.next();
		const block = this.block();
		let handler = null;
		let finalizer = null;
		if (this.isName("catch")) {
			const cstart = this.tok.start;
			this.next();
			this.pushScope(true);
			let param = null;
			if (this.eat("(")) {
				param = this.bindingTarget();
				this.declarePattern(param, true);
				this.expect(")");
			}
			const bstart = this.tok.start;
			this.expect("{");
			const body = [];
			while (!this.is("}")) {
				if (this.tok.kind === "eof") throw this.unexpected("expected }");
				body.push(this.statement(false));
			}
			this.next();
			this.popScope();
			const cbody = this.finish({ type: "BlockStatement", body }, bstart);
			handler = this.finish({ type: "CatchClause", param, body: cbody }, cstart);
		}
		if (this.isName("finally")) {
			this.next();
			finalizer = this.block();
		}
		if (handler === null && finalizer === null) throw this.unexpected("expected catch or finally");
		return this.finish({ type: "TryStatement", block, handler, finalizer }, start);
	}
	throwStatement() {
		const start = this.tok.start;
		this.next();
		if (this.tok.newlineBefore)
			throw syntaxError("a line break can't follow throw", start, this.tok.start);
		const argument = this.expression();
		this.semicolon();
		return this.finish({ type: "ThrowStatement", argument }, start);
	}
	loopControl() {
		const start = this.tok.start;
		const kind = this.tok.value;
		this.next();
		if (this.tok.kind === "name" && !this.tok.newlineBefore)
			throw excluded("labeled-statement", start, this.tok.end);
		if (this.loops === 0)
			throw syntaxError(`${kind} is only allowed in a loop`, start, this.prevEnd);
		this.semicolon();
		return this.finish(
			{ type: kind === "break" ? "BreakStatement" : "ContinueStatement", label: null },
			start,
		);
	}

	// Patterns.
	bindingIdentifier() {
		const t = this.tok;
		if (t.kind !== "name" || KEYWORD_SET.has(t.value)) throw this.unexpected("expected a name");
		this.next();
		const id = this.finish({ type: "Identifier", name: t.value }, t.start);
		this.checkBindable(id);
		return id;
	}
	bindingTarget() {
		if (this.is("[")) return this.arrayPattern();
		if (this.is("{")) return this.objectPattern();
		return this.bindingIdentifier();
	}
	// A parameter or pattern element: a target, with a type when it's a parameter, a default.
	bindingElement(isParam) {
		const start = this.tok.start;
		if (this.is("...")) {
			this.next();
			const argument = this.bindingTarget();
			const rest = this.finish({ type: "RestElement", argument }, start);
			if (isParam && this.eat(":")) rest.typeAnnotation = this.type();
			return rest;
		}
		const target = this.bindingTarget();
		if (isParam && this.is("?")) throw excluded("optional-parameter", this.tok.start, this.tok.end);
		if (isParam && this.eat(":")) target.typeAnnotation = this.type();
		if (this.eat("=")) {
			const right = this.assign();
			return this.finish({ type: "AssignmentPattern", left: target, right }, start);
		}
		return target;
	}
	arrayPattern() {
		const start = this.tok.start;
		this.next();
		const elements = [];
		while (!this.is("]")) {
			if (this.is(",")) {
				this.next();
				elements.push(null);
				continue;
			}
			const el = this.bindingElement(false);
			elements.push(el);
			if (el.type === "RestElement" && !this.is("]"))
				throw this.unexpected("a rest element must be last");
			if (!this.is("]")) this.expect(",");
		}
		this.next();
		return this.finish({ type: "ArrayPattern", elements }, start);
	}
	objectPattern() {
		const start = this.tok.start;
		this.next();
		const properties = [];
		while (!this.is("}")) {
			const pstart = this.tok.start;
			if (this.is("...")) {
				this.next();
				const argument = this.bindingIdentifier();
				properties.push(this.finish({ type: "RestElement", argument }, pstart));
			} else {
				const { key, computed } = this.propertyKey();
				let value;
				let shorthand = false;
				if (this.eat(":")) {
					value = this.bindingElement(false);
				} else {
					if (computed || key.type !== "Identifier" || KEYWORD_SET.has(key.name))
						throw this.unexpected("expected :");
					shorthand = true;
					const copy = { ...key };
					this.checkBindable(copy);
					value = this.eat("=")
						? this.finish({ type: "AssignmentPattern", left: copy, right: this.assign() }, pstart)
						: copy;
				}
				properties.push(
					this.finish(
						{ type: "Property", method: false, shorthand, computed, key, value, kind: "init" },
						pstart,
					),
				);
			}
			if (!this.is("}")) this.expect(",");
		}
		this.next();
		return this.finish({ type: "ObjectPattern", properties }, start);
	}
	propertyKey() {
		const t = this.tok;
		if (this.is("[")) {
			this.next();
			const key = this.assign();
			this.expect("]");
			return { key, computed: true };
		}
		if (t.kind === "name") {
			this.next();
			return { key: this.finish({ type: "Identifier", name: t.value }, t.start), computed: false };
		}
		if (t.kind === "string" || t.kind === "num") {
			this.next();
			return {
				key: this.finish({ type: "Literal", value: t.value, raw: t.raw }, t.start),
				computed: false,
			};
		}
		if (this.is("#")) throw excluded("private-name", t.start, t.end);
		throw this.unexpected("expected a property name");
	}

	// Expressions.
	expression() {
		const expr = this.assign();
		if (this.is(",")) throw excluded("sequence", expr.start, this.tok.end);
		return expr;
	}
	arrowAhead() {
		const t = this.tok;
		if (t.kind === "name" && !KEYWORD_SET.has(t.value)) {
			const n = this.peek();
			return n?.kind === "punct" && n.value === "=>";
		}
		return this.is("(") && this.parenArrowAhead();
	}
	arrow() {
		const start = this.tok.start;
		this.pushScope(true);
		let params;
		if (this.tok.kind === "name") {
			params = [this.bindingIdentifier()];
			this.declarePattern(params[0], true);
		} else params = this.params();
		const returnType = this.eat(":") ? this.type() : null;
		if (this.tok.newlineBefore)
			throw syntaxError("a line break can't come before =>", this.tok.start, this.tok.end);
		this.expect("=>");
		let body;
		let expression;
		if (this.is("{")) {
			body = this.functionBody();
			expression = false;
		} else {
			const loops = this.loops;
			this.loops = 0;
			body = this.assign();
			this.loops = loops;
			expression = true;
		}
		this.popScope();
		const node = {
			type: "ArrowFunctionExpression",
			id: null,
			expression,
			generator: false,
			async: false,
			params,
			body,
		};
		if (returnType !== null) node.returnType = returnType;
		return this.finish(node, start);
	}
	assign() {
		if (this.arrowAhead()) return this.arrow();
		if (this.isName("yield")) throw excluded("generator", this.tok.start, this.tok.end);
		const start = this.tok.start;
		const left = this.conditional();
		if (this.tok.kind === "punct" && ASSIGN.has(this.tok.value)) {
			const operator = this.tok.value;
			if (left.type === "ArrayExpression" || left.type === "ObjectExpression") {
				if (operator === "=") throw excluded("destructuring-assignment", left.start, left.end);
				throw syntaxError("invalid assignment target", left.start, left.end);
			}
			if (left.type !== "Identifier" && left.type !== "MemberExpression")
				throw syntaxError("invalid assignment target", left.start, left.end);
			if (left.type === "Identifier") this.checkBindable(left);
			this.next();
			const right = this.assign();
			return this.finish({ type: "AssignmentExpression", operator, left, right }, start);
		}
		return left;
	}
	conditional() {
		const start = this.tok.start;
		const test = this.binary();
		if (!this.eat("?")) return test;
		const consequent = this.assign();
		this.expect(":");
		const alternate = this.assign();
		return this.finish({ type: "ConditionalExpression", test, consequent, alternate }, start);
	}
	binop() {
		const t = this.tok;
		if (t.kind === "punct" && t.value in PREC) return t.value;
		if (t.kind === "name" && (t.value === "in" || t.value === "instanceof")) return t.value;
		return null;
	}
	binary() {
		const start = this.tok.start;
		return this.binaryRest(this.unary(), start, -1);
	}
	binaryRest(left, leftStart, minPrec) {
		const op = this.binop();
		if (op === null) return left;
		let prec = PREC[op];
		if (prec <= minPrec) return left;
		if (op === "**") throw excluded("exponent", this.tok.start, this.tok.end);
		const logical = op === "||" || op === "&&";
		const coalesce = op === "??";
		if (coalesce) prec = PREC["&&"];
		this.next();
		const rightStart = this.tok.start;
		const right = this.binaryRest(this.unary(), rightStart, prec);
		const type = logical || coalesce ? "LogicalExpression" : "BinaryExpression";
		const node = this.finish({ type, left, operator: op, right }, leftStart);
		const nextOp = this.binop();
		if ((logical && nextOp === "??") || (coalesce && (nextOp === "||" || nextOp === "&&")))
			throw syntaxError(
				"?? can't be mixed with || or && without parentheses",
				this.tok.start,
				this.tok.end,
			);
		return this.binaryRest(node, leftStart, minPrec);
	}
	unary() {
		const t = this.tok;
		const start = t.start;
		const isUnary =
			(t.kind === "punct" &&
				(t.value === "!" || t.value === "-" || t.value === "+" || t.value === "~")) ||
			(t.kind === "name" && (t.value === "typeof" || t.value === "void" || t.value === "delete"));
		if (isUnary) {
			this.next();
			const argument = this.unary();
			if (this.is("**")) throw excluded("exponent", this.tok.start, this.tok.end);
			return this.finish(
				{ type: "UnaryExpression", operator: t.value, prefix: true, argument },
				start,
			);
		}
		if (this.is("++") || this.is("--")) {
			this.next();
			const argument = this.unary();
			this.checkUpdateTarget(argument);
			return this.finish(
				{ type: "UpdateExpression", operator: t.value, prefix: true, argument },
				start,
			);
		}
		if (this.isName("await")) throw excluded("async", start, t.end);
		let expr = this.subscripts(this.atom(), start);
		if ((this.is("++") || this.is("--")) && !this.tok.newlineBefore) {
			const operator = this.tok.value;
			this.checkUpdateTarget(expr);
			this.next();
			expr = this.finish(
				{ type: "UpdateExpression", operator, prefix: false, argument: expr },
				start,
			);
		}
		return expr;
	}
	checkUpdateTarget(node) {
		if (node.type !== "Identifier" && node.type !== "MemberExpression")
			throw syntaxError("invalid update target", node.start, node.end);
	}
	subscripts(base, start) {
		let expr = base;
		let chained = false;
		for (;;) {
			if (this.is(".")) {
				this.next();
				const property = this.memberName();
				expr = this.finish(
					{ type: "MemberExpression", object: expr, property, computed: false, optional: false },
					start,
				);
			} else if (this.is("?.")) {
				chained = true;
				this.next();
				if (this.is("(")) {
					const args = this.callArguments();
					expr = this.finish(
						{ type: "CallExpression", callee: expr, arguments: args, optional: true },
						start,
					);
				} else if (this.is("[")) {
					this.next();
					const property = this.expression();
					this.expect("]");
					expr = this.finish(
						{ type: "MemberExpression", object: expr, property, computed: true, optional: true },
						start,
					);
				} else if (this.tok.kind === "template") {
					throw syntaxError("a template can't follow ?.", this.tok.start, this.tok.end);
				} else {
					const property = this.memberName();
					expr = this.finish(
						{ type: "MemberExpression", object: expr, property, computed: false, optional: true },
						start,
					);
				}
			} else if (this.is("[")) {
				this.next();
				const property = this.expression();
				this.expect("]");
				expr = this.finish(
					{ type: "MemberExpression", object: expr, property, computed: true, optional: false },
					start,
				);
			} else if (this.is("(")) {
				const args = this.callArguments();
				expr = this.finish(
					{ type: "CallExpression", callee: expr, arguments: args, optional: false },
					start,
				);
			} else if (this.tok.kind === "template" && this.tok.head) {
				throw excluded("tagged-template", start, this.tok.end);
			} else if (this.is("!") && !this.tok.newlineBefore) {
				throw excluded("type-assertion", start, this.tok.end);
			} else if ((this.isName("as") || this.isName("satisfies")) && !this.tok.newlineBefore) {
				throw excluded("type-assertion", start, this.tok.end);
			} else break;
		}
		if (chained) expr = this.finish({ type: "ChainExpression", expression: expr }, start);
		return expr;
	}
	memberName() {
		const t = this.tok;
		if (this.is("#")) throw excluded("private-name", t.start, t.end);
		if (t.kind !== "name") throw this.unexpected("expected a property name");
		this.next();
		return this.finish({ type: "Identifier", name: t.value }, t.start);
	}
	callArguments() {
		this.expect("(");
		const args = [];
		while (!this.is(")")) {
			if (this.is("...")) {
				const start = this.tok.start;
				this.next();
				const argument = this.assign();
				args.push(this.finish({ type: "SpreadElement", argument }, start));
			} else args.push(this.assign());
			if (!this.is(")")) this.expect(",");
		}
		this.next();
		return args;
	}
	atom() {
		const t = this.tok;
		const start = t.start;
		switch (t.kind) {
			case "name":
				switch (t.value) {
					case "this":
						this.next();
						return this.finish({ type: "ThisExpression" }, start);
					case "null":
						this.next();
						return this.finish({ type: "Literal", value: null, raw: "null" }, start);
					case "true":
					case "false":
						this.next();
						return this.finish({ type: "Literal", value: t.value === "true", raw: t.value }, start);
					case "function":
						throw excluded("function-expression", start, t.end);
					case "class":
						throw excluded("class", start, t.end);
					case "new": {
						const n = this.peek();
						if (n?.kind === "punct" && n.value === ".")
							throw excluded("meta-property", start, n.end);
						throw excluded("new", start, t.end);
					}
					case "super":
						throw excluded("super", start, t.end);
					case "import": {
						const n = this.peek();
						throw excluded(n?.value === "." ? "meta-property" : "dynamic-import", start, t.end);
					}
					case "async": {
						const n = this.peek();
						if (n && !n.newlineBefore && (n.value === "function" || n.kind === "name"))
							throw excluded("async", start, n.end);
						break;
					}
				}
				if (KEYWORD_SET.has(t.value)) throw this.unexpected();
				this.next();
				return this.finish({ type: "Identifier", name: t.value }, start);
			case "num":
			case "string":
				this.next();
				return this.finish({ type: "Literal", value: t.value, raw: t.raw }, start);
			case "template":
				return this.template();
			case "punct":
				switch (t.value) {
					case "(": {
						this.next();
						const expr = this.expression();
						this.expect(")");
						this.parenthesized.add(expr);
						return expr;
					}
					case "[":
						return this.arrayLiteral();
					case "{":
						return this.objectLiteral();
					case "/":
					case "/=":
						throw excluded("regex", start, t.end);
					case "#":
						throw excluded("private-name", start, t.end);
					case "@":
						throw excluded("decorator", start, t.end);
					case "<":
						throw excluded("type-assertion", start, t.end);
				}
		}
		throw this.unexpected();
	}
	template() {
		const start = this.tok.start;
		const quasis = [];
		const expressions = [];
		for (;;) {
			const t = this.tok;
			if (t.kind !== "template") throw this.unexpected("expected } in the template");
			quasis.push({
				type: "TemplateElement",
				start: t.valueStart,
				end: t.valueEnd,
				value: { raw: t.raw, cooked: t.value },
				tail: t.tail,
			});
			this.next();
			if (t.tail) break;
			expressions.push(this.expression());
		}
		return this.finish({ type: "TemplateLiteral", expressions, quasis }, start);
	}
	arrayLiteral() {
		const start = this.tok.start;
		this.next();
		const elements = [];
		while (!this.is("]")) {
			if (this.is(",")) {
				this.next();
				elements.push(null);
				continue;
			}
			if (this.is("...")) {
				const sstart = this.tok.start;
				this.next();
				const argument = this.assign();
				elements.push(this.finish({ type: "SpreadElement", argument }, sstart));
			} else elements.push(this.assign());
			if (!this.is("]")) this.expect(",");
		}
		this.next();
		return this.finish({ type: "ArrayExpression", elements }, start);
	}
	objectLiteral() {
		const start = this.tok.start;
		this.next();
		const properties = [];
		while (!this.is("}")) {
			const pstart = this.tok.start;
			if (this.is("...")) {
				this.next();
				const argument = this.assign();
				properties.push(this.finish({ type: "SpreadElement", argument }, pstart));
			} else {
				if (this.isName("get") || this.isName("set") || this.isName("async")) {
					const n = this.peek();
					if (n && (n.kind !== "punct" || n.value === "[" || n.value === "*")) {
						if (this.moduleGoal && this.isName("get") && n.kind === "name") {
							this.next();
							const { key } = this.propertyKey();
							const value = this.functionRest(this.tok.start, null);
							if (value.params.length > 0)
								throw syntaxError("a getter takes no parameters", value.start, value.end);
							properties.push(
								this.finish(
									{
										type: "Property",
										method: false,
										shorthand: false,
										computed: false,
										key,
										value,
										kind: "get",
									},
									pstart,
								),
							);
							if (!this.is("}")) this.expect(",");
							continue;
						}
						throw excluded(this.isName("async") ? "async" : "object-method", pstart, n.end);
					}
				}
				if (this.is("*")) throw excluded("generator", pstart, this.tok.end);
				const { key, computed } = this.propertyKey();
				if (this.is("(")) {
					if (!this.moduleGoal || computed) throw excluded("object-method", pstart, this.tok.end);
					const value = this.functionRest(this.tok.start, null);
					properties.push(
						this.finish(
							{
								type: "Property",
								method: true,
								shorthand: false,
								computed: false,
								key,
								value,
								kind: "init",
							},
							pstart,
						),
					);
					if (!this.is("}")) this.expect(",");
					continue;
				}
				let value;
				let shorthand = false;
				if (this.eat(":")) value = this.assign();
				else if (!computed && key.type === "Identifier" && (this.is(",") || this.is("}"))) {
					if (KEYWORD_SET.has(key.name))
						throw syntaxError(`${key.name} is a keyword`, key.start, key.end);
					shorthand = true;
					value = { ...key };
				} else throw this.unexpected("expected :");
				properties.push(
					this.finish(
						{ type: "Property", method: false, shorthand, computed, key, value, kind: "init" },
						pstart,
					),
				);
			}
			if (!this.is("}")) this.expect(",");
		}
		this.next();
		return this.finish({ type: "ObjectExpression", properties }, start);
	}

	// Types: what TypeScript writes after a colon, as far as pure-js reads it. Hosts declare
	// with the same grammar, so it also has function types, generics and methods.
	type() {
		if (this.is("<")) return this.functionType();
		if (this.is("(") && this.parenArrowAhead()) return this.functionType();
		return this.unionType();
	}
	typeParams() {
		const names = [];
		if (!this.eat("<")) return names;
		while (!this.is(">")) {
			const t = this.tok;
			if (t.kind !== "name") throw this.unexpected("expected a type parameter");
			this.next();
			if (this.isName("extends")) throw excluded("generic-type", t.start, this.tok.end);
			names.push(t.value);
			if (!this.is(">")) this.expect(",");
		}
		this.next();
		return names;
	}
	typeParamList() {
		this.expect("(");
		const params = [];
		while (!this.is(")")) {
			const start = this.tok.start;
			const rest = this.eat("...");
			const t = this.tok;
			if (t.kind !== "name") throw this.unexpected("expected a parameter name");
			this.next();
			const optional = this.eat("?");
			this.expect(":");
			const value = this.type();
			params.push(this.finish({ type: "TypeParam", name: t.value, optional, rest, value }, start));
			if (!this.is(")")) this.expect(",");
		}
		this.next();
		return params;
	}
	functionType() {
		const start = this.tok.start;
		const typeParams = this.typeParams();
		const params = this.typeParamList();
		this.expect("=>");
		const result = this.type();
		return this.finish({ type: "TypeFunction", typeParams, params, result }, start);
	}
	unionType() {
		const start = this.tok.start;
		this.eat("|");
		const first = this.arrayType();
		if (!this.is("|")) return first;
		const types = [first];
		while (this.eat("|")) types.push(this.arrayType());
		return this.finish({ type: "TypeUnion", types }, start);
	}
	arrayType() {
		const start = this.tok.start;
		let t = this.primaryType();
		while (this.is("[") && !this.tok.newlineBefore) {
			const n = this.peek();
			if (!(n?.kind === "punct" && n.value === "]")) break;
			this.next();
			this.next();
			t = this.finish({ type: "TypeArray", element: t }, start);
		}
		return t;
	}
	primaryType() {
		const t = this.tok;
		const start = t.start;
		if (t.kind === "name") {
			if (TYPE_KEYWORD_NAMES.has(t.value) || t.value === "null") {
				this.next();
				return this.finish({ type: "TypeKeyword", name: t.value }, start);
			}
			if (t.value === "true" || t.value === "false") {
				this.next();
				return this.finish({ type: "TypeLiteral", value: t.value === "true" }, start);
			}
			if (t.value === "readonly") {
				this.next();
				const operand = this.arrayType();
				return this.finish({ type: "TypeReadonly", operand }, start);
			}
			if (
				t.value === "typeof" ||
				t.value === "keyof" ||
				t.value === "infer" ||
				t.value === "unique"
			)
				throw excluded("type-keyword", start, t.end);
			if (KEYWORD_SET.has(t.value)) throw this.unexpected("expected a type");
			this.next();
			const args = [];
			if (this.eat("<")) {
				while (!this.is(">")) {
					args.push(this.type());
					if (!this.is(">")) this.expect(",");
				}
				this.next();
			}
			if (this.is(".")) throw excluded("generic-type", start, this.tok.end);
			return this.finish({ type: "TypeRef", name: t.value, args }, start);
		}
		if (t.kind === "string" || t.kind === "num") {
			this.next();
			return this.finish({ type: "TypeLiteral", value: t.value }, start);
		}
		if (this.is("-")) {
			this.next();
			if (this.tok.kind !== "num") throw this.unexpected("expected a number");
			const value = -this.tok.value;
			this.next();
			return this.finish({ type: "TypeLiteral", value }, start);
		}
		if (this.is("(")) {
			this.next();
			const inner = this.type();
			this.expect(")");
			return inner;
		}
		if (this.is("[")) {
			this.next();
			const elements = [];
			while (!this.is("]")) {
				elements.push(this.type());
				if (!this.is("]")) this.expect(",");
			}
			this.next();
			return this.finish({ type: "TypeTuple", elements }, start);
		}
		if (this.is("{")) return this.objectType();
		if (t.kind === "template") throw excluded("type-keyword", start, t.end);
		throw this.unexpected("expected a type");
	}
	objectType() {
		const start = this.tok.start;
		this.next();
		const members = [];
		while (!this.is("}")) {
			const mstart = this.tok.start;
			let readonly = false;
			if (this.isName("readonly")) {
				const n = this.peek();
				if (n && !(n.kind === "punct" && (n.value === ":" || n.value === "?" || n.value === "("))) {
					this.next();
					readonly = true;
				}
			}
			if (this.is("[")) {
				this.next();
				const k = this.tok;
				if (k.kind !== "name") throw this.unexpected("expected a key name");
				this.next();
				this.expect(":");
				const key = this.type();
				this.expect("]");
				this.expect(":");
				const value = this.type();
				members.push(this.finish({ type: "TypeIndex", keyName: k.value, key, value }, mstart));
			} else {
				const k = this.tok;
				if (k.kind !== "name" && k.kind !== "string")
					throw this.unexpected("expected a member name");
				this.next();
				const optional = this.eat("?");
				if (this.is("(") || this.is("<")) {
					const typeParams = this.typeParams();
					const params = this.typeParamList();
					this.expect(":");
					const result = this.type();
					members.push(
						this.finish(
							{ type: "TypeMethod", name: k.value, optional, typeParams, params, result },
							mstart,
						),
					);
				} else {
					this.expect(":");
					const value = this.type();
					members.push(
						this.finish({ type: "TypeProperty", name: k.value, optional, readonly, value }, mstart),
					);
				}
			}
			if (!this.eat(";") && !this.eat(",") && !this.is("}") && !this.tok.newlineBefore)
				throw this.unexpected("expected ; or }");
		}
		this.next();
		return this.finish({ type: "TypeObject", members }, start);
	}
}

const failure = (error) => {
	if (error instanceof Stop) return { program: null, diagnostics: [error.diagnostic] };
	throw error;
};

// Parses one program: { program, diagnostics }, program null when there is a diagnostic.
export const parse = (source) => {
	try {
		const program = new Parser(source).program();
		return { program, diagnostics: [] };
	} catch (error) {
		return failure(error);
	}
};

// Parses a module: { module, diagnostics }, module null when there is a diagnostic.
export const parseModule = (source) => {
	try {
		const module = new Parser(source, { module: true }).module();
		return { module, diagnostics: [] };
	} catch (error) {
		if (error instanceof Stop) return { module: null, diagnostics: [error.diagnostic] };
		throw error;
	}
};

// Parses a type on its own, as hosts declare them: { type, diagnostics }.
export const parseType = (source) => {
	try {
		const p = new Parser(source);
		const type = p.type();
		if (p.tok.kind !== "eof") throw p.unexpected("expected the end of the type");
		return { type, diagnostics: [] };
	} catch (error) {
		if (error instanceof Stop) return { type: null, diagnostics: [error.diagnostic] };
		throw error;
	}
};

// A type's source, or a thrown error naming what is wrong with it: for declarations, which are
// the host's code and not a program's.
export const typeOf = (source, what = "type") => {
	const { type, diagnostics } = parseType(source);
	if (type === null) {
		const d = diagnostics[0];
		throw new Error(`${what} ${JSON.stringify(source)}: ${d.message} (at column ${d.start + 1})`);
	}
	return type;
};

export { Diagnostic };
