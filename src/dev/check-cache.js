// CheckCache: a render cache that checks another one. Renders go to inner; after each one it
// renders again without a cache and asserts both are the same, and walks the tree with
// DepsWalker and asserts each component's recorded deps are the ones it finds. For dev and
// tests (TUTUCA_RENDER_CACHE=check:copy npm test); invariants are asserted at runtime.

import { RenderCache, samePlace, sameProvided } from "../core/view/render-cache.js";
import { RenderContext, renderView } from "../core/view/view.js";
import { childrenEqual, toVChildren } from "../vdom/index.js";
import { DepsWalker } from "./deps-walker.js";

const sameDeps = (recorded, walked) => {
	const byName = new Map(walked);
	return (
		recorded.length === byName.size &&
		recorded.every(([name, e]) => byName.has(name) && sameProvided(e, byName.get(name)))
	);
};

export class CheckCache extends RenderCache {
	constructor(inner) {
		super();
		this.inner = inner; // A DepsCache: its trace is what it hit or made in a render.
	}
	get usesSlots() {
		return this.inner.usesSlots;
	}
	get scope() {
		return this.inner.scope;
	}
	begin() {
		this.inner.begin();
		this.inner.trace = [];
	}
	render(instance, spec, view, ctx) {
		return this.inner.render(instance, spec, view, ctx);
	}
	fragment(result, wrapped, key, make) {
		return this.inner.fragment(result, wrapped, key, make);
	}
	end(root, target, vdom) {
		this.inner.end(root, target, vdom);
		const fresh = toVChildren(renderView(root, RenderContext.root(root, { target })));
		console.assert(childrenEqual(vdom, fresh), "A cached render differs from an uncached one");
		const traced = new Map();
		for (const entry of this.inner.trace) {
			const list = traced.get(entry.instance);
			if (list === undefined) traced.set(entry.instance, [entry]);
			else list.push(entry);
		}
		this.inner.trace = null;
		DepsWalker.depsOf(root, {
			target,
			onComponent(instance, view, ctx, deps) {
				// Not traced: under a hit, whose own deps cover it.
				const entry = traced.get(instance)?.find((e) => samePlace(e, view, ctx));
				if (entry === undefined) return;
				console.assert(
					sameDeps(entry.deps, deps),
					"A cached render's deps differ from DepsWalker's",
					{
						recorded: entry.deps.map(([name]) => name),
						walked: deps.map(([name]) => name),
					},
				);
			},
		});
	}
}
