// The workshop: the tree and agents (components/trail, the paths tour's) over an app that grows while it
// runs. The app is a Shelf (shelf.js), which defines components in its own scope from a
// pure-tutuca module's source, checks one without defining it and adds an instance of any it
// can make by name. Agents do it as they do anything else: they stand on the tree, check a
// module where the shelf is (their check_component tool), send the shelf define and add, and
// define a name again to give it a new definition, which the shelf's instances move onto.
//
// Unlike the tour, what an agent sends runs on the live app (attachTrail), not on a copy: define
// registers components, which a copy would forget. Clicks run as in any app.
import { compile } from "margaui";
import { agentAskHandlers } from "../../components/agent/llm.js";
import { checkAsks, checkingTrailComponents } from "../../components/trail/check.js";
import { attachTrail } from "../../components/trail/live.js";
import { tracesComponents } from "../../components/trail/traces.js";
import { ClassCompiler, classNamesOf } from "../../src/css/classes.js";
import { componentAsks } from "../../src/pure/index.js";
import { DevChecks } from "../../src/tutuca.dev.js";
import { Host, isProblem } from "../../src/tutuca.js";
import { apiOf, modelOf, preferModel, rememberModel } from "../agent-api.js";
import { shelf, shelfComponents } from "./shelf.js";

const el = (document, name, className = "", text = "") => {
	const node = document.createElement(name);
	if (className !== "") node.className = className;
	if (text !== "") node.textContent = text;
	return node;
};
const UI = {
	tour: "flex flex-col gap-3 px-6 py-4",
	idea: "text-lg opacity-75",
	panes: "grid grid-cols-2 max-md:grid-cols-1 gap-3 items-start",
	pane: "relative min-h-56 px-6 pt-9 pb-6 border border-base-300 rounded-box bg-base-100",
	paneTitle: "absolute top-2 left-4 text-[0.7rem] tracking-widest uppercase opacity-50",
	traces: "tour-traces collapse collapse-arrow border border-base-300 rounded-box bg-base-100",
	tracesTitle: "collapse-title font-bold",
	tracesBody: "collapse-content",
};
const IDEA =
	"Put an agent on the Shelf and ask it for a component: it checks the module's source there, defines it in the shelf's scope and adds one by its name. Ask for a change and it defines the name again: what's on the shelf moves onto the new definition, with its state.";

// #app in a pane, beside the tree's, and under them the traces, closed.
const buildPage = (document) => {
	const app = document.getElementById("app");
	const tour = el(document, "main", UI.tour);
	app.before(tour);
	const appPane = el(document, "section", UI.pane);
	appPane.append(el(document, "h3", UI.paneTitle, "App"), app);
	const treePane = el(document, "section", UI.pane);
	const treeNode = el(document, "div");
	treeNode.id = "path-tree";
	treePane.append(el(document, "h3", UI.paneTitle, "Path tree"), treeNode);
	const panes = el(document, "div", UI.panes);
	panes.append(appPane, treePane);
	const tracesBox = el(document, "details", UI.traces);
	const tracesTitle = el(document, "summary", UI.tracesTitle, "Traces");
	const tracesNode = el(document, "div", UI.tracesBody);
	tracesNode.id = "path-traces";
	tracesBox.append(tracesTitle, tracesNode);
	tour.append(el(document, "p", UI.idea, IDEA), panes, tracesBox);
	return { app, treeNode, tracesTitle, tracesNode };
};

// Starts the workshop on document. askHandlers are ask handlers over the tree's (a test's
// models and agent names, without a server).
export const start = (document = globalThis.document, options = {}) => {
	const page = buildPage(document);
	const host = new Host({ document, rootNode: page.app, checks: DevChecks });
	host.scope.register(shelfComponents);
	// The app's classes and the tree's, compiled into the page's style; a component defined
	// later adds its own.
	const styleNode = document.getElementById("margaui");
	const classes =
		styleNode === null
			? null
			: new ClassCompiler(
					compile,
					classNamesOf(
						[
							...Object.values(shelfComponents),
							...Object.values(checkingTrailComponents),
							...Object.values(tracesComponents),
						],
						Object.values(UI),
					),
				);
	if (classes !== null) {
		classes.update().catch((error) => console.error("margaui compile failed", error));
		classes.watch(styleNode);
	}
	host.scope.registerAskHandlers(componentAsks({ host, onDefine: (specs) => classes?.add(specs) }));
	host.listen((record) => {
		if (isProblem(record)) console.error(record.outcome ?? record.type, record);
	});
	host.start(shelf(host.scope.components));

	const agentHandlers = agentAskHandlers({ api: apiOf(document) });
	const { tree, traces } = attachTrail({
		document,
		host,
		treeNode: page.treeNode,
		tracesNode: page.tracesNode,
		onTraces: (count) => {
			page.tracesTitle.textContent = count === 0 ? "Traces" : `Traces · ${count}`;
		},
		components: checkingTrailComponents,
		askHandlers: {
			...agentHandlers,
			models: preferModel(agentHandlers.models, modelOf(document)),
			...options.askHandlers,
		},
		extraAsks: checkAsks,
	});
	rememberModel(document, tree, (model) => tree.send("useModel", [model]));
	host.tour = tree; // For tests: the tree's own host.
	host.traces = traces;
	return host;
};

if (globalThis.document?.getElementById("app")) void start();
