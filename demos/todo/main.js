import { weekOfPlans } from "../../components/todo/fixtures.js";
import { todoComponents } from "../../components/todo/index.js";
import { boot, browserHandlers } from "../boot.js";

export const start = (document = globalThis.document, today = browserHandlers.today()) =>
	boot({
		document,
		components: todoComponents,
		askHandlers: { today: browserHandlers.today },
		make: (C) => weekOfPlans(C, today),
	});

if (globalThis.document?.getElementById("app")) start();
