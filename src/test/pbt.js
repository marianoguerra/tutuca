// Property based testing for tutuca components with fast-check, derived from field and
// message schemas. fast-check is passed in, so tutuca itself doesn't depend on it.
import {
	AnyType,
	ArrayType,
	BooleanType,
	ComponentType,
	component,
	DispatchPath,
	EnumType,
	Frame,
	field,
	findInvalidFields,
	Host,
	IndexType,
	isComponent,
	MapType,
	messageIssues,
	NumberType,
	OptionType,
	RecordType,
	render,
	Selector,
	StringType,
	scopeOf,
	specOf,
	Target,
	TargetValue,
	Task,
	t,
	UnionType,
} from "../tutuca.js";

const mapValues = (record, fn) =>
	Object.fromEntries(Object.entries(record).map(([k, v]) => [k, fn(v, k)]));
// Errors make throws for state it can't default, not bugs in the component.
const NO_DEFAULT = /has no default|has no key|no scope to make/;

// Every spec registered in scope or its parents, by name; inner registrations win.
export const registeredSpecs = (scope) => {
	const specs = {};
	for (let s = scope; s !== null; s = s.parent) {
		for (const name in s.byName) specs[name] ??= s.byName[name];
	}
	return specs;
};

// A key chosen in a collection that only exists once the owner does: n picks among its keys.
export class KeyRef {
	constructor(n) {
		this.n = n;
	}
	resolve(keys) {
		return keys.length === 0 ? undefined : keys[this.n % keys.length];
	}
	toString() {
		return `key#${this.n}`;
	}
}
const indexOf = (type) => (type instanceof OptionType ? indexOf(type.valueType) : type);
const isIndex = (type) => indexOf(type) instanceof IndexType;
// Resolve KeyRefs in a value generated for type against owner.
export const resolveRefs = (value, type, owner) => {
	if (!(value instanceof KeyRef)) return value;
	return value.resolve(indexOf(type).keysIn(owner));
};

class Unbounded extends Error {
	constructor(type) {
		super(
			`no component for ${type.names.join("|") || "t.component()"} can be built within maxDepth`,
		);
	}
}

// Arbitraries for field types, make args and component instances made in scope.
// overrides maps a component name to (A, depth) => arbitrary of its instances, for
// invariants too sparse to reach by filtering.
export const arbitraries = ({
	fc,
	scope,
	maxDepth = 2,
	maxLength = 3,
	numberRange = 1000,
	overrides = {},
}) => {
	const specs = registeredSpecs(scope);
	for (const spec of Object.values(specs)) printCompactly(spec);
	const cache = new Map();
	const tryMake = (spec, args) => {
		try {
			return spec.make(args, scope);
		} catch (error) {
			if (NO_DEFAULT.test(error.message)) return undefined;
			throw error;
		}
	};
	// Specs makeable with no args end the recursion once maxDepth is reached.
	const leaves = Object.values(specs).filter((spec) => tryMake(spec, {}) !== undefined);
	const leafOf = (spec) => fc.constant(null).map(() => spec.make({}, scope));
	const specFor = (specOrName) => (typeof specOrName === "string" ? specs[specOrName] : specOrName);

	// Candidates that can't be built within maxDepth are left out; none left is an error.
	const component = (type, depth) => {
		const named = type.names.map((name) => specs[name]).filter(Boolean);
		const candidates = named.length > 0 ? named : Object.values(specs);
		const leafOrNull = (spec) => (leaves.includes(spec) ? leafOf(spec) : null);
		const arbs = candidates
			.map((spec) =>
				depth >= maxDepth ? leafOrNull(spec) : (buildable(spec, depth + 1) ?? leafOrNull(spec)),
			)
			.filter((arb) => arb !== null);
		if (arbs.length === 0) throw new Unbounded(type);
		return fc.oneof(...arbs);
	};
	const buildable = (spec, depth) => {
		try {
			return instance(spec, depth);
		} catch (error) {
			if (error instanceof Unbounded) return null;
			throw error;
		}
	};
	const lengths = ({ minLength = 0, maxLength: max = Infinity }, depth) => ({
		minLength,
		maxLength: depth >= maxDepth ? minLength : Math.max(minLength, Math.min(max, maxLength)),
	});
	const derive = (type, depth) => {
		const c = type.constraints;
		if (type instanceof OptionType) return fc.option(value(type.valueType, depth), { nil: null });
		if (type instanceof IndexType) return fc.nat().map((n) => new KeyRef(n));
		if (type instanceof EnumType) return fc.constantFrom(...type.members);
		if (type instanceof BooleanType) return fc.boolean();
		if (type instanceof StringType) {
			const { minLength, maxLength: max } = lengths(c, 0);
			if (c.pattern !== undefined) return fc.stringMatching(c.pattern);
			return fc.string({ minLength, maxLength: max });
		}
		if (type instanceof NumberType) {
			// Unbounded sides stay within numberRange of the other bound, so invariants on counts
			// and pages are met often enough to filter for.
			const min = c.min ?? Math.min(-numberRange, (c.max ?? 0) - numberRange);
			const max = c.max ?? Math.max(numberRange, min + numberRange);
			if (c.int) return fc.integer({ min: Math.ceil(min), max: Math.floor(max) });
			return fc.double({ min, max, noNaN: true });
		}
		if (type instanceof ArrayType) return fc.array(value(type.valueType, depth), lengths(c, depth));
		if (type instanceof MapType) {
			const { minLength: minKeys, maxLength: maxKeys } = lengths(c, depth);
			const key = fc.string({ maxLength: 4 }).filter((k) => k !== "__proto__");
			return fc.dictionary(key, value(type.valueType, depth), { minKeys, maxKeys });
		}
		if (type instanceof RecordType) return fc.record(mapValues(type.shape, (v) => value(v, depth)));
		if (type instanceof UnionType) return fc.oneof(...type.types.map((v) => value(v, depth)));
		if (type instanceof ComponentType) return component(type, depth);
		return fc.jsonValue();
	};
	// Valid values for type; KeyRefs stand in for t.index keys until the owner exists.
	const value = (type, depth = 0) => {
		const arb = type.generator === undefined ? derive(type, depth) : type.generator(fc, A);
		// Refinements and bounds the derived arbitrary can't express are met by filtering.
		const needsFilter =
			type.generator === undefined && !isIndex(type) && !(type instanceof ComponentType);
		return needsFilter ? arb.filter((v) => type.isValid(v, scope)) : arb;
	};
	const pool = () =>
		fc.oneof(
			fc.string({ maxLength: 4 }),
			fc.double(),
			fc.integer(),
			fc.boolean(),
			fc.constant(null),
			fc.array(fc.nat(), { maxLength: 2 }),
			fc.dictionary(fc.string({ maxLength: 2 }), fc.nat(), { maxKeys: 2 }),
		);
	// Values type rejects, or null when it accepts every defined value.
	const invalid = (type) => {
		const unwrapped = type instanceof OptionType ? type.valueType : type;
		const acceptsAll =
			unwrapped.constructor === AnyType && Object.keys(unwrapped.constraints).length === 0;
		if (acceptsAll) return null;
		return pool().filter((v) => !type.isValid(v, scope));
	};
	// Args for make: each field valid, invalid or missing.
	const args = (specOrName) => {
		const spec = specFor(specOrName);
		const fields = mapValues(spec.fields, (type) => {
			const options = [value(type), fc.constant(undefined)];
			const bad = invalid(type);
			return fc.oneof(...(bad === null ? options : [...options, bad]));
		});
		return fc.record(fields, { requiredKeys: [] });
	};
	const build = (spec, depth) => {
		const entries = Object.entries(spec.fields);
		const plain = Object.fromEntries(entries.filter(([, type]) => !isIndex(type)));
		const indexes = entries.filter(([, type]) => isIndex(type));
		const draft = fc.record(mapValues(plain, (type) => value(type, depth)));
		const withKeys = draft.chain((fieldArgs) => {
			if (indexes.length === 0) return fc.constant(fieldArgs);
			const keyArbs = Object.fromEntries(indexes.map(([name, type]) => [name, value(type, depth)]));
			return fc.record(keyArbs).map((refs) => {
				const owner = tryMake(spec, fieldArgs);
				const keys = mapValues(refs, (ref, name) => resolveRefs(ref, spec.fields[name], owner));
				return { ...fieldArgs, ...keys };
			});
		});
		const made = withKeys.map((a) => tryMake(spec, a)).filter((v) => v !== undefined);
		const { invariants } = spec;
		if (Object.keys(invariants).length === 0) return made;
		return made.filter((v) => Object.values(invariants).every((inv) => inv.call(v)));
	};
	// Component instances that pass their schema and invariants.
	const instance = (specOrName, depth = 0) => {
		const spec = specFor(specOrName);
		const key = `${spec.name}@${depth}`;
		if (!cache.has(key)) {
			const override = overrides[spec.name];
			try {
				cache.set(key, override === undefined ? build(spec, depth) : override(A, depth));
			} catch (error) {
				if (error instanceof Unbounded) cache.set(key, error);
				throw error;
			}
		}
		const cached = cache.get(key);
		if (cached instanceof Unbounded) throw cached;
		return cached;
	};
	const A = { fc, scope, specs, value, invalid, args, instance };
	return A;
};

// Counterexamples print components as their snapshot instead of their scope and spec.
const printCompactly = (spec) => {
	spec.proto[Symbol.for("fast-check/toStringMethod")] = function () {
		return JSON.stringify(snapshot(this));
	};
};

// A plain copy of a state for comparing runs: components become { $: name, ...fields }.
export const snapshot = (v) => {
	if (v === null || typeof v !== "object") return v;
	if (Array.isArray(v)) return v.map(snapshot);
	const out = isComponent(v) ? { $: specOf(v).name } : {};
	for (const key of Object.keys(v)) out[key] = snapshot(v[key]);
	return out;
};

const PROBLEMS = new Set(["taskFailed", "stateInvalid", "messageInvalid"]);

// Runs messages on a component tree through Host's task handling in dev mode, with no
// timers. With a document it renders too; otherwise it is headless. Live keeps the timers,
// for async ask replies and events from a user, and only keeps problems in reports;
// onReport gets every report as it happens.
export class Driver {
	constructor({ root, document = null, rootNode = null, live = false, onReport = null }) {
		const node = rootNode ?? document?.createElement("main") ?? { addEventListener() {} };
		this.host = new Host({ document, rootNode: node, dev: true });
		this.reports = [];
		this.host.notify = (type, info) => {
			const report = { type, ...info };
			if (!live || PROBLEMS.has(type)) this.reports.push(report);
			onReport?.(report);
		};
		if (!live) this.host.scheduleNextTaskTick = () => {};
		if (document === null) this.host.render = () => {};
		else
			for (const spec of Object.values(registeredSpecs(scopeOf(root)))) {
				this.host.addEventListeners(spec.eventNames);
			}
		this.host.start(root);
	}
	get state() {
		return this.host.rootComponent;
	}
	get rootNode() {
		return this.host.rootNode;
	}
	// Problems reported since start: failed tasks, invalid state, broken message specs.
	get problems() {
		return this.reports.filter((r) => PROBLEMS.has(r.type));
	}
	// Send name to the component at path, a DispatchPath or a Selector from the root; from is
	// the frames (or a Selector) from it to the child the message comes through, which sets
	// ctx.sourceKey.
	send(path, name, args = [], from = []) {
		const base = path instanceof Selector ? new DispatchPath(path.freeze(this.state)) : path;
		const fromFrames =
			from instanceof Selector ? from.freeze(base.resolve().getIn(this.state)) : from;
		const task = new Task(name, args, base.concat(fromFrames), new Target(base), null);
		this.host.prepareTask(task, this.state);
		this.host.pushTask(task);
		this.drain();
	}
	drain() {
		while (this.host.tasks.length > 0) this.host.handleTasks();
	}
	// Continue from root instead, dropping queued tasks: rewinds a timeline. An async ask
	// reply already in flight still arrives, against the new root.
	restart(root) {
		const { host } = this;
		host.tasks.length = 0;
		clearTimeout(host._taskTickTimeoutId);
		host._taskTickTimeoutId = null;
		host.start(root);
	}
}

// The frame that reads keys from the previous component: the last key is the item, if
// any collection was crossed.
const frameFor = (keys) =>
	keys.length === 1
		? new Frame(keys, null, null, true)
		: new Frame(keys.slice(0, -1), keys.at(-1), null, true);
// The components in state with the path to each, parents first.
export const componentPaths = (state) => {
	const found = [];
	// keys: read since the last component, null at the root.
	const visit = (value, frames, keys) => {
		if (value === null || typeof value !== "object") return;
		if (isComponent(value)) {
			const path = keys === null ? frames : [...frames, frameFor(keys)];
			found.push({ path: new DispatchPath(path), instance: value });
			for (const name of Object.keys(specOf(value).fields)) visit(value[name], path, [name]);
			return;
		}
		for (const key of Object.keys(value)) {
			visit(value[key], frames, [...keys, Array.isArray(value) ? Number(key) : key]);
		}
	};
	visit(state, [], null);
	return found;
};

const EVENT_ARG = { TargetValue: (fc) => fc.oneof(fc.string({ maxLength: 6 }), fc.boolean()) };
// Arbitraries of args for a message: its declared types, else the args of the sends in the
// spec's views when every one is a constant or targetValue; null when it can't be driven.
const argsFor = (A, spec, message) => {
	const { fc } = A;
	if (message.args !== undefined) return fc.tuple(...message.args.map((type) => A.value(type)));
	const sends = [...spec.eventHandlers.values()]
		.flat()
		.map((h) => h.action)
		.filter((action) => action.name === message.name);
	const tuples = [];
	for (const { args } of sends) {
		const arbs = args.map((arg) => {
			if (arg instanceof TargetValue) return EVENT_ARG.TargetValue(fc);
			return arg.constructor.kind === "constant" ? fc.constant(arg.value) : null;
		});
		if (!arbs.includes(null)) tuples.push(fc.tuple(...arbs));
	}
	return tuples.length === 0 ? null : fc.oneof(...tuples);
};

// The messages of spec that can be generated, as { message, args, from }; from builds the
// source steps for messages that declare a sourceKey of a t.index field.
export const drivableMessages = (A, spec) => {
	const drivable = [];
	const untyped = [];
	for (const message of Object.values(spec.on)) {
		const args = argsFor(A, spec, message);
		if (args === null) {
			untyped.push(message.name);
			continue;
		}
		const index = message.sourceKey === undefined ? null : indexOf(message.sourceKey);
		if (index !== null && !(index instanceof IndexType)) {
			untyped.push(message.name); // A sourceKey the harness can't build a source path for.
			continue;
		}
		drivable.push({ message, args, index });
	}
	return { drivable, untyped };
};

const pathString = (path) =>
	path.frames
		.flatMap((f) => f.accessKeys)
		.map((k) => (typeof k === "number" ? `[${k}]` : `.${k}`))
		.join("") || "·";

// One line per problem a Driver reported, for errors and logs.
export const describeProblems = (problems) =>
	problems.map((p) => {
		if (p.type === "taskFailed") return `taskFailed: ${p.error?.stack ?? p.error}`;
		if (p.type === "messageInvalid") return `messageInvalid ${p.message}: ${p.issues.join(", ")}`;
		const issues = p.issues.map((i) => `${i.component} ${i.path.join(".")} ${i.reason}`);
		return `stateInvalid: ${issues.join("; ")}`;
	});

// Sends message to the target-th component of its spec in the current state.
export class MessageCommand {
	constructor(specName, { message, index }, target, args, keyRef, afterEach) {
		Object.assign(this, { specName, message, index, target, args, keyRef, afterEach });
		this.resolved = null;
	}
	resolve(state) {
		const candidates = componentPaths(state).filter(
			(c) => specOf(c.instance).name === this.specName,
		);
		if (candidates.length === 0) return null;
		const { path, instance } = candidates[this.target % candidates.length];
		const args = this.args.map((arg, i) => resolveRefs(arg, this.message.args?.[i], instance));
		let from = [];
		let sourceKey = null;
		if (this.index !== null) {
			sourceKey = this.keyRef.resolve(this.index.keysIn(instance));
			if (sourceKey === undefined) return null;
			from = [new Frame([this.index.fieldName], sourceKey, null, true)];
		}
		if (args.includes(undefined)) return null;
		return { path, instance, args, from, sourceKey };
	}
	check({ state }) {
		const r = this.resolve(state);
		if (r === null) return false;
		const { message } = this;
		if (message.pre === undefined) return true;
		const info = { sourceKey: r.sourceKey, emitted: [] };
		return !messageIssues({ pre: message.pre }, r.instance, r.instance, r.args, info).length;
	}
	run(model, driver) {
		const prev = driver.state;
		const r = this.resolve(prev);
		this.resolved = r;
		const before = driver.reports.length;
		driver.send(r.path, this.message.name, r.args, r.from);
		const problems = driver.problems.filter((p) => driver.reports.indexOf(p) >= before);
		if (problems.length > 0) {
			throw new Error(`${this} broke:\n  ${describeProblems(problems).join("\n  ")}`);
		}
		model.state = driver.state;
		this.afterEach?.(prev, driver.state, this);
	}
	toString() {
		const args = this.args.map((a) => (a instanceof KeyRef ? String(a) : JSON.stringify(a)));
		const from = this.index === null ? "" : ` from ${this.index.fieldName}[${this.keyRef}]`;
		const at = this.resolved === null ? `#${this.target}` : ` at ${pathString(this.resolved.path)}`;
		return `${this.specName}${at}.${this.message.name}(${args.join(", ")})${from}`;
	}
	// An unrun copy, to replay a sequence fast-check already ran.
	clone() {
		const { specName, message, index, target, args, keyRef, afterEach } = this;
		return new MessageCommand(specName, { message, index }, target, args, keyRef, afterEach);
	}
}

// One arbitrary per drivable message of the registered components; include/exclude filter
// "Spec.message" names, afterEach(prev, next, cmd) adds assertions.
const commandArbs = (A, { include, exclude = [], afterEach } = {}) => {
	const { fc } = A;
	const arbs = [];
	for (const [specName, spec] of Object.entries(A.specs)) {
		for (const entry of drivableMessages(A, spec).drivable) {
			const id = `${specName}.${entry.message.name}`;
			if ((include !== undefined && !include.includes(id)) || exclude.includes(id)) continue;
			const cmd = fc
				.tuple(fc.nat(), entry.args, fc.nat())
				.map(
					([target, args, n]) =>
						new MessageCommand(specName, entry, target, args, new KeyRef(n), afterEach),
				);
			arbs.push(cmd);
		}
	}
	if (arbs.length === 0) throw new Error("no drivable messages, type some with on.<name>.args");
	return arbs;
};

// A single MessageCommand, with the options of messageCommands.
export const messageCommand = (A, options) => A.fc.oneof(...commandArbs(A, options));

// fc.commands of messages to every registered component that has drivable messages.
export const messageCommands = (A, { maxCommands = 20, ...options } = {}) =>
	A.fc.commands(commandArbs(A, options), { maxCommands });

// Runs commands from messageCommands or eventCommands on a new Driver for root; pass a
// document in driverOptions for eventCommands.
export const runCommands = (A, root, cmds, driverOptions = {}) => {
	A.fc.modelRun(
		() => ({ model: { state: root }, real: new Driver({ root, ...driverOptions }) }),
		cmds,
	);
};

const FORM_FIELDS = new Set(["INPUT", "TEXTAREA", "SELECT"]);
// The DOM under node as text, attributes sorted: patching may add them in another order.
export const domSignature = (node) => {
	if (node.nodeType === 3) return node.data;
	if (node.nodeType === 8) return `<!--${node.data}-->`;
	const attrs = [...node.attributes].map((a) => `${a.name}="${a.value}"`).sort();
	const childs = [...node.childNodes].map(domSignature).join("");
	return `<${node.tagName} ${attrs.join(" ")}>${childs}</${node.tagName}>`;
};
// Sets the value of a form field, when given, and dispatches a bubbling type event on el.
export const dispatchOn = (el, type, value) => {
	if (value !== undefined) {
		if (el.type === "checkbox") el.checked = Boolean(value);
		else if (FORM_FIELDS.has(el.tagName)) el.value = String(value);
	}
	const { Event } = el.ownerDocument.defaultView;
	el.dispatchEvent(new Event(type, { bubbles: true }));
};
// Dispatches an event on the target-th element with handlers in the current DOM, with a
// generated value for targetValue, then checks the patched DOM equals a fresh render.
export class EventCommand {
	constructor(target, pick, value) {
		Object.assign(this, { target, pick, value });
	}
	elements(driver) {
		return [...driver.rootNode.querySelectorAll("[data-eid]")];
	}
	check() {
		return true;
	}
	run(model, driver) {
		const elements = this.elements(driver);
		if (elements.length === 0) return;
		const el = elements[this.target % elements.length];
		const eid = Number(el.dataset.eid);
		const handlers = Object.values(registeredSpecs(scopeOf(driver.state))).flatMap(
			(spec) => spec.eventHandlers.get(eid) ?? [],
		);
		if (handlers.length === 0) return;
		const { name } = handlers[this.pick % handlers.length];
		const before = driver.reports.length;
		dispatchOn(el, name, this.value);
		driver.drain();
		this.description = `${name} on <${el.tagName.toLowerCase()} data-eid=${eid}>`;
		const problems = driver.problems.filter((p) => driver.reports.indexOf(p) >= before);
		if (problems.length > 0) {
			throw new Error(`${this} broke: ${problems.map((p) => p.type).join(", ")}`);
		}
		const fresh = new Driver({ root: driver.state, document: el.ownerDocument });
		if (domSignature(fresh.rootNode) !== domSignature(driver.rootNode)) {
			throw new Error(`${this}: the patched DOM differs from a fresh render`);
		}
		model.state = driver.state;
	}
	toString() {
		return this.description ?? `event#${this.target}.${this.pick}(${JSON.stringify(this.value)})`;
	}
	clone() {
		return new EventCommand(this.target, this.pick, this.value);
	}
}

// fc.commands of DOM events; run them on a Driver made with a document.
export const eventCommands = (A, { maxCommands = 20 } = {}) => {
	const { fc } = A;
	const value = fc.oneof(fc.string({ maxLength: 6 }), fc.boolean());
	const cmd = fc.tuple(fc.nat(), fc.nat(), value).map((a) => new EventCommand(...a));
	return fc.commands([cmd], { maxCommands });
};

// Shows spec through one of its views, so properties can render views other than main.
const viewHost = (viewName) =>
	component({
		name: `ViewOf:${viewName}`,
		fields: { c: t.component() },
		view: render(field("c"), viewName),
	});

// Generic properties of spec, as fc properties to run with fc.assert. document enables
// rendering views; without it the views property is left out.
export const specProperties = (spec, A, { document = null } = {}) => {
	const { fc, scope } = A;
	const props = {};
	const schemaIssues = (v) =>
		findInvalidFields(v, null).filter((i) => !i.reason.startsWith("invariant:"));
	props.makeIsTotal = fc.property(A.args(spec), (args) => {
		let made;
		try {
			made = spec.make(args, scope);
		} catch (error) {
			if (NO_DEFAULT.test(error.message)) return;
			throw error;
		}
		const issues = schemaIssues(made);
		if (issues.length > 0)
			throw new Error(`invalid after make: ${JSON.stringify(issues.map((i) => i.path))}`);
	});
	props.makeKeepsValidInput = fc.property(A.instance(spec), (made) => {
		const args = { ...made };
		const again = spec.make(args, scope);
		for (const key in spec.fields) {
			if (again[key] !== args[key]) throw new Error(`${spec.name}.${key} was replaced`);
		}
	});
	props.defaultsAreFresh = fc.property(fc.constant(null), () => {
		let a;
		let b;
		try {
			a = spec.make({}, scope);
			b = spec.make({}, scope);
		} catch (error) {
			if (NO_DEFAULT.test(error.message)) return;
			throw error;
		}
		for (const key in spec.fields) {
			if (a[key] !== null && typeof a[key] === "object" && a[key] === b[key]) {
				throw new Error(`${spec.name}.${key} default is shared between instances`);
			}
		}
	});
	const fieldNames = Object.keys(spec.fields).filter((k) => !isIndex(spec.fields[k]));
	if (fieldNames.length > 0) {
		props.validatorAgrees = fc.property(
			fc.constantFrom(...fieldNames).chain((name) => {
				const type = spec.fields[name];
				const good = A.value(type).map((v) => [name, v, true]);
				const bad = A.invalid(type);
				return bad === null
					? good
					: fc.oneof(
							good,
							bad.map((v) => [name, v, false]),
						);
			}),
			([name, v, expected]) => {
				if (spec.fields[name].isValid(v, scope) !== expected) {
					throw new Error(`${spec.name}.${name} isValid(${JSON.stringify(v)}) !== ${expected}`);
				}
			},
		);
	}
	if (document !== null) {
		const hosts = Object.keys(spec.views).map((viewName) => [viewName, viewHost(viewName)]);
		props.viewsRender = fc.property(A.instance(spec), (made) => {
			for (const [viewName, Shown] of hosts) {
				const driver = new Driver({ root: Shown.make({ c: made }, scope), document });
				const failed = driver.problems.find((p) => p.type === "taskFailed");
				if (failed) throw new Error(`${spec.name} view ${viewName}: ${failed.error}`);
			}
		});
	}
	const { drivable } = drivableMessages(A, spec);
	if (drivable.length > 0) {
		const sends = fc.constantFrom(...drivable).chain((entry) =>
			fc.tuple(A.instance(spec), entry.args, fc.nat()).map(([made, args, n]) => ({
				entry,
				made,
				args,
				n,
			})),
		);
		const resolveSend = ({ entry, made, args, n }) => {
			const cmd = new MessageCommand(spec.name, entry, 0, args, new KeyRef(n));
			return { cmd, ok: cmd.check({ state: made }) };
		};
		props.messagesKeepContract = fc.property(sends, (input) => {
			const { cmd, ok } = resolveSend(input);
			fc.pre(ok);
			cmd.run({ state: input.made }, new Driver({ root: input.made }));
		});
		props.messagesAreDeterministic = fc.property(sends, (input) => {
			const { cmd, ok } = resolveSend(input);
			fc.pre(ok);
			const [a, b] = [new Driver({ root: input.made }), new Driver({ root: input.made })];
			const r = cmd.resolve(input.made);
			a.send(r.path, cmd.message.name, r.args, r.from);
			b.send(r.path, cmd.message.name, r.args, r.from);
			const [sa, sb] = [JSON.stringify(snapshot(a.state)), JSON.stringify(snapshot(b.state))];
			if (sa !== sb) throw new Error(`${cmd} gave different states:\n${sa}\n${sb}`);
		});
	}
	return props;
};
