// Testing components from pure-tutuca's model of their module (pure-tutuca model --pbt-model):
// what a component's state may be (fields, types, constraints in normal form)
// and how each message moves it from one state to the next (its pre, changes,
// post and emits), which a dev host checks as messages run.
//
// - walk: random walks. A generated start state, then messages whose guard
//   holds, with generated arguments, through a headless dev host; a walk
//   fails when the host reports an issue (an ensures, a frame, an emit, a
//   field, an invariant) or a failure. The failing trace is shrunk to the
//   shortest sequence of messages that still fails.
// - exhaust: bounded exhaustive exploration of small state spaces (enums,
//   small intervals, keys of the state's collections): the reachable states,
//   the messages never enabled, the states where none is.
// - examples: the model's example blocks, run as regression tests.
//
// Generated values meet the constraints the model states (bounds, lengths,
// keys of a field); patterns are left to the runtime, which rejects what
// doesn't fit them. Invariants
// aren't aimed at: walk skips start states that break them.

// ---- Randomness -------------------------------------------------------------------

// A generator of numbers in [0, 1) from seed: mulberry32, as testEnv uses.
export const rng = (seed = 1) => {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let x = state;
		x = Math.imul(x ^ (x >>> 15), x | 1);
		x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
		return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
	};
};
const pick = (rand, xs) => xs[Math.floor(rand() * xs.length)];
const intIn = (rand, lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

// ---- Reading the state --------------------------------------------------------------

// Wasm-gc objects (components) reach JS as objects with a null prototype.
const isWasm = (v) => v !== null && typeof v === "object" && Object.getPrototypeOf(v) === null;

// A plain copy of a value: components become { $: type, ...fields and properties }.
export const snapshot = (runtime, v) => {
	if (isWasm(v)) {
		const schema = runtime.schema(v);
		const out = { $: runtime.typeName(v) };
		if (schema === null) return out;
		for (const f of [...schema.fields, ...schema.gets]) out[f.name] = snapshot(runtime, runtime.get(v, f.name));
		return out;
	}
	if (Array.isArray(v)) return v.map((x) => snapshot(runtime, x));
	if (v !== null && typeof v === "object") {
		return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, snapshot(runtime, x)]));
	}
	return v;
};

// ---- Expectations ----------------------------------------------------------------------


// Whether got has what want says: the same scalar, a list of as many items
// each matching, or an object whose every key want names matches (others,
// and a component's $, aren't looked at).
export const matches = (want, got) => {
	if (Array.isArray(want)) return Array.isArray(got) && got.length === want.length && want.every((w, i) => matches(w, got[i]));
	if (want !== null && typeof want === "object") {
		return got !== null && typeof got === "object" && Object.entries(want).every(([k, w]) => matches(w, got[k]));
	}
	return Object.is(want, got) || want === got;
};

// ---- Generating values ---------------------------------------------------------------

const NO_VALUE = Symbol("no value");
const LETTERS = "abcdexyz";

const keysOf = (v) => (Array.isArray(v) ? v.map((_, i) => i) : v && typeof v === "object" ? Object.keys(v) : []);

// A value of type meeting norm, or NO_VALUE when none can be made (a key of an
// empty collection). ctx: { rand, state (a snapshot, for keys of fields), make (a
// component of a name), depth }.
const gen = (type, norm, ctx) => {
	const { rand } = ctx;
	if (norm?.keyOf?.length) {
		const keys = keysOf(ctx.state[norm.keyOf[0]]);
		if (keys.length === 0) return type.kind === "option" ? null : NO_VALUE;
		if (type.kind === "option" && rand() < 0.2) return null;
		return pick(rand, keys);
	}
	return genType(type, norm, ctx);
};

// The interval to draw a number from: the constraints', or [lo, hi] around
// the one bound there is, or [lo, hi].
const bounds = (norm, lo, hi) => {
	const l = norm?.lo ? norm.lo.value + (norm.lo.exclusive ? 0.01 : 0) : null;
	const h = norm?.hi ? norm.hi.value - (norm.hi.exclusive ? 0.01 : 0) : null;
	if (l !== null && h !== null) return [l, h];
	if (l !== null) return [l, l + (hi - lo)];
	if (h !== null) return [h - (hi - lo), h];
	return [lo, hi];
};

const lengths = (norm, max) => {
	const lo = norm?.lenLo ?? 0;
	const hi = Math.min(norm?.lenHi ?? lo + max, lo + max);
	return [lo, hi];
};

// A number constrained to whole numbers (f64 with the int constraint) is drawn as a whole one.
const kindOf = (type, norm) => (type.kind === "f64" && norm?.int ? "int" : type.kind);

const genType = (type, norm, ctx) => {
	const { rand } = ctx;
	switch (kindOf(type, norm)) {
		case "bool":
			return rand() < 0.5;
		case "int": {
			const [lo, hi] = bounds(norm, -10, 10);
			return intIn(rand, Math.ceil(lo), Math.floor(hi));
		}
		case "f64": {
			const [lo, hi] = bounds(norm, -10, 10);
			return Math.round((lo + rand() * (hi - lo)) * 100) / 100;
		}
		case "string": {
			const [lo, hi] = lengths(norm, 5);
			const n = intIn(rand, lo, hi);
			return Array.from({ length: n }, () => pick(rand, LETTERS)).join("");
		}
		case "enum":
			return pick(rand, type.members);
		case "null":
		case "any":
			return null;
		case "option":
			return rand() < 0.25 ? null : gen(type.item, norm, ctx);
		case "list": {
			const [lo, hi] = lengths(norm, ctx.depth > 1 ? 1 : 3);
			const out = [];
			for (let i = intIn(rand, lo, hi); i > 0; i--) {
				const v = gen(type.item, null, { ...ctx, depth: ctx.depth + 1 });
				if (v === NO_VALUE) return NO_VALUE;
				out.push(v);
			}
			return out;
		}
		case "map": {
			const [lo, hi] = lengths(norm, 2);
			const out = {};
			for (let i = intIn(rand, lo, hi); i > 0; i--) {
				const v = gen(type.item, null, { ...ctx, depth: ctx.depth + 1 });
				if (v === NO_VALUE) return NO_VALUE;
				out[`k${i}`] = v;
			}
			return out;
		}
		case "record": {
			const out = {};
			for (const f of type.fields) {
				const v = gen(f.type, null, ctx);
				if (v === NO_VALUE) return NO_VALUE;
				out[f.name] = v;
			}
			return out;
		}
		case "one_of":
			return gen(pick(rand, type.types), null, ctx);
		case "component":
			if (ctx.depth > 2 || type.names.length === 0) return NO_VALUE;
			return ctx.make(pick(rand, type.names), ctx) ?? NO_VALUE;
	}
	return NO_VALUE;
};

// ---- A component's model -------------------------------------------------------------

// What the runner needs of a package model, with runtime and scope.
const prepare = ({ runtime, scope, model }) => {
	const byName = new Map(model.components.map((c) => [c.name, c]));
	const interfaces = new Map((model.interfaces ?? []).map((i) => [i.name, i]));
	// The name a component type is registered as.
	const registered = (name) => model.registers.find((r) => r.component === name)?.as ?? name;
	// Fields for a component of name: its own, or the interface's.
	const fieldsFor = (name, ctx, start = {}) => {
		const c = byName.get(name) ?? model.components.find((x) => registered(x.name) === name);
		const fields = c?.fields ?? interfaces.get(name)?.fields ?? [];
		const order = c?.fieldOrder ?? fields.map((f) => f.name);
		const out = { ...start };
		for (const name of order) {
			if (name in out) continue;
			const f = fields.find((x) => x.name === name);
			const v = gen(f.type, f.norm, { ...ctx, state: out });
			if (v === NO_VALUE) {
				if (f.required) return null;
				continue;
			}
			out[name] = v;
		}
		return out;
	};
	const make = (name, ctx) => {
		const fields = fieldsFor(name, { ...ctx, depth: ctx.depth + 1 });
		if (fields === null) return null;
		try {
			return runtime.make(scope, name, fields);
		} catch {
			return null;
		}
	};
	return { byName, registered, fieldsFor, make };
};

// The root's model component, after a swap too, or undefined.
const modelOf = (runtime, m, root) => m.byName.get(runtime.typeName(root));

// A message of comp to send to root now, with generated arguments, or null
// when none is enabled.
const nextMessage = (runtime, m, comp, root, rand) => {
	const state = snapshot(runtime, root);
	const candidates = [...comp.messages];
	for (let i = candidates.length - 1; i > 0; i--) {
		const j = Math.floor(rand() * (i + 1));
		[candidates[i], candidates[j]] = [candidates[j], candidates[i]];
	}
	for (const msg of candidates) {
		for (let attempt = 0; attempt < 4; attempt++) {
			const ctx = { rand, state, make: m.make, depth: 0 };
			const args = msg.params.map((p) => gen(p.type, p.norm, ctx));
			if (args.includes(NO_VALUE)) break;
			if (runtime.messageProblem(root, msg.name, args) === null) return { name: msg.name, args };
		}
	}
	return null;
};

// ---- Random walks ---------------------------------------------------------------------

// Runs trace from start (a component made from fields) on a headless dev host;
// what went wrong, or null. A step whose guard doesn't hold (after shrinking)
// is skipped.
const replay = (runtime, scope, typeName, fields, trace) => {
	const host = runtime.createHost(null, null, runtime.make(scope, typeName, fields), { dev: true });
	const ran = [];
	for (const step of trace) {
		if (runtime.messageProblem(host.root(), step.name, step.args) !== null) continue;
		host.send(step.name, step.args, { now: true });
		ran.push(step);
		if (host.issues.length > 0 || host.failures.length > 0) {
			return { trace: ran, issues: host.issues, failures: host.failures.map((e) => e.rejection ?? e.message) };
		}
	}
	return null;
};

// Whether trace still fails from a component of component made from start.
export const fails = ({ runtime, scope, model, component, start, trace }) => {
	const m = prepare({ runtime, scope, model });
	return replay(runtime, scope, m.registered(component), start, trace) !== null;
};

// Greedily drops steps while the failure stays: what's left is 1-minimal,
// no single step can go.
const shrink = (runtime, scope, typeName, fields, failure) => {
	let best = failure;
	let changed = true;
	while (changed) {
		changed = false;
		for (let i = 0; i < best.trace.length; i++) {
			const candidate = [...best.trace.slice(0, i), ...best.trace.slice(i + 1)];
			const again = replay(runtime, scope, typeName, fields, candidate);
			if (again !== null) {
				best = again;
				changed = true;
				break;
			}
		}
	}
	return best;
};

// An issue the host reported that is about invariants only.
const breaksOnlyInvariants = (issue) => (issue.issues ?? [issue]).every((i) => i.reason?.startsWith("invariant:"));

// Random walks over component (its runtime type name) of model, in scope.
// Resolves { ok, runs } or { ok: false, start, trace, issues, failures }: the
// start state's fields and the shortest message sequence found that fails.
export const walk = ({ runtime, scope, model, component, runs = 50, steps = 25, seed = 1 }) => {
	const m = prepare({ runtime, scope, model });
	const rand = rng(seed);
	const typeName = m.registered(component);
	for (let run = 0; run < runs; run++) {
		const fields = m.fieldsFor(component, { rand, make: m.make, depth: 0 });
		if (fields === null) continue;
		let root;
		try {
			root = runtime.make(scope, typeName, fields);
		} catch {
			continue;
		}
		const host = runtime.createHost(null, null, root, { dev: true });
		// A start state that only breaks invariants is one the generator made,
		// not one the component reached: skip it, as make's rejections are.
		if (host.issues.length > 0 && host.issues.every(breaksOnlyInvariants)) continue;
		if (host.issues.length > 0) {
			return { ok: false, start: fields, trace: [], issues: host.issues, failures: [] };
		}
		const trace = [];
		for (let step = 0; step < steps; step++) {
			const comp = modelOf(runtime, m, host.root());
			if (!comp) break;
			const msg = nextMessage(runtime, m, comp, host.root(), rand);
			if (msg === null) break;
			host.send(msg.name, msg.args, { now: true });
			trace.push(msg);
			if (host.issues.length > 0 || host.failures.length > 0) {
				const failure = { trace, issues: host.issues, failures: host.failures.map((e) => e.rejection ?? e.message) };
				return { ok: false, start: fields, ...shrink(runtime, scope, typeName, fields, failure) };
			}
		}
	}
	return { ok: true, runs };
};

// ---- Exhaustive exploration ---------------------------------------------------------------

// A message's argument domain at state: every value, when it's small; null
// when a parameter's type can't be enumerated.
const domain = (type, norm, state) => {
	if (norm?.keyOf?.length) {
		const keys = keysOf(state[norm.keyOf[0]]);
		return type.kind === "option" ? [null, ...keys] : keys;
	}
	const values = (() => {
		switch (kindOf(type, norm)) {
			case "bool":
				return [false, true];
			case "enum":
				return type.members;
			case "int": {
				const lo = norm?.lo?.value ?? -2;
				const hi = norm?.hi?.value ?? 2;
				if (hi - lo <= 8) return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
				return [...new Set([lo, lo + 1, Math.floor((lo + hi) / 2), hi - 1, hi])];
			}
			case "string":
				return ["", "a"];
			case "option": {
				const inner = domain(type.item, norm, state);
				return inner === null ? null : [null, ...inner];
			}
			case "null":
				return [null];
			default:
				return null;
		}
	})();
	return values ?? null;
};

const product = (lists) => lists.reduce((acc, xs) => acc.flatMap((a) => xs.map((x) => [...a, x])), [[]]);

// Explores the states reachable from a component made from start (fields),
// breadth first, up to maxStates: { states, transitions, neverEnabled (message
// names), deadlocks (snapshots of states where no message is enabled), issues
// (what the dev host reported, with the transition) }.
export const exhaust = ({ runtime, scope, model, component, start = {}, maxStates = 500 }) => {
	const m = prepare({ runtime, scope, model });
	const typeName = m.registered(component);
	const first = runtime.make(scope, typeName, start);
	const seen = new Map([[JSON.stringify(snapshot(runtime, first)), first]]);
	const queue = [first];
	const enabled = new Set();
	const deadlocks = [];
	const issues = [];
	let transitions = 0;
	const comp0 = modelOf(runtime, m, first);
	while (queue.length > 0) {
		const root = queue.shift();
		const comp = modelOf(runtime, m, root);
		if (!comp) continue;
		const state = snapshot(runtime, root);
		let any = false;
		for (const msg of comp.messages) {
			const domains = msg.params.map((p) => domain(p.type, p.norm, state));
			if (domains.includes(null)) continue;
			for (const args of product(domains)) {
				if (runtime.messageProblem(root, msg.name, args) !== null) continue;
				any = true;
				enabled.add(msg.name);
				const host = runtime.createHost(null, null, root, { dev: true });
				host.send(msg.name, args, { now: true });
				transitions++;
				if (host.issues.length > 0 || host.failures.length > 0) {
					issues.push({ from: state, message: msg.name, args, issues: host.issues, failures: host.failures.map((e) => e.rejection ?? e.message) });
				}
				const next = host.root();
				const key = JSON.stringify(snapshot(runtime, next));
				if (!seen.has(key) && seen.size < maxStates) {
					seen.set(key, next);
					queue.push(next);
				}
			}
		}
		if (!any) deadlocks.push(state);
	}
	return {
		states: seen.size,
		transitions,
		neverEnabled: (comp0?.messages ?? []).map((x) => x.name).filter((n) => !enabled.has(n)),
		deadlocks,
		issues,
	};
};

// ---- Examples --------------------------------------------------------------------------

// Runs model's example blocks: [{ name, ok, failures }], a failure being what an
// expect said that didn't hold, an issue or a failure of the host.
export const examples = ({ runtime, scope, model }) => {
	const m = prepare({ runtime, scope, model });
	return model.examples.map((ex) => {
		const failures = [];
		let host;
		try {
			host = runtime.createHost(null, null, runtime.make(scope, m.registered(ex.component), ex.start), { dev: true });
		} catch (error) {
			return { name: ex.name, ok: false, failures: [`can't make ${ex.component}: ${error.message}`] };
		}
		for (const step of ex.steps) {
			if ("send" in step) {
				const seen = host.reports.length;
				host.send(step.send, step.args, { now: true });
				for (const r of host.reports.slice(seen)) {
					if (r.type === "taskFailed") failures.push(`${step.send}: ${r.error.message}`);
					if (r.type === "stateInvalid" || r.type === "messageInvalid") failures.push(`${step.send}: ${JSON.stringify(r)}`);
				}
			} else {
				const now = snapshot(runtime, host.root());
				for (const [k, want] of Object.entries(step.expect)) {
					if (!matches(want, now[k])) failures.push(`expected ${k} to be ${JSON.stringify(want)}, not ${JSON.stringify(now[k])}`);
				}
			}
		}
		return { name: ex.name, ok: failures.length === 0, failures };
	});
};
