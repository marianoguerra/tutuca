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

This is one of three wiring strategies (naive two-scan, shared, coupled
one-scan) — the trade-offs and the other two are in
[iteration.md](../iteration.md) *Filter-then-paginate strategies*. Test
whichever wiring with `collectIterBindings` — pass
`{ when, loopWith, scopeEnrich }` and assert on the returned keys; see
[testing.md](../testing.md) *Testing iteration handlers*. See
[filter-a-list.md](filter-a-list.md) and
[paginate-a-list.md](paginate-a-list.md) for each half on its own.
