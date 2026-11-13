// Rendering anything but a page is opt in. A component's renders.tui, renders.js, renders.md, ...
// are each for a render target, which the module that renders it defines (tuiTarget in
// tutuca/tui/target, jsTarget in tutuca/jsast/target, mdTarget in tutuca/mdast/target), and
// component() takes renders only for the targets enableTargets was given. Without it, tutuca
// renders view and views and nothing else, and carries none of the others' code.

export class RenderTarget {
	// fallsBackToViews: whether a component without renders for it shows its page views there
	// (a terminal does), instead of failing to render (JavaScript, markdown).
	constructor(name, { fallsBackToViews = false } = {}) {
		this.name = name;
		this.fallsBackToViews = fallsBackToViews;
		Object.freeze(this);
	}
}

const enabled = new Map();
// Lets components say what they render for each target: enableTargets(tuiTarget, jsTarget).
export const enableTargets = (...targets) => {
	for (const target of targets) {
		if (!(target instanceof RenderTarget)) {
			throw new TypeError(`enableTargets takes RenderTargets, not ${String(target)}`);
		}
		const other = enabled.get(target.name);
		if (other !== undefined && other !== target) {
			throw new Error(`another render target is enabled as ${target.name}`);
		}
		enabled.set(target.name, target);
	}
};
// The enabled target of that name, or null.
export const enabledTarget = (name) => enabled.get(name) ?? null;
export const enabledTargetNames = () => [...enabled.keys()];
