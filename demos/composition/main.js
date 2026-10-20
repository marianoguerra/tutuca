import { compositionComponents, notebook } from "../../components/composition/index.js";
import { boot } from "../boot.js";

export const start = (document = globalThis.document, now = Date.now()) =>
	boot({
		document,
		components: compositionComponents,
		make: (C) => notebook(C, { now, tz: -new Date(now).getTimezoneOffset() }),
	});

if (globalThis.document?.getElementById("app")) start();
