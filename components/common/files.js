// Ask handlers for files, backed by the browser; without a DOM saving does nothing.

// saveFile([filename, text, type, kind]) downloads text as filename and replies kind, which
// tells the asker which of its saves finished; type is the mime type, json by default.
export const saveFile = ([filename, text, type = "application/json", kind = filename]) => {
	const doc = globalThis.document;
	if (doc?.createElement !== undefined && globalThis.URL?.createObjectURL !== undefined) {
		const url = URL.createObjectURL(new Blob([text], { type }));
		Object.assign(doc.createElement("a"), { href: url, download: filename }).click();
		setTimeout(() => URL.revokeObjectURL(url), 0);
	}
	return kind;
};
export const readText = ([file]) => file.text();
