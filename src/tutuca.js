// The core: components, views, schemas, specs, paths, tasks and the host. Each lives in its own module;
// this one is the public surface npm consumers and dist/ bundle.

export { ComponentSpec, component, InitContext } from "./core/component.js";
export { DRAG_EVENTS, DROP_EVENTS, Drag } from "./core/host/drag.js";
export { browserEnv, Host } from "./core/host/host.js";
export { HostEvent } from "./core/host/host-event.js";
export {
	isProblem,
	problemLines,
	transitionLabel,
} from "./core/host/records.js";
export { componentHandlers, HandlerContext, HostTask } from "./core/host/tree-binding.js";
export {
	filledMeta,
	hasMeta,
	metaOf,
	metaShapeProblems,
} from "./core/model/component-meta.js";
export {
	apply,
	ContractError,
	canApply,
	canQuery,
	checkCall,
	contractOf,
	interfaceGaps,
	query,
} from "./core/model/contract.js";
export {
	Interface,
	iface,
	implementsIface,
	interfaceProblems,
	resolveImplements,
} from "./core/model/interface.js";
export { Scope } from "./core/model/scope.js";
export {
	enableHandlerSources,
	HandlerSpec,
	handlerSourcesEnabled,
	isComponent,
	QuerySpec,
	scopeOf,
	scopeSym,
	specOf,
	specOrSelf,
	specSym,
} from "./core/model/spec.js";
export {
	AnyType,
	ArrayType,
	BooleanType,
	ComponentType,
	checkType,
	compileShape,
	compileType,
	dataText,
	EnumType,
	IndexType,
	isRecord,
	MapType,
	NumberType,
	OneOfType,
	OptionType,
	prefixed,
	RecordType,
	StringType,
	signatureText,
	syncsAt,
	TYPE_KINDS,
	Type,
	t,
	typeProblems,
	typeText,
	unlessNoDefault,
	unwrapOption,
} from "./core/model/types.js";
export {
	brokenInvariants,
	findInvalid,
	messageIssues,
	preHolds,
} from "./core/model/validate.js";
export {
	CopyCache,
	DepsCache,
	NullCache,
	RenderCache,
	viewFacts,
	WeakMapCache,
} from "./core/view/render-cache.js";
export { button, tag } from "./core/view/tag.js";
export { enableTargets, RenderTarget } from "./core/view/targets.js";
export {
	$if,
	$query,
	CondNode,
	ConstantNode,
	dragKey,
	ElementNode,
	EventArgNode,
	each,
	eventKey,
	eventProperty,
	field,
	h,
	lookupBind,
	provided,
	pushView,
	RenderContext,
	RenderEachNode,
	render,
	renderEach,
	renderIt,
	SendNode,
	send,
	seqItem,
	sourceKey,
	targetValue,
	ViewNode,
	withBinds,
} from "./core/view/view.js";
export { Walker } from "./core/view/walk.js";
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
	KeyPath,
	MessageContext,
	NotifyTask,
	pathProblems,
	pathSteps,
	plainOf,
	Scheduler,
	Selector,
	selectorOfPath,
	Target,
	Task,
	TRANSITION_OUTCOMES,
	Transition,
	WATCH_OUTCOMES,
	Watch,
} from "./tree/index.js";
