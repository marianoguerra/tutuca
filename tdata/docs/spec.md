# tdata: messages, values, encodings, specs and queries

Version 1 (draft). tdata is the data format tutuca's components use to pass information to each
other, in the JavaScript runtime and in the wasm-gc runtime (tutuca-wax) alike. Its unit is the
**Message**. Each component understands only part of what it receives, so the format has these
goals:

- **Opaque round-trip.** A component decodes a message, possibly edits the parts it knows, and
  re-encodes it. Everything it did not touch comes out unchanged, bit for bit: unknown types,
  unknown metadata dialects, unknown object keys, the order of keys.
- **Open types.** A component registers codecs for the type tags it cares about. A tag nobody
  registered decodes to a generic typed envelope, which re-encodes as it was.
- **Open matching.** A spec says what a component needs from a message and nothing more. Parts
  the spec doesn't mention never cause a rejection. Specs are values in the format itself, and
  they compose from named fragments.
- **Two encodings, one model.** A JSON encoding (plain JSON text, tagged arrays in the style of
  Cap'n Web) and a CBOR encoding (a subset of RFC 8949) carry the same model. Converting from
  one to the other and back is the identity.
- **Asking with names.** A query (tq, §6) asks a message a question in the style of jq, and its
  patterns name the parts the asker wants back, the way a regex's named groups do.

The key words MUST, MUST NOT, SHOULD and MAY are used as RFC 2119 defines them.

## 1. Data model

```
Scalar  = Null
        | Bool(bool)
        | Int(i64)
        | Double(f64)
        | String(string)
        | Bytes(octets)
        | Instant(epoch_ns: i64)
        | Ref(uri: string)

Value   = Scalar
        | Array([Value])
        | Object(OrderedMap<string, Value>)
        | Set([Value])
        | Typed(type_id: string, value: Value)
        | Node(tag: string, attributes: OrderedMap<string, Value>, children: [Value])

Headers = OrderedMap<string, Scalar>
Meta    = OrderedMap<dialect_uri: string, Headers>

Message = { id: string, kind: string, payload: Data(Value) | Messages([Message]), meta: Meta }
```

### 1.1 Invariants

- **String**: a sequence of Unicode scalar values. A lone surrogate is not a String, and
  encoders MUST reject one.
- **Int**: a signed 64-bit integer, −2⁶³ ≤ n ≤ 2⁶³−1. Encoders MUST reject a value outside that
  range, and decoders MUST reject one too.
- **Double**: an IEEE-754 binary64. There is one NaN: payload bits are not preserved. `+0` and
  `-0` are distinct values. **`Int(1)` and `Double(1.0)` are different values**, and both
  encodings keep them apart.
- **Instant**: nanoseconds since 1970-01-01T00:00:00Z as an i64, which covers the years
  1678 to 2262.
- **Ref**: a reference to something outside the message, as a URI. Version 1 doesn't validate
  the URI's syntax.
- **OrderedMap** (Object, attributes, Headers, Meta): keys are unique Strings, and entries keep
  insertion order. Decoders MUST reject duplicate keys. Encoders MUST emit entries in order.
  Order is what lets a message pass through a component byte for byte.
- **Set**: elements keep insertion order and are pairwise unequal (§1.2). Producers are
  responsible for uniqueness, and decoders MUST reject a set with two equal elements.
- **Typed.type_id**: a non-empty String, by convention `namespace/name` (`app/point`). The
  namespace `tdata` and every namespace that starts with `tdata.` are reserved for this
  specification (`tdata.spec/keys`).
- **Meta** keys are dialect URIs, compared by their exact spelling, never normalized. A dialect
  groups related headers (`https://tutuca.dev/d/trace` → `{at, by}`). Header values are Scalars.
- A **Message** is not a Value. Messages nest only through a `Messages` payload. A single child
  is a one-element list.

### 1.2 Equality

`equal(a, b)` is structural:

- Null, Bool, Int, String, Bytes, Instant, Ref: same case and same contents.
- Double: same bits, except that every NaN equals every NaN. `+0` does not equal `-0`.
- An Int never equals a Double, whatever their magnitudes.
- Array, Node children: same length, and the elements are equal pairwise in order.
- Object, Node attributes, Headers, Meta: the same set of keys, with equal values per key.
  Order does not count.
- Set: the same size, and every element of each has an equal element in the other. Order does
  not count.
- Typed: equal type_id and equal value.
- Node: equal tag, attributes and children.
- Message: equal id, kind, payload (Data with Data, Messages with Messages, pairwise) and meta.

Order does not count for equality, but encoding preserves it: two equal values can have
different encodings, and a decoded value always re-encodes to the bytes it came from (when those
bytes are in canonical form, §2.5 and §3.4).

### 1.3 Natives and the wire view

A **codec** binds a type_id to a native representation in one implementation: a JS class, a Wax
struct. It has two halves:

- `decode(value) → native | reject`
- `encode(native) → value`

Every native has a **wire view**, `Typed(type_id, encode(native))`. Equality, matching against
specs, and both encodings are all defined on wire views. JS and Wax therefore agree whatever
native types each one registered.

When a decoder meets `Typed(t, v)`:
- if no codec is registered for `t`, the result is the `Typed` itself;
- if the codec's `decode` rejects `v`, the result is also the `Typed` itself. Decoding never
  fails because of an application type;
- otherwise the result is the native.

A `Typed` that stayed a `Typed` re-encodes exactly as it was decoded. This is the opaque
round-trip.

## 2. JSON encoding

The JSON encoding is RFC 8259 JSON text, so any JSON tool can read it. Plain JSON whose arrays
are written in the escaped form `[[…]]` decodes to the Value it looks like: objects, strings,
numbers, booleans and null need no escaping. A bare JSON array such as `[1,2]` is a decode error,
because arrays are where the tagged forms live.

### 2.1 Values

`J(v)` is the JSON for a value `v`:

| Value | JSON |
|---|---|
| Null | `null` |
| Bool | `true`, `false` |
| Int | an integer token with no fraction and no exponent: `0`, `-123` |
| Double, finite and not `-0` | the shortest text that reads back as the same double (ECMAScript `Number::toString`), followed by `.0` when that text has none of `.`, `e`, `E`: `1.0`, `1.5`, `1e+21`, `5e-324` |
| Double NaN | `["num","NaN"]` |
| Double +∞ / −∞ | `["num","Infinity"]` / `["num","-Infinity"]` |
| Double −0 | `["num","-0"]` |
| String | a JSON string (§2.4) |
| Bytes | `["bytes","<base64>"]` (RFC 4648 §4 alphabet, with padding) |
| Instant | `["inst","<decimal epoch ns>"]` |
| Ref | `["ref","<uri>"]` |
| Array | `[[J(e₁),…,J(eₙ)]]`; the empty Array is `[[]]` |
| Object | `{"k₁":J(v₁),…}` (keys are not escaped or rewritten) |
| Set | `["set",[[J(e₁),…]]]` (the argument is an Array in its encoded form) |
| Typed | `["#","<type_id>",J(value)]` |
| Node | `["node","<tag>",{attributes},[[J(c₁),…]]]` (attributes encoded as an Object, children as an Array) |

The decimal in `inst` is an optional `-`, then `0` or a digit 1–9 followed by digits, within the
i64 range.

### 2.2 Decoding arrays

A JSON array in value position MUST be one of two things:

1. **An Array literal**: exactly one element, and that element is a JSON array. Its elements are
   values.
2. **A tagged form**: the first element is a String naming one of the tags `num bytes inst ref
   set # node`, followed by exactly the arguments §2.1 gives that tag. Each argument must have
   the expected shape (a string in the expected syntax, an Object, an encoded Array).

Anything else is a decode error. That covers `[]`, `[1,2]`, `["x"]`, an unknown tag, the wrong
number of arguments and a malformed argument. The set of tags is closed in version 1: the tags
`bigint` and `dec` are reserved for arbitrary-precision integers and decimals, and new
application types use `#`.

### 2.3 Numbers

A number token with no fraction and no exponent (`-?(0|[1-9][0-9]*)`) is an **Int**. If it
doesn't fit in i64, decoding fails. Any other number token is a **Double**: the nearest binary64
value, as ECMAScript reads it. Plain JSON therefore reads the way people expect:
`{"count":3,"price":1.5}` is an Int and a Double.

### 2.4 Strings

A JSON string decodes to its code points. An escape that leaves a lone surrogate (`"\ud800"`)
is a decode error. Encoders escape `"`, `\` and U+0000–U+001F the way `JSON.stringify` does
(`\b \t \n \f \r` by name, the rest as `\u00XX` with lowercase hex). Everything else is written
as is.

### 2.5 Canonical text

The canonical JSON text has no insignificant whitespace, keeps every OrderedMap in insertion
order, and follows §2.1–§2.4. Decoders accept any valid JSON whitespace. The test vectors use
canonical text.

### 2.6 Messages

```
{"id":"<id>","kind":"<kind>","data":J(value),"meta":{…}}
{"id":"<id>","kind":"<kind>","messages":[M₁,…],"meta":{…}}
```

- `id` and `kind` are Strings. Exactly one of `data` and `messages` is present.
- `messages` is a plain JSON array of message objects. It is not an encoded Value, so it has no
  `[[…]]` wrapping.
- `meta` is `{"<dialect uri>":{"<header>":J(scalar),…},…}`. Each header value MUST be the
  encoding of a Scalar. Encoders omit `meta` when it has no dialects, and decoders read a
  missing `meta` as empty. A dialect with no headers is kept: `{"uri":{}}`.
- Any other key is a decode error. The envelope is closed. Extensions go into meta dialects and
  Typed values.
- Canonical key order: `id`, `kind`, `data` or `messages`, `meta`. Decoders accept any order.

## 3. CBOR encoding

The CBOR encoding is a subset of RFC 8949. Every item has a definite length, and every head uses
the shortest form of its argument (preferred serialization).

### 3.1 Values

| Value | CBOR |
|---|---|
| Null | simple value 22 (`0xf6`) |
| Bool | `0xf4` false, `0xf5` true |
| Int | major type 0 (n ≥ 0) or 1 (n < 0) |
| Double | major type 7 float, always: the shortest of half (`0xf9`), single (`0xfa`) and double (`0xfb`) precision that holds the value exactly. NaN is `0xf97e00`. |
| String | major type 3, UTF-8 |
| Bytes | major type 2 |
| Array | major type 4 |
| Object | major type 5, text keys, in insertion order |
| Ref | tag 32 (URI) on a text string |
| Set | tag 258 (set) on an array |
| Typed | tag 27 (language-independent object) on `[type_id, value]` |
| Node | tag 37700 on `[tag, attributes map, children array]` |
| Instant | tag 37701 on an integer (epoch ns) |

An integer is always an Int and a float is always a Double, so `Double(1.0)` is `0xf93c00`,
never `0x01`. Tags 2/3 (bignums) and 4 (decimal fractions) are reserved for arbitrary-precision
integers and decimals.

Tags 37700 and 37701 come from the first-come-first-served range and are **provisional**. They
are to be checked against the IANA registry, and moved if needed, before version 1 is frozen.

### 3.2 Messages

A Message is an untagged map that mirrors the JSON one: `{"id": text, "kind": text, "data":
value}` or `{…, "messages": [message…]}`, plus `"meta": {uri: {header: scalar}}` when it isn't
empty. The rules of §2.6 apply: exactly one of `data` and `messages`, no other keys, canonical
order `id, kind, data|messages, meta`, and decoders accept any order.

### 3.3 What decoders reject

Indefinite lengths; `undefined` (`0xf7`) and every simple value other than false, true and null;
reserved additional-information values 28–30; integers outside i64; tags other than those in
§3.1 (except a single leading 55799); map keys that aren't text; duplicate map keys; invalid
UTF-8 (including encoded surrogates); and bytes left over after the top-level item.

A decoder MUST accept a leading self-describe tag 55799 on the top-level item. Encoders emit it
only when asked to.

### 3.4 Canonical bytes

The bytes the encoder produces are canonical: shortest heads, shortest exact floats, maps in
insertion order. A decoder MAY accept non-shortest heads and floats, but re-encoding them then
yields the canonical form. The test vectors use canonical bytes.

## 4. Specs

A spec describes the part of a value or a message that a component needs. Matching is **open**:
keys, dialects, attributes and trailing array elements that a spec doesn't mention are ignored,
never rejected.

### 4.1 Specs are values

A spec is a Value of one of two forms:

- **A String**: the name of a spec in the registry. These built-ins are always registered:
  `any null bool int double number string bytes instant ref`. `number` matches an Int or a
  Double.
- **A Typed** `Typed("tdata.spec/<form>", Object)` that names a form from §4.2 and carries its
  arguments in the Object.

A **registry** maps names to specs. `define(name, spec)` adds one. Specs can also travel in
messages of kind `tdata/specs`, whose data is an Object from names to specs. A name SHOULD be
namespaced (`app/point`). Definitions can refer to each other, recursively too, so fragments
defined separately compose by name.

### 4.2 Forms

In the table, `S` is a spec, `V` any value, `n` an Int and `x` an Int or a Double. Every
argument marked `?` is optional.

| Form | Arguments | Matches |
|---|---|---|
| `keys` | `req?: {k: S}`, `opt?: {k: S}` | an Object where every key in `req` is present and matches its spec, and every key in `opt` that is present matches. Other keys are ignored. |
| `map_of` | `values: S` | an Object whose every value matches `S` |
| `array` | `of?: S`, `min?: n`, `max?: n` | an Array whose length is within bounds and whose every element matches `of` |
| `set` | `of?: S`, `min?: n`, `max?: n` | the same, for a Set |
| `tuple` | `items: [S…]` | an Array with at least as many elements as `items`, matching position by position. Extra elements are ignored. |
| `int`, `double`, `number` | `min?: x`, `max?: x` | that kind of number, within the inclusive bounds, compared numerically |
| `string` | `min_len?: n`, `max_len?: n` | a String whose length in code points is within bounds |
| `bytes` | `min_len?: n`, `max_len?: n` | Bytes whose length is within bounds |
| `ref` | `prefix?: string` | a Ref whose uri starts with `prefix` |
| `instant` | `min?: inst`, `max?: inst` | an Instant within bounds |
| `const` | `value: V` | a value `equal` to `V` |
| `enum` | `values: [V…]` | a value `equal` to one of `values` |
| `typed` | `type_id: string`, `value?: S` | a Typed (or the wire view of a native) with that type_id, whose value matches `value` |
| `node` | `tag?: string`, `attrs?: S`, `children?: S` | a Node with that tag, whose attributes (as an Object) match `attrs` and whose children (as an Array) match `children` |
| `message` | `id?: S`, `kind?: S`, `data?: S`, `messages?: S`, `meta?: {uri: S}` | a Message. `id` and `kind` are matched as Strings. `data` requires a Data payload, and `messages` a Messages payload. Each dialect in `meta` must be present, and its headers (as an Object) must match its spec. Other dialects are ignored. |
| `messages` | `every?: S`, `some?: S`, `min?: n`, `max?: n` | a list of messages (the payload of a `message` spec's `messages`) |
| `and` | `of: [S…]` | every spec in `of`. This is how fragments compose: `and` of `keys` works like Clojure's `s/merge`. |
| `or` | `alts: {name: S}` | the first alt, in order, that matches. The result records the alt's name. |
| `maybe` | `of: S` | Null, or a value that matches `of` |
| `not` | `of: S` | a value that doesn't match `of` |

A spec that names an unknown form, has an argument of the wrong type, or names a spec missing
from the registry does not throw. It fails to match, with a problem that says why. A spec is a
value, so even a spec with an unknown form round-trips through both encodings.

### 4.3 Results

```
check(registry, spec, x) → { ok: true,  picks:    [{path, alt}] }
                         | { ok: false, problems: [{path, reason}] }
```

`x` is a Value or a Message. A **path** is a list of segments, each a String (an object key, an
attribute name, a dialect URI, or one of `id kind data messages meta attrs children value`) or
an Int (an index). A **reason** is a short, readable phrase (`expected an Int`, `missing key
"title"`, `no alt matched`, `unknown spec "app/pt"`).

`picks` lists the `or` branches taken, in the order the walk meets them. Inside `not`, and in
alts that were tried but didn't match, nothing is recorded. When there are problems, an
implementation SHOULD report every one it can find in the walk, not just the first. Matching
never alters its input.

### 4.4 Routing

A **router** holds `(spec, handler)` pairs in registration order. `dispatch(msg)` returns every
handler whose spec matches `msg`, in order, each with its picks. `first(msg)` returns the first.
Handlers receive the original message object.

### 4.5 Editing without loss

Implementations provide persistent updates by path: `getIn(x, path)`, `setIn(x, path, v)`,
`updateIn(x, path, f)` over Messages and Values. The result shares every part off the path with
the input, so those parts encode to the same bytes as before.

## 5. Conformance vectors

`tdata/vectors/` holds the vectors both implementations run:

- `values.json` and `messages.json`: `{name, json, cbor}` entries, with `cbor` in lowercase hex.
  Decoding `json` and decoding `cbor` give equal models, and the model encodes back to exactly
  `json` and exactly `cbor`.
- `invalid.json`: `{name, json}` or `{name, cbor}` entries, each of which MUST fail to decode.
- `specs.json`: `{name, registry?, spec, value | message, ok, picks? | problems?}`, where specs
  and values are given in canonical JSON and `problems` lists the paths only (reason texts may
  differ between implementations).
- `queries.json`: `{messages: {name: json}, cases: [{name, query, message, out, bindings?} |
  {name, query, error: true}]}`. `out` lists every output of the query (`run`, §6.6) as
  canonical JSON text, in order, and `bindings[i]`, when present, the Object of names bound for
  output `i` (`{}` otherwise). The matches (§6.1) are the outputs other than `false` and `null`.
  Error cases MUST fail to parse; the error texts are not compared.

## 6. Queries (tq)

tq is a small query language in the style of jq. A query asks a message a question: whether it
matches, and which parts of it the asker wants, named by the query's patterns. Like specs (§4),
queries are open: a missing key, a value of another kind or an unknown type makes a query
produce nothing, never an error. A query is a String, so it travels in messages as any value
does.

### 6.1 Evaluation

A query is a **filter**: it takes an input and an environment of bindings, and produces an
ordered sequence of **solutions**, each an output and the bindings it was produced with. The
input of a whole query is a Message. Inputs and outputs are **subjects**: a Value, a Message, or
the list of child messages of a Messages payload.

A step that doesn't apply to its input produces no solutions. This is where tq differs from jq:
in jq `.missing` gives `null`, in tq it gives nothing, so an absent key and a key whose value is
`null` stay distinct.

An output is **truthy** unless it is `false` or `null`. A query **matches** a message when one
of its outputs is truthy; the **match** is the first such solution. Running a query never fails;
only parsing does.

### 6.2 Grammar

```
query    = pipe
pipe     = comma [ "as" pattern "|" pipe | "|" pipe ]
comma    = alt { "," alt }
alt      = or { "//" or }
or       = and { "or" and }
and      = cmp { "and" cmp }
cmp      = match [ ("==" | "!=" | "<" | "<=" | ">" | ">=") match ]
match    = postfix [ "~" pattern ]
postfix  = primary { field | "." "[" sub | "[" sub }
sub      = "]" | int "]" | string "]"
primary  = "." [ "[" sub ] | ".." | field | "$" name | literal
         | "(" pipe ")" | "[" "]" | "[" pipe "]"
         | fn0 | fn1 "(" pipe ")"
field    = "." name | "." string                (no space after the dot)
literal  = string | number | "true" | "false" | "null"
         | "ref" "(" string ")" | "inst" "(" string ")"
fn0      = "not" | "empty" | "type" | "type_id" | "length" | "keys"
fn1      = "select" | "has" | "starts_with" | "ends_with" | "contains" | "first" | "any" | "all"

pattern  = "$" name [ "@" pattern ] | "_" | literal
         | "{" [ key ":" pattern { "," key ":" pattern } [ "," ] ] "}"
         | "[" [ items ] "]"
         | "#" string pattern
         | "<" pattern pattern pattern ">"
         | "(" pattern { "|" pattern } ")"
items    = ".." [ "$" name ] | pattern [ "," items ]
key      = name | string
name     = [A-Za-z_][A-Za-z0-9_]*
```

Strings and numbers are JSON tokens (§2.3, §2.4): `1` is an Int and `1.0` a Double, and an
integer outside i64 is an error. A number may start with `-`. `inst("…")` takes the decimal
nanoseconds of an Instant. Whitespace (space, tab, newline, carriage return) separates tokens,
except within a field (`.k`). Comparisons don't chain: `a == b == c` is an error. Within a
pattern's object, a key may appear once. A query that doesn't parse is an error that says what
was expected and where, as `line N, col N`.

### 6.3 Paths

| Query | Output |
|---|---|
| `.` | the input |
| `.k`, `."k"`, `.["k"]` | the value of key `k` of an Object. Of a Message: `id`, `kind` (Strings), `data` (when the payload is a Value), `messages` (the child messages, when it is a list), `meta` (an Object from dialect URIs to Objects of headers). Of a Node: `tag` (a String), `attrs` (an Object), `children` (an Array). Of a Typed: `value` |
| `[n]` | element `n` of an Array or of a list of messages, counted from the end when negative |
| `[]` | each element of an Array, a Set or a list of messages, in order; each value of an Object, in order |
| `..` | the input, then `..` of each of its parts, in order: for a Message `id kind data\|messages meta`, for a Node `tag attrs children`, for a Typed its value, otherwise what `[]` gives |

These are the segments of `getIn` (§4.5). A native (§1.3) is seen through its wire view.

### 6.4 Expressions

- `a | b` runs `b` on each output of `a`, with that output's bindings.
- `a, b` gives the outputs of `a`, then those of `b`, each run with the input's bindings.
- `a // b` gives the truthy outputs of `a`, or the outputs of `b` if there are none.
- `a and b` outputs `true` when `a` has a truthy output and `b`, run with that output's
  bindings, has one too; its bindings are those of `b`'s first truthy output. Otherwise it
  outputs `false` with the input's bindings. `a or b` outputs `true` with the bindings of the
  first truthy output of `a`, else of `b`; else `false`.
- A comparison outputs a Bool for each pair of outputs, `a`'s in the outer loop. `==` and `!=`
  are equality (§1.2) on the subjects: `1 == 1.0` is `false`. `<`, `<=`, `>`, `>=` order
  numbers (Int and Double compared exactly, without rounding), Strings (by code point) and
  Instants; any other pair, and NaN, compares `false`.
- `$name` outputs the value bound to `name`, or nothing when it isn't bound.
- `[q]` outputs one Array of the outputs of `q`; `[]` the empty Array. A message in it is written
  as the Value `#"tdata/message" {id, kind, data | messages, meta?}` (with child messages
  written the same way, and `meta` only when not empty).
- Literals output themselves.

Built-in functions; where an argument has several outputs, the function runs once per output:

| Function | Output |
|---|---|
| `select(q)` | the input, when `q` has a truthy output, with that output's bindings |
| `not` | `true` when the input isn't truthy, else `false` |
| `empty` | nothing |
| `type` | the kind's name: `null bool int double string bytes instant ref array object set typed node`, `message`, `messages` |
| `type_id` | a Typed's type_id |
| `length` | the code points of a String, the bytes of Bytes, the elements of an Array, a Set or a list of messages, the entries of an Object |
| `keys` | an Array of an Object's keys, in order; of a Message, `id kind data\|messages meta` |
| `has(k)` | for a String `k`: whether an Object or a Message has that key; for an Int: whether an Array or a list of messages has that index |
| `starts_with(s)`, `ends_with(s)`, `contains(s)` | for a String input and String `s`, a Bool |
| `first(q)` | the first output of `q`, with its bindings |
| `any(q)`, `all(q)` | whether some, or every, output of `q` is truthy (`all` of nothing is `true`) |

A function given an input or argument it doesn't take outputs nothing.

### 6.5 Patterns and bindings

`q ~ P` matches each output of `q` against the pattern `P`; each way it matches outputs that
value with the bindings `P` added. `q as P | body` runs `body` on the input (not on `q`'s output)
once per way each output of `q` matches `P`; `q as $x | body` is the plain variable binding.

| Pattern | Matches |
|---|---|
| `$name` | anything, binding it to `name`. A name already bound matches only an equal value (§1.2), so a name has one value in a solution |
| `_` | anything, binding nothing |
| a literal | an equal value |
| `{k: P, …}` | an Object, or a Message (by its fields as in §6.3), that has every key listed, each value matching its pattern. Other keys are ignored |
| `[P1, …, Pn]` | an Array, or a list of messages, of exactly `n` elements, matching in order |
| `[P1, …, Pn, ..]` | one of at least `n` elements; the others are ignored |
| `[P1, …, Pn, ..$rest]` | the same, binding the others to `rest`, as an Array (or a list of messages) |
| `#"type_id" P` | a Typed with that type_id whose value matches `P` |
| `<Pt Pa Pc>` | a Node whose tag (a String), attributes (an Object) and children (an Array) match |
| `$name @ P` | what `P` matches, binding the whole value to `name` as well |
| `(P1 \| P2 \| …)` | what any alternative matches, tried left to right: each way each one matches is a solution |

Bindings are listed in the order the names were first bound.

### 6.6 Results

An implementation provides `run(query, msg)` (every solution), `match_all(query, msg)` (the
solutions whose output is truthy) and `match(query, msg)` (the first of those, or none). The
interchange form of a result is a canonical JSON Value: `{"ok":true,"value":V,"bindings":{name:V}}`
for a match, `{"ok":false}` for none, `{"ok":true,"solutions":[[{"value":V,"bindings":{…}}, …]]}`
for `run` and `match_all`, and `{"ok":false,"error":"…"}` when the query or the message doesn't
parse. Messages and lists of messages in outputs and bindings are written as in a collected
array (§6.4).

Example: on a batch whose first child is a note by `ana` with a trace header,

```
.messages[] ~ {kind: "note", data: {title: $title, author: {name: $who}},
               meta: {"https://tutuca.dev/d/trace": {at: $at}}}
| select($who != "bot")
```

matches with that child as the value and the bindings `title`, `who` and `at`.
