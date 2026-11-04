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
// The files a drop event carries, from outside the page: none for a drag of the page's own
// elements.
export const droppedFiles = (event) => [...(event?.dataTransfer?.files ?? [])];
// A file to read as JSON: by its type, or its extension when the OS gives none.
export const isJsonFile = (file) =>
	/^application\/([\w.+-]+\+)?json$/.test(file.type) || /\.json$/i.test(file.name);
// The first JSON file a drop event carries, as { file }, or { error } when it carries files but
// none is JSON; null when it carries none.
export const droppedJsonFile = (event) => {
	const files = droppedFiles(event);
	if (files.length === 0) return null;
	const file = files.find(isJsonFile);
	return file === undefined ? { error: `Not a JSON file: ${files[0].name}` } : { file };
};
// The classes of a drop target: a dashed outline while a file is dragged over it.
export const DROP_TARGET =
	"rounded-box outline-2 outline-dashed outline-offset-4 outline-transparent data-[draggingover=external]:outline-primary";
