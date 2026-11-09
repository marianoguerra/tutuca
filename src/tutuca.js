// The core: components, views, schemas, specs, paths, tasks and the host. Each lives in its own module;
// this one is the public surface npm consumers and dist/ bundle.

export { DRAG_EVENTS, DROP_EVENTS, Drag } from "./core/host/drag.js";
export { browserEnv, Host } from "./core/host/host.js";
export { FAILED_TYPES, HOST_EVENT_TYPES, HostEvent } from "./core/host/host-event.js";
export { isProblem, problemLines, transitionLabel } from "./core/host/records.js";
export { engineName } from "./core/host/sync-engines.js";
export { componentHandlers, HandlerContext, HostTask } from "./core/host/tree-binding.js";
export { ComponentSpec, component } from "./core/model/component.js";
export {
	filledMeta,
	hasMeta,
	metaOf,
	metaProblems,
	metaShapeProblems,
} from "./core/model/component-meta.js";
export {
	apply,
	ContractError,
	canApply,
	canQuery,
	checkCall,
	checkInvariants,
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
} from "./core/model/spec.js";
export {
	AnyType,
	ArrayType,
	BooleanType,
	ComponentType,
	EnumType,
	IndexType,
	isRecord,
	MapType,
	NoDefaultError,
	NumberType,
	OneOfType,
	OptionType,
	prefixed,
	RecordType,
	StringType,
	SYNC_LEVELS,
	syncsAt,
	Type,
	t,
	typeText,
	unlessNoDefault,
	unwrapOption,
} from "./core/model/types.js";
export {
	argIssues,
	brokenInvariants,
	findInvalid,
	messageIssues,
	postHolds,
	preHolds,
} from "./core/model/validate.js";
export * from "./core/view/tag.js";
export {
	$if,
	$query,
	CondNode,
	ConstantNode,
	dragKey,
	EachNode,
	ElementNode,
	EventArgNode,
	each,
	FieldNode,
	field,
	h,
	LookupBindNode,
	lookupBind,
	ProvidedNode,
	PushViewNode,
	provided,
	pushView,
	QueryNode,
	RenderContext,
	RenderEachNode,
	RenderItNode,
	RenderNode,
	render,
	renderEach,
	renderIt,
	SendNode,
	SeqItemNode,
	send,
	seqItem,
	sourceKey,
	targetValue,
	ViewNode,
	WithBindsNode,
	withBinds,
} from "./core/view/view.js";
export * from "./core/view/walk.js";
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
	Scheduler,
	Selector,
	selectorFrom,
	Target,
	Task,
	TRANSITION_OUTCOMES,
	Transition,
	WATCH_OUTCOMES,
	Watch,
} from "./tree/index.js";
