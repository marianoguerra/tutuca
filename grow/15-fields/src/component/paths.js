// Paths (spec/component/paths.rkt).
//
//   upath   an update path: the property keys from the root state to a value.
//           getIn and setIn read and write through it.

// prop-set of spec/data.rkt: value[key] = v, as a new value.
function propSet(value, key, v) {
	if (Array.isArray(value)) {
		const copy = value.slice();
		copy[key] = v;
		return copy;
	}
	return Object.assign(Object.create(Object.getPrototypeOf(value)), value, { [key]: v });
}

// One property read per key. Reading below null throws.
export function getIn(upath, value) {
	if (upath.length === 0) return value;
	const [key, ...rest] = upath;
	return getIn(rest, value[key]);
}

// The root with value at upath: a new root, the old one is unchanged.
export function setIn(upath, root, value) {
	if (upath.length === 0) return value;
	const [key, ...rest] = upath;
	return propSet(root, key, setIn(rest, root[key], value));
}
