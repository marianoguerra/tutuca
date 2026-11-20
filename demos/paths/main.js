// The paths tour: one example at a time (?e= picks it, the first when it's left out), live on
// the left and its path tree on the right. Hovering either side points at the other, the
// markers switch outlines what each marker comment covers, and a click becomes steps to go
// through with the pager under the app (trace.js): how its path is read from the page, where
// its message goes and what changed. The app has the state from before the click until the
// step that delivers it, going back included; with instant on, a click starts at its last step,
// the app changed, and the pager goes back from there.
// Under it all, a panel that opens: the traces (traces.js), what each event led to as spans.
import { compile } from "margaui";
import { agentAskHandlers } from "../../components/agent/llm.js";
import { sentEntriesOf } from "../../components/trail/entries.js";
import { pickName } from "../../components/trail/names.js";
import { PROFILES } from "../../components/trail/profiles.js";
import { tracesOf } from "../../components/trail/spans.js";
import { traces, tracesComponents } from "../../components/trail/traces.js";
import { nodesOf, trail, trailComponents } from "../../components/trail/trail.js";
import { rowsOf } from "../../components/trail/tree.js";
import { pathOf } from "../../src/core/host/events.js";
import { ClassCompiler, classNamesOf } from "../../src/css/classes.js";
import { agentMetaSchemas, contractErrorText } from "../../src/meta/index.js";
import { plainOf } from "../../src/tree/record.js";
import { DevChecks } from "../../src/tutuca.dev.js";
import { canQuery, HandlerSpec, Host, isProblem, specOf } from "../../src/tutuca.js";
import { apiOf, modelOf, preferModel, rememberModel } from "../agent-api.js";
import { exampleOf, examples } from "./examples.js";
import {
	boxLayer,
	chainOf,
	layerClasses,
	pathKey,
	pathLabel,
	rectOrNull,
	regionBoxes,
	regionsAt,
	scanRegions,
} from "./regions.js";
import { deliver, entriesOf, holdEvents, nodeAt, stepsOf } from "./trace.js";

const SETTINGS_KEY = "tutuca-demos:paths";
const loadSettings = (window) => {
	try {
		return JSON.parse(window?.localStorage.getItem(SETTINGS_KEY) ?? "{}") ?? {};
	} catch {
		return {};
	}
};
const saveSettings = (window, settings) => {
	try {
		window?.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
	} catch {
		// A page without storage forgets them.
	}
};

const el = (document, name, className = "", text = "") => {
	const node = document.createElement(name);
	if (className !== "") node.className = className;
	if (text !== "") node.textContent = text;
	return node;
};
// What the page around the app is drawn with, margaui's classes. The tour-* names style
// nothing but a token's entrance (paths.css): they say what a node is.
const UI = {
	links: "tour-examples flex flex-wrap gap-1 px-6 py-2 bg-base-100 border-b border-base-300",
	link: "btn btn-sm btn-square tabular-nums aria-[current=page]:btn-primary",
	tour: "flex flex-col gap-3 px-6 py-4",
	title: "text-2xl font-bold",
	idea: "mt-0.5 text-lg opacity-75",
	panes: "grid grid-cols-2 max-md:grid-cols-1 gap-3 items-start",
	pane: "relative min-h-56 px-6 pt-9 pb-6 border border-base-300 rounded-box bg-base-100",
	paneTitle: "absolute top-2 left-4 text-[0.7rem] tracking-widest uppercase opacity-50",
	bar: "flex flex-col gap-1.5 min-h-18 px-4 py-3 border border-base-300 rounded-box bg-base-100",
	line: "flex flex-wrap items-center gap-3 min-h-8 font-mono text-lg",
	message: "font-bold text-primary",
	path: "flex flex-wrap gap-1",
	caption: "opacity-80",
	controls: "flex flex-wrap items-center justify-between gap-3 text-sm",
	pager: "flex flex-wrap gap-1 min-h-8",
	// A step's button: the one shown, one from which the app has the state after the event,
	// and the rest.
	page: "tour-page btn btn-sm min-w-8 tabular-nums",
	pageNow: "btn-primary",
	pageApplied: "tour-page-applied btn-outline btn-success",
	pageRest: "btn-outline",
	options: "flex flex-wrap gap-3",
	check: "inline-flex items-center gap-1.5 cursor-pointer",
	checkbox: "checkbox checkbox-sm",
	traces: "tour-traces collapse collapse-arrow border border-base-300 rounded-box bg-base-100",
	tracesTitle: "collapse-title font-bold",
	tracesBody: "collapse-content",
	// A step of the path: a frame that reaches a component is filled, a loop item of the
	// component's own view isn't.
	token: "tour-token px-2 py-0.5 border-2 border-warning rounded-md",
	tokenNode: "bg-warning/20",
	tokenRoot: "bg-warning/20",
	tokenItem: "border-dashed",
};
const TOKENS = { node: UI.tokenNode, root: UI.tokenRoot, item: UI.tokenItem };

const hrefOf = (id) => `?e=${encodeURIComponent(id)}`;

// The page around #app: the example's links and idea, the app's pane with the layers the tour
// draws over it, the tree's pane, and under both the bar a step writes in and the pager.
const buildPage = (document, example) => {
	const app = document.getElementById("app");
	const at = examples.indexOf(example);

	const links = document.querySelector(".tour-examples") ?? el(document, "nav");
	links.className = UI.links;
	links.replaceChildren(
		...examples.map(({ id, title }, i) => {
			const link = el(document, "a", UI.link, String(i + 1));
			link.href = hrefOf(id);
			link.title = title;
			if (i === at) link.setAttribute("aria-current", "page");
			return link;
		}),
	);

	const head = el(document, "div");
	head.append(
		el(document, "h2", UI.title, `${at + 1}. ${example.title}`),
		el(document, "p", UI.idea, example.idea),
	);

	const appPane = el(document, "section", UI.pane);
	const treePane = el(document, "section", UI.pane);
	const treeNode = el(document, "div");
	treeNode.id = "path-tree";
	treePane.append(el(document, "h3", UI.paneTitle, "Path tree"), treeNode);
	const panes = el(document, "div", UI.panes);
	const tour = el(document, "main", UI.tour);
	app.before(tour);
	if (links.parentNode === null) tour.append(links);
	appPane.append(el(document, "h3", UI.paneTitle, "App"), app);
	panes.append(appPane, treePane);

	const message = el(document, "span", UI.message);
	const path = el(document, "span", UI.path);
	const caption = el(document, "p", UI.caption);
	const bar = el(document, "div", UI.bar);
	const line = el(document, "div", UI.line);
	line.append(message, path);
	bar.append(line, caption);

	const controls = el(document, "div", UI.controls);
	const pager = el(document, "nav", UI.pager);
	pager.setAttribute("aria-label", "Steps");
	const options = el(document, "div", UI.options);
	controls.append(pager, options);
	// Under them all, closed until it's opened: the traces (traces.js).
	const traces = el(document, "details", UI.traces);
	const tracesTitle = el(document, "summary", UI.tracesTitle, "Traces");
	const tracesNode = el(document, "div", UI.tracesBody);
	tracesNode.id = "path-traces";
	traces.append(tracesTitle, tracesNode);
	tour.append(head, panes, bar, controls, traces);
	return {
		app,
		appPane,
		treeNode,
		message,
		path,
		caption,
		pager,
		options,
		traces,
		tracesTitle,
		tracesNode,
	};
};

const checkbox = (document, text, checked, onChange) => {
	const label = el(document, "label", UI.check);
	const input = el(document, "input", UI.checkbox);
	input.type = "checkbox";
	input.checked = checked;
	input.addEventListener("change", () => onChange(input.checked));
	label.append(input, ` ${text}`);
	return label;
};

// A dev Host on #app with the example's components and root, its classes, and those of the
// tour's own components (the agent's), compiled into the page's margaui style. Not boot's: the
// tour moves the app between the states before and after an event itself, which a time travel
// bar would record as changes from elsewhere.
const startExample = (document, example) => {
	const host = new Host({ document, rootNode: document.getElementById("app"), checks: DevChecks });
	host.scope.register(example.components);
	host.listen((record) => {
		if (isProblem(record)) console.error(record.outcome ?? record.type, record);
	});
	host.start(example.make(host.scope.components));
	const styleNode = document.getElementById("margaui");
	if (styleNode !== null) {
		const all = [
			...Object.values(example.components),
			...Object.values(trailComponents),
			...Object.values(tracesComponents),
		];
		// With the classes of what isn't a component: the page around the app and its layers.
		const classes = new ClassCompiler(
			compile,
			classNamesOf(all, [...Object.values(UI), ...layerClasses]),
		);
		classes.update().catch((error) => console.error("margaui compile failed", error));
		classes.watch(styleNode);
	}
	return host;
};

// Where the arrow keys are the element's own.
const TYPING = 'input:not([type="checkbox"]), select, textarea';
const HINT = "Click something in the app to see how its path is read from the page.";

// Starts the tour on document: example is an example's id (the page's ?e= otherwise), instant
// whether a click starts at its last step (what the page remembers otherwise) and askHandlers
// ask handlers over the tour's (a test's models and agent names, without a server).
export const start = (document = globalThis.document, options = {}) => {
	const window = document.defaultView;
	const params = new URLSearchParams(window?.location.search ?? "");
	const example = exampleOf(options.example ?? params.get("e"));
	const settings = { instant: false, markers: false, traces: false, ...loadSettings(window) };
	if (options.instant !== undefined) settings.instant = options.instant;

	const page = buildPage(document, example);
	const host = startExample(document, example);
	const treeHost = new Host({ document, rootNode: page.treeNode });
	treeHost.scope.registerMetaSchemas(agentMetaSchemas);
	const C = treeHost.scope.register(trailComponents);
	const agentHandlers = agentAskHandlers({ api: apiOf(document) });
	treeHost.scope.registerAskHandlers({
		...agentHandlers,
		models: preferModel(agentHandlers.models, modelOf(document)),
		// A name for a new agent, among those the others have.
		agentName: ([taken]) => pickName(taken),
		agentProfiles: () => PROFILES,
		sendToApp: (args) => sendToApp(...args),
		queryApp: (args) => queryApp(...args),
		...options.askHandlers,
	});
	treeHost.listen((record) => {
		if (isProblem(record)) console.error(record.outcome ?? record.type, record);
	});
	treeHost.start(trail(C));
	// The trail (trail.js) holds the tree: what the rows show goes to the tree, the rest to it.
	const send = (name, args = []) => treeHost.send(name, args, { now: true });
	const tree = (name, args = []) => treeHost.send(name, args, { now: true, to: "tree" });

	// The traces view shows the trail's log by what caused what: it's told whenever the trail's
	// log or nodes are other ones.
	const tracesHost = new Host({ document, rootNode: page.tracesNode });
	const TC = tracesHost.scope.register(tracesComponents);
	tracesHost.listen((record) => {
		if (isProblem(record)) console.error(record.outcome ?? record.type, record);
	});
	tracesHost.start(traces(TC));
	const shown = { log: null, nodes: null };
	const syncTraces = () => {
		const { log, nodes } = treeHost.root;
		if (log === shown.log && nodes === shown.nodes) return;
		Object.assign(shown, { log, nodes });
		tracesHost.send("show", [log, nodes], { now: true });
		const count = tracesOf(log, nodes).length;
		page.tracesTitle.textContent = count === 0 ? "Traces" : `Traces · ${count}`;
	};
	// What the trail does on its own: a reset, an agent's message.
	treeHost.listen((record) => {
		if (record.kind === "hostEvent" && record.type === "rendered") syncTraces();
	});

	const markersLayer = boxLayer(page.appPane, "markers");
	const hoverLayer = boxLayer(page.appPane, "hover");
	const traceLayer = boxLayer(page.appPane, "trace");

	// run: the event being gone through, { steps, before, after, call, capture, at, click }, click
	// its number, which its trace has; null for none.
	// paths: the path of each row that has a key, for what an agent sends there.
	const state = { regions: [], focus: null, hover: "", run: null, clicks: 0, paths: new Map() };
	const stepNow = () => state.run?.steps[state.run.at] ?? null;
	const drawMarkers = () =>
		settings.markers
			? markersLayer.draw(regionBoxes(state.regions, "marker"))
			: markersLayer.clear();
	const drawHover = () => {
		const found = state.hover === "" ? [] : regionsAt(state.regions, state.hover);
		hoverLayer.draw(
			found.map((region) => ({
				...regionBoxes([region], "hover", false)[0],
				label: pathLabel(region.path),
			})),
		);
	};
	// What a step outlines in the app: the element with the handler and the regions walked so
	// far, found again in the page as it is now. Only before the event is delivered: after it,
	// the page may not have them.
	const drawTrace = () => {
		const step = stepNow();
		if (step === null || step.applied) return traceLayer.clear();
		const { capture } = state.run;
		const target = nodeAt(host.rootNode, capture.targetAt);
		const node = nodeAt(host.rootNode, capture.nodeAt);
		if (target === null || node === null) return traceLayer.clear();
		const walked = chainOf(state.regions, target).slice(0, step.walked);
		traceLayer.draw([
			{ rect: rectOrNull(node), kind: "target", grow: 3 },
			...regionBoxes(walked.slice(0, -1), "walk", false),
			...regionBoxes(walked.slice(-1), "walk-now"),
		]);
	};
	// Reads the app again: its regions and its tree, with what the step lights.
	const refresh = () => {
		if (host.root === null) return;
		state.regions = scanRegions(host.rootNode);
		const rows = rowsOf(host.root, state.focus);
		state.paths = new Map(rows.filter(({ row }) => row.key !== "").map((r) => [r.row.key, r.path]));
		send("show", [rows.map(({ row }) => row), nodesOf(rows)]);
		const step = stepNow();
		for (const { keys, kind, note } of step?.lights ?? []) tree("light", [keys, kind, note]);
		if (step !== null) tree("copied", [step.copied]);
		if (state.hover !== "") tree("hover", [state.hover]);
		syncTraces();
		drawMarkers();
		drawHover();
		drawTrace();
	};
	const setHover = (key) => {
		if (key === state.hover) return;
		state.hover = key;
		tree("hover", [key]);
		drawHover();
	};

	// The pager: first, previous, a button per step, next, last. The steps from the one that
	// delivers the event on are marked: there the app changes.
	const pagerButton = (text, title, at, disabled = false) => {
		const button = el(document, "button", `${UI.page} ${UI.pageRest}`, text);
		button.type = "button";
		button.title = title;
		button.disabled = disabled;
		button.addEventListener("click", () => showStep(at));
		return button;
	};
	const drawPager = () => {
		const { run } = state;
		if (run === null) return page.pager.replaceChildren();
		const last = run.steps.length - 1;
		const numbers = run.steps.map((step, i) => {
			const button = pagerButton(String(i + 1), step.title, i);
			const state = i === run.at ? UI.pageNow : step.applied ? UI.pageApplied : UI.pageRest;
			button.className = `${UI.page} ${state}`;
			// What a step is doesn't depend on whether it's the one shown.
			if (step.applied) button.classList.add("tour-page-applied");
			if (i === run.at) button.setAttribute("aria-current", "step");
			return button;
		});
		page.pager.replaceChildren(
			pagerButton("⏮", "First step (Home)", 0, run.at === 0),
			pagerButton("◀", "Previous step (←)", run.at - 1, run.at === 0),
			...numbers,
			pagerButton("▶", "Next step (→)", run.at + 1, run.at === last),
			pagerButton("⏭", "Last step (End)", last, run.at === last),
		);
	};
	// Shows step at of the event being gone through, the app in the state the step is about.
	const showStep = (at) => {
		const { run } = state;
		if (run === null || at < 0 || at >= run.steps.length) return;
		run.at = at;
		const step = run.steps[at];
		const want = step.applied ? run.after : run.before;
		state.focus = step.focus;
		// Renders, and reads the app again; a state the app already has only needs the latter.
		if (host.root !== want) host.applyChange(() => want);
		refresh();
		tracesHost.send("at", [run.click, step.span], { now: true });
		page.message.textContent = run.call;
		page.caption.textContent = `${at + 1}/${run.steps.length} · ${step.caption}`;
		page.path.replaceChildren(
			...step.tokens.map(({ text, kind }) =>
				el(document, "span", `${UI.token} ${TOKENS[kind]}`, text),
			),
		);
		drawPager();
	};
	// The event being gone through is over: the app has the state after it.
	const finishRun = () => {
		const { run } = state;
		if (run === null) return;
		state.run = null;
		state.focus = null;
		if (host.root !== run.after) host.applyChange(() => run.after);
		page.message.textContent = "";
		page.path.replaceChildren();
		page.caption.textContent = HINT;
		drawPager();
	};
	// The message name(args) an agent called by sends the component at the place key: checked
	// against the component's contract, run as an event's message is (trace.js's deliver), and
	// the app given the state it leaves. Answers { entries, state }, what it left at each place
	// and the component after, or { error }.
	const sendToApp = (key, name, args, by) => {
		finishRun();
		const path = state.paths.get(key);
		if (path === undefined) return { error: "that place is no longer in the tree" };
		const to = host.addressOf(path);
		const instance = to.keyPath.getIn(host.root);
		const spec = specOf(instance);
		const handler = spec?.on[name];
		if (!(handler instanceof HandlerSpec)) return { error: `there's no message ${name} there` };
		let sent;
		try {
			sent = deliver({ name, args, to }, host.root, example.components);
		} catch (error) {
			return { error: contractErrorText(instance, error) };
		}
		const failed = sent.transitions.find((transition) => transition.outcome === "failed");
		if (failed !== undefined && failed.cause === null) {
			return { error: contractErrorText(instance, failed.error) };
		}
		state.clicks += 1;
		if (host.root !== sent.after) host.applyChange(() => sent.after);
		return {
			entries: sentEntriesOf(sent.transitions, state.clicks, by),
			state: plainOf(to.keyPath.getIn(sent.after) ?? null),
		};
	};
	// The query name(args) of the component at the place key, read from the app as it is now
	// (before the event, while one is gone through) and checked against its contract: answers
	// { value }, what it returned as data, or { error }. It changes nothing.
	const queryApp = (key, name, args) => {
		const path = state.paths.get(key);
		if (path === undefined) return { error: "that place is no longer in the tree" };
		const to = host.addressOf(path);
		const instance = to.keyPath.getIn(host.root);
		if (!canQuery(instance, name)) return { error: `there's no query ${name} there` };
		try {
			return { value: plainOf(host.query(name, args, { to })) ?? null };
		} catch (error) {
			return { error: contractErrorText(instance, error) };
		}
	};
	host.listen((record) => {
		if (record.kind !== "hostEvent") return;
		if (record.type === "rendered" || record.type === "started") refresh();
	});
	refresh();
	page.caption.textContent = HINT;

	// Pointing: a row at the regions of its path, an element at the row of the path it's in.
	// A span points as the row of its place does, and a click on it shows the place in the
	// inspector.
	for (const node of [page.treeNode, page.tracesNode]) {
		node.addEventListener("mouseover", (event) => {
			setHover(event.target.closest?.("[data-step]")?.getAttribute("data-step") ?? "");
		});
		node.addEventListener("mouseleave", () => setHover(""));
	}
	page.tracesNode.addEventListener("click", (event) => {
		const key = event.target.closest?.("[data-step]")?.getAttribute("data-step") ?? "";
		if (key !== "") send("pick", [key]);
	});
	page.app.addEventListener("mouseover", (event) => {
		const path = host.root === null ? null : pathOf(event.target, host.rootNode);
		setHover(path === null ? "" : pathKey(path));
	});
	page.app.addEventListener("mouseleave", () => setHover(""));
	window?.addEventListener("resize", () => {
		drawMarkers();
		drawHover();
		drawTrace();
	});

	const change = (changes) => {
		Object.assign(settings, changes);
		saveSettings(window, settings);
	};
	page.options.append(
		checkbox(document, "instant: start at the last step", settings.instant, (instant) => {
			change({ instant });
		}),
		checkbox(document, "markers", settings.markers, (markers) => {
			change({ markers });
			drawMarkers();
		}),
	);
	page.traces.open = settings.traces;
	page.traces.addEventListener("toggle", () => {
		if (page.traces.open !== settings.traces) change({ traces: page.traces.open });
	});
	// An event the app would handle becomes the steps to go through, from the first, or from
	// the last with instant on. One that comes before the last was delivered replaces it: the
	// app is still as it was before it.
	holdEvents({
		host,
		regions: () => state.regions,
		onCapture(capture) {
			// Once per event: going through its steps again counts nothing.
			state.clicks += 1;
			const steps = stepsOf(capture, host.root, example.components);
			state.run = { ...steps, capture, at: 0, click: state.clicks };
			send("record", [entriesOf(capture, state.run.transitions, state.clicks)]);
			showStep(settings.instant ? state.run.steps.length - 1 : 0);
		},
	});

	// ← and → go a step back and on, Home and End to the first and last; Alt+← and Alt+→
	// change example.
	const at = examples.indexOf(example);
	document.addEventListener("keydown", (event) => {
		if (event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
			const next = examples[at + (event.key === "ArrowRight" ? 1 : -1)];
			if (next !== undefined && window != null) window.location.search = hrefOf(next.id);
			return;
		}
		const { run } = state;
		if (run === null || event.target.closest?.(TYPING) != null) return;
		if (event.key === "ArrowRight") showStep(run.at + 1);
		else if (event.key === "ArrowLeft") showStep(run.at - 1);
		else if (event.key === "Home") showStep(0);
		else if (event.key === "End") showStep(run.steps.length - 1);
		else return;
		event.preventDefault();
	});
	send("checkInference");
	// The model picked in an agent is the one the next agents start with, and the page's ?model=.
	rememberModel(document, treeHost, (model) => treeHost.send("useModel", [model]));
	host.tour = treeHost; // For tests: the tour's own host.
	host.traces = tracesHost; // And the traces view's.
	return host;
};

if (globalThis.document?.getElementById("app")) void start();
