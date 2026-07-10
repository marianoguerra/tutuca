import { collectIterBindings, component, html } from "tutuca";

// Three takes on the SAME feature — filter a list, then show one page of the
// matches — trading simplicity for how many times the list is scanned per
// render. All three return `keys` (original indices) so `@key` keeps each row's
// identity; they differ only in WHO does the scanning.
//
//   1. NaivePeople   — two independent full scans (table + pager).
//   2. SharedPeople  — one count scan + one partial (early-exit) collect scan.
//   3. CoupledPeople — one scan total: the enrich does everything (even the
//                      loop's keys); the loop-with just forwards them. Fast, but
//                      the two handlers are welded together.

// The single match predicate, shared everywhere.
const matches = (person, query) => {
  const q = query.trim().toLowerCase();
  return q === "" || `${person.name} ${person.email}`.toLowerCase().includes(q);
};

// Clamp a (possibly stale) page against the match count. Cheap arithmetic —
// the expensive part is counting the matches.
const clamp = (page, total, pageSize) => {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  return { pageCount, currentPage: Math.min(Math.max(0, page), pageCount - 1) };
};

const pagerLabel = (currentPage, pageCount, total) =>
  `Page ${currentPage + 1} of ${pageCount} · ${total} match${total === 1 ? "" : "es"}`;

// Each row is its own component, so editing a field is self-contained two-way
// binding — no parent paths involved.
const Person = component({
  name: "Person",
  fields: { name: "", email: "", active: false },
  view: html`<div class="flex gap-2 items-center grow">
    <input class="input input-sm grow" :value=".name" @on.input="$setName value" placeholder="name" />
    <input class="input input-sm grow" :value=".email" @on.input="$setEmail value" placeholder="email" />
    <label class="label cursor-pointer gap-1">
      <input type="checkbox" class="checkbox checkbox-sm" :checked=".active" @on.input="$setActive value" />
      active
    </label>
  </div>`,
});

// Shared state, controls, and the count scan — identical across the three
// strategies, spread into each component below.
const baseFields = { items: [], query: "", page: 0, pageSize: 5 };
const baseMethods = {
  // The one full scan: how many rows match the current query.
  matchCount() {
    const items = this.items;
    let n = 0;
    for (let i = 0; i < items.size; i++) if (matches(items.get(i), this.query)) n++;
    return n;
  },
};
const baseInput = {
  // Reset the page on every query change so a shrinking result set never leaves
  // you stranded on an empty page.
  search(query) {
    return this.setQuery(query).setPage(0);
  },
  prev() {
    const { currentPage } = clamp(this.page, this.matchCount(), this.pageSize);
    return this.setPage(Math.max(0, currentPage - 1));
  },
  next() {
    const { pageCount, currentPage } = clamp(this.page, this.matchCount(), this.pageSize);
    return this.setPage(Math.min(pageCount - 1, currentPage + 1));
  },
};
// @when predicate; also handed to a loop-with handler as `ctx.filter`.
function onlyMatches(_key, person) {
  return matches(person, this.query);
}

// The row + pager markup is the same in every strategy; only the directives on
// the <li> and the @enrich-with on the <section> change.
const ROW = html`<span class="badge badge-neutral" @text="@key"></span>
  <x render-it></x>
  <button class="btn btn-sm btn-error btn-outline" @on.click="$removeInItemsAt @key">✕</button>`;

// ─── 1. NAIVE: two independent full scans ────────────────────────────────────
// The table scans the whole list to build + slice its page; the pager scans the
// whole list again for the count. Each scan is fine on its own — but the list is
// walked twice per render and nothing is shared.
const NaivePeople = component({
  name: "NaivePeople",
  fields: { ...baseFields },
  methods: { ...baseMethods },
  input: { ...baseInput },
  alter: {
    onlyMatches,
    // TABLE scan: materialize every matching key, clamp by its length, slice.
    naiveTablePage(seq, { filter }) {
      const all = [];
      for (let i = 0; i < seq.size; i++) if (filter(i, seq.get(i))) all.push(i);
      const { currentPage } = clamp(this.page, all.length, this.pageSize);
      const start = currentPage * this.pageSize;
      return { keys: all.slice(start, start + this.pageSize) };
    },
    // PAGER scan: a second, independent walk of the list for the labels.
    naivePagerInfo() {
      const total = this.matchCount();
      const { pageCount, currentPage } = clamp(this.page, total, this.pageSize);
      return {
        isFirst: currentPage <= 0,
        isLast: currentPage >= pageCount - 1,
        pageLabel: pagerLabel(currentPage, pageCount, total),
      };
    },
  },
  view: html`<section class="flex flex-col gap-3" @enrich-with="naivePagerInfo">
    <input type="search" class="input" :value=".query" @on.input="search value" placeholder="Filter by name or email" />
    <ul class="flex flex-col gap-2">
      <li @each=".items" @when="onlyMatches" @loop-with="naiveTablePage" class="flex gap-2 items-center">
        ${ROW}
      </li>
    </ul>
    <div class="join">
      <button class="btn join-item" @on.click="prev" :disabled="@isFirst">‹ Prev</button>
      <button class="btn join-item btn-disabled" @text="@pageLabel"></button>
      <button class="btn join-item" @on.click="next" :disabled="@isLast">Next ›</button>
    </div>
  </section>`,
});

// ─── 2. SHARED: one count scan + one partial collect ─────────────────────────
// The scope enrich does the one count scan and publishes the clamped page; the
// loop-with reuses it (lookup) and the predicate (filter) to collect just this
// page's keys, early-exiting once the page is full.
const SharedPeople = component({
  name: "SharedPeople",
  fields: { ...baseFields },
  methods: { ...baseMethods },
  input: { ...baseInput },
  alter: {
    onlyMatches,
    pageInfo() {
      const total = this.matchCount();
      const { pageCount, currentPage } = clamp(this.page, total, this.pageSize);
      return {
        currentPage,
        isFirst: currentPage <= 0,
        isLast: currentPage >= pageCount - 1,
        pageLabel: pagerLabel(currentPage, pageCount, total),
      };
    },
    page(seq, { lookup, filter }) {
      const start = lookup("currentPage") * this.pageSize;
      const end = start + this.pageSize;
      const keys = [];
      let m = 0;
      for (let i = 0; i < seq.size && m < end; i++) {
        if (filter(i, seq.get(i))) {
          if (m >= start) keys.push(i);
          m++;
        }
      }
      return { keys };
    },
  },
  view: html`<section class="flex flex-col gap-3" @enrich-with="pageInfo">
    <input type="search" class="input" :value=".query" @on.input="search value" placeholder="Filter by name or email" />
    <ul class="flex flex-col gap-2">
      <li @each=".items" @when="onlyMatches" @loop-with="page" class="flex gap-2 items-center">
        ${ROW}
      </li>
    </ul>
    <div class="join">
      <button class="btn join-item" @on.click="prev" :disabled="@isFirst">‹ Prev</button>
      <button class="btn join-item btn-disabled" @text="@pageLabel"></button>
      <button class="btn join-item" @on.click="next" :disabled="@isLast">Next ›</button>
    </div>
  </section>`,
});

// ─── 3. COUPLED: one scan, the loop-with just forwards the enrich's keys ──────
// The fastest — the list is walked exactly once — but the two handlers are
// welded together and named to make that obvious. The enrich builds the page's
// keys and stashes them under `__keys__` ONLY so the loop-with can hand them
// back. The loop-with does no work of its own and is useless without this exact
// enrich above it; the enrich publishes a binding no template element reads.
const CoupledPeople = component({
  name: "CoupledPeople",
  fields: { ...baseFields },
  methods: { ...baseMethods },
  input: { ...baseInput },
  alter: {
    // One scan: count, clamp, build the page's keys, AND the pager labels.
    enrichAlsoBuildsTheLoopWithsKeysIntoUnderscoreKeys() {
      const all = [];
      for (let i = 0; i < this.items.size; i++) {
        if (matches(this.items.get(i), this.query)) all.push(i);
      }
      const { pageCount, currentPage } = clamp(this.page, all.length, this.pageSize);
      const start = currentPage * this.pageSize;
      return {
        // consumed only by loopWithJustForwardsUnderscoreKeysFromTheEnrich below
        __keys__: all.slice(start, start + this.pageSize),
        isFirst: currentPage <= 0,
        isLast: currentPage >= pageCount - 1,
        pageLabel: pagerLabel(currentPage, pageCount, all.length),
      };
    },
    // Does nothing but echo the keys the enrich above already computed.
    loopWithJustForwardsUnderscoreKeysFromTheEnrich(_seq, { lookup }) {
      return { keys: lookup("__keys__") };
    },
  },
  view: html`<section
    class="flex flex-col gap-3"
    @enrich-with="enrichAlsoBuildsTheLoopWithsKeysIntoUnderscoreKeys"
  >
    <input type="search" class="input" :value=".query" @on.input="search value" placeholder="Filter by name or email" />
    <ul class="flex flex-col gap-2">
      <li
        @each=".items"
        @loop-with="loopWithJustForwardsUnderscoreKeysFromTheEnrich"
        class="flex gap-2 items-center"
      >
        ${ROW}
      </li>
    </ul>
    <div class="join">
      <button class="btn join-item" @on.click="prev" :disabled="@isFirst">‹ Prev</button>
      <button class="btn join-item btn-disabled" @text="@pageLabel"></button>
      <button class="btn join-item" @on.click="next" :disabled="@isLast">Next ›</button>
    </div>
  </section>`,
});

// Renders all three strategies stacked, so you can compare them side by side.
const Strategies = component({
  name: "Strategies",
  fields: { naive: null, shared: null, coupled: null },
  view: html`<div class="flex flex-col gap-6">
    <div class="flex flex-col gap-1">
      <h3 class="font-bold">1. Naive — two independent scans</h3>
      <x render=".naive"></x>
    </div>
    <div class="flex flex-col gap-1">
      <h3 class="font-bold">2. Shared — one count + one partial collect</h3>
      <x render=".shared"></x>
    </div>
    <div class="flex flex-col gap-1">
      <h3 class="font-bold">3. Coupled — one scan; loop-with forwards the enrich's keys</h3>
      <x render=".coupled"></x>
    </div>
  </div>`,
});

const PEOPLE = [
  { name: "Ada Lovelace", email: "ada@analytical.engine" },
  { name: "Alan Turing", email: "alan@bletchley.uk" },
  { name: "Grace Hopper", email: "grace@navy.mil" },
  { name: "Edsger Dijkstra", email: "edsger@shortest.path" },
  { name: "Barbara Liskov", email: "barbara@substitution.org" },
  { name: "Donald Knuth", email: "don@tex.org" },
  { name: "Margaret Hamilton", email: "margaret@apollo.nasa" },
  { name: "John von Neumann", email: "john@architecture.edu" },
  { name: "Katherine Johnson", email: "katherine@orbit.nasa" },
  { name: "Tim Berners-Lee", email: "tim@web.org" },
  { name: "Linus Torvalds", email: "linus@kernel.org" },
  { name: "Radia Perlman", email: "radia@spanning.tree" },
  { name: "Ken Thompson", email: "ken@bell.labs" },
  { name: "Dennis Ritchie", email: "dennis@bell.labs" },
];

const makeItems = () => PEOPLE.map((p) => Person.make(p));
const makeOne = (Comp, extra = {}) => Comp.make({ items: makeItems(), ...extra });
const makeStrategies = (extra = {}) =>
  Strategies.make({
    naive: makeOne(NaivePeople, extra),
    shared: makeOne(SharedPeople, extra),
    coupled: makeOne(CoupledPeople, extra),
  });

export function getComponents() {
  return [Strategies, NaivePeople, SharedPeople, CoupledPeople, Person];
}

export function getRoot() {
  return makeStrategies();
}

export function getExamples() {
  return {
    title: "Filter + Paginate — three strategies",
    description: "Same feature, scanned 2× / 1.x× / 1× per render — all keep key identity",
    items: [
      {
        title: "All three",
        description: "Naive (two scans), Shared (count + partial collect), Coupled (one scan)",
        value: makeStrategies(),
      },
      {
        title: "Filtered to page 2",
        description: "Query 'a', page 2 — every strategy shows the same original indices",
        value: makeStrategies({ query: "a", page: 1 }),
      },
    ],
  };
}

export function getTests({ describe, test, expect }) {
  // The original indices of the page each strategy should render.
  const expectedPageKeys = (c) => {
    const all = [];
    for (let i = 0; i < c.items.size; i++) if (matches(c.items.get(i), c.query)) all.push(i);
    const { currentPage } = clamp(c.page, all.length, c.pageSize);
    const start = currentPage * c.pageSize;
    return all.slice(start, start + c.pageSize);
  };
  // The original keys collectIterBindings reports the loop would render.
  const pageKeys = (Comp, c, opts) => collectIterBindings(Comp, c, c.items, opts).map((b) => b.key);

  describe(SharedPeople, () => {
    test("matchCount counts the rows matching the query", () => {
      const c = makeOne(SharedPeople, { query: "bell.labs" });
      expect(c.matchCount()).toBe(2); // Ken Thompson + Dennis Ritchie
    });

    test("search resets to the first page", () => {
      const c = makeOne(SharedPeople, { page: 4 });
      expect(SharedPeople.input.search.call(c, "grace").page).toBe(0);
    });

    test("removing by original key drops the right person even when filtered", () => {
      const c = makeOne(SharedPeople, { query: "bell.labs" });
      const after = c.removeInItemsAt(12); // Ken Thompson, original index 12
      expect(after.items.size).toBe(PEOPLE.length - 1);
      expect(after.items.get(12).name).toBe("Dennis Ritchie");
    });
  });

  // `collectIterBindings(Comp, instance, seq, opts)` drives a loop exactly like
  // the renderer and returns the `{ key, value }` binds it would render. Map the
  // template's directives to `opts`:
  //   • `when`       → the `@when` handler name
  //   • `loopWith`   → the `@loop-with` handler name
  //   • `scopeEnrich`→ the ancestor scope `@enrich-with` whose result the
  //                    loop-with reads via `ctx.lookup`
  // Each strategy wires these differently, yet all render the same page.
  // (`collectIterBindings` lives in the dev build; `tutuca test`, `tutuca
  // storybook` and the playground's Test tab all resolve "tutuca" to it.)
  describe(NaivePeople, () => {
    test("naive: @when + @loop-with (the loop does its own scan)", () => {
      const c = makeOne(NaivePeople, { query: "a", page: 1, pageSize: 5 });
      const opts = { when: "onlyMatches", loopWith: "naiveTablePage" };
      expect(pageKeys(NaivePeople, c, opts)).toEqual(expectedPageKeys(c));
    });
  });

  describe(SharedPeople, () => {
    test("shared: @loop-with reads the enrich's @currentPage via scopeEnrich", () => {
      const c = makeOne(SharedPeople, { query: "a", page: 1, pageSize: 5 });
      const opts = { when: "onlyMatches", loopWith: "page", scopeEnrich: "pageInfo" };
      expect(pageKeys(SharedPeople, c, opts)).toEqual(expectedPageKeys(c));
    });
  });

  describe(CoupledPeople, () => {
    test("coupled: @loop-with forwards the enrich's __keys__ via scopeEnrich", () => {
      const c = makeOne(CoupledPeople, { query: "a", page: 1, pageSize: 5 });
      const opts = {
        loopWith: "loopWithJustForwardsUnderscoreKeysFromTheEnrich",
        scopeEnrich: "enrichAlsoBuildsTheLoopWithsKeysIntoUnderscoreKeys",
      };
      expect(pageKeys(CoupledPeople, c, opts)).toEqual(expectedPageKeys(c));
    });
  });
}
