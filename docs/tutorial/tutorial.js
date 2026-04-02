import { component, css, html, IMap } from "tutuca";

const Tutorial = component({
  name: "Tutorial",
  fields: {
    currentStep: 0,
    steps: [],
  },
  methods: {
    wrapStep(v) {
      const lastStep = this.steps.size - 1;
      return v < 0 ? lastStep : v > lastStep ? 0 : v;
    },
    goToStep(i, ctx) {
      ctx.at.index("steps", i).logic("init");
      return this.setCurrentStep(i);
    },
    goNext(isCtrl, ctx) {
      const newStep = this.wrapStep(isCtrl ? this.steps.size - 1 : this.currentStep + 1);
      return this.goToStep(newStep, ctx);
    },
    goPrev(isCtrl, ctx) {
      const newStep = this.wrapStep(isCtrl ? 0 : this.currentStep - 1);
      return this.goToStep(newStep, ctx);
    },
    getCurrentStepLabel() {
      return this.currentStep + 1;
    },
  },
  logic: {
    init() {
      return this;
    },
  },
  view: html`<section>
    <div class="flex gap-3 justify-between items-center">
      <button class="btn btn-soft btn-primary" @on.click=".goPrev isCtrl ctx">
        Prev
      </button>
      <div class="font-mono">
        <span @text=".getCurrentStepLabel"></span> /
        <span @text=".stepsLen"></span>
      </div>
      <button class="btn btn-soft btn-primary" @on.click=".goNext isCtrl ctx">
        Next
      </button>
    </div>
    <div class="p-3 border border-indigo-600 mb-3">
      <x render=".steps[.currentStep]"></x>
    </div>
  </section>`,
});

const TextDirective = component({
  name: "TextDirective",
  fields: { str: "hello", num: 42, bool: true, notSet: null },
  methods: {
    getStrUpper() {
      return this.str.toUpperCase();
    },
  },
  view: html`<section>
    <p>String: <span @text=".str"></span></p>
    <p>Number: <span @text=".num"> &lt;- text directive is prepended</span></p>
    <p>Boolean: <x text=".bool"></x></p>
    <p>notSet: <span @text=".notSet"></span></p>
    <p>Method Call: <span @text=".getStrUpper"></span></p>
  </section>`,
});

const AttributeBinding = component({
  name: "AttributeBinding",
  fields: { str: "hello", num: 42, bool: true, notSet: null },
  methods: {
    setRawNumber(v) {
      const n = parseInt(v, 10);
      return Number.isNaN(n) ? this : this.setNum(n);
    },
  },
  view: html`<section class="flex flex-col gap-3">
    <input
      :value=".str"
      @on.input=".setStr value"
      :title="Content is {.str}"
      class="input"
    />
    <input
      :value=".num"
      type="number"
      @on.input=".setRawNumber value"
      class="input"
    />
    <input
      :value=".bool"
      type="checkbox"
      @on.input=".setBool value"
      class="checkbox"
    />

    <p>String: <span @text=".str"></span></p>
    <p>Number: <span @text=".num"></span></p>
    <p>Boolean: <span @text=".bool"></span></p>
  </section>`,
});

const Counter = component({
  name: "Counter",
  fields: {
    count: 0,
  },
  methods: {
    inc() {
      return this.setCount(this.count + 1);
    },
  },
  input: {
    dec() {
      return this.setCount(this.count - 1);
    },
  },
  view: html`<div class="flex flex-col">
    <button class="btn btn-soft btn-error" @on.click="dec">-</button>
    <div class="stats">
      <div class="stat text-center">
        <div class="stat-title">Count</div>
        <div class="stat-value" @text=".count"></div>
        <div class="stat-desc">Current Count</div>
      </div>
    </div>
    <button class="btn btn-soft btn-success" @on.click=".inc">+</button>
  </div>`,
});

const EventModifiers = component({
  name: "EventModifiers",
  fields: { query: "", lastSentSearch: null },
  input: {
    onInput(value) {
      return this.setQuery(value);
    },
  },
  view: html`<section class="flex flex-col gap-3">
    <input
      type="search"
      class="input"
      :value=".query"
      @on.input="onInput value"
      @on.keydown+send=".setLastSentSearch value"
      @on.keydown+cancel=".resetQuery"
      placeholder="Search Query (Enter to send, Esc to clear)"
    />
    <p @show=".isLastSentSearchSet">
      Search: "<span @text=".lastSentSearch"></span>"
    </p>
  </section>`,
});

const ConditionalAttributes = component({
  name: "ConditionalAttributes",
  fields: { isActive: true },
  view: html`<section>
    <button
      @if.class=".isActive"
      @then="'btn btn-success'"
      @else="'btn btn-ghost'"
      @if.title=".isActive"
      @then.title="'Click to disable'"
      @else.title="'Click to enable'"
      @on.click=".toggleIsActive"
    >
      <span @show=".isActive">Enabled</span>
      <span @hide=".isActive">Disabled</span>
    </button>
  </section>`,
});

const ListIteration = component({
  name: "ListIteration",
  fields: { items: [] },
  view: html`<section>
    <ul>
      <li @each=".items"><span @text="@key"></span>: <x text="@value"></x></li>
    </ul>
  </section>`,
});

const ListAndFilter = component({
  name: "ListAndFilter",
  fields: { items: [], query: "" },
  alter: {
    filterItem(_key, item) {
      return item.toLowerCase().includes(this.query.toLowerCase());
    },
  },
  view: html`<section class="flex flex-col gap-3">
    <input
      type="search"
      :value=".query"
      @on.input=".setQuery value"
      @on.keydown+cancel=".resetQuery"
      class="input"
      placeholder="Filter entries"
    />
    <ul>
      <li @each=".items" @when="filterItem">
        <span @text="@key"></span>: <x text="@value"></x>
      </li>
    </ul>
  </section>`,
});

const ListFilterEnrich = component({
  name: "ListFilterEnrich",
  fields: { items: [], query: "" },
  alter: {
    filterItem(_key, item) {
      return item.toLowerCase().includes(this.query.toLowerCase());
    },
    enrichItem(binds, _key, item) {
      binds.count = item.length;
    },
  },
  view: html`<section class="flex flex-col gap-3">
    <input
      type="search"
      :value=".query"
      @on.input=".setQuery value"
      @on.keydown+cancel=".resetQuery"
      class="input"
      placeholder="Filter entries"
    />
    <ul>
      <li @each=".items" @when="filterItem" @enrich-with="enrichItem">
        <span @text="@key"></span>: <x text="@value"></x> (<x text="@count"></x>
        characters)
      </li>
    </ul>
  </section>`,
});

const ListFilterEnrichWith = component({
  name: "ListFilterEnrichWith",
  fields: { items: [], query: "" },
  alter: {
    filterItem(_key, item, iterData) {
      return item.toLowerCase().includes(iterData.queryLower);
    },
    enrichItem(binds, _key, item, iterData) {
      binds.count = item.length;
      binds.total = iterData.totalChars;
    },
    getIterData(seq) {
      let totalChars = 0;
      for (const item of seq) {
        totalChars += item.length;
      }
      return { totalChars, queryLower: this.query.toLowerCase() };
    },
  },
  view: html`<section class="flex flex-col gap-3">
    <input
      type="search"
      :value=".query"
      @on.input=".setQuery value"
      @on.keydown+cancel=".resetQuery"
      class="input"
      placeholder="Filter entries"
    />
    <ul>
      <li
        @each=".items"
        @when="filterItem"
        @enrich-with="enrichItem"
        @loop-with="getIterData"
      >
        <span @text="@key"></span>: <x text="@value"></x> (<x text="@count"></x>
        / <x text="@total"></x>)
      </li>
    </ul>
  </section>`,
});

const RenderWithScope = component({
  name: "RenderWithScope",
  fields: { text: "Hello" },
  alter: {
    enrichScope() {
      return { len: this.text.length, upper: this.text.toUpperCase() };
    },
  },
  view: html`<section class="flex flex-col gap-3">
    <input :value=".text" @on.input=".setText value" class="input" />
    <div @enrich-with="enrichScope">
      <p>Text: <span @text=".text"></span></p>
      <p>Len: <span @text="@len"></span></p>
      <p>Upper: <span @text="@upper"></span></p>
    </div>
  </section>`,
});

const ComputedProperties = component({
  name: "ComputedProperties",
  fields: { items: [], query: "" },
  alter: {
    filterItem(_key, item, iterData) {
      return item.toLowerCase().includes(iterData.queryLower);
    },
    enrichItem(binds, _key, item, iterData) {
      binds.count = item.length;
      binds.total = iterData.totalChars;
    },
    getIterData(_seq) {
      return { queryLower: this.query.toLowerCase() };
    },
  },
  computed: {
    totalItemsChars() {
      console.log("computing totalItemsChars");
      let totalChars = 0;
      for (const item of this.items) {
        totalChars += item.length;
      }
      return totalChars;
    },
  },
  view: html`<section class="flex flex-col gap-3">
    <input
      type="search"
      :value=".query"
      @on.input=".setQuery value"
      @on.keydown+cancel=".resetQuery"
      class="input"
      placeholder="Filter entries"
    />
    <ul>
      <li
        @each=".items"
        @when="filterItem"
        @enrich-with="enrichItem"
        @loop-with="getIterData"
      >
        <span @text="@key"></span>: <x text="@value"></x> (<x text="@count"></x>
        / <x text="$totalItemsChars"></x>)
      </li>
    </ul>
  </section>`,
});

const DangerSetInnerHtml = component({
  name: "DangerSetInnerHtml",
  fields: { content: "<strong><em>Raw HTML!</em></strong>" },
  view: html`<section>
    <div @dangerouslysetinnerhtml=".content"></div>
  </section>`,
});

const Entry = component({
  name: "Entry",
  fields: { title: "Entry Title", description: "Entry Description" },
  methods: {
    containsText(s) {
      return this.title.includes(s) || this.description.includes(s);
    },
  },
  view: html`<div class="card bg-base-100 shadow-sm">
    <div class="card-body">
      <h2 class="card-title" @text=".title"></h2>
      <p @text=".description"></p>
    </div>
  </div>`,
  views: {
    edit: html`<div class="card bg-base-100 shadow-sm gap-3">
      <div class="card-body">
        <input class="input" :value=".title" @on.input=".setTitle value" />
        <input
          class="input"
          :value=".description"
          @on.input=".setDescription value"
        />
      </div>
    </div> `,
  },
});

const MultipleViews = component({
  name: "MultipleViews",
  fields: { item: Entry.make() },
  view: html`<section class="flex flex-col gap-3">
    <x render=".item"></x>
    <x render=".item" as="edit"></x>
  </section>`,
});

const PushView = component({
  name: "PushView",
  fields: { items: [], query: "", view: "main" },
  methods: {
    toggleView() {
      return this.setView(this.view === "main" ? "edit" : "main");
    },
    getToggleLabel() {
      return this.view === "main" ? "Set Edit Mode" : "Set Read Only";
    },
  },
  alter: {
    filterItem(_key, item) {
      return item.containsText(this.query);
    },
  },
  view: html`<section class="flex flex-col gap-3">
    <div class="flex justify-between">
      <input
        type="search"
        :value=".query"
        @on.input=".setQuery value"
        @on.keydown+cancel=".resetQuery"
        class="input"
        placeholder="Filter entries"
      />
      <button
        class="btn bnt-sm btn-primary"
        @text=".getToggleLabel"
        @on.click=".toggleView"
      ></button>
    </div>
    <div
      class="flex flex-col gap-3 max-h-[40vh] overflow-y-auto pr-3"
      @push-view=".view"
    >
      <x render-each=".items" when="filterItem"></x>
    </div>
    <div class="alert alert-info justify-center">
      Search to filter, toggle edit mode, edit content, filter some more, edit
      again, toggle read only mode, filter some more.
    </div>
  </section>`,
});

const RequestExample = component({
  name: "RequestExample",
  fields: { items: [], query: "", view: "main", isLoading: false },
  methods: {
    toggleView() {
      return this.setView(this.view === "main" ? "edit" : "main");
    },
    loadAnotherWay(ctx) {
      ctx.request("loadData", [], {
        onOkName: "loadDataOk",
        onErrorName: "loadDataError",
      });
      return this.setIsLoading(true);
    },
    updateFromResponse(res) {
      const items = res.map(({ title, description }) => Entry.make({ title, description }));
      return this.setIsLoading(false).setItems(items);
    },
  },
  logic: {
    init(ctx) {
      ctx.request("loadData", []);
      return this.setIsLoading(true);
    },
  },
  response: {
    loadData(res, err) {
      console.log({ res, err });
      return this.updateFromResponse(res);
    },
    loadDataOk(res) {
      return this.updateFromResponse(res);
    },
    loadDataErr(err) {
      console.error(err);
      return this.setIsLoading(false);
    },
  },
  alter: {
    filterItem(_key, item) {
      return item.containsText(this.query);
    },
  },
  view: html`<section class="flex flex-col gap-3">
    <div @show=".isLoading" class="alert alert-info alert-outline">Loading</div>
    <div class="flex justify-between" @hide=".isLoading">
      <input
        type="search"
        :value=".query"
        @on.input=".setQuery value"
        @on.keydown+cancel=".resetQuery"
        class="input"
        placeholder="Filter entries"
      />
      <button
        class="btn bnt-sm btn-primary btn-outline"
        @on.click=".loadAnotherWay ctx"
      >
        Load Another Way
      </button>
      <button
        class="btn bnt-sm btn-primary"
        @text=".view"
        @on.click=".toggleView"
      ></button>
    </div>
    <div
      class="flex flex-col gap-3 max-h-[40vh] overflow-y-auto pr-3"
      @hide=".isLoading"
      @push-view=".view"
    >
      <x render-each=".items" when="filterItem"></x>
    </div>
  </section>`,
});

function moveKeyIndexToIndex(list, source, target, offset = 0) {
  if (source === -1 || target === -1 || source === target) {
    return list;
  }
  const newPos = target + offset;
  const oldPos = newPos < source ? source + 1 : source;
  return list.insert(newPos, list.get(source)).delete(oldPos);
}

function dropWasAbove(e) {
  const rect = e.target.getBoundingClientRect();
  const midY = rect.top + rect.height / 2;
  return e.clientY < midY;
}

const DnDExample = component({
  name: "DnDExample",
  fields: { items: [], query: "" },
  alter: {
    filterItem(_key, item) {
      return item.includes(this.query);
    },
  },
  input: {
    onDropOnItem(targetIndex, dragInfo, e) {
      console.log(dragInfo, e);
      const offset = dropWasAbove(e) ? 0 : 1;
      const sourceIndex = dragInfo.lookupBind("key");
      const newItems = moveKeyIndexToIndex(this.items, sourceIndex, targetIndex, offset);
      return this.setItems(newItems);
    },
  },
  style: css`
    [data-dragging="1"] {
      opacity: 0.5;
    }
    [data-draggingover="my-list-item"] {
      border-top: 2rem solid transparent;
      border-bottom: 2rem solid transparent;
      outline: 1px solid #77777777;
      transition: 0.15s border-top ease;
    }
  `,
  view: html`<section class="flex flex-col gap-3">
    <input
      type="search"
      :value=".query"
      @on.input=".setQuery value"
      @on.keydown+cancel=".resetQuery"
      class="input"
      placeholder="Filter entries"
    />
    <div>
      <div
        class="cursor-grab"
        @each=".items"
        @when="filterItem"
        draggable="true"
        data-dragtype="my-list-item"
        data-droptarget="my-list-item"
        @on.drop="onDropOnItem @key dragInfo event"
      >
        <span @text="@key"></span>: <x text="@value"></x>
      </div>
    </div>
  </section>`,
});

const StylesExample = component({
  name: "StylesExample",
  fields: {},
  style: css`
    .mine {
      color: red;
    }
  `,
  commonStyle: css`
    .common {
      color: yellow;
    }
  `,
  globalStyle: css`
    .styles-example-global-class {
      color: green;
    }
  `,
  view: html`<section>
    <p>View: main</p>
    <p class="mine">My Style</p>
    <p class="common">Common Style</p>
    <p class="styles-example-global-class">Global Style</p>
  </section>`,
  views: {
    one: html`<section>
      <p>View: one</p>
      <p class="mine">My Style</p>
      <p class="common">Common Style</p>
      <p class="styles-example-global-class">Global Style</p>
    </section>`,
    two: {
      view: html`<section>
        <p>View: two</p>
        <p class="mine">My Style</p>
        <p class="common">Common Style</p>
        <p class="styles-example-global-class">Global Style</p>
      </section>`,
      style: css`
        .mine {
          color: orange;
          text-decoration: underline;
        }
      `,
    },
  },
});

const StylesExampleRoot = component({
  name: "StylesExampleRoot",
  fields: { value: StylesExample.make() },
  view: html`<section class="flex flex-col gap-3">
    <x render=".value"></x>
    <x render=".value" as="one"></x>
    <x render=".value" as="two"></x>
  </section>`,
});

const SeqItemAccess = component({
  name: "SeqItemAccess",
  fields: { byKey: {}, byIndex: [], currentKey: null, currentIndex: 0 },
  methods: {
    getMaxIndex() {
      return Math.max(0, this.byIndex.size - 1);
    },
    setRawCurrentIndex() {},
  },
  alter: {
    enrichByKey(binds, _key, item) {
      binds.label = item.title;
    },
  },
  view: html`<section class="flex flex-col gap-3">
    <input
      type="range"
      min="0"
      :max=".getMaxIndex"
      :value=".currentIndex"
      @on.input=".setCurrentIndex valueAsInt"
    />
    <x render=".byIndex[.currentIndex]"></x>
    <select
      class="select"
      :value=".currentKey"
      @on.input=".setCurrentKey value"
    >
      <option
        @each=".byKey"
        @enrich-with="enrichByKey"
        :value="@key"
        @text="@label"
      ></option>
    </select>
    <x render=".byKey[.currentKey]"></x>
  </section>`,
});

const TreeRoot = component({
  name: "TreeRoot",
  fields: { items: [], log: [] },
  statics: {
    fromData(items) {
      return TreeRoot.make({
        items: items.map((v) => TreeItem.Class.fromData(v)),
      });
    },
  },
  bubble: {
    treeItemSelected(selectedItem, ctx) {
      console.log("..", ctx);
      const msg = `Selected ${selectedItem.type}: ${selectedItem.label}`;
      return this.insertInLogAt(0, msg);
    },
  },
  view: html`<secction class="flex gap-2">
    <div class="flex flex-col gap-2 flex-1">
      <x render-each=".items"></x>
    </div>
    <div class="flex flex-col gap-2 max-h-[40vh] overflow-y-auto flex-1">
      <p @each=".log" @text="@value"></p>
    </div>
  </secction>`,
});

const TreeItem = component({
  name: "TreeItem",
  fields: { type: "dir", label: "A Tree Item", isOpen: true, items: [] },
  methods: {
    areChildsVisible() {
      return this.isOpen && this.items.size > 0;
    },
  },
  statics: {
    fromData({ type = "dir", label = "A Tree Item", isOpen = true, items = [] }) {
      return TreeItem.make({
        type,
        label,
        isOpen,
        items: items.map((v) => TreeItem.Class.fromData(v)),
      });
    },
  },
  input: {
    onItemClick(ctx) {
      ctx.bubble("treeItemSelected", [this]);
      return this.toggleIsOpen();
    },
  },
  bubble: {
    treeItemSelected(_selectedItem) {
      return this;
    },
  },
  style: css`
    user-select: none;
    .head {
      cursor: pointer;
    }
    .head:before {
      content: "⏺️";
      margin-right: 0.25rem;
    }
    .head[data-type="file"]:before {
      content: "📄️";
    }
    .head.open[data-type="dir"]:before {
      content: "📂️";
    }
    .head.closed[data-type="dir"]:before {
      content: "📁️";
    }
  `,
  view: html`<secction>
    <p
      @if.class=".isOpen"
      @then="'head open'"
      @else="'head closed'"
      @text=".label"
      :data-type=".type"
      @on.click="onItemClick ctx"
    ></p>
    <div class="pl-3 pt-1 flex flex-col gap-2" @show=".areChildsVisible">
      <x render-each=".items"></x>
    </div>
  </secction>`,
});

export function getComponents() {
  return [
    Tutorial,
    TextDirective,
    AttributeBinding,
    Counter,
    EventModifiers,
    ConditionalAttributes,
    ListIteration,
    ListAndFilter,
    ListFilterEnrich,
    ListFilterEnrichWith,
    RenderWithScope,
    ComputedProperties,
    DangerSetInnerHtml,
    MultipleViews,
    Entry,
    PushView,
    RequestExample,
    DnDExample,
    StylesExample,
    StylesExampleRoot,
    SeqItemAccess,
    TreeRoot,
    TreeItem,
  ];
}

const ITEMS = [
  "those belonging to the Emperor",
  "embalmed ones",
  "trained ones",
  "suckling pigs",
  "mermaids (or sirens)",
  "fabled ones",
  "stray dogs",
  "those included in this classification",
  "those that tremble as if they were mad",
  "innumerable ones",
  "those drawn with a very fine camel hair brush",
  "et cetera",
  "those that have just broken the vase",
  "those that from afar look like flies",
];

export function getRoot() {
  const ENTRIES = ITEMS.map((v) => Entry.make({ title: v, description: `Length: ${v.length}` }));
  return Tutorial.make({
    steps: [
      TextDirective.make(),
      AttributeBinding.make(),
      Counter.make(),
      EventModifiers.make(),
      ConditionalAttributes.make(),
      ListIteration.make({ items: ITEMS }),
      ListAndFilter.make({ items: ITEMS }),
      ListFilterEnrich.make({ items: ITEMS }),
      ListFilterEnrichWith.make({ items: ITEMS }),
      RenderWithScope.make(),
      DangerSetInnerHtml.make(),
      MultipleViews.make(),
      PushView.make({
        items: ENTRIES,
      }),
      RequestExample.make(),
      ComputedProperties.make({ items: ITEMS }),
      DnDExample.make({ items: ITEMS }),
      StylesExampleRoot.make(),
      SeqItemAccess.make({
        byIndex: ENTRIES,
        currentKey: "key-0",
        byKey: IMap(
          ITEMS.map((v, i) => [
            `key-${i}`,
            Entry.make({ title: v, description: `Length: ${v.length}` }),
          ]),
        ),
      }),
      TreeRoot.Class.fromData([
        {
          label: "home",
          items: [
            {
              label: "alice",
              items: [
                { type: "file", label: ".bashrc" },
                { type: "file", label: ".profile" },
              ],
            },
            {
              label: "bob",
              items: [
                { type: "file", label: ".zrc" },
                {
                  label: "Desktop",

                  items: [{ type: "file", label: ".DS_Store" }],
                },
              ],
            },
          ],
        },
        {
          label: "etc",
          items: [{ type: "file", label: "passwd" }],
        },
      ]),
    ],
  });
}

export function getRequestHandlers() {
  return {
    async loadData() {
      const req = await fetch("https://marianoguerra.github.io/data.json");
      return await req.json();
    },
  };
}
