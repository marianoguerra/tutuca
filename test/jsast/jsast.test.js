// tutuca/jsast: components whose renders.js render ESTrees, checked when the tags are built and when
// they render, and printed to JavaScript that parses back to the same tree.
import assert from "node:assert/strict";
import test from "node:test";
import * as acorn from "acorn";
import { JsAstError, js, jsTarget, renderJs, renderJsAst } from "../../src/jsast/index.js";
import {
	$if,
	component,
	each,
	enableTargets,
	field,
	lookupBind,
	pushView,
	render,
	renderEach,
	Scope,
	t,
} from "../../src/tutuca.js";

enableTargets(jsTarget);

const {
	ArrayExpression,
	ArrowFunctionExpression,
	BinaryExpression,
	BlockStatement,
	BreakStatement,
	CallExpression,
	ClassBody,
	ClassDeclaration,
	ExportNamedDeclaration,
	ExpressionStatement,
	FunctionDeclaration,
	FunctionExpression,
	Hole,
	Identifier,
	ImportDeclaration,
	ImportSpecifier,
	Literal,
	MemberExpression,
	MethodDefinition,
	PrivateIdentifier,
	Program,
	PropertyDefinition,
	ReturnStatement,
	StaticBlock,
	SwitchCase,
	SwitchStatement,
	TemplateElement,
	TemplateLiteral,
	ThisExpression,
	VariableDeclaration,
	VariableDeclarator,
} = js;
const {
	argument,
	arguments: args,
	body,
	callee,
	cases,
	consequent,
	declaration,
	declarations,
	discriminant,
	elements,
	expression,
	expressions,
	id,
	imported,
	init,
	key,
	left,
	local,
	object,
	params,
	property,
	quasis,
	right,
	source,
	specifiers,
	test: testSlot,
	value: valueSlot,
} = js;

const scope = (specs) => {
	const s = new Scope();
	return s.register(specs);
};
const ident = (name) => Identifier({ name });
const lit = (value) => Literal({ value });

// What acorn reads back from the source, without what only a parser knows (positions, raw) and
// the fields it puts on every function, which ESTree has only on some: expression on arrows,
// id and generator on the others.
const plain = (node) => {
	if (Array.isArray(node)) return node.map(plain);
	if (node === null || typeof node !== "object") return node;
	const out = {};
	for (const [k, v] of Object.entries(node)) {
		if (k === "start" || k === "end" || k === "raw") continue;
		if (k === "expression" && /^Function/.test(node.type)) continue;
		if ((k === "id" || k === "generator") && node.type === "ArrowFunctionExpression") continue;
		out[k] = plain(v);
	}
	return out;
};
// The error fn throws, which must be a JsAstError.
const thrown = (fn) => {
	try {
		fn();
	} catch (error) {
		assert.ok(error instanceof JsAstError, error.stack);
		return error;
	}
	assert.fail("it didn't throw");
};
// The source prints, parses, and parses back to the tree that was rendered.
const roundTrips = (instance, opts) => {
	const tree = renderJsAst(instance, opts);
	const src = renderJs(instance, opts);
	const parsed = acorn.parse(src, { ecmaVersion: 2022, sourceType: "module" });
	const program = tree.type === "Program" ? parsed : parsed.body[0];
	assert.deepEqual(plain(program), plain(tree), src);
	return src;
};

const Adder = component({
	name: "Adder",
	fields: { fn: t.string("add"), n: t.number(1) },
	renders: {
		js: FunctionDeclaration(
			id(ident(field("fn"))),
			params(ident("x")),
			body(
				BlockStatement(
					body(
						ReturnStatement(
							argument(
								BinaryExpression(
									{ operator: "+" },
									left(ident("x")),
									right(Literal({ value: field("n") })),
								),
							),
						),
					),
				),
			),
		),
	},
});

test("a renders.js renders its fields into the ESTree it says", () => {
	const src = roundTrips(Adder.make({ fn: "inc", n: 5 }));
	assert.equal(src, "function inc(x) {\n  return x + 5;\n}");
});

test("tags are checked when they're built", () => {
	const fails = (make, ...expected) => {
		const error = thrown(make);
		for (const e of expected)
			assert.ok(
				error.issues.some((i) => i.includes(e)),
				`${e} in ${error.issues}`,
			);
		return true;
	};
	const built = (make) => {
		try {
			make();
			return null;
		} catch (error) {
			return error;
		}
	};
	assert.ok(built(() => js.Frobnicate()) instanceof JsAstError);
	fails(() => js.Frobnicate(), "unknown ESTree type Frobnicate");
	fails(() => Identifier({ name: "x", nmae: "y" }), "Identifier has no attr nmae");
	fails(() => Identifier({}), "Identifier needs attr name");
	fails(
		() => BinaryExpression({ operator: "+++" }, left(ident("a")), right(ident("b"))),
		"operator must be one of",
	);
	fails(() => Literal({ value: -1 }), "use a UnaryExpression");
	fails(() => ReturnStatement(ident("x")), "Identifier in ReturnStatement needs a slot");
	fails(() => ReturnStatement(left(ident("x"))), "ReturnStatement has no slot left");
	fails(
		() =>
			BinaryExpression({ operator: "+" }, left(ident("a")), left(ident("b")), right(ident("c"))),
		"BinaryExpression has slot left twice",
	);
	fails(
		() => ReturnStatement(argument(ReturnStatement())),
		"takes an Expression, not ReturnStatement",
	);
	fails(() => ReturnStatement(argument(ident("a"), ident("b"))), "holds one node");
	fails(() => ReturnStatement(argument("x")), "can't hold text");
	fails(
		() => BinaryExpression({ operator: "+" }, left(ident("a"))),
		"BinaryExpression needs slot right",
	);
	fails(() => ReturnStatement(argument(Hole())), "not a hole");
	fails(() => js.left({ x: 1 }), "slot left takes no attrs");
	fails(() => Identifier({ name: "a", "on:click": "x" }), "can't handle events");
	// What field, each or render give is checked when it renders.
	assert.equal(
		built(() => ReturnStatement(argument(field("x")))),
		null,
	);
	assert.equal(
		built(() => Identifier({ name: field("x") })),
		null,
	);
	assert.equal(
		built(() => ArrayExpression(elements(lit(1), Hole(), lit(2)))),
		null,
	);
});

test("the rendered tree is checked, every issue at its ESTree path", () => {
	// What a child renders is only known when it renders: a statement here.
	const Stmt = component({ name: "Stmt", renders: { js: BreakStatement() } });
	const Bad = component({
		name: "Bad",
		fields: {
			name: t.any(null),
			n: t.any(null),
			stmt: t.boolean(true),
			child: t.component("Stmt"),
		},
		renders: {
			js: Program(
				body(
					VariableDeclaration(
						{ kind: "const" },
						declarations(
							VariableDeclarator(
								id(Identifier({ name: field("name") })),
								init($if(field("stmt"), render(field("child")), Literal({ value: field("n") }))),
							),
						),
					),
				),
			),
		},
	});
	const C = scope({ Stmt, Bad });
	const error = thrown(() => renderJsAst(C.Bad({ name: 3, n: -2 })));
	assert.deepEqual(error.issues, [
		"Program.body[0].declarations[0].id: Identifier name must be a string, not 3",
		"Program.body[0].declarations[0].init: expected an Expression, got BreakStatement",
	]);
	const error2 = thrown(() => renderJsAst(C.Bad({ name: "x", n: -2, stmt: false })));
	assert.deepEqual(error2.issues, [
		"Program.body[0].declarations[0].init: Literal value -2 has no literal: use a UnaryExpression for a negative number",
	]);
	assert.equal(renderJs(C.Bad({ name: "x", n: 2, stmt: false })), "const x = 2;\n");
});

test("text from a field, a missing slot and an empty each are found when it renders", () => {
	const Call = component({
		name: "Call",
		fields: { fn: t.any(null), xs: t.array().default([]) },
		renders: {
			js: ExpressionStatement(
				expression(
					CallExpression(callee(field("fn")), args(each(field("xs"), lit(lookupBind("value"))))),
				),
			),
		},
	});
	const error = thrown(() => renderJsAst(Call.make({ fn: "f" })));
	assert.deepEqual(error.issues, [
		'ExpressionStatement.expression.callee: expected an Expression or a Super, got text "f"',
	]);
	const Seq = component({
		name: "Seq",
		fields: { xs: t.array().default([]) },
		renders: {
			js: js.SequenceExpression(expressions(each(field("xs"), lit(lookupBind("value"))))),
		},
	});
	assert.throws(() => renderJsAst(Seq.make()), /SequenceExpression needs at least one expression/);
});

test("each splices into an array slot", () => {
	const Arr = component({
		name: "Arr",
		fields: { xs: t.array().default([1, "two", true]) },
		renders: {
			js: ExpressionStatement(
				expression(
					ArrayExpression(elements(lit(1), Hole(), each(field("xs"), lit(lookupBind("value"))))),
				),
			),
		},
	});
	assert.equal(roundTrips(Arr.make()), '[1, , 1, "two", true];');
});

// A switch whose cases are child components, each rendering its own renders.js into the cases slot.
const Case = component({
	name: "Case",
	fields: { match: t.string(), result: t.number() },
	renders: {
		js: {
			main: SwitchCase(
				testSlot(Literal({ value: field("match") })),
				consequent(ReturnStatement(argument(Literal({ value: field("result") })))),
			),
			// A default case, for when the parent asks for it.

			fallback: SwitchCase(
				consequent(ReturnStatement(argument(Literal({ value: field("result") })))),
			),
		},
	},
});
const Lookup = component({
	name: "Lookup",
	fields: {
		name: t.string("lookup"),
		cases: t.array(t.component("Case")).default([]),
		fallback: t.component("Case"),
	},
	renders: {
		js: FunctionDeclaration(
			id(ident(field("name"))),
			params(ident("k")),
			body(
				BlockStatement(
					body(
						SwitchStatement(
							discriminant(ident("k")),
							cases(renderEach(field("cases")), render(field("fallback"), "fallback")),
						),
					),
				),
			),
		),
	},
});

test("render puts child components' renders.js into a slot, by view name too", () => {
	const C = scope({ Case, Lookup });
	const lookup = C.Lookup({
		cases: [C.Case({ match: "a", result: 1 }), C.Case({ match: "b", result: 2 })],
		fallback: C.Case({ result: 0 }),
	});
	const src = roundTrips(lookup);
	assert.equal(
		src,
		[
			"function lookup(k) {",
			"  switch (k) {",
			'    case "a":',
			"      return 1;",
			'    case "b":',
			"      return 2;",
			"    default:",
			"      return 0;",
			"  }",
			"}",
		].join("\n"),
	);
});

test("pushView picks a named js view, and a component without renders.js can't render", () => {
	const Greeting = component({
		name: "Greeting",
		fields: { who: t.string("world") },
		renders: {
			js: {
				main: ExpressionStatement(
					expression(
						CallExpression(callee(ident("greet")), args(Literal({ value: field("who") }))),
					),
				),

				template: ExpressionStatement(
					expression(
						TemplateLiteral(
							quasis(
								TemplateElement({ value: { raw: "hello ", cooked: "hello " } }),
								TemplateElement({ value: { raw: "!", cooked: "!" }, tail: true }),
							),
							expressions(ident(field("who"))),
						),
					),
				),
			},
		},
	});
	const Holder = component({
		name: "Holder",
		fields: { g: t.component("Greeting"), style: t.string("main") },
		renders: { js: Program(body(pushView(field("style"), render(field("g"))))) },
	});
	const C = scope({ Greeting, Holder });
	assert.equal(roundTrips(C.Holder({ style: "main" })), 'greet("world");\n');
	assert.equal(roundTrips(C.Holder({ style: "template" })), "`hello \u0024{world}!`;\n");
	assert.equal(roundTrips(C.Greeting(), { view: "template" }), "`hello \u0024{world}!`;");
	assert.throws(
		() => component({ name: "X", renders: { js: { other: ident("x") } } }),
		/X renders js views but no main one/,
	);
	const Plain = component({ name: "Plain" });
	assert.throws(() => renderJsAst(Plain.make()), /Plain has no js render/);
});

test("an ES2022 module with a class prints and parses back", () => {
	const Field = component({
		name: "Field",
		fields: { name: t.string(), initial: t.number(), private: t.boolean(false) },
		renders: {
			js: PropertyDefinition(
				key(
					$if(field("private"), PrivateIdentifier({ name: field("name") }), ident(field("name"))),
				),
				valueSlot(Literal({ value: field("initial") })),
			),
		},
	});
	const Module = component({
		name: "Module",
		fields: { className: t.string("Counter"), fields: t.array(t.component("Field")).default([]) },
		renders: {
			js: Program(
				{ sourceType: "module" },
				body(
					ImportDeclaration(
						specifiers(ImportSpecifier(imported(ident("log")), local(ident("log")))),
						source(lit("./log.js")),
					),
					ExportNamedDeclaration(
						declaration(
							ClassDeclaration(
								id(ident(field("className"))),
								body(
									ClassBody(
										body(
											renderEach(field("fields")),
											StaticBlock(
												body(
													ExpressionStatement(
														expression(CallExpression(callee(ident("log")), args(lit("loaded")))),
													),
												),
											),
											MethodDefinition(
												{ kind: "method" },
												key(ident("next")),
												valueSlot(
													FunctionExpression(
														body(
															BlockStatement(
																body(
																	ReturnStatement(
																		argument(
																			ArrowFunctionExpression(
																				body(
																					MemberExpression(
																						object(ThisExpression()),
																						property(PrivateIdentifier({ name: "n" })),
																					),
																				),
																			),
																		),
																	),
																),
															),
														),
													),
												),
											),
										),
									),
								),
							),
						),
					),
				),
			),
		},
	});
	const C = scope({ Field, Module });
	const src = roundTrips(
		C.Module({
			fields: [
				C.Field({ name: "n", initial: 0, private: true }),
				C.Field({ name: "step", initial: 1 }),
			],
		}),
	);
	assert.match(src, /#n = 0;/);
	assert.match(src, /static \{/);
});
