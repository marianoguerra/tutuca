# Filter and paginate a list

**Problem:** show one page of the items that match a query — filtering
*before* paging, so page counts reflect the filtered total and a row's
identity survives editing or deleting across pages — without scanning the
list more than necessary.

```html
<section @enrich-with="pageInfo">          <!-- COUNT pass: runs once -->
  <input :value=".query" @on.input="search value" />
  <li @each=".items" @when="onlyMatches" @loop-with="page">  <!-- COLLECT pass -->
    <span @text="@key"></span> <x render-it></x>
    <button @on.click="$removeInItemsAt @key">✕</button>
  </li>
  <button :disabled="@isFirst" @on.click="prev">‹</button>
  <button @text="@pageLabel"></button>
  <button :disabled="@isLast" @on.click="next">›</button>
</section>
```

```js
methods: { matchCount() { /* one scan: how many match this.query */ } },
alter: {
  onlyMatches(_key, p) { return matches(p, this.query); },   // the predicate
  pageInfo() {                                  // scope enrich: the COUNT scan
    const total = this.matchCount();
    const { pageCount, currentPage } = clamp(this.page, total, this.pageSize);
    return { currentPage, isFirst: currentPage <= 0, isLast: currentPage >= pageCount - 1,
             pageLabel: `Page ${currentPage + 1} of ${pageCount} · ${total}` };
  },
  page(seq, { lookup, filter }) {               // @loop-with: the COLLECT scan
    const start = lookup("currentPage") * this.pageSize, end = start + this.pageSize;
    const keys = [];
    let m = 0;
    for (let i = 0; i < seq.size && m < end; i++)   // early-exit: stops at page end
      if (filter(i, seq.get(i))) { if (m >= start) keys.push(i); m++; }
    return { keys };
  },
},
```

Returning **`keys`** (ordered *original* keys) is what makes this work: the
renderer visits exactly those and does **not** re-apply `@when`, and because
`@key` stays the original index, deleting row `@key` on page 2 of a filtered
view hits the right item. The page controls live *outside* the loop, so they
can't read its `iterData`; instead a scope `@enrich-with` does the one counting
scan and publishes the clamped page + labels as `@`-bindings. The `@loop-with`
handler's `ctx` lets it avoid repeating that work: `ctx.lookup` reads the
clamped page the enrich already computed, and `ctx.filter` reuses the declared
`@when` predicate — so the collect pass scans just far enough to fill the page.
Reset `page` to 0 when the query changes.

## Three ways to wire it

The block above is the **shared** strategy. There are three, trading simplicity
for scans-per-render (all return `keys`, so all keep identity):

**1. Naive — two independent scans.** The loop scans + slices the whole list
itself; a separate `@enrich-with` scans again for the labels. Simplest, nothing
shared:

```js
naiveTablePage(seq, { filter }) {            // builds the WHOLE matching list…
  const all = [];
  for (let i = 0; i < seq.size; i++) if (filter(i, seq.get(i))) all.push(i);
  const start = clamp(this.page, all.length, this.pageSize).currentPage * this.pageSize;
  return { keys: all.slice(start, start + this.pageSize) };   // …just to slice it
},
```

**2. Shared — one count + one partial collect** (the block above). The enrich
counts and publishes `@currentPage`; the loop reuses it via `lookup` and stops
once the page is full.

**3. Coupled — one scan.** The enrich does *everything*, including the page keys,
and stashes them in a binding only the loop reads. Fastest, but the two handlers
are welded together — name them so it shows:

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

## Testing each strategy

`collectIterBindings(Comp, instance, seq, opts)` drives a loop exactly like the
renderer and returns the `{ key, value }` binds it would render. Map the
template's directives to `opts` — `when` → `@when`, `loopWith` → `@loop-with`,
`scopeEnrich` → the ancestor scope `@enrich-with` whose result the loop reads via
`ctx.lookup`:

```js
import { collectIterBindings } from "tutuca";
const keys = (Comp, c, opts) => collectIterBindings(Comp, c, c.items, opts).map((b) => b.key);

// each strategy wires the directives differently, yet renders the same page:
keys(Naive,   c, { when: "onlyMatches", loopWith: "naiveTablePage" });
keys(Shared,  c, { when: "onlyMatches", loopWith: "page", scopeEnrich: "pageInfo" });
keys(Coupled, c, { loopWith: "loopJustForwardsTheEnrichsKeys",
                   scopeEnrich: "enrichBuildsKeysForTheLoopBelow" });
```

A `keys` return is honored as-is (no `@when` re-applied), and `scopeEnrich` runs
the named scope handler so a `lookup("currentPage")` / `lookup("__keys__")`
resolves in the test. `collectIterBindings` ships in the **dev build**, so these
run in the playground's Test tab (and via `tutuca test` with the dev build), not
the core CLI. See [filter-a-list.md](filter-a-list.md) and
[paginate-a-list.md](paginate-a-list.md) for each half on its own.
