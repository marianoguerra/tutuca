# Tutuca — List Iteration & Enrichment

Read this file when a view iterates a sequence (`@each`,
`render-each`), filters (`@when`), enriches items or scopes
(`@enrich-with`), or paginates (`@loop-with`).

## List Iteration

`@each` accepts: `.field`, `*dynamic`.

```html
<!-- iterate plain values -->
<li @each=".items"><span @text="@key"></span>: <x text="@value"></x></li>

<!-- filter -->
<li @each=".items" @when="filterItem">...</li>

<!-- per-item enrichment (binds.X => @X in template) -->
<li @each=".items" @enrich-with="enrichItem">
  <x text="@count"></x>
</li>

<!-- shared per-loop data + slicing (computed once before iteration) -->
<li @each=".items" @loop-with="getIterData" @when="filterItem">...</li>

<!-- render a list of components -->
<x render-each=".items"></x>
<x render-each=".items" as="edit"></x>                          <!-- specific view -->
<x render-each=".items" @when="filterItem"></x>                 <!-- with filter -->
<x render-each=".items" loop-with="getIterData" @when="filterItem"></x>
<x render-each=".items" @show=".isOpen"></x>                    <!-- wrap in show -->
```

On `<li @each>` / `<div @each>` and other host-element loops the
filters are written `@when` / `@enrich-with` / `@loop-with` (the `@`
prefix is the element-directive convention). On `<x render-each>` the
same filters drop the prefix — `when=` / `enrich-with=` / `loop-with=`
— because `<x>` carries plain attributes, not directives. Both forms
share the handler-name resolution rules below.

```js
alter: {
  filterItem(_key, item, iterData) { return item.includes(iterData.q); },
  enrichItem(binds, _key, item, iterData) { binds.count = item.length; },
  // `@loop-with` is `(seq, ctx)` and returns { iterData?, start?, end?, keys? }.
  getIterData(seq, ctx) {
    const start = this.page * this.pageSize;
    return { iterData: { q: this.query.toLowerCase() }, start, end: start + this.pageSize };
  },
}
```

### `@loop-with` return shape — `iterData` + slicing

A `@loop-with` handler returns an object with up to four optional keys:

- **`iterData`** — the shared per-loop value handed to `@when` /
  `@enrich-with`. Defaults to `{ seq }` when omitted.
- **`start`, `end`** — a positional slice of the iteration, with
  `Array.prototype.slice` semantics: `end` is exclusive, negatives count
  from the end (`end: -3` drops the last 3), `undefined` means the
  natural bound. Use this to **paginate** — skip a prefix and/or suffix
  without iterating or rendering it.
- **`keys`** — an explicit, ordered array of **original keys** to visit,
  for **filter-then-paginate**. The handler filters/sorts/slices the full
  sequence itself and returns the current page's slice of original keys;
  the renderer visits exactly those (`seq.get(key)`), in order. Takes
  precedence over `start`/`end` when both are present.

Slicing is positional but **preserves each item's original key**: a List
sliced to `start: 2` still binds `@key` to `2, 3, …`, so events, drag,
and two-way binding keep their identity. With `start`/`end`, `@when` then
filters *within* the window, so a page may yield fewer than `end - start`
items — to filter *before* paging (so the page count reflects the filtered
total), return `keys` instead. `keys` are original keys, so identity is
preserved there too: editing or deleting a row on page 2 of a filtered view
hits the right item. A `keys` return is **authoritative** — the renderer
visits exactly those keys and does **not** re-apply `@when` (the handler has
already decided what renders).

### `@loop-with` handler context — `(seq, ctx)`

The handler's second argument is `ctx = { lookup, filter }` (an object so it
can grow):

- **`ctx.lookup(name)`** — reads a scope `@`-binding, e.g. one published by an
  ancestor scope `@enrich-with`. Lets the handler **reuse a value the enrich
  already computed** instead of recomputing it.
- **`ctx.filter(key, value, iterData)`** — wraps the declared `@when` predicate
  (always callable; a no-op that returns `true` when there is no `@when`). Lets
  the handler apply the *declared* filter while building its `keys` slice,
  rather than re-implementing the match test.

### Lifecycle of `@each`

For each render of an element with `@each=".items"`:

1. **Resolve sequence** — evaluate `.items`. Lists, IMaps, OMaps, ISets,
   and any class declaring a `SEQ_INFO` walker are recognized.
2. **`@loop-with`** (once per render) — `getIterData.call(this, seq, ctx)`
   is called with the full sequence and the `{ lookup, filter }` context;
   its `iterData` becomes the shared per-loop value and its `start`/`end`
   slice the iteration. Skipped if no `@loop-with`; then `iterData` is
   `{ seq }` and the whole sequence is iterated. If it returns `keys`,
   those exact keys are visited in order (filter-then-paginate) and
   `start`/`end` are ignored.
3. For each `(key, value)` pair in the sliced sequence (or each `key` in
   `keys`):
   1. **`@when`** — `filterItem.call(this, key, value, iterData)`; if it
      returns `false`, the item is skipped. **Not applied** when the
      handler returned `keys` (those are authoritative).
   2. **`@enrich-with`** — `enrichItem.call(this, binds, key, value, iterData)`.
      `binds` is a **mutable object** seeded with `{ key, value }`;
      mutating it (`binds.count = ...`) creates `@`-prefixed bindings
      available in the templated children. The return value is ignored.
   3. **Render** the element with the new bindings on the stack.

Auto-bound names inside the loop are always `@key` and `@value` (or
whatever you wrote into `binds`).

### Handler resolution

`@when` / `@enrich-with` / `@loop-with` resolve like event handler names:
bare `filterItem` → `alter.filterItem` (idiomatic); `$filterItem` →
method on `this` (works, not idiomatic — `alter` keeps iteration helpers
grouped).

## Scope Enrichment

Without an `@each` on the same element, `@enrich-with` becomes a scope
enricher: it takes no `binds` arg, and its **return value** is the
bindings object whose keys become `@`-prefixed bindings for descendants.

```js
alter: { enrichScope() { return { len: this.text.length }; } }
```

```html
<div @enrich-with="enrichScope">Length: <x text="@len"></x></div>
```

## Filter-then-paginate strategies

The recipe form is in
[patterns/filter-and-paginate.md](./patterns/filter-and-paginate.md).
There are three ways to wire it, trading simplicity for scans-per-render
(all return `keys`, so all keep identity):

**1. Naive — two independent scans.** The loop scans + slices the whole
list itself; a separate `@enrich-with` scans again for the pager labels.
Simplest, nothing shared:

```js
naiveTablePage(seq, { filter }) {            // builds the WHOLE matching list…
  const all = [];
  for (let i = 0; i < seq.size; i++) if (filter(i, seq.get(i))) all.push(i);
  const start = clamp(this.page, all.length, this.pageSize).currentPage * this.pageSize;
  return { keys: all.slice(start, start + this.pageSize) };   // …just to slice it
},
```

**2. Shared — one count + one partial collect** (the recipe's default).
A scope `@enrich-with` on an ancestor does **one** counting scan and
publishes the clamped page + pager labels (which the page controls,
sitting outside the loop, read as `@`-bindings); the `@loop-with` handler
reads the clamped page via `ctx.lookup`, reuses the predicate via
`ctx.filter`, and collects only the current page's keys — early-exiting
once the page is full.

**3. Coupled — one scan.** The enrich does *everything*, including the
page keys, and stashes them in a binding only the loop reads. Fastest,
but the two handlers are welded together — name them so it shows:

```js
enrichBuildsKeysForTheLoopBelow() {          // the only scan: count + labels + keys
  const all = []; /* …collect matching indices… */
  const { pageCount, currentPage } = clamp(this.page, all.length, this.pageSize);
  const start = currentPage * this.pageSize;
  return { __keys__: all.slice(start, start + this.pageSize), /* …labels… */ };
},
loopJustForwardsTheEnrichsKeys(_seq, { lookup }) {  // useless without the enrich
  return { keys: lookup("__keys__") };
},
```

Test any strategy with `collectIterBindings(Comp, instance, seq, opts)`,
which drives a loop exactly like the renderer — map `when` → `@when`,
`loopWith` → `@loop-with`, `scopeEnrich` → the ancestor scope
`@enrich-with` the loop reads via `ctx.lookup`. Mechanics and the
dev-build caveat in [testing.md](./testing.md).

## See also

- [patterns/iterate-a-list.md](./patterns/iterate-a-list.md),
  [patterns/filter-a-list.md](./patterns/filter-a-list.md),
  [patterns/paginate-a-list.md](./patterns/paginate-a-list.md),
  [patterns/enrich-each-item.md](./patterns/enrich-each-item.md) — minimal
  recipes for each half.
- [core.md](./core.md) — the component primer, notation, and the
  frame/scope stack model these directives build on.
- [advanced.md](./advanced.md) — custom seq types (`SEQ_INFO`).
