import {
	AnyType,
	ArrayType,
	AstNode,
	ComponentType,
	IndexType,
	MapType,
	MessageSpec,
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
]);
const LOOP_HOOKS = ["prepare", "filter", "iter", "key", "enrich"];
const EMIT_KINDS = new Set(["notify", "ask", "sendAt"]);
const isRecord = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
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
		case "action":
			return `send(${node.name})`;
		default:
			return kind;
	}
};
// Bindings visible where an expression evaluates: inside a loop body (value and
// key), and whether a scope or an enriching loop adds names only known at runtime.
const viewEnv = Object.freeze({ loop: false, open: false });

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
		for (const [name, fn] of Object.entries(spec.provides)) {
			if (typeof fn !== "function") {
				this.report("error", "section-shape", null, `provides.${name} must be a function`);
			}
		}
		for (const [name, message] of Object.entries(spec.on)) {
			this.lintMessage(name, message);
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
	}
	// A named t.component() makes and checks its value through the scope.
	lintFieldType(name, type, fields) {
		if (type instanceof ComponentType) {
			for (const componentName of type.names) {
				if (this.componentNames === null || this.componentNames.has(componentName)) continue;
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
	lintMessage(name, message) {
		const bad = (what) => this.report("error", "section-shape", null, `on.${name}${what}`);
		if (!(message instanceof MessageSpec)) return bad(" must be a function or a message spec");
		const { run, args, sourceKey, pre, post, emits } = message;
		if (typeof run !== "function") bad(".run must be a function");
		if (args !== undefined && !(Array.isArray(args) && args.every((a) => a instanceof AnyType))) {
			bad(".args must be an array of types");
		}
		if (sourceKey !== undefined && !(sourceKey instanceof AnyType))
			bad(".sourceKey must be a type");
		for (const [hook, fn] of [
			["pre", pre],
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
			if (!/^[a-z]+$/.test(name)) {
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
		this.labels.push(`[@on.${name}]`);
		if (kindOf(action) !== "action") {
			this.report("error", "event-needs-send", action, `@on.${name} needs a send action`);
		} else {
			const message = this.spec.on[action.name];
			if (typeof message?.run !== "function") {
				this.report("error", "unknown-handler", action, `no own handler on.${action.name}`);
			} else if (message.args !== undefined) this.checkSendArgs(action, message.args);
			this.labels.push(labelOf(action, "action"));
			this.inAction = true;
			for (const arg of action.args) this.visit(arg);
			this.inAction = false;
			this.labels.pop();
		}
		this.labels.pop();
	}
	// Arity always, and constant arguments against their declared type.
	checkSendArgs(action, types) {
		if (action.args.length !== types.length) {
			const message = `send(${action.name}) passes ${action.args.length} args, on.${action.name} takes ${types.length}`;
			this.report("error", "send-arity", action, message);
			return;
		}
		action.args.forEach((arg, i) => {
			if (kindOf(arg) === "constant" && !types[i].isValid(arg.value, null)) {
				this.report(
					"error",
					"send-arg-type",
					action,
					`send(${action.name}) arg ${i} doesn't match its type`,
				);
			}
		});
	}
	action(node) {
		this.report("error", "send-not-event", node, "send is only valid as an @on.* value");
	}
	field(node) {
		this.checkField(node, node.name);
		super.field(node);
	}
	seqItem(node) {
		this.checkField(node, node.seqName);
		this.checkField(node, node.keyName);
		super.seqItem(node);
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
		super.provided(node);
	}
	targetValue(node) {
		if (!this.inAction) {
			this.report(
				"error",
				"target-outside-action",
				node,
				"targetValue is only valid in send arguments",
			);
		}
		super.targetValue(node);
	}
	// Events from outside any each body, in this view, always have a null source key.
	sourceKey(node) {
		if (!this.inAction) {
			this.report(
				"error",
				"source-key-outside-action",
				node,
				"sourceKey is only valid in send arguments",
			);
		} else if (!this.env.loop) {
			this.report(
				"error",
				"source-key-outside-loop",
				node,
				"sourceKey is only set inside an each body",
			);
		}
		super.sourceKey(node);
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
		super.lookupBind(node);
	}
	render(node) {
		this.checkSource(node);
		this.checkViewName(node, node.viewName);
		super.render(node);
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
		super.pushView(node);
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
		if (node.child !== null) this.withEnv(body, () => this.visit(node.child));
	}
	scope(node) {
		if (this.lookupSection("scopes", node.scopeName) === undefined) {
			this.report("error", "unknown-scope", node, `no own scopes.${node.scopeName}`);
		}
		this.withEnv({ ...this.env, open: true }, () => this.visit(node.child));
	}
}

// The issues of a set of registrations, such as host.registrations; [] when clean.
// Pass the registered names, such as host.componentNames, to check t.component() names.
export const lint = (registrations, componentNames = null) =>
	new Lint(registrations, componentNames).run();

// Lints the registrations and reports to the console: one collapsed group per
// component, errors with console.error and warnings with console.warn, each
// with its node to inspect. Returns the issues.
export const lintToConsole = (registrations, out = console, componentNames = null) => {
	const issues = lint(registrations, componentNames);
	if (issues.length === 0) {
		out.info("tutuca lint: clean");
		return issues;
	}
	const errors = issues.filter((issue) => issue.level === "error").length;
	out.group(`tutuca lint: ${errors} errors, ${issues.length - errors} warnings`);
	const byComponent = new Map();
	for (const issue of issues) {
		const group = byComponent.get(issue.component);
		if (group === undefined) byComponent.set(issue.component, [issue]);
		else group.push(issue);
	}
	for (const [component, componentIssues] of byComponent) {
		out.groupCollapsed(`${component} (${componentIssues.length})`);
		for (const { level, code, path, message, node } of componentIssues) {
			const log = level === "error" ? out.error : out.warn;
			log.call(out, `${code} ${path}: ${message}`, ...(node === null ? [] : [node]));
		}
		out.groupEnd();
	}
	out.groupEnd();
	return issues;
};
