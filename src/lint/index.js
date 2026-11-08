import { agentProblems, dataProblems } from "../meta/index.js";
import {
	ANSWER_OUTCOMES,
	ArrayType,
	AstNode,
	ComponentType,
	DRAG_EVENTS,
	HandlerSpec,
	IndexType,
	Interface,
	isRecord,
	MapType,
	QuerySpec,
	Type,
	unwrapOption,
	Walker,
} from "../tutuca.js";

// The kind of a node: the name of the Walker callback it dispatches to.
const kindOf = (node) => (node instanceof AstNode ? node.constructor.kind : null);
const SOURCE_KINDS = new Set(["field", "seqItem", "provided"]);
// Nodes that read the component state or render, so they need a RenderContext.
const RENDER_KINDS = new Set([
	...SOURCE_KINDS,
	"render",
	"renderIt",
	"each",
	"renderEach",
	"scope",
	"element",
	"query",
]);
const LOOP_HOOKS = ["prepare", "filter", "iter", "key", "enrich"];
const EMIT_KINDS = new Set(["notify", "ask", "sendAt"]);
const isTypeList = (a) => Array.isArray(a) && a.every((t) => t instanceof Type);
// Per event arg: the prefix of its lint codes and where it can be used beyond send args.
const EVENT_ARG_RULES = {
	targetValue: { code: "target" },
	// Events from outside any each body, in this view, always have a null source key.
	sourceKey: {
		code: "source-key",
		check: (lint) =>
			!lint.env.loop && ["source-key-outside-loop", "sourceKey is only set inside an each body"],
	},
	// Only drag events happen with something dragged.
	dragKey: {
		code: "drag-key",
		check: (lint) =>
			!DRAG_EVENTS.includes(lint.eventName) && [
				"drag-key-outside-drag-event",
				`dragKey is only set in drag events, not in on:${lint.eventName}`,
			],
	},
};
const labelOf = (node, kind) => {
	switch (kind) {
		case "element":
			return node.tagName;
		case "field":
		case "provided":
			return `${kind}(${node.name})`;
		case "seqItem":
			return `seqItem(${node.seqName}, ${node.keyName})`;
		case "each":
		case "renderEach":
			return `${kind}(${node.loopName ?? ""})`;
		case "scope":
			return `scope(${node.scopeName})`;
		case "send":
		case "query":
			return `${kind}(${node.name})`;
		case "eventArg":
			return node.name;
		default:
			return kind;
	}
};
// Bindings visible where an expression evaluates: inside a loop body (value and
// key), and whether a scope or an enriching loop adds names only known at runtime.
const viewEnv = Object.freeze({ loop: false, open: false });
// Calls whose results differ between runs, and the ctx method to use instead.
const WORLD_READS = [
	[/\bDate\.now\s*\(/, "Date.now()", "ctx.now()"],
	[/\bnew Date\s*\(\s*\)/, "new Date()", "new Date(ctx.now())"],
	[/\bperformance\.now\s*\(/, "performance.now()", "ctx.now()"],
	[/\bMath\.random\s*\(/, "Math.random()", "ctx.random()"],
	[/\bcrypto\.randomUUID\s*\(/, "crypto.randomUUID()", "ctx.uuid()"],
];

// Checks statically everything the runtime assumes about registrations and their
// views. The runtime does not repeat these checks: run lint and fix every issue
// before release, since an unlinted app can fail with any error. Errors are what the
// runtime fails on; warnings are what it has a fallback for, or what only the scopes
// at runtime decide (a provider among the ancestors, a name registered in the scope).
export class Lint extends Walker {
	issues = [];
	constructor(registrations, componentNames = null) {
		super();
		this.registrations = [...registrations];
		this.componentNames = componentNames === null ? null : new Set(componentNames);
		this.viewNames = new Set(this.registrations.flatMap((spec) => Object.keys(spec.views)));
		this.providedNames = new Set(this.registrations.flatMap((spec) => Object.keys(spec.provides)));
		// The interface names registrations say they implement, which fields can hold.
		this.implementedNames = new Set(
			this.registrations.flatMap((spec) =>
				(spec.implements ?? []).map((it) => (it instanceof Interface ? it.name : it)),
			),
		);
		this.spec = null;
		this.viewName = null;
		this.labels = [];
		this.env = viewEnv;
		this.inAction = false;
	}
	run() {
		for (const spec of this.registrations) {
			this.spec = spec;
			this.viewName = null;
			this.labels = [];
			this.lintSpec(spec);
			for (const [viewName, view] of Object.entries(spec.views)) {
				this.viewName = viewName;
				this.env = viewEnv;
				this.inAction = false;

				this.visit(view);
			}
		}
		return this.issues;
	}
	report(level, code, node, message) {
		const { name } = this.spec;
		const head = this.viewName === null ? name : `${name}.${this.viewName}`;
		const path = [head, ...this.labels].join(" > ");
		this.issues.push({ level, code, component: name, view: this.viewName, path, message, node });
	}
	// component() already rejects a missing main view and copies each section into an
	// object, so only the entries are left to check.
	lintSpec(spec) {
		// What its agent meta says it can't do: tools naming no message or query, wrong params.
		for (const problem of agentProblems(spec)) this.report("error", "agent-meta", null, problem);
		// What its data meta says it can't do: a load that isn't a pure one-arg message.
		for (const problem of dataProblems(spec)) this.report("error", "data-meta", null, problem);
		for (const [name, fn] of Object.entries(spec.provides)) {
			if (typeof fn !== "function") {
				this.report("error", "section-shape", null, `provides.${name} must be a function`);
			}
		}
		for (const [name, message] of Object.entries(spec.on)) {
			this.lintMessage(`on.${name}`, message);
		}
		this.lintAnswers(spec);
		this.lintQueries(spec);
		// A computed property is a query: methods are the component's own helpers.
		for (const [name, d] of Object.entries(Object.getOwnPropertyDescriptors(spec.methods ?? {}))) {
			if (d.get === undefined) continue;
			const text = `methods.${name} is a getter: move it to queries, where computed properties go`;
			this.report("warning", "getter-in-methods", null, text);
		}
		for (const [name, scope] of Object.entries(spec.scopes)) {
			if (typeof scope?.bind !== "function") {
				this.report("error", "section-shape", null, `scopes.${name}.bind must be a function`);
			}
		}
		for (const [name, loop] of Object.entries(spec.loops)) {
			this.lintLoop(name, loop);
		}
		for (const [name, type] of Object.entries(spec.fields)) {
			this.lintFieldType(name, type, spec.fields);
		}
		if (Object.hasOwn(spec.fields, "$")) {
			const message = "fields.$: $ marks a component in synced state, name the field otherwise";
			this.report("error", "reserved-field", null, message);
		}
	}
	// A named t.component() makes and checks its value through the scope.
	lintFieldType(name, type, fields) {
		if (type instanceof ComponentType) {
			for (const componentName of type.names) {
				if (componentName instanceof Interface) continue;
				if (this.componentNames === null || this.componentNames.has(componentName)) continue;
				if (this.implementedNames.has(componentName)) continue; // an interface's name
				this.report(
					"warning",
					"unknown-component",
					null,
					`fields.${name}: no component is registered as "${componentName}"`,
				);
			}
		} else if (type instanceof IndexType) {
			const target = fields[type.fieldName];
			const unwrapped = unwrapOption(target);
			if (!(unwrapped instanceof ArrayType || unwrapped instanceof MapType)) {
				this.report(
					"error",
					"bad-index",
					null,
					`fields.${name}: t.index("${type.fieldName}") needs an array or map field`,
				);
			}
		}
		// Defaults only need the right kind: one that breaks the constraints makes the field required.
		const { defaultValue } = type;
		const hasStaticDefault = defaultValue !== undefined && typeof defaultValue !== "function";
		if (hasStaticDefault && !type.isValidValue(defaultValue, null)) {
			this.report("error", "bad-default", null, `fields.${name}: default doesn't match its type`);
		}
		for (const child of type.children()) this.lintFieldType(name, child, fields);
	}
	// answers: ask name -> { ok, error, unhandled }, each like an on entry. An ask a message
	// says it emits with no answers here can't be answered.
	lintAnswers(spec) {
		for (const [ask, outcomes] of Object.entries(spec.answers)) {
			if (!isRecord(outcomes)) {
				const message = `answers.${ask} must map ok, error or unhandled to handlers`;
				this.report("error", "section-shape", null, message);
				continue;
			}
			for (const [outcome, message] of Object.entries(outcomes)) {
				if (!ANSWER_OUTCOMES.includes(outcome)) {
					const text = `answers.${ask}.${outcome}: an answer is ok, error or unhandled`;
					this.report("error", "section-shape", null, text);
				} else this.lintMessage(`answers.${ask}.${outcome}`, message);
			}
		}
		for (const [name, message] of Object.entries(spec.on)) {
			const asks = message instanceof HandlerSpec ? message.emits?.ask : undefined;
			for (const ask of Array.isArray(asks) ? asks : []) {
				if (spec.answers[ask] !== undefined) continue;
				const text = `on.${name} asks ${ask}, but answers has no ${ask}: its answer goes unhandled`;
				this.report("warning", "unanswered-ask", null, text);
			}
		}
	}
	lintMessage(label, message) {
		const bad = (what) => this.report("error", "section-shape", null, `${label}${what}`);
		if (!(message instanceof HandlerSpec)) return bad(" must be a function or a handler spec");
		const { run, args, sourceKey, pre, post, emits } = message;
		if (typeof run !== "function") bad(".run must be a function");
		if (args !== undefined && !isTypeList(args)) bad(".args must be an array of types");
		if (sourceKey !== undefined && !(sourceKey instanceof Type)) bad(".sourceKey must be a type");
		for (const [hook, fn] of [
			["pre", pre],
			["why", message.why],
			["post", post],
		]) {
			if (fn !== undefined && typeof fn !== "function") bad(`.${hook} must be a function`);
		}
		if (emits !== undefined) {
			const kinds = Object.entries(isRecord(emits) ? emits : { "": null });
			if (kinds.some(([kind, names]) => !EMIT_KINDS.has(kind) || !Array.isArray(names))) {
				bad(".emits must map notify, ask or sendAt to name arrays");
			}
		}
		if (typeof run === "function") this.lintWorldReads(label, run);
		if (message.pure) {
			if (typeof run === "function" && (run.length > 2 || /\bctx\b/.test(String(run)))) {
				const text = `${label} is pure: it gets no ctx, pass what it needs as args`;
				this.report("error", "pure-uses-ctx", null, text);
			}
			if (emits !== undefined) {
				this.report("error", "pure-emits", null, `${label} is pure: it can't emit`);
			}
		}
	}
	// queries: getters, functions, { get, returns } or { run, args, returns }. They read: one
	// that assigns to this changes what it was asked about.
	lintQueries(spec) {
		for (const [name, q] of Object.entries(spec.queries ?? {})) {
			const bad = (what) => this.report("error", "section-shape", null, `queries.${name}${what}`);
			if (!(q instanceof QuerySpec)) {
				bad(" must be a getter, a function, { get, returns } or { run, args, returns }");
				continue;
			}
			if (q.kind === "call" && q.args !== undefined && !isTypeList(q.args)) {
				bad(".args must be an array of types");
			}
			if (q.returns !== undefined && !(q.returns instanceof Type)) bad(".returns must be a type");
			if (q.fn === null) continue;
			this.lintWorldReads(`queries.${name}`, q.fn);
			if (/\bthis\.[\w$]+(\[[^\]]*\])*\s*([-+*/%]|\?\?|\|\||&&)?=(?!=)/.test(String(q.fn))) {
				const text = `queries.${name} assigns to this: a query reads, a pure message changes`;
				this.report("error", "query-mutates-this", null, text);
			}
		}
	}
	// A handler that reads the clock or randomness itself gives a Driver different runs.
	lintWorldReads(label, run) {
		const source = String(run);
		for (const [pattern, call, instead] of WORLD_READS) {
			if (!pattern.test(source)) continue;
			const message = `${label}: ${call} changes between runs, use ${instead} so they repeat`;
			this.report("warning", "nondeterministic-call", null, message);
		}
	}
	lintLoop(name, loop) {
		if (!isRecord(loop)) {
			this.report("error", "section-shape", null, `loops.${name} must be an object`);
			return;
		}
		for (const hook of LOOP_HOOKS) {
			if (loop[hook] !== undefined && typeof loop[hook] !== "function") {
				this.report("error", "section-shape", null, `loops.${name}.${hook} must be a function`);
			}
		}
		if (loop.view !== undefined) {
			if (typeof loop.view !== "string") {
				this.report("error", "loop-view-type", null, `loops.${name}.view must be a string`);
			} else this.checkViewName(null, loop.view);
		}
		if (loop.iter !== undefined && loop.filter !== undefined) {
			this.report("warning", "filter-ignored", null, `loops.${name}.iter replaces its filter`);
		}
	}
	// The own loop or scope the view names; inherited names like "toString" are not.
	lookupSection(section, name) {
		const record = this.spec[section];
		return Object.hasOwn(record, name) ? record[name] : undefined;
	}
	checkViewName(node, viewName) {
		if (viewName !== undefined && !this.viewNames.has(viewName)) {
			this.report(
				"warning",
				"unknown-view",
				node,
				`no registered component declares view "${viewName}"`,
			);
		}
	}
	checkSource(node) {
		if (!SOURCE_KINDS.has(kindOf(node.source))) {
			this.report("error", "not-a-source", node, "the source must be field, seqItem or provided");
		}
	}
	// The component state is ctx.it only outside loop bodies; items have unknown shapes.
	checkField(node, name) {
		const { fields, proto } = this.spec;
		if (this.env.loop || Object.hasOwn(fields, name) || name in proto) return;
		this.report("warning", "unknown-field", node, `${this.spec.name} has no field "${name}"`);
	}
	withEnv(env, fn) {
		const outer = this.env;
		this.env = env;
		fn();
		this.env = outer;
	}
	visit(node) {
		const kind = kindOf(node);
		this.labels.push(labelOf(node, kind));
		if (this.inAction && RENDER_KINDS.has(kind)) {
			this.report("error", "state-in-action", node, `${kind} cannot be a send argument`);
		} else super.visit(node);
		this.labels.pop();
	}
	element(node) {
		for (const { name } of node.handlers) {
			// Custom elements' events are often kebab-case, like emoji-click.
			if (!/^[a-z]+(-[a-z0-9]+)*$/.test(name)) {
				this.report("warning", "unknown-event", node, `"${name}" is not a lower-case event type`);
			}
		}
		super.element(node);
	}
	attr(node, name, value) {
		this.labels.push(`[${name}]`);
		super.attr(node, name, value);
		this.labels.pop();
	}
	handler(_node, { name, action }) {
		this.labels.push(`[on:${name}]`);
		if (kindOf(action) !== "send") {
			this.report("error", "event-needs-send", action, `on:${name} needs a send action`);
		} else {
			const message = this.spec.on[action.name];
			if (typeof message?.run !== "function") {
				this.report("error", "unknown-handler", action, `no own handler on.${action.name}`);
			} else if (message.args !== undefined) {
				this.checkArgs(action, message.args, "send", `send(${action.name})`, `on.${action.name}`);
			}
			this.labels.push(labelOf(action, "send"));
			this.inAction = true;
			this.eventName = name;
			for (const arg of action.args) this.visit(arg);
			this.inAction = false;
			this.labels.pop();
		}
		this.labels.pop();
	}
	// node's args (a send's or a $query's, as code prefixes them, written as call, to target):
	// arity always, and constant ones against their declared type.
	checkArgs(node, types, code, call, target) {
		if (node.args.length !== types.length) {
			const message = `${call} passes ${node.args.length} args, ${target} takes ${types.length}`;
			this.report("error", `${code}-arity`, node, message);
			return;
		}
		node.args.forEach((arg, i) => {
			if (kindOf(arg) === "constant" && !types[i].isValid(arg.value, null)) {
				this.report("error", `${code}-arg-type`, node, `${call} arg ${i} doesn't match its type`);
			}
		});
	}
	send(node) {
		this.report("error", "send-not-event", node, "send is only valid as an on:* value");
	}
	field(node) {
		this.checkField(node, node.name);
		super.node(node);
	}
	// $query(name, ...args): one of the component's queries that takes args.
	query(node) {
		const q = this.spec.queries?.[node.name];
		if (!(q instanceof QuerySpec)) {
			this.report("error", "unknown-query", node, `${this.spec.name} has no query "${node.name}"`);
		} else if (q.kind !== "call") {
			const text = `query "${node.name}" takes no args, read it with field("${node.name}")`;
			this.report("error", "query-arity", node, text);
		} else if (q.args !== undefined) {
			this.checkArgs(node, q.args, "query", `$query(${node.name})`, `queries.${node.name}`);
		}
		super.node(node);
	}
	seqItem(node) {
		this.checkField(node, node.seqName);
		this.checkField(node, node.keyName);
		super.node(node);
	}
	provided(node) {
		if (!this.providedNames.has(node.name)) {
			this.report(
				"warning",
				"unknown-provided",
				node,
				`no registered component provides "${node.name}"`,
			);
		}
		super.node(node);
	}
	// Event args read the event, so they only make sense as send args; some only in some events.
	eventArg(node) {
		const { name } = node;
		const { code, check } = EVENT_ARG_RULES[name] ?? {};
		if (!this.inAction) {
			const text = `${name} is only valid in send arguments`;
			this.report("error", `${code ?? name}-outside-action`, node, text);
		} else {
			const issue = check?.(this);
			if (issue) this.report("error", issue[0], node, issue[1]);
		}
		super.node(node);
	}
	lookupBind(node) {
		const { name } = node;
		const isItemBind = name === "value" || name === "key";
		if (this.inAction) {
			const hint = name === "key" ? ", use sourceKey()" : "";
			this.report("error", "bind-in-action", node, `binds are not available on dispatch${hint}`);
		} else if (isItemBind && !this.env.loop) {
			this.report(
				"error",
				"bind-outside-loop",
				node,
				`"${name}" is only bound inside an each body`,
			);
		} else if (!isItemBind && !this.env.open) {
			this.report(
				"warning",
				"unknown-bind",
				node,
				`no enclosing scope or enriching loop binds "${name}"`,
			);
		}
		super.node(node);
	}
	render(node) {
		this.checkSource(node);
		this.checkViewName(node, node.viewName);
		super.node(node);
	}
	renderIt(node) {
		if (!this.env.loop) {
			this.report(
				"error",
				"render-it-outside-loop",
				node,
				"renderIt is only valid inside an each body",
			);
		}
		this.checkViewName(node, node.viewName);
	}
	pushView(node) {
		if (kindOf(node.viewNameVal) === "constant") this.checkViewName(node, node.viewNameVal.value);
		super.node(node);
	}
	each(node) {
		let loop;
		if (node.loopName !== undefined) {
			loop = this.lookupSection("loops", node.loopName);
			if (loop === undefined) {
				this.report("error", "unknown-loop", node, `no own loops.${node.loopName}`);
			}
		}
		this.checkSource(node);
		this.visit(node.source);
		const body = { loop: true, open: loop?.enrich !== undefined };
		if (kindOf(node) === "each") this.withEnv(body, () => this.visit(node.child));
	}
	scope(node) {
		if (this.lookupSection("scopes", node.scopeName) === undefined) {
			this.report("error", "unknown-scope", node, `no own scopes.${node.scopeName}`);
		}
		this.withEnv({ ...this.env, open: true }, () => this.visit(node.child));
	}
}

// The issues of a set of registrations; [] when clean. Pass the registered names to check
// t.component() names.
export const lint = (registrations, componentNames = null) =>
	new Lint(registrations, componentNames).run();
// The specs registered in scope and the scopes below it, and the names they're registered
// under, aliases included: { specs, names }.
export const registeredIn = (scope) => {
	const entries = [...scope.descendants()].flatMap((s) => Object.entries(s.byName));
	return {
		specs: new Set(entries.map(([, spec]) => spec)),
		names: new Set(entries.map(([name]) => name)),
	};
};
// The issues of everything registered in scope and below (a host's: host.scope); [] when clean.
export const lintScope = (scope) => {
	const { specs, names } = registeredIn(scope);
	return lint(specs, names);
};
