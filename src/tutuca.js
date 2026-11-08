// The core: components, views, schemas, specs, paths, tasks and the host. Each lives in its own module;
// this one is the public surface npm consumers and dist/ bundle.

export { ComponentSpec, component } from "./component.js";
export { filledMeta, hasMeta, metaOf, metaProblems, metaShapeProblems } from "./component-meta.js";
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
} from "./contract.js";
export { DRAG_EVENTS, DROP_EVENTS, Drag } from "./drag.js";
export { browserEnv, Host } from "./host.js";
export {
	Interface,
	iface,
	implementsIface,
	interfaceProblems,
	resolveImplements,
} from "./interface.js";
export * from "./schema.js";
export { Scope } from "./scope.js";
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
} from "./spec.js";
export * from "./tag.js";
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
	SCOPE_OUTCOMES,
	Scheduler,
	Selector,
	SettleScope,
	selectorFrom,
	Target,
	Task,
} from "./tree/index.js";
export { componentKinds, HostTask, TutucaContext } from "./tree-binding.js";
export { findInvalidFields } from "./validate.js";
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
} from "./view.js";
export * from "./walk.js";
