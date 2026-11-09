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
// The keys from the root to a value: ".items[0].label", "·" for the root.
export const pathText = (keys) => keys.map(keyText).join("") || "·";
// What a thrown value says: an Error's message, anything else as text.
export const errorMessage = (error) => String(error?.message ?? error);
