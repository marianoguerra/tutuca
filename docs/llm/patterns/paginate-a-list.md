# Paginate a list

**Problem:** show one page at a time without iterating or rendering the
off-page items.

```html
<li @each=".items" @loop-with="paginate">
  <span class="badge" @text="@key"></span> <x text="@value"></x>
</li>
```

```js
fields: { items: [], page: 0, pageSize: 5 },
alter: {
  paginate(seq) {           // runs once per render, before iteration
    const start = this.page * this.pageSize;
    return { iterData: { total: seq.size }, start, end: start + this.pageSize };
  },
}
```

`@loop-with` returns `{ iterData?, start?, end? }`, all optional. `start`/`end`
slice with `Array.prototype.slice` semantics (`end` exclusive, negatives count
from the end). Slicing is positional but **preserves each item's original
key** — `@key` is the index in the full list, so events and two-way binding
keep their identity across pages. `iterData` is the shared per-loop value
handed to `@when` / `@enrich-with`.

**Reference:** [core.md#loop-with-return-shape--iterdata--slicing](../core.md#list-iteration) ·
**Runnable:** [examples/pagination.js](../../examples/pagination.js),
[examples/list-filter-enrich-with.js](../../examples/list-filter-enrich-with.js)
