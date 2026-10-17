import { h } from "./view.js";

// Element builders: tag.div(attrs, ...childs) is h("div", attrs, ...childs), and attrs can be
// left out, as in tag.p("Hello"): a plain object first is attrs, children never are.
// Destructure the ones a view uses: const { div, p, span } = tag; tag["my-element"] works too.
const isAttrs = (v) =>
	v !== null && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype;
const build = (name, args) =>
	isAttrs(args[0]) ? h(name, args[0], ...args.slice(1)) : h(name, {}, ...args);
export const tag = new Proxy(Object.create(null), {
	get:
		(_target, name) =>
		(...args) =>
			build(name, args),
});

// A <button> that doesn't submit its form unless attrs say type: "submit".
export const button = (...args) => {
	const [attrs, childs] = isAttrs(args[0]) ? [args[0], args.slice(1)] : [{}, args];
	return h("button", { type: "button", ...attrs }, ...childs);
};
