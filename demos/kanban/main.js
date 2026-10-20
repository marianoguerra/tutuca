import { kanbanComponents } from "../../components/kanban/index.js";
import { sampleBoard } from "../../components/kanban/stories.js";
import { boot } from "../boot.js";

export const start = (document = globalThis.document) =>
	boot({ document, components: kanbanComponents, make: sampleBoard });

if (globalThis.document?.getElementById("app")) start();
