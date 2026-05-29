import { component, html } from "tutuca";
import { ITEMS } from "./_shared-data.js";

// `@loop-with` returns `{ iterData?, start?, end? }`. The `start`/`end` keys
// slice the iteration so `@each` skips the off-page prefix and suffix instead
// of walking and discarding them. Slicing keeps each item's original key, so
// `@key` below is the item's index in the full list, not the page.
const Pagination = component({
  name: "Pagination",
  fields: { items: [], page: 0, pageSize: 5 },
  methods: {
    pageCount() {
      return Math.max(1, Math.ceil(this.items.size / this.pageSize));
    },
    pageLabel() {
      return `Page ${this.page + 1} of ${this.pageCount()}`;
    },
    isFirstPage() {
      return this.page <= 0;
    },
    isLastPage() {
      return this.page >= this.pageCount() - 1;
    },
  },
  input: {
    prev() {
      return this.setPage(Math.max(0, this.page - 1));
    },
    next() {
      return this.setPage(Math.min(this.pageCount() - 1, this.page + 1));
    },
  },
  alter: {
    // runs once per render: turn the current page into a slice range
    paginate(seq) {
      const start = this.page * this.pageSize;
      return { iterData: { total: seq.size }, start, end: start + this.pageSize };
    },
  },
  view: html`<section class="flex flex-col gap-3">
    <div class="join">
      <button class="btn join-item" @on.click="prev" :disabled="$isFirstPage">
        ‹ Prev
      </button>
      <button class="btn join-item btn-disabled" @text="$pageLabel"></button>
      <button class="btn join-item" @on.click="next" :disabled="$isLastPage">
        Next ›
      </button>
    </div>
    <ul class="flex flex-col gap-1">
      <li @each=".items" @loop-with="paginate" class="flex gap-2 items-center">
        <span class="badge badge-neutral" @text="@key"></span>
        <x text="@value"></x>
      </li>
    </ul>
  </section>`,
});

export function getComponents() {
  return [Pagination];
}

export function getRoot() {
  return Pagination.make({ items: ITEMS });
}

export function getExamples() {
  return {
    title: "Pagination",
    description: "@loop-with slices the sequence so off-page items are never iterated",
    items: [
      {
        title: "First page",
        description: "Five items per page, starting at the top",
        value: Pagination.make({ items: ITEMS }),
      },
      {
        title: "Second page",
        description: "Keys stay original — badges show indices 5..9",
        value: Pagination.make({ items: ITEMS, page: 1 }),
      },
    ],
  };
}

export function getTests({ describe, test, expect }) {
  describe(Pagination, () => {
    test("paginate returns the slice range for the current page", () => {
      const c = Pagination.make({ items: ITEMS, page: 2, pageSize: 5 });
      const r = Pagination.alter.paginate.call(c, c.items);
      expect(r.start).toBe(10);
      expect(r.end).toBe(15);
      expect(r.iterData.total).toBe(ITEMS.length);
    });

    test("next() advances the page but stops at the last one", () => {
      const c = Pagination.make({ items: ITEMS, pageSize: 5 });
      expect(Pagination.input.next.call(c).page).toBe(1);
      const last = Pagination.make({ items: ITEMS, page: 99, pageSize: 5 });
      expect(Pagination.input.next.call(last).page).toBe(last.pageCount() - 1);
    });

    test("prev() never goes below the first page", () => {
      const c = Pagination.make({ items: ITEMS, page: 0 });
      expect(Pagination.input.prev.call(c).page).toBe(0);
    });
  });
}
