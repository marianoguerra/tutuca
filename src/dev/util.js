import { h, Walker } from "../tutuca.js";

// Constants are class names only while inside a class attribute.
class ClassNames extends Walker {
	inClass = false;
	constructor(classes) {
		super();
		this.classes = classes;
	}
	attr(node, name, value) {
		const outer = this.inClass;
		this.inClass = name === "class";
		super.attr(node, name, value);
		this.inClass = outer;
	}
	constant(node) {
		if (!this.inClass || typeof node.value !== "string") return;
		for (const c of node.value.split(/\s+/)) if (c) this.classes.add(c);
	}
}

// The constant class names in a tree, including every $if branch; classes
// read from the state are only known at render time.
export const collectClasses = (tree, classes = new Set()) => {
	tree.walk(new ClassNames(classes));
	return classes;
};

// Element builders: tag.div(attrs, ...childs) is h("div", attrs, ...childs), and attrs can be
// left out, as in tag.p("Hello"): a plain object first is attrs, children never are.
// Destructure the ones a view uses: const { div, p, span } = tag; tag["my-element"] works too.
const isAttrs = (v) =>
	v !== null && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype;
export const tag = new Proxy(Object.create(null), {
	get:
		(_target, name) =>
		(...args) =>
			isAttrs(args[0]) ? h(name, args[0], ...args.slice(1)) : h(name, {}, ...args),
});
