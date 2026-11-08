import { notesComponents } from "../../components/notes/index.js";
import { boot } from "../boot.js";

export const start = (document = globalThis.document) =>
	boot({ document, components: notesComponents, make: (C) => C.Notes() });

if (globalThis.document?.getElementById("app")) start();
