// Class names for CSS compilers that need them listed: the constant ones a view tree holds, and
// the ones a component declares its views compute (the classes meta, meta/classes.js).
import { declaredClassesOf } from "../meta/classes.js";
import { Walker } from "../tutuca.js";

// Constants are class names only while inside a class attribute; anything else there (a field,
// a query, a bind) computes one, which is noted in dynamic.
class ClassNames extends Walker {
	inClass = false;
	dynamic = [];
	constructor(classes) {
		super();
		this.classes = classes;
	}
	within(inClass, node) {
		const outer = this.inClass;
		this.inClass = inClass;
		this.visit(node);
		this.inClass = outer;
	}
	attr(_node, name, value) {
		this.within(name === "class", value);
	}
	constant(node) {
		if (!this.inClass || typeof node.value !== "string") return;
		for (const c of node.value.split(/\s+/)) if (c) this.classes.add(c);
	}
	// A condition picks a class, it isn't one.
	cond(node) {
		this.within(false, node.test);
		this.visit(node.thenVal);
		this.visit(node.elseVal);
	}
	node(node) {
		if (this.inClass) this.dynamic.push(node);
		else super.node(node);
	}
}

// The constant class names in a tree, including every $if branch, and the nodes that compute a
// class (classes: Set, dynamic: [ViewNode]), whose classes are only known at render time.
export const classUsesOf = (tree, classes = new Set()) => {
	const walker = new ClassNames(classes);
	walker.visit(tree);
	return { classes, dynamic: walker.dynamic };
};
// classUsesOf for the value of a class attribute.
export const classValueUsesOf = (value, classes = new Set()) => {
	const walker = new ClassNames(classes);
	walker.within(true, value);
	return { classes, dynamic: walker.dynamic };
};
// The constant class names in a tree, including every $if branch.
export const collectClasses = (tree, classes = new Set()) => classUsesOf(tree, classes).classes;

// The class names the components use: the constant ones in views and those they declare.
export const classNamesOf = (specs, extra = []) => {
	const classes = new Set(extra.flatMap((c) => c.split(/\s+/)));
	for (const spec of specs) {
		for (const name in spec.views) collectClasses(spec.views[name], classes);
		for (const c of declaredClassesOf(spec)) classes.add(c);
	}
	return [...classes].filter(Boolean);
};

// Compiles the class names of the components it's given into the <style>s it watches:
// compile(classes) → css. Compiles again only when components add class names it hasn't seen.
export class ClassCompiler {
	constructor(compile, known = []) {
		this.compile = compile;
		this.seen = new Set(known);
		this.styles = new Set();
		this.css = "";
		this.queued = false;
		this.compiled = false;
	}
	// Fills style with the css, compiling it first if it hasn't been yet.
	watch(style) {
		this.styles.add(style);
		style.textContent = this.css;
		if (!this.compiled) this.schedule();
		return this;
	}
	// Adds the class names of specs; compiles again, once per microtask, when any is new.
	add(specs) {
		let added = false;
		for (const c of classNamesOf(specs)) {
			if (!this.seen.has(c)) {
				this.seen.add(c);
				added = true;
			}
		}
		if (added) this.schedule();
		return added;
	}
	schedule() {
		if (this.queued) return;
		this.queued = true;
		queueMicrotask(() => this.update());
	}
	async update() {
		this.queued = false;
		this.compiled = true;
		this.css = await this.compile([...this.seen]);
		for (const style of this.styles) {
			if (style.isConnected) style.textContent = this.css;
			else this.styles.delete(style);
		}
	}
}
