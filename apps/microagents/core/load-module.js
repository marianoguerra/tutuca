// Loads an agent's module from its source text. Agent modules import nothing (everything comes
// through define(kit)), so a data: URL works the same in browsers and in Node.
export const loadModule = (source) =>
	import(/* @vite-ignore */ `data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`);

// What define(kit) must return: { components, root, decode, encode }, with root the name of
// one of components; tools and asks are optional.
export const definitionProblems = (def) => {
	if (def === null || typeof def !== "object") return ["define(kit) must return an object"];
	const problems = [];
	if (def.components === null || typeof def.components !== "object") {
		problems.push("define(kit) must return components, an object of tutuca components");
	} else if (typeof def.root !== "string" || def.components[def.root] === undefined) {
		problems.push("define(kit) must return root, the name of one of its components");
	}
	for (const fn of ["decode", "encode"]) {
		if (typeof def[fn] !== "function") problems.push(`define(kit) must return a ${fn} function`);
	}
	if (def.toolViews !== undefined) {
		for (const [tool, name] of Object.entries(def.toolViews ?? {})) {
			if (typeof name !== "string" || def.components?.[name] === undefined) {
				problems.push(`toolViews.${tool} must name one of its components`);
			}
		}
	}
	for (const key of ["tools", "asks"]) {
		if (def[key] !== undefined && (def[key] === null || typeof def[key] !== "object")) {
			problems.push(`define(kit)'s ${key}, when given, must be an object of functions`);
		}
	}
	return problems;
};

// The definition the module at source makes with kit, or an Error saying what's wrong with it.
export const defineAgent = async (source, kit) => {
	let mod;
	try {
		mod = await loadModule(source);
	} catch (error) {
		throw new Error(`the module doesn't load: ${error.message}`);
	}
	if (typeof mod.default !== "function") {
		throw new Error("the module must export default function define(kit)");
	}
	let def;
	try {
		def = await mod.default(kit); // define may be async, to load engines
	} catch (error) {
		throw new Error(`define(kit) failed: ${error.message}`);
	}
	const problems = definitionProblems(def);
	if (problems.length > 0) throw new Error(problems.join("; "));
	return def;
};
