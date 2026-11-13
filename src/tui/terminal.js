// A tutuca app on a terminal. startTui makes a Host that renders the components' renders.tui into a
// Screen, without a terminal (tests, tools); runTui puts it on one: raw mode, the alternate
// screen, mouse reporting and bracketed paste on start, each restored on stop.
import { Host } from "../core/host/host.js";
import { detectTerminal } from "./capabilities.js";
import { parseInput } from "./input.js";
import { Screen } from "./screen.js";
import { tuiTarget } from "./target.js";

// components are registered, root is the instance to start with or a function of the
// registered factories that makes it, and the rest is what Host takes (checks, env, publish,
// schedule). write(ansi) gets what changed on each flush.
export function startTui({
	components = {},
	root,
	width = 80,
	height = 24,
	write = () => {},
	terminal,
	...hostOptions
}) {
	const screen = new Screen({ width, height, write, terminal });
	const host = new Host({
		...hostOptions,
		document: screen.document,
		rootNode: screen.rootNode,
		target: tuiTarget,
	});
	host.scope.register(components);
	host.start(typeof root === "function" ? root(host.scope.components) : root);
	screen.flush();
	return { host, screen };
}

// The events a Screen sends its elements.
const SCREEN_EVENTS = new Set([
	"keydown",
	"mousedown",
	"mouseup",
	"click",
	"mousemove",
	"wheel",
	"scroll",
	"input",
	"submit",
]);

// A host that only renders: what's done on its screen goes to source, whose state it shows.
class MirrorHost extends Host {
	constructor(source, options) {
		super(options);
		this.source = source;
	}
	// A message from its screen runs on source, routed against source's root, which it shows.
	send(name, args, options) {
		return this.source.send(name, args, options);
	}
}

// A Screen that shows the state of another host, source (one on a page, say): its components'
// renders.tui, as startTui's do, rendered again from source's root on sync(), and the messages
// its events send run on source. So a page's app and its terminal render are one app: a click
// on either is a task of source, in its timeline and checks. Call sync after source renders.
// Returns { host, screen, sync, stop }; write and terminal are as startTui takes them.
export function mirrorTui(source, { width = 80, height = 24, write = () => {}, terminal } = {}) {
	const screen = new Screen({ width, height, write, terminal });
	const host = new MirrorHost(source, {
		document: screen.document,
		rootNode: screen.rootNode,
		target: tuiTarget,
	});
	host.addEventListeners(SCREEN_EVENTS);
	let stopped = false;
	const sync = () => {
		const { root } = source;
		if (!stopped && root !== null && root !== host.root) host.start(root);
	};
	const stop = () => {
		if (stopped) return;
		stopped = true;
		host.stop();
	};
	sync();
	screen.flush();
	return {
		host,
		screen,
		sync,
		stop,
		get stopped() {
			return stopped;
		},
	};
}

const MODES_ON = "\x1b[?1049h\x1b[?25l\x1b[?1000h\x1b[?1002h\x1b[?1006h\x1b[?2004h";
const MODES_OFF = "\x1b[?2004l\x1b[?1006l\x1b[?1002l\x1b[?1000l\x1b[0m\x1b[?25h\x1b[?1049l";

// Runs the app until Ctrl+C or stop(); returns { host, screen, stop, done }, done a promise that
// resolves when it stops. Paints once per batch of changes, after the task that made them.
// onInput(data, events), when given, hears each chunk the terminal sends and what it parsed to.
export function runTui({
	input = process.stdin,
	output = process.stdout,
	onInput = null,
	...options
}) {
	const write = (s) => {
		if (s) output.write(s);
	};
	output.write(MODES_ON);
	// What this terminal shows, from the environment, unless options says.
	const { host, screen } = startTui({
		...options,
		terminal: options.terminal ?? detectTerminal(),
		width: output.columns ?? 80,
		height: output.rows ?? 24,
		write,
	});
	let scheduled = false;
	screen.document.onInvalidate = () => {
		if (scheduled) return;
		scheduled = true;
		setImmediate(() => {
			scheduled = false;
			screen.flush();
		});
	};
	let resolveDone;
	const done = new Promise((resolve) => {
		resolveDone = resolve;
	});
	const onData = (chunk) => {
		const data = chunk.toString("utf8");
		const events = parseInput(data);
		onInput?.(data, events);
		for (const event of events) {
			// Ctrl+C quits, unless there's a selection in an input or textarea for it to copy.
			const ctrlC = event.kind === "key" && event.ctrlKey && event.key === "c";
			if (ctrlC && !screen.hasSelection) return stop();
			if (event.kind === "key") screen.key(event);
			else if (event.kind === "mouse") screen.mouse(event);
			else screen.paste(event.text);
		}
	};
	const onResize = () => screen.resize(output.columns, output.rows);
	input.setRawMode?.(true);
	input.resume();
	input.on("data", onData);
	output.on("resize", onResize);
	let stopped = false;
	function stop() {
		if (stopped) return;
		stopped = true;
		input.off("data", onData);
		output.off("resize", onResize);
		input.setRawMode?.(false);
		input.pause();
		host.stop();
		output.write(MODES_OFF);
		resolveDone();
	}
	return { host, screen, stop, done };
}
