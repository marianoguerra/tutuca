# Tutuca — Testing

How to author component tests in Tutuca: the `getTests` export shape,
the calling conventions for methods and handler blocks (`input`,
`receive`, `bubble`, `response`, `alter`), and the view-handler design
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
  Mocha/Bun-style API, injected by `tutuca test` — not Bun's built-ins.
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
- **Input handlers** — call via
  `Comp.input.handlerName.call(comp, ...args)` (see *Calling input
  handlers* below).
- **All other handler kinds** (`receive`, `bubble`, `response`, `alter`,
  and `on` if a component declares one) follow the **same shape**:
  `Comp.<kind>.handlerName.call(comp, ...declaredArgs)`. Only the
  arguments the handler receives differ:
    - `receive.<name>(ctx)` — `ctx` carries `send` / `request` / `bubble`.
    - `bubble.<name>(payload, ctx)` — `payload` is whatever the child sent.
    - `response.<name>(res, err, ctx)` — async result + error. But a
      handler reached via a request's `onOkName` / `onErrorName`
      override takes a **single** payload arg, not `(res, err)`:
      `Comp.response.loadDataOk.call(comp, res)` /
      `Comp.response.loadDataErr.call(comp, err)`. See
      [request-response.md](./request-response.md).
    - `alter.<name>(...)` — iteration handlers used by `@when`,
      `@loop-with`, `@enrich-with`. Each kind has its own signature; see
      *Testing iteration handlers* below.
  Pass a plain stand-in for `ctx` (e.g. `{}`) when the handler doesn't
  read from it; otherwise build the minimal shape it touches.
- **Factories / coercion** — `Comp.make({...})` shape, defaults, and
  any deep-coercion you wired up.

## Calling input handlers

Pattern:

```js
Comp.input.handlerName.call(comp, arg1, arg2, /* … */);
```

- Why `.call`: input handlers are plain functions stored on the
  component descriptor. `this` must be bound explicitly to the instance.
- `comp` is an instance — `Comp.make({...})`.
- The args after `comp` are exactly what the template would have passed
  (see next section). The auto-appended `ctx` is *not* required in
  tests when the handler doesn't read from it; pass `{}` or a stub if
  it does.
- Returned value is the next instance.

## Driving a full cascade (`drive`)

Direct `.call(comp, ...)` tests one handler in isolation. When you need a message
to fan out through real dispatch — a `request` that resolves and feeds its
`response`, a `send` that triggers more sends — `getTests` also injects an async
`drive` helper (alongside `describe`, `test`, `expect`):

```js
export function getTests({ describe, test, expect, drive }) {
  describe(Grid, () => {
    test("init loads rows", async () => {
      const settled = await drive(
        Grid.make({ rows: [] }),
        { request: [{ name: "load", args: [] }] }, // an `on`-phase config
      );
      expect(settled.rows.size).toBe(3);
    });
  });
}
```

- `drive(value, phase, opts?)` builds a transactor over `value`, dispatches the
  phase's actions at the root, awaits the whole cascade (including async
  requests), and returns the **settled** instance.
- `drive` **always originates at the root** — there is no `at:`/path option. To
  exercise a handler on a nested child, call it directly with `.call(child, …)`.
- `phase` is the same shape as an example's `on.init`
  (`{ send, bubble, request, input, do }`; see
  [storybook.md](./storybook.md#lifecycle-hooks-on)). `args` may be a function
  `(self) => [...]`.
- A `bubble` action is a **no-op under `drive`**: bubbles travel child→parent, and
  at the root there is no ancestor to receive it (the root's own `bubble` handler
  is skipped too). To test a `bubble` handler, call it directly. (`drive` warns
  when a phase contains a `bubble`.)
- These are *action kinds*, not methods. `$`-prefixed **methods** (auto setters/
  togglers, `$foo`) are not an action kind — `on`/`drive` can only reach state
  through `input`/`receive`/`response` handlers. To put a component into a method-
  driven state for a test, call the method directly or route it through an `input`
  handler.
- `request` actions resolve against the module's `getRequestHandlers()`.
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
stub. `tutuca test` redirects the bare `tutuca` import to the dev build
automatically, so test modules can import it as below:

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

- `seq` can be a plain JS Array, a JS `Map`, or any immutable.js indexed
  or keyed seq.
- Handler names refer to entries in `MyComp.alter`. An unknown name
  throws — there's no silent fallback.
- The `compInstance` is `this` for every handler. Pass
  `MyComp.make({ field: ... })` so handlers that read `this.field` see
  the value you want.

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

Tutuca templates resolve handler args by name (see
[core.md](./core.md) *Event Handling*). When you author a handler,
**pick the most specific named args you need; don't take the raw
event**. With named args, the test passes a literal; with `event`,
the test must fabricate a DOM-event-shaped object.

The prefix in the template picks the handler block: a leading `$`
means "method on `this`", no prefix means an input handler. The same
named-arg rule applies to both. Both forms below are correct
placements — what matters is what argument the handler asks for.

**Bad — method:**

```html
<input @on.input="$setName event" />
```
```js
methods: { setName(event) { return this.setName(event.target.value); } }
```

**Good — method:**

```html
<input @on.input="$setName value" />
```
```js
methods: { setName(value) { return this.setName(value); } }
```

**Bad — input handler:**

```html
<input @on.input="setCount event" />
```
```js
input: { setCount(event) { return this.setCount(parseInt(event.target.value, 10)); } }
```

**Good — input handler:**

```html
<input @on.input="setCount valueAsInt" />
```
```js
input: { setCount(n) { return this.setCount(n); } }
```

At test time, the "good" forms become trivial:

```js
expect(MyComp.make().setName("Ada").name).toBe("Ada");
expect(MyComp.input.setCount.call(MyComp.make(), 42).count).toBe(42);
```

The "bad" forms force every test to construct
`{ target: { value: "42" } }` (or a fuller stub when more fields are
read), which is brittle and obscures intent.

The built-in named args are listed in [core.md](./core.md) *Event
Handling*; `ctx` is auto-appended last. Reach for `event` only when no
narrower arg fits.

## Worked example

A `getTests` export covering a method (`inc`), an input handler with no
args (`dec`), and an input handler with a named arg (`setCount` taking
`valueAsInt`):

```js
export function getTests({ describe, test, expect }) {
  describe(Counter, () => {
    describe("inc()", () => {                         // method
      test("returns a Counter with count + 1", () => {
        expect(Counter.make().inc().count).toBe(1);
      });
      test("does not mutate the original instance", () => {
        const c = Counter.make({ count: 7 });
        c.inc();
        expect(c.count).toBe(7);
      });
    });

    describe("dec()", () => {                         // input handler, no args
      test("returns a Counter with count - 1", () => {
        const next = Counter.input.dec.call(Counter.make());
        expect(next.count).toBe(-1);
      });
    });

    describe("setCount()", () => {                    // input handler, valueAsInt
      test("sets the count from a parsed int", () => {
        const next = Counter.input.setCount.call(Counter.make(), 42);
        expect(next.count).toBe(42);
      });
    });

    test("inc and dec round-trip", () => {            // untagged, inherits Counter
      expect(Counter.input.dec.call(Counter.make().inc()).count).toBe(0);
    });
  });
}
```

## See also

- [core.md](./core.md) — *Verifying changes*, *Event Handling*,
  *Component Skeleton*.
- [request-response.md](./request-response.md) — handler signatures for
  `bubble` / `receive` / `response`, override forms, `$unknown`.
- [cli.md](./cli.md) — `test` flags, exit codes, output formats,
  `--grep` syntax.
