// Class names for CSS compilers that need them listed: the constant ones a view tree holds, and
// the computed ones as they show up in the DOM.
import { Walker } from "../tutuca.js";

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
	new ClassNames(classes).visit(tree);
	return classes;
};

// The class names the components use: the constant ones in views and those loops bind.
export const classNamesOf = (specs, extra = []) => {
	const classes = new Set(extra.flatMap((c) => c.split(/\s+/)));
	for (const spec of specs)
		for (const name in spec.views) collectClasses(spec.views[name], classes);
	return [...classes].filter(Boolean);
};

// Compiles the class names stories render that the static css lacks: views can compute
// classes in methods and loops, which collectClasses can't see. compile(classes) → css.
export class ClassCompiler {
	constructor(compile, known = []) {
		this.compile = compile;
		this.seen = new Set(known);
		this.styles = new Set();
		this.css = "";
		this.queued = false;
	}
	watch(rootNode, style) {
		this.styles.add(style);
		style.textContent = this.css;
		this.scan(rootNode);
	}
	scan(rootNode) {
		let added = false;
		for (const el of rootNode.querySelectorAll("[class]")) {
			for (const c of el.getAttribute("class").split(/\s+/)) {
				if (c !== "" && !this.seen.has(c)) {
					this.seen.add(c);
					added = true;
				}
			}
		}
		if (added && !this.queued) {
			this.queued = true;
			queueMicrotask(() => this.update());
		}
	}
	async update() {
		this.queued = false;
		this.css = await this.compile([...this.seen]);
		for (const style of this.styles) {
			if (style.isConnected) style.textContent = this.css;
			else this.styles.delete(style);
		}
	}
}
