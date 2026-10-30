// From the tree spec's exported JSON (spec/tree/export.rkt) to components. A state is a
// snapshot, so everything a view shows about it is worked out here, once: where each instance
// is drawn, where each message's address leads under the scenario's policy, and the arrows.

// Geometry, in SVG units: a node's box, the room each leaf takes, and the rows.
export const NODE_W = 128;
export const NODE_H = 54;
export const COL = 148;
export const ROW = 104;
export const MARGIN = 24;

// ---- the tree -----------------------------------------------------------------
const childrenOf = (node) =>
	node.slots.flatMap((slot) => slot.items.map((item) => ({ slot, item })));
const stepText = (slot, item) =>
	slot.type === "field"
		? slot.name
		: `${slot.name}[${slot.type === "map" ? JSON.stringify(item.key) : item.key}]`;
const pathKey = (path) => path.map((s) => `${s.slot}:${s.key}`).join("/");

// Tidy layout: leaves (and cleared places) take the next column, a parent sits above the middle
// of its children. Rows start at 1: row 0 is the host's.
const layout = (root) => {
	const nodes = new Map(); // id -> { x, y, node, path }
	const byPath = new Map(); // path key -> id
	const ghosts = new Map(); // item -> { x, y }
	let column = 0;
	const place = (node, depth, path) => {
		const kids = childrenOf(node);
		const xs = [];
		for (const { slot, item } of kids) {
			const step = { slot: slot.name, key: item.key };
			if (item.node) xs.push(place(item.node, depth + 1, [...path, step]));
			else {
				const x = column++;
				ghosts.set(item, { x, y: depth + 1 });
				xs.push(x);
			}
		}
		const x = xs.length === 0 ? column++ : (xs[0] + xs[xs.length - 1]) / 2;
		nodes.set(node.id, { x, y: depth, node, path });
		byPath.set(pathKey(path), node.id);
		return x;
	};
	place(root, 1, []);
	const px = (x) => MARGIN + x * COL + NODE_W / 2;
	const py = (y) => MARGIN + y * ROW + NODE_H / 2;
	for (const p of nodes.values()) Object.assign(p, { x: px(p.x), y: py(p.y) });
	for (const p of ghosts.values()) Object.assign(p, { x: px(p.x), y: py(p.y) });
	const width = MARGIN * 2 + Math.max(column, 1) * COL;
	const depth = Math.max(...[...nodes.values()].map((p) => p.y), py(1));
	return {
		nodes,
		byPath,
		ghosts,
		host: { x: nodes.get(root.id).x, y: py(0) },
		width,
		height: depth + NODE_H / 2 + MARGIN,
	};
};

// ---- addresses ----------------------------------------------------------------
export const addressText = (a) => {
	if (a.host) return "host";
	const path = a.path.length === 0 ? "root" : a.path.map((s) => s.text).join(".");
	return `${path} #${a.id}`;
};

// Where an address leads under a policy: { pos, id, status } with status ok, misroute (another
// instance than the one recorded), stale (refused for that), orphaned (nothing) or host.
const resolve = (lay, a, policy) => {
	if (a.host) return { pos: lay.host, id: "host", status: "host" };
	const atPath = lay.nodes.get(lay.byPath.get(pathKey(a.path)));
	const atId = lay.nodes.get(a.id);
	const found = (p) =>
		p === undefined
			? { pos: null, id: null, status: "orphaned" }
			: { pos: p, id: p.node.id, status: p.node.id === a.id ? "ok" : "misroute" };
	switch (policy) {
		case "by-path":
			return found(atPath);
		case "by-path-checked":
			if (atPath !== undefined && atPath.node.id !== a.id)
				return { pos: null, id: atPath.node.id, status: "stale" };
			return found(atPath);
		case "anchored": {
			if (a.anchor === null) return found(atId);
			const sender = lay.nodes.get(a.anchor.sender);
			if (sender === undefined) return found(undefined);
			return found(lay.nodes.get(lay.byPath.get(pathKey([...sender.path, ...a.anchor.rel]))));
		}
		default:
			return found(atId);
	}
};

const posOf = (lay, a) => {
	if (a.host) return lay.host;
	return lay.nodes.get(a.id) ?? lay.nodes.get(lay.byPath.get(pathKey(a.path))) ?? null;
};
const parentPos = (lay, p) => {
	if (p.path.length === 0) return lay.host;
	return lay.nodes.get(lay.byPath.get(pathKey(p.path.slice(0, -1))));
};

const STATUS_NOTE = {
	ok: (r) => `reaches #${r.id}`,
	host: () => "reaches the host",
	misroute: (r, a) => `reaches #${r.id}, not #${a.id}`,
	stale: (r, a) => `stale: #${r.id} is where #${a.id} was`,
	orphaned: () => "orphaned: reaches nothing",
};

// A curve from a to b, bent by bend; a loop when they're the same point.
const curve = (a, b, bend) => {
	if (a.x === b.x && a.y === b.y) {
		const x = a.x + NODE_W / 2;
		return `M ${x} ${a.y - 10} C ${x + 50} ${a.y - 40}, ${x + 50} ${a.y + 40}, ${x} ${a.y + 10}`;
	}
	const mx = (a.x + b.x) / 2;
	const my = (a.y + b.y) / 2;
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const len = Math.hypot(dx, dy);
	const cx = mx - (dy / len) * bend;
	const cy = my + (dx / len) * bend;
	// End at the box's edge, not its middle.
	const end = edgePoint(b, { x: cx, y: cy });
	const start = edgePoint(a, { x: cx, y: cy });
	return `M ${start.x} ${start.y} Q ${cx} ${cy} ${end.x} ${end.y}`;
};
const edgePoint = (center, toward) => {
	const dx = toward.x - center.x;
	const dy = toward.y - center.y;
	const sx = dx === 0 ? Infinity : NODE_W / 2 / Math.abs(dx);
	const sy = dy === 0 ? Infinity : NODE_H / 2 / Math.abs(dy);
	const s = Math.min(sx, sy, 1);
	return { x: Math.round(center.x + dx * s), y: Math.round(center.y + dy * s) };
};

// What a message shows and the arrows it draws.
const routeOf = (lay, m, policy, index, place) => {
	const from = posOf(lay, m.from);
	if (m.hop) {
		const last = resolve(lay, m.to, policy);
		const lastPos = last.pos === null ? null : lay.nodes.get(last.id);
		if (lastPos === undefined || lastPos === null) {
			const lost = m.expected !== null;
			return {
				note: lost ? "lost: its last hop is gone" : "orphaned: its sender is gone",
				status: lost ? "misroute" : "orphaned",
				arrows: [],
			};
		}
		const next = parentPos(lay, lastPos);
		const to = next === lay.host ? "the host" : `#${next.node.id}`;
		return {
			note: `bubbles up to ${to}`,
			status: "ok",
			arrows: [{ d: curve(lastPos, next, 30 + index * 6), status: m.mode, msg: index, place }],
		};
	}
	const r = resolve(lay, m.to, policy);
	const arrows = [];
	const bend = 30 + index * 8;
	if (from !== null && r.pos !== null)
		arrows.push({
			d: curve(from, r.pos, bend),
			status: r.status === "misroute" ? "misroute" : m.mode,
			msg: index,
			place,
		});
	// Where the address was meant to go, when that's somewhere else.
	const meant = m.to.host ? null : lay.nodes.get(m.to.id);
	if (from !== null && meant !== undefined && meant !== null && meant !== r.pos)
		arrows.push({ d: curve(from, meant, -bend), status: "meant", msg: index, place });
	return { note: STATUS_NOTE[r.status](r, m.to), status: r.status, arrows };
};

// ---- components -----------------------------------------------------------------
const instanceOf = (C, node, lay, selected) => {
	const p = lay.nodes.get(node.id);
	return C.Instance({
		kind: node.kind,
		id: node.id,
		control: node.control,
		locals: node.locals,
		x: p.x,
		y: p.y,
		selected: node.id === selected,
		slots: node.slots.map((slot) =>
			C.Slot({
				name: slot.name,
				type: slot.type,
				items: slot.items.map((item) => {
					const at = item.node ? lay.nodes.get(item.node.id) : lay.ghosts.get(item);
					return C.Item({
						key: item.key,
						step: stepText(slot, item),
						cleared: item.cleared,
						x: at.x,
						y: at.y,
						node: item.node ? instanceOf(C, item.node, lay, selected) : null,
					});
				}),
			}),
		),
	});
};

const messageOf = (C, m, route, index) =>
	C.Message({
		index,
		mode: m.mode,
		name: m.name,
		args: m.args.join(", "),
		request: m.request ?? -1,
		urgent: m.urgent,
		result: m.result === null ? "" : `${m.result.kind} ${m.result.value}`.trim(),
		from: addressText(m.from),
		to: addressText(m.to),
		hop: m.hop,
		note: route.note,
		status: route.status,
	});

// One state of the scenario, as a World. policy decides where addresses lead.
export const worldOf = (C, state, policy, gran = "turn") => {
	const lay = layout(state.tree);
	const msgs = [
		...state.queue.map((m) => ["queue", m]),
		...state.inflight.map((m) => ["inflight", m]),
	];
	const routes = msgs.map(([place, m], i) => routeOf(lay, m, policy, i, place));
	return C.World({
		policy,
		gran,
		tree: instanceOf(C, state.tree, lay, -1),
		hostX: lay.host.x,
		hostY: lay.host.y,
		width: lay.width,
		height: lay.height,
		queue: state.queue.map((m, i) => messageOf(C, m, routes[i], i)),
		inflight: state.inflight.map((m, i) =>
			messageOf(C, m, routes[state.queue.length + i], state.queue.length + i),
		),
		arrows: routes.flatMap((r) => r.arrows.map(({ d, status, msg }) => ({ d, status, msg }))),
		script: state.script,
		obs: state.obs.map((o) => C.Observation({ kind: o.kind, text: o.text, bad: o.bad })),
		quiescent: state.quiescent,
	});
};

// A whole exported scenario, as an Explorer at its first state.
export const explorerOf = (C, json) =>
	C.Explorer({
		name: json.name,
		tier: json.tier,
		title: json.title,
		blurb: json.blurb,
		program: C.Program({
			kinds: json.kinds,
			host: json.host,
			policy: json.policy,
			gran: json.gran,
		}),
		states: json.states.map((s) => worldOf(C, s, json.policy, json.gran)),
		edges: json.edges,
	});
