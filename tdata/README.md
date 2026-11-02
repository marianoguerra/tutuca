# tdata

tdata is the message format tutuca's components share, with two implementations: JavaScript
(TypeScript, in `js/`) and WebAssembly (Wax compiled to wasm-gc, in `wax/`). Both follow the same
specification and pass the same conformance vectors. tq, its query language, is written in
MoonBit (`mbt/`) and built for JS and wasm-gc.

- **The model**: a Message has an id, a kind, data (a Value) or child messages, and meta (headers
  grouped by dialect URI). A Value is a scalar (Null, Bool, Int (i64), Double (f64), String, Bytes,
  Instant, Ref), an Array, an ordered Object, a Set, a Typed value, or a Node.
- **Two encodings, one model**: JSON (plain JSON text, with tagged arrays in the style of Cap'n Web)
  and CBOR (a subset of RFC 8949). Converting from one to the other and back is the identity.
- **Opaque round-trip**: types nobody registered stay `Typed` envelopes, and order is kept
  everywhere. A message passes through a component that doesn't understand all of it with every
  byte intact.
- **Codecs**: register a type_id to decode it into a native value and encode it back.
- **Open specs**: in the style of Clojure spec, a spec matches the part it names and ignores the
  rest. Specs are values in the format itself and compose from named fragments. A router
  dispatches messages to the handlers whose specs match.
- **Queries (tq)**: a jq-style language for asking a message a question. Its patterns name the
  parts you want back, the way a regex's named groups do:
  `.messages[] ~ {kind: "note", data: {author: {name: $who}}}` matches each note and binds `who`.

[docs/spec.md](docs/spec.md) is the specification.

```
docs/spec.md     the specification
vectors/         conformance vectors both implementations run
js/              the TypeScript implementation (erasable syntax only: Node runs it directly)
wax/             the Wax implementation, built to wax/dist/tdata.wasm
mbt/             tq in MoonBit, built to mbt/dist/tq.js (ESM) and mbt/dist/tq.wasm (wasm-gc)
test/            fast-check generators the cross-implementation tests share
```

## JavaScript

```ts
import { Codecs, decodeMessage, encodeMessageCbor, Registry, Router, spec } from "./js/src/index.ts";

const msg = decodeMessage('{"id":"m1","kind":"note","data":{"title":"Hi","extra":["#","x/other",[[1]]]}}');
const reg = new Registry().define("app/note", spec("message", { kind: spec("const", { value: "note" }) }));
new Router(reg).on("app/note", (m) => console.log("a note", m.id)).handle(msg);
encodeMessageCbor(msg); // the same message as CBOR, x/other included
```

In JS, Int is `bigint` and Double is `number`, so `typeof` tells them apart, and `1.0` re-encodes
as `1.0`. Objects are `Map`s, which keep insertion order for every key, including keys that look
like integers.

## tq

The MoonBit build exports five functions with the same interface on both targets. Each takes
strings and returns canonical tdata JSON: `tq_parse(query)`, `tq_run(query, messageJson)`,
`tq_match(query, messageJson)`, `tq_match_all(query, messageJson)` and `tq_canon(messageJson)`.
`mbt/load.mjs` loads either build. `Query` in the JS implementation converts to and from
Messages and Values:

```ts
import { loadWasm } from "./mbt/load.mjs"; // or loadJs()
import { decodeMessage, Query, Registry, Router } from "./js/src/index.ts";

const q = new Query(await loadWasm());
const batch = decodeMessage(
	'{"id":"b","kind":"batch","messages":[{"id":"n1","kind":"note","data":{"title":"Hi","author":{"name":"ana"}}}]}',
);
const found = q.match('.messages[] ~ {kind: "note", data: {title: $title, author: {name: $who}}}', batch);
found?.bindings; // Map { "title" => "Hi", "who" => "ana" }, found.value is the note

new Router(new Registry(), q)
	.when('.messages[] ~ {kind: "note", data: {author: {name: $who}}}', (_m, _picks, b) => b.get("who"))
	.handle(batch); // ["ana"]
```

A message that has to be a Value in a result (in a collected array, say) is written as
`["#","tdata/message",{…envelope…}]`; `Query` turns those back into Messages.

## Wax

`wax/scripts/build.mjs` concatenates `wax/src/*.wax` and compiles them with the wax-mb that
tutuca-wax pins (run `just setup` there first, or set `WAX_MB`). The module needs the js-string
builtins, the imported string constants (`"'"`) and two host functions for number text; see
`wax/test/tdata.mjs`.

## Tasks

```
just setup      install the JS dev dependencies
just test       every suite: JS (and tsc), the Wax build and its suite, tq (moon test and the vectors)
just build-mbt  build mbt/dist/tq.js and mbt/dist/tq.wasm (needs moon)
just vectors    regenerate vectors/values.json and vectors/messages.json
```
