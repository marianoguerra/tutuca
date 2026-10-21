import { langComponents, sample } from "../../components/lang/index.js";
import { boot } from "../boot.js";

export const start = (document = globalThis.document) =>
	boot({
		document,
		components: langComponents,
		make: (C) => C.Editor({ program: sample(C) }),
	});

if (globalThis.document?.getElementById("app")) start();
