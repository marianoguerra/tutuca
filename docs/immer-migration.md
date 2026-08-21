# Migrating from Immutable.js to Immer

Tutuca state now uses generated Immer-draftable classes and native JavaScript
collections. Component instances are deeply frozen snapshots outside a
transaction and retain structural sharing after an update.

## Handler contract

Dispatched `receive` and `intent` handlers receive a draft first. `methods`
are read-only computations and are never event handlers:

```js
const Counter = component({
  name: "Counter",
  fields: { count: 0, items: [], selected: new Set() },
  receive: {
    increment(draft) {
      draft.count++;
    },
    removeItem(draft, index) {
      draft.items.splice(index, 1);
    },
    select(draft, id) {
      draft.selected.add(id);
    },
  },
});
```

`this` is always the immutable value at the start of that handler. Mutate the
draft and return nothing (or the draft itself) to commit. If the recipe makes no
change, Tutuca keeps the current identity.

Return any other value to replace the addressed component. This is how a type
selector can swap one component for another:

```js
receive: {
  chooseType(_draft, Type) {
    return Type.make();
  },
}
```

Immer rejects a handler that both mutates its draft and returns a replacement.
Keep those two forms mutually exclusive.

`alter` handlers are render-time, read-only functions and keep their existing
signature. A method used as a computed `$value` remains a no-argument read. In
a view, `@on.click="increment"` resolves only through `receive`; `$increment` is
rejected in event position.

## Fields and collections

Replace Immutable.js values with native equivalents:

| Before | Now |
| --- | --- |
| `List(values)` | `[...values]` |
| `IMap(entries)` / `OMap(entries)` | `new Map(entries)` |
| `ISet(values)` | `new Set(values)` |
| Immutable Record component instance | generated component class instance |
| `list.get(i)` / `list.size` | `list[i]` / `list.length` |
| `map.get(k)` / `map.set(k, v)` | the native Map API |

The `omap` field descriptor is removed; native Map already preserves insertion
order. Generated `setX`, `toggleX`, `pushInX`, and related methods are also
removed. Declare the small named handlers that the view actually calls and use
normal mutation syntax on their drafts.

Custom classes stored in state must opt into Immer and should expose `get` and
a draft-mutating `set` when they participate in Tutuca's keyed sequence/path
protocol:

```js
import { immerable } from "tutuca/immer";

class KeyedValues {
  static [immerable] = true;
  // get(key, fallback), draft-mutating set(key, value), and optional SEQ_INFO walker
}
```

## Tests and host-side recipes

Prefer `drive()` when testing dispatched behavior. For a small recipe unit,
use the separate Immer entry point and pass the draft explicitly:

```js
import { produce } from "tutuca/immer";

const current = Counter.make({ count: 1 });
const next = produce(current, (draft) => Counter.receive.increment.call(current, draft));
```

The root `tutuca` export no longer re-exports Immutable.js. The standalone
browser/package entry is now `tutuca/immer`. The Immutable-specific data
inspector and bundled `immutable-js` skill were removed; use `DataInspector`
for arrays, objects, Map, Set, and other JavaScript values.
