// What tasks and the records of what became of them share: back-references kept out of sight,
// and a record as plain data.
import { Address } from "./address.js";

// Sets props on obj as non-enumerable: back-references (a task's parent, a DOM event's event
// and node, a record's roots), so inspecting or deep-comparing obj doesn't walk into the tree or
// the document.
export const hidden = (obj, props) => {
	for (const key in props) {
		Object.defineProperty(obj, key, { value: props[key], writable: true, configurable: true });
	}
};

// value as data: its own enumerable fields, an Address as its path, an Error as its name and
// message, and no functions. What records are written down as.
export const plainOf = (value) => {
	if (value === null || value === undefined) return value ?? null;
	if (typeof value === "function") return undefined;
	if (typeof value !== "object") return value;
	if (value instanceof Error) return { name: value.name, message: value.message };
	if (value instanceof Address) return value.isHost ? "host" : String(value.keyPath);
	if (Array.isArray(value)) return value.map(plainOf);
	const out = {};
	for (const key of Object.keys(value)) {
		const v = plainOf(value[key]);
		if (v !== undefined) out[key] = v;
	}
	return out;
};

// Something that happened, as a host reports it: a Transition or a HostEvent, told apart by
// kind. toJSON gives what can be written down.
export class Record {
	constructor(kind) {
		this.kind = kind;
		this.n = null; // Its place among what the host reported, set as it's reported.
		this.at = null; // When it was reported, by the host's clock.
		this.issues = []; // What the host's dev checks found.
	}
	toJSON() {
		return plainOf(this);
	}
}
