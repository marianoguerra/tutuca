# Tutuca — Testing

How to author component tests in Tutuca: the `getTests` export shape,
the calling conventions for methods and handler blocks (`receive`,
`intent`, `alter`), and the view-handler design
rule that keeps tests free of fake DOM events. Run them with
`tutuca test <module-path>` — flags and exit codes are in
[cli.md](./cli.md). General authoring lives in
[core.md](./core.md).

## Setup

A module opts into `tutuca test` by exporting `getTests`:

```js
export function getTests({ describe, test, expect }) {
  describe(MyComp, () => {
    test("does the thing", () => {
      expect(MyComp.make().doTheThing().count).toBe(1);
    });
  });
}
```

- `expect` is chai, extended with **jest-style matchers** (`toBe`,
  `toEqual`, `toContain`, `toThrow`, `.not.toBe`, …) — the recommended
  style. Chai's BDD chain (`expect(x).to.equal(1)`) still works for those
  who prefer it. Run `tutuca help` for the full matcher list (it's
  surfaced from code). Asymmetric/mock matchers
  (`expect.objectContaining`, `toHaveBeenCalled…`, `toMatchSnapshot`) are
  **not** available — tutuca has no mocking layer.
- `test` and `describe` are **Tutuca's own** subset of the common
  Mocha/Jest-style API, injected by `tutuca test` — they are not imported
  from a test runner, so don't reach for one's extras.
  Available calls: `describe(title, fn)`, `describe(Component, fn)`,
  `describe(title, { component }, fn)`, and `test(title, fn)`. There is
  no `before` / `after` / `beforeEach` / `it` / skip-flag — don't reach
  for them.
- `describe(Component, fn)` auto-tags the suite with `Component.name`,
  so `tutuca test <module> Component` picks it up. Untagged `test(...)`
  inside a tagged `describe` inherits the tag.

Run with `tutuca test <module-path> [name] [--grep <pattern>] [--bail]`.
Full flag/format/exit-code reference in [cli.md](./cli.md).

## What to test

Run tests when the change is observable from JS — methods, handlers,
factories, coercion in `make({...})`. Skip them for pure
template/styling tweaks; `tutuca render <module>` covers those.

- **Methods** — call directly: `Comp.make({...}).method(args)`. Assert
  on the *returned* instance (Tutuca state is immutable).
- **Receive handlers** — call via
  `Comp.receive.handlerName.call(comp, ...args)` (see *Calling receive
  handlers* below). One bucket holds every addressed message, so the same
  call drives a view's `@on.*` name, what a parent sends, and an
  **answer** to an intent — a handler cannot tell them apart, which is
  exactly what makes it testable:
    - `receive.<name>(ctx)` — `ctx` carries `send` / `intent` / `forward`.
    - `receive.<name>Ok(res, ctx)` / `receive.<name>Error(err, ctx)` /
      `receive.<name>Unhandled(...intentArgs, ctx)` — the three outcomes
      of an intent. Each takes **one** payload, so there is no arm that
      can be handed both a result and an error.
- **The other handler kinds** (`intent`, `alter`) follow the **same
  shape**: `Comp.<kind>.handlerName.call(comp, ...declaredArgs)`. Only
  the arguments differ:
    - `intent.<name>(payload, ctx)` — `payload` is whatever the sender
      raised it with. Call `ctx.reply` / `ctx.fail` on a stand-in ctx to
      assert what it answers.
    - `alter.<name>(...)` — iteration handlers used by `@when`,
      `@loop-with`, `@enrich-with`. Each kind has its own signature; see
      *Testing iteration handlers* below.
  Pass a plain stand-in for `ctx` (e.g. `{}`) when the handler doesn't
  read from it; otherwise build the minimal shape it touches.
- **Factories / coercion** — `Comp.make({...})` shape, defaults, and
  any deep-coercion you wired up.

## Calling receive handlers

Pattern:

```js
Comp.receive.handlerName.call(comp, arg1, arg2, /* … */);
```

- Why `.call`: receive handlers are plain functions stored on the
  component descriptor. `this` must be bound explicitly to the instance.
- `comp` is an instance — `Comp.make({...})`.
- The args after `comp` are exactly what the template would have passed
  (see next section). The auto-appended `ctx` is *not* required in
  tests when the handler doesn't read from it; pass `{}` or a stub if
  it does.
- Returned value is the next instance.

## Driving a full cascade (`drive`)

Direct `.call(comp, ...)` tests one handler in isolation. When you need a message
to fan out through real dispatch — an intent whose answer feeds more dispatches,
a `send` that triggers more sends — `getTests` also injects an async
`drive` helper (alongside `describe`, `test`, `expect`):

```js
export function getTests({ describe, test, expect, drive }) {
  describe(Grid, () => {
    test("init loads rows", async () => {
      const settled = await drive(
        Grid.make({ rows: [] }),
        { intent: [{ name: "load", args: [], opts: { route: ["lex"] } }] }, // an `on`-phase config
      );
      expect(settled.rows.size).toBe(3);
    });
  });
}
```

- `drive(value, phase, opts?)` builds a transactor over `value`, dispatches the
  phase's actions at the root, awaits the whole cascade (including async
  intents), and returns the **settled** instance.
- `drive` **always originates at the root** — there is no `at:`/path option. To
  exercise a handler on a nested child, call it directly with `.call(child, …)`.
- `phase` is the same shape as an example's `on.init` (`{ send, intent, do }`;
  see [storybook.md](./storybook.md#lifecycle-hooks-on)). `args` may be a function
  `(self) => [...]`, and an `intent` action takes `opts: { route: [...] }`.
- An `intent` on the **`dyn`** leg has nowhere to walk under `drive`: it
  originates at the root, and the leg starts at the sender's *parent*. The walk
  runs out and the sender hears `<name>Unhandled` — which is a result you can
  assert on. To exercise an `intent` handler itself, call it directly.
- These are *action kinds*, not methods. `$`-prefixed methods are read-only
  computations, not an action kind — `on`/`drive` can only reach state through
  `receive` / `intent` handlers. To put a component into a specific state in a
  unit test, call the receive recipe directly or drive a message.
- `intent` actions on the `lex` leg resolve against the module's
  `getIntentHandlers()`.
- `opts.onMessage(message, before, after)` observes every committed transaction —
  `message` is `{ kind, name, args, path }`, `before`/`after` are the root values
  around its commit — handy for asserting the message/state trace.

## Testing iteration handlers

`alter` handlers run inside `@each` / `@when` / `@loop-with` /
`@enrich-with` and have three distinct shapes:

- `loopWith(seq, ctx)` — called once with the full collection, returns
  `{ iterData?, start?, end?, keys? }`: `iterData` is the shared per-loop
  value (defaults to `{ seq }`); `start`/`end` slice the iteration
  (`Array.prototype.slice` semantics, original keys preserved); `keys`
  is an authoritative list of original keys to visit. `this` is the
  parent component instance. Full return-shape and `ctx` semantics in
  [iteration.md](./iteration.md).
- `when(key, value, iterData)` — called per element, returns truthy to
  keep. `this` is the parent component instance.
- `enrichWith(binds, key, value, iterData)` — called per kept element;
  mutates `binds` (which already contains `key` and `value`). `this` is
  the parent component instance.

You can call each one directly with `.call(comp, ...)`, but in practice
you want to test them as a pipeline: filter + loop-data + enrichment
together produce a list of bindings the view sees. Use
`collectIterBindings` for that — a functional implementation only ships
in the dev build (`tutuca/dev`); the core `tutuca` build exports a no-op
stub that returns `[]`. Both commands that run `getTests()` in the
terminal — `tutuca test` and `tutuca storybook` (including `--dry-run`) —
redirect the bare `tutuca` import to the dev build automatically, as does
the browser storybook's import map. So test modules can import it as below:

```js
import { collectIterBindings } from "tutuca";

const c = MyComp.make({ items: [...] });
const r = collectIterBindings(MyComp, c, c.items, {
  loopWith: "loopHandlerName",   // optional
  when: "whenHandlerName",       // optional
  enrichWith: "enrichHandlerName", // optional
});
// r is Array<{ key, value, ...enrichments }> — one entry per kept item,
// in iteration order.
```

- `seq` can be a plain JS Array, a JS `Map`, or a custom collection
  or keyed seq.
- Handler names refer to entries in `MyComp.alter`. An unknown name
  throws — there's no silent fallback.
- The `compInstance` is `this` for every handler. Pass
  `MyComp.make({ field: ... })` so handlers that read `this.field` see
  the value you want.
- The redirect uses Node's `module.register`, which is how the `tutuca`
  bin runs. On a runtime without loader-hook support it degrades to the
  no-op stub — if you see `collectIterBindings` return `[]`, import it
  from `tutuca/dev` explicitly.

Example:

```js
const Items = component({
  name: "Items",
  fields: { items: [], multiplier: 1 },
  alter: {
    loopMeta(seq) { return { iterData: { len: seq.length, doubled: seq.length * 2 } }; },
    keepEven(k) { return k % 2 === 0; },
    addLabel(binds, k, v, { len }) { binds.label = `${k}/${len}: ${v}`; },
  },
});

test("filters and enriches", () => {
  const c = Items.make({ items: [10, 20, 30, 40] });
  const r = collectIterBindings(Items, c, c.items, {
    loopWith: "loopMeta",
    when: "keepEven",
    enrichWith: "addLabel",
  });
  expect(r).toEqual([
    { key: 0, value: 10, label: "0/4: 10" },
    { key: 2, value: 30, label: "2/4: 30" },
  ]);
});
```

Use this whenever the iteration logic is the subject under test —
no DOM, no view, no Stack/Renderer needed. For end-to-end checks that
the view actually wires these handlers correctly, use
`tutuca render <module>` instead.

## Designing handlers so tests stay simple

Tutuca templates resolve each handler arg from its sigil (see
[core.md](./core.md) *Event Handling*). When you author a handler,
**pick the most specific args you need; don't take broad event
reads**. With narrow args, the test passes a literal; with `e.target`
or friends, the test must fabricate DOM-node-shaped objects.

An event always names a `receive` handler without a prefix. `$method` is for
read-only value slots and is rejected in `@on.*`. What matters for testability
is which named argument the receive handler asks for.

**Bad — receive handler taking the whole input node:**

```html
<input @on.input="setName e.target" />
```
```js
receive: { setName(draft, target) { draft.name = target.value; } }
```

**Good — receive handler taking the value:**

```html
<input @on.input="setName e.value" />
```
```js
receive: { setName(draft, value) { draft.name = value; } }
```

**Bad — receive handler:**

```html
<input @on.input="setCount e.value" />
```
```js
receive: { setCount(draft, value) { draft.count = parseInt(value, 10); } }
```

**Good — receive handler:**

```html
<input @on.input="setCount e.valueAsInt" />
```
```js
receive: { setCount(draft, n) { draft.count = n; } }
```

At test time, the "good" forms become trivial:

```js
const value = MyComp.make();
expect(produce(value, (draft) => value.setName(draft, "Ada")).name).toBe("Ada");
expect(produce(value, (draft) => MyComp.receive.setCount.call(value, draft, 42)).count).toBe(42);
```

The "bad" forms force every test to construct
`{ target: { value: "42" } }` (or a fuller stub when more fields are
read), which is brittle and obscures intent.

The handler-arg forms are listed in [core.md](./core.md) *Event
Handling*; `ctx` is auto-appended last as the trailing argument.

## Worked example

A `getTests` export covering two receive handlers (`inc` and `dec`) and a
receive handler with a named arg (`setCount` taking
`e.valueAsInt`):

```js
import { produce } from "tutuca/immer";

export function getTests({ describe, test, expect }) {
  describe(Counter, () => {
    describe("inc", () => {                           // receive handler
      test("returns a Counter with count + 1", () => {
        const c = Counter.make();
        expect(produce(c, (draft) => Counter.receive.inc.call(c, draft)).count).toBe(1);
      });
      test("does not mutate the original instance", () => {
        const c = Counter.make({ count: 7 });
        produce(c, (draft) => Counter.receive.inc.call(c, draft));
        expect(c.count).toBe(7);
      });
    });

    describe("dec()", () => {                         // receive handler, no args
      test("returns a Counter with count - 1", () => {
        const c = Counter.make();
        const next = produce(c, (draft) => Counter.receive.dec.call(c, draft));
        expect(next.count).toBe(-1);
      });
    });

    describe("setCount()", () => {                    // receive handler, e.valueAsInt
      test("sets the count from a parsed int", () => {
        const c = Counter.make();
        const next = produce(c, (draft) => Counter.receive.setCount.call(c, draft, 42));
        expect(next.count).toBe(42);
      });
    });

    test("inc and dec round-trip", () => {            // untagged, inherits Counter
      const c = Counter.make();
      const next = produce(c, (draft) => {
        Counter.receive.inc.call(c, draft);
        Counter.receive.dec.call(c, draft);
      });
      expect(next.count).toBe(0);
    });
  });
}
```

## See also

- [core.md](./core.md) — *Verifying changes*, *Event Handling*,
  *Component Skeleton*.
- [messages-and-intents.md](./messages-and-intents.md) — handler signatures for
  `receive` / `intent`, routes and the three outcomes, `$unknown`.
- [cli.md](./cli.md) — `test` flags, exit codes, output formats,
  `--grep` syntax.
