// The tree and agents of a running app: attachTrail puts the path tree (tree.js), the inspector
// and the agents (trail.js) in a host of their own on treeNode, and the traces (traces.js) on
// tracesNode, beside host, the app's. They read the app as it is: its tree again whenever it
// renders, and what an agent sends runs on the live app (sendToApp), its queries on its root
// (queryApp). Nothing here reaches into the app but those: it's driven from the outside, as a
// person at the page would.
//
// Unlike the paths tour, nothing is held back: a click on the app runs as it would, and only
// what agents send is kept as entries.
import { agentMetaSchemas, contractErrorText } from "../../src/meta/index.js";
import { plainOf } from "../../src/tree/record.js";
import { canQuery, HandlerSpec, Host, isProblem, specOf } from "../../src/tutuca.js";
import { sentEntriesOf } from "./entries.js";
import { pickName } from "./names.js";
import { PROFILES } from "./profiles.js";
import { tracesOf } from "./spans.js";
import { traces, tracesComponents } from "./traces.js";
import { nodesOf, trail, trailComponents } from "./trail.js";
import { rowsOf } from "./tree.js";

const GONE = "that place is no longer in the tree";
const logProblems = (record) => {
	if (isProblem(record)) console.error(record.outcome ?? record.type, record);
};

// Starts the tree and its agents on treeNode for host, and the traces on tracesNode (null for
// none), telling onTraces(count) how many there are. components are the trail's (one with a
// Probe of its own: probeWith); askHandlers answer its agents' asks (infer, models, ...) over the
// ones it answers itself (sendToApp, queryApp, agentName, agentProfiles), and extraAsks(placeOf)
// gives more, placeOf(key) being the component at a place, { path, to, instance }, or null.
// delay is how long a render waits before the tree is read again (0: at once), and active()
// whether it is read at all (a closed drawer's isn't, until refresh).
// Returns { tree, traces, refresh, placeOf }, tree and traces their hosts.
export const attachTrail = ({
	document,
	host,
	treeNode,
	tracesNode = null,
	onTraces = null,
	components = trailComponents,
	askHandlers = {},
	extraAsks = () => ({}),
	delay = 0,
	active = () => true,
}) => {
	const tree = new Host({ document, rootNode: treeNode });
	tree.scope.registerMetaSchemas(agentMetaSchemas);
	const C = tree.scope.register(components);
	// paths: the path of each row that has a key, for what an agent sends there.
	const state = { sent: 0, paths: new Map(), timer: null, stale: false };

	// The component at the place key, or null when it's gone.
	const placeOf = (key) => {
		const path = state.paths.get(key);
		if (path === undefined || host.root === null) return null;
		const to = host.addressOf(path);
		const instance = to.keyPath.getIn(host.root);
		return instance === undefined ? null : { path, to, instance };
	};
	// The message name(args) an agent called by sends the component at the place key, on the
	// live app, checked against its contract; answers once everything it led to ran (the asks
	// it made answered): { entries, state }, what it left at each place and the component after,
	// or { error }.
	const sendToApp = async (key, name, args, by) => {
		const place = placeOf(key);
		if (place === null) return { error: GONE };
		const { to, instance } = place;
		if (!(specOf(instance)?.on[name] instanceof HandlerSpec)) {
			return { error: `there's no message ${name} there` };
		}
		const transitions = [];
		const stop = host.listen((record) => {
			if (record.kind === "transition") transitions.push(record);
		});
		try {
			host.send(name, args, { to, now: true });
			while (host.tasks.length > 0) host.handleTasks();
			await host.whenIdle();
		} catch (error) {
			return { error: contractErrorText(instance, error) };
		} finally {
			stop();
		}
		const failed = transitions.find((t) => t.outcome === "failed" && t.cause === null);
		if (failed !== undefined) return { error: contractErrorText(instance, failed.error) };
		state.sent += 1;
		transitions.sort((a, b) => a.seq - b.seq);
		return {
			entries: sentEntriesOf(transitions, state.sent, by),
			state: plainOf(host.addressOf(place.path).keyPath.getIn(host.root) ?? null),
		};
	};
	// The query name(args) of the component at the place key: { value } or { error }.
	const queryApp = (key, name, args) => {
		const place = placeOf(key);
		if (place === null) return { error: GONE };
		const { to, instance } = place;
		if (!canQuery(instance, name)) return { error: `there's no query ${name} there` };
		try {
			return { value: plainOf(host.query(name, args, { to })) ?? null };
		} catch (error) {
			return { error: contractErrorText(instance, error) };
		}
	};
	tree.scope.registerAskHandlers({
		agentName: ([taken]) => pickName(taken),
		agentProfiles: () => PROFILES,
		...askHandlers,
		sendToApp: (args) => sendToApp(...args),
		queryApp: (args) => queryApp(...args),
		...extraAsks(placeOf),
	});
	tree.listen(logProblems);
	tree.start(trail(C));
	const send = (name, args = []) => tree.send(name, args, { now: true });

	// The traces of the trail's log, told whenever its log or nodes are other ones.
	let tracesHost = null;
	const shown = { log: null, nodes: null };
	const syncTraces = () => {
		if (tracesHost === null) return;
		const { log, nodes } = tree.root;
		if (log === shown.log && nodes === shown.nodes) return;
		Object.assign(shown, { log, nodes });
		tracesHost.send("show", [log, nodes], { now: true });
		onTraces?.(tracesOf(log, nodes).length);
	};
	if (tracesNode !== null) {
		tracesHost = new Host({ document, rootNode: tracesNode });
		const TC = tracesHost.scope.register(tracesComponents);
		tracesHost.listen(logProblems);
		tracesHost.start(traces(TC));
		tree.listen((record) => {
			if (record.kind === "hostEvent" && record.type === "rendered") syncTraces();
		});
	}

	// The app's tree read again: its rows and its places, for the tree and every probe.
	const refresh = () => {
		clearTimeout(state.timer);
		state.timer = null;
		state.stale = false;
		if (host.root === null) return;
		const rows = rowsOf(host.root);
		state.paths = new Map(rows.filter(({ row }) => row.key !== "").map((r) => [r.row.key, r.path]));
		send("show", [rows.map(({ row }) => row), nodesOf(rows)]);
		syncTraces();
	};
	const schedule = () => {
		state.stale = true;
		if (!active()) return;
		if (delay === 0) return refresh();
		state.timer ??= setTimeout(refresh, delay);
	};
	host.listen((record) => {
		if (record.kind !== "hostEvent") return;
		if (record.type === "rendered" || record.type === "started") schedule();
	});
	if (active()) refresh();
	else state.stale = true;
	send("checkInference");
	return {
		tree,
		traces: tracesHost,
		placeOf,
		// Reads the app again, at once; with stale, only when a render came since.
		refresh: ({ stale = false } = {}) => {
			if (!stale || state.stale) refresh();
		},
		// What the page compiles the classes of: the trail's components and the traces'.
		specs: [...Object.values(components), ...Object.values(tracesComponents)],
	};
};
