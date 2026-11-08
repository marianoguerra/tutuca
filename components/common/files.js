// Ask handlers for files, backed by the browser; without a DOM saving does nothing.
import { JSON_FILE } from "../../src/meta/index.js";

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
// Whether file is of format (fileFormatOf's): by its mime type or one of its extensions.
export const isFileOf = (file, format = JSON_FILE) => {
	if (format.json) return isJsonFile(file);
	const name = file.name.toLowerCase();
	return file.type === format.type || format.extensions.some((ext) => name.endsWith(ext));
};
// The first file of format (JSON by default) a drop event carries, as { file }, or { error }
// when it carries files but none is of it; null when it carries none.
export const droppedFile = (event, format = JSON_FILE) => {
	const files = droppedFiles(event);
	if (files.length === 0) return null;
	const file = files.find((f) => isFileOf(f, format));
	const what = format.json ? "JSON" : format.extensions[0];
	return file === undefined ? { error: `Not a ${what} file: ${files[0].name}` } : { file };
};
// The classes of a drop target: a dashed outline while a file is dragged over it.
export const DROP_TARGET =
	"rounded-box outline-2 outline-dashed outline-offset-4 outline-transparent data-[draggingover=external]:outline-primary";
