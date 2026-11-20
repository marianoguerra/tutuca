// The tree: ESTree nodes as acorn makes them, so acorn is an oracle for the parser, plus a
// PureProgram root and the type annotations, which TypeScript allows where erasing them leaves
// JavaScript. The node kinds are a closed set: CHILDREN lists every kind and the fields that
// hold its children, which is what walking, erasing and the MoonBit port's enums need.

export const CHILDREN = Object.freeze({
	PureProgram: ["function"],
	PureModule: ["items"],
	ImportDeclaration: ["specifiers", "source"], // importKind: "type" or "value"
	ImportSpecifier: ["imported", "local"],
	ExportNamedDeclaration: ["declaration"],
	FunctionDeclaration: ["id", "thisType", "params", "returnType", "body"],
	TypeAlias: ["id", "typeAnnotation"],
	InterfaceDeclaration: ["id", "body"],
	FunctionExpression: ["id", "thisType", "params", "returnType", "body"],
	ArrowFunctionExpression: ["params", "returnType", "body"],
	BlockStatement: ["body"],
	ExpressionStatement: ["expression"],
	VariableDeclaration: ["declarations"],
	VariableDeclarator: ["id", "init"],
	IfStatement: ["test", "consequent", "alternate"],
	ReturnStatement: ["argument"],
	ForOfStatement: ["left", "right", "body"],
	TryStatement: ["block", "handler", "finalizer"],
	CatchClause: ["param", "body"],
	ThrowStatement: ["argument"],
	BreakStatement: [],
	ContinueStatement: [],
	Identifier: ["typeAnnotation"],
	Literal: [],
	ThisExpression: [],
	TemplateLiteral: ["quasis", "expressions"],
	TemplateElement: [],
	ArrayExpression: ["elements"],
	ObjectExpression: ["properties"],
	Property: ["key", "value"],
	SpreadElement: ["argument"],
	UnaryExpression: ["argument"],
	UpdateExpression: ["argument"],
	BinaryExpression: ["left", "right"],
	LogicalExpression: ["left", "right"],
	AssignmentExpression: ["left", "right"],
	ConditionalExpression: ["test", "consequent", "alternate"],
	CallExpression: ["callee", "arguments"],
	MemberExpression: ["object", "property"],
	ChainExpression: ["expression"],
	ArrayPattern: ["elements", "typeAnnotation"],
	ObjectPattern: ["properties", "typeAnnotation"],
	RestElement: ["argument", "typeAnnotation"],
	AssignmentPattern: ["left", "right"],
	// Types.
	TypeKeyword: [], // name: number, string, boolean, null, undefined, unknown, void, ...
	TypeLiteral: [], // value: a string, number or boolean
	TypeArray: ["element"],
	TypeTuple: ["elements"],
	TypeObject: ["members"],
	TypeProperty: ["value"], // name, optional, readonly
	TypeMethod: ["params", "result"], // name, typeParams
	TypeIndex: ["key", "value"], // keyName
	TypeUnion: ["types"],
	TypeRef: ["args"], // name
	TypeFunction: ["params", "result"], // typeParams
	TypeParam: ["value"], // name, optional, rest
	TypeReadonly: ["operand"],
});

const TYPE_FIELDS = Object.freeze(["typeAnnotation", "returnType", "thisType"]);

// Calls visit(node, parent, key) on node and every node under it, parents first. visit
// returning false skips the node's children.
export const walk = (node, visit, parent = null, key = null) => {
	if (node === null || node === undefined) return;
	if (visit(node, parent, key) === false) return;
	for (const field of CHILDREN[node.type] ?? []) {
		const child = node[field];
		if (Array.isArray(child)) {
			for (const c of child) walk(c, visit, node, field);
		} else if (child !== null && child !== undefined) walk(child, visit, node, field);
	}
};

// A copy of the tree without its type annotations: the JavaScript program it stands for.
export const erase = (node) => {
	if (node === null || node === undefined || typeof node !== "object") return node;
	if (Array.isArray(node)) return node.map(erase);
	const out = {};
	for (const key of Object.keys(node)) {
		if (TYPE_FIELDS.includes(key)) continue;
		const v = node[key];
		out[key] = v !== null && typeof v === "object" && key !== "value" ? erase(v) : v;
	}
	// A template element's value is { raw, cooked }, a literal's a plain value: both copy as is.
	if (node.type === "TemplateElement") out.value = { ...node.value };
	if (node.type === "Property") out.value = erase(node.value);
	return out;
};

// What a module item declares only for types: it goes when types are erased.
export const isTypeItem = (item) => {
	const d = item.type === "ExportNamedDeclaration" ? item.declaration : item;
	return (
		d.type === "TypeAlias" ||
		d.type === "InterfaceDeclaration" ||
		(d.type === "ImportDeclaration" && d.importKind === "type")
	);
};
// A module without its types: the JavaScript module it stands for.
export const eraseModule = (module) => {
	const out = erase(module);
	out.items = module.items.filter((i) => !isTypeItem(i)).map(erase);
	for (const i of out.items) if (i.type === "ImportDeclaration") delete i.importKind;
	return out;
};
// The declaration an item makes (an export's).
export const itemDeclaration = (item) =>
	item.type === "ExportNamedDeclaration" ? item.declaration : item;

// The names a pattern binds, in order.
export const boundNames = (pattern, out = []) => {
	if (pattern === null) return out;
	switch (pattern.type) {
		case "Identifier":
			out.push(pattern.name);
			break;
		case "ArrayPattern":
			for (const e of pattern.elements) boundNames(e, out);
			break;
		case "ObjectPattern":
			for (const p of pattern.properties)
				boundNames(p.type === "RestElement" ? p.argument : p.value, out);
			break;
		case "RestElement":
			boundNames(pattern.argument, out);
			break;
		case "AssignmentPattern":
			boundNames(pattern.left, out);
			break;
	}
	return out;
};
