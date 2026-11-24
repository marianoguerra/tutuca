// A component this version of the app doesn't define, as a projection from elsewhere brings it:
// a peer registered it at runtime, or runs a newer version. It keeps the ref and the fields as
// they came, so it projects back unchanged and the ops peers send into it still land; once its
// ref resolves (the definition is registered here too), a rebuild makes the real one.
import { component } from "../core/component.js";
import { isUnknownComponent } from "../core/model/spec.js";
import { t } from "../core/model/types.js";
import { tag } from "../core/view/tag.js";
import { field } from "../core/view/view.js";

export { isUnknownComponent };
export const UnknownComponent = component({
	name: "UnknownComponent",
	fields: { ref: t.string(), data: t.any({ default: {} }) },
	view: tag.div(
		{
			class: "p-3 text-sm opacity-70",
			title: "Another peer defines it: it's kept as it came until it's defined here",
		},
		"🧩 ",
		field("ref"),
		" isn't defined here",
	),
});
UnknownComponent.unknown = true;

// The placeholder for plain, a projected component whose ref doesn't resolve, made in scope.
export const unknownComponent = (ref, plain, scope) => {
	const data = { ...plain };
	delete data.$;
	return UnknownComponent.make({ ref, data: structuredClone(data) }, scope);
};
// Its projection: the component as it came.
export const unknownPlain = (v) => ({ $: v.ref, ...structuredClone(v.data) });
