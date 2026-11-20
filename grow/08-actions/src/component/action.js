// Actions (spec/component/action.rkt): what handling one message does to one instance.
//
// A handler is a function (next, args), called with the instance before the message as this.
// next starts as that instance and is the handler's to write on: what it holds when the
// handler returns is the instance after the message. Returning a value replaces the instance.
import { produce } from "../../../../deps/immer.js";

// One message on one instance: { outcome: "ok", next } or, when the handler throws,
// { outcome: "aborted", error }. The instance it was given is as it was either way.
// The handler must exist; the host decides what a missing handler means.
export function act(classDef, self, name, args) {
	const handler = classDef.on[name];
	if (handler === undefined) throw new Error(`${classDef.name} has no handler for ${name}`);
	try {
		return { outcome: "ok", next: produce(self, (next) => handler.call(self, next, args)) };
	} catch (error) {
		return { outcome: "aborted", error };
	}
}
