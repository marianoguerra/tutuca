import { h } from "./view.js";

// Element builders: tag.div(attrs, ...children) is h("div", attrs, ...children), and attrs can be
// left out, as in tag.p("Hello"): a plain object first is attrs, children never are.
// Destructure the ones a view uses: const { div, p, span } = tag; tag["my-element"] works too.
export const isAttrs = (v) =>
	v !== null && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype;
// A builder's arguments as [attrs, children].
export const splitArgs = (args) => (isAttrs(args[0]) ? [args[0], args.slice(1)] : [{}, args]);
// Builders by name: tags.name(...args) is build(name, args). The render targets' tags (md, js,
// ps, ...) are made with it too.
export const tagProxy = (build) =>
	new Proxy(Object.create(null), {
		get: (_target, name) => (typeof name === "string" ? (...args) => build(name, args) : undefined),
	});
export const tag = tagProxy((name, args) => {
	const [attrs, children] = splitArgs(args);
	return h(name, attrs, ...children);
});

// A <button> that doesn't submit its form unless attrs say type: "submit".
export const button = (...args) => {
	const [attrs, children] = splitArgs(args);
	return h("button", { type: "button", ...attrs }, ...children);
};
