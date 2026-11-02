// How the tree prints values, keys and paths, in labels and errors.
export const jsonText = (v) => {
	try {
		return JSON.stringify(v) ?? String(v);
	} catch {
		return String(v);
	}
};
// A key prints as .key or [item]; a whole path uses · for the root.
export const keyText = (key) => (typeof key === "string" ? `.${key}` : `[${jsonText(key)}]`);
