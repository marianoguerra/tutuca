import { component, html } from "tutuca";

export const JsonNull = component({
  name: "JsonNull",
  fields: {},
  view: html`<span
    class="font-mono text-sm leading-tight text-warning italic"
    >null</span
  >`,
});

export const JsonBoolean = component({
  name: "JsonBoolean",
  fields: { value: false },
  methods: {
    text() {
      return this.value ? "true" : "false";
    },
    cssClass() {
      const base = "font-mono text-sm leading-tight";
      return `${base} ${this.value ? "text-success" : "text-warning"}`;
    },
  },
  view: html`<span :class="$cssClass" @text="$text"></span>`,
  views: {
    // Decoy: cssClass() builds these at runtime, so they never appear as
    // literals the margaui scanner can find. Never rendered — registering
    // the view is enough for compileClassesToStyleText to emit their CSS.
    _margauiClasses: html`<p class="text-success text-warning"></p>`,
  },
});

export const JsonNumber = component({
  name: "JsonNumber",
  fields: { value: 0 },
  methods: {
    text() {
      return String(this.value);
    },
  },
  view: html`<span
    class="font-mono text-sm leading-tight text-info"
    @text="$text"
  ></span>`,
});

export const JsonString = component({
  name: "JsonString",
  fields: { value: "" },
  methods: {
    text() {
      return JSON.stringify(this.value ?? "");
    },
  },
  view: html`<span
    class="font-mono text-sm leading-tight inline-block max-w-xs truncate align-bottom"
    :title=".value"
    @text="$text"
  ></span>`,
});

export const compositeFields = {
  items: [],
  isExpanded: false,
  itemsPerPage: 10,
  currentPage: 0,
};

export const compositeMethods = {
  arrowText() {
    return this.isExpanded ? "▼" : "▶";
  },
  isItemsEmpty() {
    return this.items.size === 0;
  },
  pageCount() {
    return Math.max(1, Math.ceil(this.items.size / this.itemsPerPage));
  },
  pageStart() {
    return this.currentPage * this.itemsPerPage;
  },
  pageEnd() {
    return Math.min(this.items.size, this.pageStart() + this.itemsPerPage);
  },
  hasPagination() {
    return this.items.size > this.itemsPerPage;
  },
  showPagination() {
    return this.isExpanded && this.hasPagination();
  },
  cannotPrevPage() {
    return this.currentPage <= 0;
  },
  cannotNextPage() {
    return this.currentPage >= this.pageCount() - 1;
  },
  pageIndicatorText() {
    return `${this.currentPage + 1} / ${this.pageCount()}`;
  },
  prevPage() {
    return this.currentPage > 0 ? this.setCurrentPage(this.currentPage - 1) : this;
  },
  nextPage() {
    return this.currentPage < this.pageCount() - 1
      ? this.setCurrentPage(this.currentPage + 1)
      : this;
  },
};

export const compositeAlter = {
  getPageRange() {
    return { start: this.pageStart(), end: this.pageEnd() };
  },
};

export function makeCompositeView({
  typeClass = "",
  borderClass = "border-base-content/10",
  toggleHandler = "$toggleIsExpanded",
} = {}) {
  return html`<span class="font-mono text-sm leading-tight inline-block">
    <span class="inline-flex items-center gap-2">
      <button
        type="button"
        class="cursor-pointer text-base-content/70 hover:text-base-content inline-flex items-center gap-1"
        :disabled="$isItemsEmpty"
        @on.click="${toggleHandler}"
      >
        <span @text="$arrowText"></span>
        <span class="${typeClass}" @text="$typeText"></span>
        <span @text="$countText"></span>
      </button>
      <div @show="$showPagination" class="join">
        <button
          type="button"
          class="join-item btn btn-xs"
          :disabled="$cannotPrevPage"
          @on.click="$prevPage"
        >
          «
        </button>
        <span
          class="join-item badge font-mono text-xs"
          @text="$pageIndicatorText"
        ></span>
        <button
          type="button"
          class="join-item btn btn-xs"
          :disabled="$cannotNextPage"
          @on.click="$nextPage"
        >
          »
        </button>
      </div>
    </span>
    <div
      @show=".isExpanded"
      class="ml-1 flex flex-col gap-0.5 border-l ${borderClass} pl-2 mt-0.5"
    >
      <x render-each=".items" loop-with="getPageRange"></x>
    </div>
  </span>`;
}

export const compositeView = makeCompositeView();

export const JsonArray = component({
  name: "JsonArray",
  fields: compositeFields,
  methods: {
    ...compositeMethods,
    typeText() {
      return "Array";
    },
    countText() {
      return `(${this.items.size})`;
    },
  },
  alter: compositeAlter,
  view: compositeView,
});

export const JsonObject = component({
  name: "JsonObject",
  fields: compositeFields,
  methods: {
    ...compositeMethods,
    typeText() {
      return "Object";
    },
    countText() {
      return `{${this.items.size}}`;
    },
  },
  alter: compositeAlter,
  view: compositeView,
});

export const JsonProperty = component({
  name: "JsonProperty",
  fields: {
    key: "",
    child: null,
  },
  view: html`<div class="flex items-center gap-2 leading-tight">
    <span class="text-base-content/60 font-mono text-sm" @text=".key"></span>
    <span class="text-base-content/30">:</span>
    <x render=".child"></x>
  </div>`,
});

// Delegate an expand/collapse toggle to the wrapped `value` when it supports
// one; leaf values (JsonNull, …) have no toggle so the wrapper stays as-is.
// Shared by every top-level inspector wrapper (JsonViewer, DataInspector,
// ImInspector, InstanceInspector, SchemaViewer).
export const valueWrapperMethods = {
  toggleIsExpanded() {
    return typeof this.value?.toggleIsExpanded === "function"
      ? this.setValue(this.value.toggleIsExpanded())
      : this;
  },
};

const valueWrapperView = html`<span class="contents"><x render=".value"></x></span>`;

// Build a thin top-level inspector wrapper: one `value` field holding the
// classified tree, the delegating toggle above, and a pass-through view.
// `fromData` runs as a static (`this` is the component class) and classifies
// the raw input into `value`.
export function makeValueInspector({ name, fromData }) {
  return component({
    name,
    fields: { value: null },
    methods: valueWrapperMethods,
    statics: { fromData },
    view: valueWrapperView,
  });
}

export const JsonViewer = makeValueInspector({
  name: "JsonViewer",
  fromData(data) {
    return this.make({ value: classifyData(data) });
  },
});

// Shared type dispatch behind classifyJson (strict: only plain objects, null
// result so a `chain` can hand unknown values to the next classifier) and
// classifyData (lenient: any object, always renders something).
function classifyJsonValue(data, recurse, anyObject) {
  if (data === null || data === undefined) return JsonNull.make({});
  const t = typeof data;
  if (t === "boolean") return JsonBoolean.make({ value: data });
  if (t === "number") return JsonNumber.make({ value: data });
  if (t === "string") return JsonString.make({ value: data });
  if (Array.isArray(data)) {
    const items = data.map((v, i) => JsonProperty.make({ key: String(i), child: recurse(v) }));
    return JsonArray.make({ items });
  }
  if (t === "object") {
    const proto = Object.getPrototypeOf(data);
    if (anyObject || proto === Object.prototype || proto === null) {
      const items = Object.entries(data).map(([k, v]) =>
        JsonProperty.make({ key: k, child: recurse(v) }),
      );
      return JsonObject.make({ items });
    }
  }
  return null;
}

export function classifyJson(data, recurse = classifyJson) {
  return classifyJsonValue(data, recurse, false);
}

export function classifyData(data, recurse = classifyData) {
  return classifyJsonValue(data, recurse, true) ?? JsonNull.make({});
}

export function chain(...classifiers) {
  const recurse = (data) => {
    for (const c of classifiers) {
      const result = c(data, recurse);
      if (result != null) return result;
    }
    return null;
  };
  return recurse;
}

export function getComponents() {
  return [
    JsonViewer,
    JsonProperty,
    JsonNull,
    JsonBoolean,
    JsonNumber,
    JsonString,
    JsonArray,
    JsonObject,
  ];
}
