// The core: components, views, schemas, specs, paths, tasks and the host. Each lives in its own module;
// this one is the public surface npm consumers and dist/ bundle.

export { ComponentSpec, component } from "./core/component.js";
export {
	filledMeta,
	hasMeta,
	metaOf,
	metaProblems,
	metaShapeProblems,
} from "./core/component-meta.js";
export {
	apply,
	argIssues,
	brokenInvariants,
	ContractError,
	canApply,
	canQuery,
	checkCall,
	checkInvariants,
	contractOf,
	messageIssues,
	query,
	supports,
} from "./core/contract.js";
export { DRAG_EVENTS, DROP_EVENTS, Drag } from "./core/drag.js";
export { browserEnv, Host } from "./core/host.js";
export {
	Interface,
	iface,
	implementsIface,
	interfaceProblems,
	resolveImplements,
} from "./core/interface.js";
export {
	engineName,
	FAILED_PHASES,
	isProblem,
	LIFECYCLE_PHASES,
	Lifecycle,
} from "./core/lifecycle.js";
export * from "./core/schema.js";
export { Scope } from "./core/scope.js";
export {
	HandlerSpec,
	isComponent,
	QuerySpec,
	scopeOf,
	scopeSym,
	specOf,
	specSym,
	toAnswers,
	toMessages,
	toQueries,
} from "./core/spec.js";
export * from "./core/tag.js";
export { componentKinds, HostTask, TutucaContext } from "./core/tree-binding.js";
export { findInvalidFields } from "./core/validate.js";
export {
	$if,
	$query,
	AstNode,
	Cond,
	Constant,
	dragKey,
	Each,
	Element,
	EventArg,
	each,
	Field,
	field,
	h,
	LookupBind,
	lookupBind,
	Provided,
	PushView,
	provided,
	pushView,
	Query,
	Render,
	RenderContext,
	RenderEach,
	RenderIt,
	render,
	renderEach,
	renderIt,
	Send,
	SeqItem,
	send,
	seqItem,
	sourceKey,
	targetValue,
	WithBinds,
	withBinds,
} from "./core/view.js";
export * from "./core/walk.js";
export {
	Address,
	ANSWER_OUTCOMES,
	AnswerTask,
	AskTask,
	copy,
	DispatchPath,
	errorMessage,
	Frame,
	HOST,
	idOf,
	idSym,
	KeyPath,
	MessageContext,
	NotifyTask,
	plainOf,
	SCOPE_OUTCOMES,
	Scheduler,
	Selector,
	SettleScope,
	selectorFrom,
	Target,
	Task,
	TRANSITION_OUTCOMES,
	Transition,
} from "./tree/index.js";
