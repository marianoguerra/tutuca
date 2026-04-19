import { component, html, ISet, List } from "tutuca";

export const Root = component({
  name: "Root",
  fields: {
    allEntries: [],
    allCategories: [],
    allRoles: [],
    selectedCategories: ISet(),
    selectedRoles: ISet(),
    featuredFirst: true,
    sortByEnd: false,
    sortAsc: false,
  },
  methods: {
    clearFilters() {
      return this.setSelectedCategories(ISet(this.allCategories)).setSelectedRoles(
        ISet(this.allRoles),
      );
    },
    sortedEntries() {
      const byEnd = this.sortByEnd;
      const asc = this.sortAsc;
      const feat = this.featuredFirst;
      return this.allEntries.sort((a, b) => {
        if (feat) {
          if (a.featured && !b.featured) return -1;
          if (!a.featured && b.featured) return 1;
        }
        const aYear = (byEnd ? (a.endYear ?? a.startYear) : a.startYear) || 0;
        const bYear = (byEnd ? (b.endYear ?? b.startYear) : b.startYear) || 0;
        return asc ? aYear - bYear : bYear - aYear;
      });
    },
    hasActiveFilters() {
      return (
        this.selectedCategories.size !== this.allCategories.size ||
        this.selectedRoles.size !== this.allRoles.size
      );
    },
  },
  input: {
    onCategoryToggle(key, isAlt) {
      const cat = this.allCategories.get(key);
      if (isAlt) {
        if (this.hasInSelectedCategories(cat)) {
          // Inverse solo: select all except this one
          return this.setSelectedCategories(ISet(this.allCategories).delete(cat));
        } else {
          // Solo: select only this one
          return this.setSelectedCategories(ISet([cat]));
        }
      }
      return this.toggleInSelectedCategories(cat);
    },
    onRoleToggle(key, isAlt) {
      const role = this.allRoles.get(key);
      if (isAlt) {
        if (this.hasInSelectedRoles(role)) {
          // Inverse solo: select all except this one
          return this.setSelectedRoles(ISet(this.allRoles).delete(role));
        } else {
          // Solo: select only this one
          return this.setSelectedRoles(ISet([role]));
        }
      }
      return this.toggleInSelectedRoles(role);
    },
  },
  alter: {
    filterEntry(_key, entry) {
      if (this.selectedRoles.size > 0) {
        if (!this.selectedRoles.has(entry.role)) return false;
      }
      if (this.selectedCategories.size > 0 && entry.categories.size > 0) {
        const hasMatch = this.selectedCategories.some((c) => entry.categories.includes(c));
        if (!hasMatch) return false;
      }
      return true;
    },
    enrichCategoryBindings(binds, _key, cat) {
      binds.isSelected = this.hasInSelectedCategories(cat);
      const colorClass = getCategoryColor(cat, binds.isSelected);
      binds.btnClass = `btn btn-xs border-0 ${colorClass}`;
    },
    enrichRoleBindings(binds, _key, role) {
      const isSelected = this.hasInSelectedRoles(role);
      binds.btnClass = isSelected
        ? "btn btn-xs btn-neutral font-bold ring-1 ring-neutral-content/30"
        : "btn btn-xs btn-ghost font-bold opacity-40";
    },
  },
  response: {
    loadData(res, err) {
      console.assert(err === null);
      const entries = res.map((data) => Entry.Class.fromData(data));
      const allCats = new Set();
      const allRoles = new Set();
      for (const entry of entries) {
        for (const cat of entry.categories) {
          allCats.add(cat);
        }
        if (entry.role) {
          allRoles.add(entry.role);
        }
      }
      const allCatList = List([...allCats].sort());
      const allRolesList = List([...allRoles].sort());
      return this.setAllEntries(entries)
        .setAllCategories(allCatList)
        .setSelectedCategories(ISet(allCatList))
        .setAllRoles(allRolesList)
        .setSelectedRoles(ISet(allRolesList));
    },
  },
  logic: {
    init(ctx) {
      ctx.request("loadData");
      return this;
    },
  },
  view: html`<section class="flex flex-col gap-4">
    <div class="card bg-base-200 p-4">
      <p class="text-sm mb-4">
        💡 Click tags to toggle. Solo / unsolo toggle with
        <kbd class="text-mono">alt/option + click</kbd>.
      </p>
      <div
        class="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-y-1 sm:gap-x-3 sm:gap-y-3 items-start"
      >
        <span class="font-semibold text-sm pt-1">Categories</span>
        <div class="flex flex-wrap gap-2">
          <button
            @each=".allCategories"
            @enrich-with="enrichCategoryBindings"
            :class="@btnClass"
            @on.click="onCategoryToggle @key isAlt"
            @text="@value"
          ></button>
        </div>

        <span class="font-semibold text-sm pt-1">Roles</span>
        <div class="flex flex-wrap gap-2">
          <button
            @each=".allRoles"
            @enrich-with="enrichRoleBindings"
            :class="@btnClass"
            @on.click="onRoleToggle @key isAlt"
            @text="@value"
          ></button>
        </div>
        <span class="font-semibold text-sm pt-1">Sort By</span>
        <div class="flex flex-wrap items-center gap-2">
          <label class="swap btn btn-xs btn-outline btn-primary">
            <input
              type="checkbox"
              :checked=".sortByEnd"
              @on.change=".toggleSortByEnd"
            />
            <span class="swap-on">End Year</span>
            <span class="swap-off">Start Year</span>
          </label>

          <label class="swap btn btn-xs btn-outline btn-primary">
            <input
              type="checkbox"
              :checked=".sortAsc"
              @on.change=".toggleSortAsc"
            />
            <span class="swap-on">↑ Oldest first</span>
            <span class="swap-off">↓ Newest first</span>
          </label>

          <label class="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              class="toggle toggle-sm"
              :checked=".featuredFirst"
              @on.change=".toggleFeaturedFirst"
            />
            <span class="text-sm">Featured first</span>
          </label>
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-4 mt-4">
        <button
          class="btn btn-outline btn-sm"
          @on.click=".clearFilters"
          @show=".hasActiveFilters"
        >
          Clear Filters
        </button>
      </div>
    </div>

    <div class="flex flex-col gap-3">
      <div @each=".sortedEntries" @when="filterEntry">
        <x render-it></x>
      </div>
    </div>
  </section>`,
});

export const AltUrl = component({
  name: "AltUrl",
  fields: {
    label: "",
    url: "#",
  },
  view: html`<a
    :href=".url"
    target="_blank"
    class="badge badge-ghost badge-sm cursor-pointer gap-1 no-underline hover:bg-base-200"
    >🔗 <span @text=".label"></span
  ></a>`,
});

export const Entry = component({
  name: "Entry",
  fields: {
    title: "?",
    description: "",
    lang: "en",
    startYear: null,
    endYear: null,
    role: null,
    featured: false,
    url: "#",
    altUrls: [],
    categories: [],
  },
  statics: {
    fromData({
      title,
      description,
      lang,
      startYear,
      endYear,
      role,
      featured,
      url,
      altUrls,
      categories,
      currentlyActive,
    }) {
      return this.make({
        title,
        description,
        lang,
        startYear,
        endYear: currentlyActive ? new Date().getFullYear() : endYear,
        role,
        featured: featured || false,
        url,
        altUrls: (altUrls ?? []).map((l) => AltUrl.make(l)),
        categories: (categories ?? []).sort(),
      });
    },
  },
  methods: {
    langFlag() {
      return this.lang === "es" ? "🇪🇸" : "🇬🇧";
    },
    isSpanish() {
      return this.lang === "es";
    },
    yearDisplay() {
      if (this.startYear === null) return "";
      if (this.endYear !== null) return `${this.startYear}-${this.endYear}`;
      return `${this.startYear}`;
    },
    hasYear() {
      return this.startYear !== null;
    },
  },
  alter: {
    enrichCategoryBadge(binds, _key, cat) {
      binds.badgeClass = `badge badge-sm ${getCategoryColor(cat, true)}`;
    },
  },
  view: html`<div
    class="card bg-base-200 shadow-sm p-2 sm:p-3 flex flex-col gap-2"
  >
    <div class="flex gap-1 sm:gap-2 flex-wrap items-center">
      <span @show=".featured">⭐</span>
      <span @show=".isSpanish" @text=".langFlag"></span>
      <span
        class="badge badge-ghost badge-sm border-0 font-bold"
        @show=".hasYear"
        @text=".yearDisplay"
      ></span>
      <span
        class="badge badge-neutral badge-sm border-0 font-bold"
        @show=".role"
        @text=".role"
      ></span>
    </div>
    <a :href=".url" target="_blank" class="link link-hover">
      <h2 class="font-bold" @text=".title"></h2>
    </a>
    <p class="text-sm opacity-70" @text=".description"></p>
    <div class="flex gap-1 sm:gap-2 flex-wrap">
      <span
        @each=".categories"
        @enrich-with="enrichCategoryBadge"
        :class="@badgeClass"
        @text="@value"
      ></span>
    </div>
    <div @hide=".isAltUrlsEmpty">
      <ul>
        <li @each=".altUrls"><x render-it></x></li>
      </ul>
    </div>
  </div>`,
});

const CATEGORY_COLORS = {
  "Programming Languages": "ring-1 ring-violet-500 text-violet-700 dark:text-violet-300",
  "Distributed Systems": "ring-1 ring-indigo-500 text-indigo-700 dark:text-indigo-300",
  "End User Programming": "ring-1 ring-orange-500 text-orange-700 dark:text-orange-300",
  "Erlang / Elixir": "ring-1 ring-purple-500 text-purple-700 dark:text-purple-300",
  WebAssembly: "ring-1 ring-fuchsia-500 text-fuchsia-700 dark:text-fuchsia-300",
  Web: "ring-1 ring-cyan-500 text-cyan-700 dark:text-cyan-300",
  "Future of Coding": "ring-1 ring-rose-500 text-rose-700 dark:text-rose-300",
  Startup: "ring-1 ring-amber-500 text-amber-700 dark:text-amber-300",
  AI: "ring-1 ring-emerald-500 text-emerald-700 dark:text-emerald-300",
  Python: "ring-1 ring-sky-500 text-sky-700 dark:text-sky-300",
  Education: "ring-1 ring-teal-500 text-teal-700 dark:text-teal-300",
  Rust: "ring-1 ring-red-500 text-red-700 dark:text-red-300",
};

const CATEGORY_COLORS_SELECTED = {
  "Programming Languages": "bg-violet-700 text-white",
  "Distributed Systems": "bg-indigo-700 text-white",
  "End User Programming": "bg-orange-700 text-white",
  "Erlang / Elixir": "bg-purple-700 text-white",
  WebAssembly: "bg-fuchsia-700 text-white",
  Web: "bg-cyan-700 text-white",
  "Future of Coding": "bg-rose-700 text-white",
  Startup: "bg-amber-700 text-white",
  AI: "bg-emerald-700 text-white",
  Python: "bg-sky-700 text-white",
  Education: "bg-teal-700 text-white",
  Rust: "bg-red-700 text-white",
};

function getCategoryColor(cat, isSelected) {
  if (isSelected) {
    return CATEGORY_COLORS_SELECTED[cat] || "bg-primary text-primary-content";
  }
  return CATEGORY_COLORS[cat] || "bg-base-300 text-base-content";
}

export function getComponents() {
  return [Root, Entry, AltUrl];
}

export function getRoot() {
  return Root.make();
}

export function getRequestHandlers() {
  return {
    async loadData() {
      const req = await fetch("https://marianoguerra.github.io/data.json");
      return await req.json();
    },
  };
}

export function getStoryBookSection() {
  return {
    title: "Personal Site",
    description: "Filterable list of entries with categories and roles",
    items: [
      {
        title: "Default (Loading)",
        description: "Initial state, requests data on init",
        item: Root.make(),
      },
      {
        title: "Sample Entry",
        description: "Single entry rendered standalone",
        item: Entry.Class.fromData({
          title: "Sample Project",
          description: "An example entry",
          startYear: 2020,
          endYear: 2024,
          role: "Author",
          featured: true,
          url: "#",
          categories: ["Web", "AI"],
        }),
      },
      {
        title: "Alt URL",
        description: "Auxiliary link badge",
        item: AltUrl.make({ label: "GitHub", url: "#" }),
      },
    ],
  };
}

export function getExtraCSSClasses() {
  const v = new Set(
    "btn btn-xs btn-neutral font-bold ring-1 ring-neutral-content/30 btn-ghost font-bold opacity-40".split(
      /\s+/,
    ),
  );
  for (const classes of Object.values(CATEGORY_COLORS)) {
    for (const c of classes.split(/\s+/)) {
      v.add(c);
    }
  }
  for (const classes of Object.values(CATEGORY_COLORS_SELECTED)) {
    for (const c of classes.split(/\s+/)) {
      v.add(c);
    }
  }
  return v;
}
