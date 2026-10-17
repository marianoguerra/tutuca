import {
	matrixLabel,
	quadraticLabel,
	workbenchComponents,
} from "../../components/math/workbench.js";
import { boot } from "../boot.js";

export const start = (document = globalThis.document) =>
	boot({
		document,
		components: workbenchComponents,
		make: (C) =>
			C.Workbench({
				quadratic: C.Quadratic({ a: 1, b: -3, c: 2 }),
				history: [
					{ kind: "quadratic", label: quadraticLabel(1, 2, 5), values: [1, 2, 5] },
					{ kind: "matrix", label: matrixLabel(2, 4, 1, 2), values: [2, 4, 1, 2] },
				],
			}),
	});

if (globalThis.document?.getElementById("app")) start();
