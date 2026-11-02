// tdata: tutuca's message format (docs/spec.md).

export {
	type CborOptions,
	decodeMessageCbor,
	decodeValueCbor,
	encodeMessageCbor,
	encodeValueCbor,
	fromHex,
	toHex,
} from "./cbor.ts";
export { asValue, type Codec, Codecs } from "./codecs.ts";
export { getIn, setIn, updateIn } from "./edit.ts";
export { equal, equalMessages } from "./equal.ts";
export {
	decodeMessage,
	decodeValue,
	encodeMessage,
	encodeValue,
	isScalar,
	type JsonOptions,
} from "./json.ts";
export * from "./model.ts";
export {
	type Bindings,
	type Engine,
	type Found,
	MESSAGE_TYPE_ID,
	Query,
	type Solution,
} from "./query.ts";
export { type Handler, type Match, Router } from "./router.ts";
export {
	type CheckResult,
	type Path,
	type Pick,
	type Problem,
	Registry,
	SPEC_PREFIX,
	SPECS_KIND,
	spec,
} from "./spec.ts";
