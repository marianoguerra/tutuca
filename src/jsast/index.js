// tutuca/jsast (experimental): components that render JavaScript. A component's renders.js (one
// tree, or views by name with a main) says what it renders as an ESTree
// (https://github.com/estree/estree, ES2022), as its view (and views) say what it renders on a
// page; renderJsAst renders it, renderJs prints it.
//
// Rendering JavaScript is opt in: enableTargets(jsTarget) before component() takes a renders.js.
// A module that only declares components imports jsTarget and js from tutuca/jsast/target, which
// leaves out the renderer and its printer.
//
// Tags are ESTree, almost one to one: a PascalCase tag is a node of that type and its attrs are
// the node's scalar fields; a camelCase tag is a slot, one of the node fields of the node it's
// in, always named. A slot of one node holds one, an array slot any number (an each splices
// into it), and Hole() is a null in an array that has holes. field, $if, each, render and
// pushView work as in views, so a component renders its child components' renders.js into slots.
//
//   const { FunctionDeclaration, Identifier, BlockStatement, ReturnStatement, BinaryExpression,
//     Literal } = js;
//   const { id, params, body, argument, left, right } = js;
//   enableTargets(jsTarget);
//   const Adder = component({
//     name: "Adder",
//     fields: { fn: t.string("add"), n: t.number(1) },
//     renders: {
//       js: FunctionDeclaration(
//         id(Identifier({ name: field("fn") })),
//         params(Identifier({ name: "x" })),
//         body(BlockStatement(body(ReturnStatement(argument(BinaryExpression({ operator: "+" },
//           left(Identifier({ name: "x" })), right(Literal({ value: field("n") }))))))))),
//     },
//   });
//   renderJs(Adder.make()) // "function add(x) {\n  return x + 1;\n}"
//
// What's checked, against one table (schema.js): what a view says, when it's built (tags.js:
// types, attrs, slots, what a slot takes, as far as it's constant), and the tree it renders to,
// when it renders (lower.js, every node, with the path to it). Both throw a JsAstError. Rules
// of the language ESTree's shapes don't say (a const with no init, a break outside a loop) are
// not checked.
export { lower } from "./lower.js";
export { renderJs, renderJsAst } from "./render.js";
export {
	ASSIGNMENT_OPERATORS,
	BINARY_OPERATORS,
	HOLE,
	LOGICAL_OPERATORS,
	SCHEMA,
	UNARY_OPERATORS,
	UPDATE_OPERATORS,
} from "./schema.js";
export { JsAstError, js, jsTarget } from "./target.js";
