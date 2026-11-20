// Host modules the page gives a pure-tutuca module (the lab engines: regular expressions, jq,
// cron, ...): a declaration as tutuca/data's (specifier, module, members' TypeScript signatures,
// fresh) and the page's implementations, by member. The page isn't trusted as tutuca's own code
// is: what a member returns is checked against the type its signature says, and one that doesn't
// fit fails the call, as a throw does (tutuca-wax's lowering checks the same).
//
//   componentModule(source, { hostModules: [{ ...declaration, impls: { test: (p, f, t) => ... } }] })

// Whether value is a type's value: data only (no functions, no objects but plain ones and
// arrays), checked all the way down. resolve gives a named type's.
const fits = (value, ty, resolve) => {
	switch (ty.k) {
		case "number":
			return typeof value === "number";
		case "string":
			return typeof value === "string";
		case "boolean":
			return typeof value === "boolean";
		case "null":
			return value === null;
		case "undefined":
		case "void":
			return value === undefined;
		case "unknown":
			return isData(value);
		case "never":
			return false;
		case "lit":
			return Object.is(value, ty.value);
		case "list":
			return Array.isArray(value) && value.every((x) => fits(x, ty.elem, resolve));
		case "tuple":
			return (
				Array.isArray(value) &&
				value.length === ty.elems.length &&
				ty.elems.every((t, i) => fits(value[i], t, resolve))
			);
		case "dict":
			return isPlain(value) && Object.values(value).every((x) => fits(x, ty.value, resolve));
		case "record":
			return (
				isPlain(value) &&
				Object.entries(ty.fields).every(([name, f]) =>
					Object.hasOwn(value, name)
						? fits(value[name], f.type, resolve) || (f.optional && value[name] === undefined)
						: f.optional,
				)
			);
		case "union":
			return ty.types.some((t) => fits(value, t, resolve));
		case "ref":
			return fits(value, resolve(ty), resolve);
		default:
			return false;
	}
};

const isPlain = (v) =>
	v !== null &&
	typeof v === "object" &&
	!Array.isArray(v) &&
	Object.getPrototypeOf(v) === Object.prototype;
const isData = (v) => {
	if (v === null || v === undefined) return true;
	const t = typeof v;
	if (t === "number" || t === "string" || t === "boolean") return true;
	if (Array.isArray(v)) return v.every(isData);
	return isPlain(v) && Object.values(v).every(isData);
};

// The host declaration of the page's modules, to extend tutuca's with.
export const pageDeclaration = (modules) => ({
	modules: Object.fromEntries(modules.map((m) => [m.module, m.members])),
	imports: Object.fromEntries(modules.map((m) => [m.specifier, m.module])),
	fresh: modules.flatMap((m) => m.fresh ?? []),
});

// The page's implementations, each checking what it returns against its declared result, by
// pure-js's types (host() is the host they are part of, made after them).
export const pageImpls = (modules, host) => {
	const out = {};
	for (const m of modules) {
		for (const name of Object.keys(m.members)) {
			const qualified = `${m.module}.${name}`;
			const impl = m.impls?.[name];
			out[qualified] = (...args) => {
				if (typeof impl !== "function") throw new Error(`the page gives no ${qualified}`);
				const result = impl(...args);
				const { ty } = host().member(m.module, name);
				const results = ty.k === "fn" ? ty.sigs.map((s) => s.result) : [ty];
				if (!results.some((r) => fits(result, r, (x) => host().resolve(x)))) {
					throw new Error(`${qualified} returned a value that doesn't fit its declared type`);
				}
				return result;
			};
		}
	}
	return out;
};
