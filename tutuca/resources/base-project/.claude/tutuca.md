# Tutuca UI Framework

Tutuca is a reactive UI component framework using immutable data structures (Immutable.js). Components are defined declaratively with state, methods, views, and event handlers.

## Importing

```javascript
import { component, html, macro, List, IMap, OMap } from "@tutuca/index.js";
// or from a local ui.js that re-exports tutuca
import { component, html, macro, List } from "./ui.js";
```

## Defining Components

Use the `component()` function with an options object:

```javascript
export const Counter = component({
  name: "Counter",
  fields: {
    count: 0,           // number field
    label: "Counter",   // string field
    isVisible: true,    // boolean field
    items: [],          // List field (arrays become Immutable List)
    data: {},           // Map field (objects become Immutable Map)
  },
  methods: {
    inc() {
      return this.setCount(this.count + 1);
    },
    formatDisplay() {
      return `${this.label}: ${this.count}`;
    },
  },
  input: {
    onIncrement() {
      return this.setCount(this.count + 1);
    },
    onReset() {
      return this.resetCount();
    },
  },
  view: html`<div>
    <span @text=".formatDisplay"></span>
    <button @on.click="onIncrement">+</button>
  </div>`,
});
```

## Component Options

| Option | Description |
|--------|-------------|
| `name` | Component name (required, used for type identification) |
| `fields` | State fields with default values |
| `methods` | Pure methods that compute values or return new state |
| `statics` | Static methods on the component class (e.g., `fromData`) |
| `input` | Event handlers called from view templates |
| `computed` | Cached computed properties |
| `view` | Main HTML template |
| `views` | Named alternative views (accessed via `render-it as="viewName"`) |
| `style` | CSS styles scoped to this component |
| `commonStyle` | CSS applied to all views |
| `dynamic` | Dynamic bindings for context passing |
| `on` | Lifecycle hooks (e.g., `stackEnter`) |
| `alter` | Loop iteration modifiers (`loopWith`, `when`, `enrichWith`) |
| `logic` | Business logic handlers |
| `bubble` | Event bubbling handlers |
| `response` | Async response handlers |

## Auto-Generated Field Methods

For a field named `count`:

| Method | Description |
|--------|-------------|
| `this.count` | Get current value |
| `this.setCount(v)` | Set new value, returns new instance |
| `this.updateCount(fn)` | Update via function, returns new instance |
| `this.resetCount()` | Reset to default value |
| `this.isCountSet()` | Check if not null/undefined |
| `this.isCountNotSet()` | Check if null/undefined |

For boolean fields (e.g., `isVisible`):
- `this.toggleIsVisible()` - Toggle boolean value

For List fields (e.g., `items`):
- `this.itemsIsEmpty()` - Check if empty
- `this.itemsLen()` - Get length
- `this.pushInItems(v)` - Add item, returns new instance
- `this.insertInItemsAt(i, v)` - Insert at index
- `this.setInItemsAt(i, v)` - Set at index
- `this.getInItemsAt(i)` - Get at index
- `this.updateInItemsAt(i, fn)` - Update at index
- `this.removeInItemsAt(i)` - Remove at index

For string fields (e.g., `label`):
- `this.labelIsEmpty()` - Check if empty string
- `this.labelLen()` - Get string length

## View Template Syntax

### Text Binding
```html
<span @text=".fieldName"></span>
<span @text=".methodName"></span>
```

### Attribute Binding
```html
<input :value=".fieldName" />
<a :href=".getUrl"></a>
<div :class="base-class {.dynamicClass}"></div>
<div :style="color: {.getColor}"></div>
```

### Event Handlers
```html
<!-- Call input handler -->
<button @on.click="handlerName">Click</button>

<!-- Call method directly -->
<button @on.click=".methodName">Click</button>

<!-- Pass event value -->
<input @on.input=".setLabel value" />

<!-- Pass event target -->
<select @on.change="onSelect value target"></select>

<!-- Pass component references -->
<button @on.click=".addItem ItemComponent">Add</button>

<!-- Keyboard modifiers -->
<input @on.keydown.send="onSubmit" />
<input @on.keydown.cancel="onCancel" />
<button @on.click.ctrl="onCtrlClick">Ctrl+Click</button>
```

### Event Handler Arguments

These special names can be used as arguments in event handlers:

| Name | Description |
|------|-------------|
| `value` | Event value: `e.target.checked` for checkbox, `e.detail` for CustomEvent, else `e.target.value` |
| `target` | The DOM element that triggered the event (`e.target`) |
| `event` | The raw event object |
| `isAlt` | `true` if Alt key is pressed |
| `isShift` | `true` if Shift key is pressed |
| `isCtrl` | `true` if Ctrl (or Cmd on Mac) key is pressed |
| `isCmd` | Alias for `isCtrl` (cross-platform) |
| `key` | The key name (e.g., `"Enter"`, `"Escape"`) |
| `keyCode` | The numeric key code |
| `isUpKey` | `true` if ArrowUp key |
| `isDownKey` | `true` if ArrowDown key |
| `isSend` | `true` if Enter key |
| `isCancel` | `true` if Escape key |
| `isTabKey` | `true` if Tab key |
| `ctx` | EventContext for dispatching logic/bubble/request events |
| `dragInfo` | Drag and drop context information |

```html
<!-- Using multiple event arguments -->
<input @on.keydown="onKeyPress key isCtrl isShift" />
<button @on.click="onClick isCtrl">Ctrl+Click does something special</button>

<!-- Using ctx for advanced event dispatching -->
<button @on.click="onSave ctx">Save</button>

<!-- Custom events with value (gets e.detail) -->
<code-editor @on.code-editor-update="onUpdate event"></code-editor>
```

### Conditional Rendering
```html
<div @show=".isVisible">Shown when true</div>
<div @hide=".isHidden">Hidden when true</div>
```

### Rendering Components
```html
<!-- Render a component field -->
<x render=".childComponent"></x>

<!-- Render with specific view -->
<x render=".childComponent" as="compact"></x>

<!-- Render from computed path -->
<x render=".items[.activeIndex]"></x>
```

### Rendering with Alternative Views (as)

Components can define multiple views and render them with the `as` attribute:

```javascript
export const User = component({
  name: "User",
  fields: { name: "", email: "", avatar: "" },
  view: html`<div class="user-card">
    <img :src=".avatar" />
    <h3 @text=".name"></h3>
    <p @text=".email"></p>
  </div>`,
  views: {
    handle: html`<span class="font-bold" @text=".name"></span>`,
    avatar: html`<img :src=".avatar" :alt=".name" class="rounded-full" />`,
    option: html`<option :value=".email" @text=".name"></option>`,
  },
});

export const Message = component({
  name: "Message",
  fields: { author: null, body: "" },
  view: html`<div class="message">
    <!-- Render author using "handle" view instead of default -->
    <x render=".author" as="handle"></x>
    <p @text=".body"></p>
  </div>`,
});

export const UserList = component({
  name: "UserList",
  fields: { users: [] },
  view: html`<div>
    <!-- Each user rendered with "avatar" view -->
    <div class="avatars">
      <span @each=".users"><x render-it as="avatar"></x></span>
    </div>

    <!-- Same users as dropdown options -->
    <select>
      <x @each=".users"><x render-it as="option"></x></x>
    </select>
  </div>`,
});
```

### List Iteration
```html
<!-- Render each item in list -->
<x render-each=".items"></x>

<!-- Iterate with wrapper element -->
<li @each=".items"><x render-it></x></li>

<!-- Access iteration variables -->
<div @each=".items">
  <span @text="@key"></span>    <!-- index/key -->
  <span @text="@value"></span>  <!-- raw value -->
  <x render-it></x>             <!-- render as component -->
</div>

<!-- Conditional iteration -->
<div @each=".items" @when="filterFn" @loop-with="initFn">
  <x render-it></x>
</div>
```

### Computed Values
```html
<span @text="$computedName"></span>
<div @show="$isEditing"></div>
```

## Macros

Macros are reusable template snippets:

```javascript
export function getMacros() {
  return {
    "btn-primary": macro(
      { label: "'Click Me'" },  // defaults (note: strings need quotes)
      html`<button class="btn btn-primary" @text="^label"></button>`,
    ),
    card: macro(
      { title: "'Card'" },
      html`<div class="card">
        <h2 @text="^title"></h2>
        <x:slot name="body">Default body</x:slot>
      </div>`,
    ),
  };
}
```

Using macros:
```html
<x:btn-primary></x:btn-primary>
<x:btn-primary :label=".buttonLabel"></x:btn-primary>
<x:card :title=".cardTitle">
  <x slot="body"><p>Custom content</p></x>
</x:card>
```

Macro variables use `^` prefix: `^varName`

## Creating Component Instances

```javascript
// Using make() static method
const counter = Counter.make({ count: 10, label: "My Counter" });

// Default values used for missing fields
const counter2 = Counter.make();

// Creating nested components
const parent = Parent.make({
  child: Child.make({ name: "nested" }),
  items: List([Item.make(), Item.make()]),
});
```

## App Initialization

```javascript
import { tutuca } from "@tutuca/index.js";
import { getComponents, getMacros, getRoot } from "./components.js";

const app = tutuca("#app");
const scope = app.registerComponents(getComponents());
scope.registerMacros(getMacros?.() ?? {});
app.transactor.state.set(getRoot());
app.start();
```

## Export Pattern

Components file should export:

```javascript
export function getComponents() {
  return [ComponentA, ComponentB, ComponentC];
}

export function getMacros() {
  return {
    "macro-name": macro({}, html`...`),
  };
}

export function getRoot() {
  return RootComponent.make({ /* initial state */ });
}

// Or for simpler cases:
export function getExample() {
  return MainComponent.make({});
}
```

## Immutable Data Types

```javascript
import { List, IMap, OMap, isList, isMap } from "@tutuca/index.js";

// Lists (ordered, indexed)
const list = List([1, 2, 3]);
list.push(4);        // Returns new List
list.get(0);         // 1
list.set(0, 10);     // Returns new List
list.size;           // 3

// Maps (unordered key-value)
const map = IMap({ a: 1, b: 2 });
map.get("a");        // 1
map.set("c", 3);     // Returns new Map

// OrderedMaps (ordered key-value)
const omap = OMap([["a", 1], ["b", 2]]);
```

## Static Methods Pattern

Use `statics` for factory methods:

```javascript
export const Message = component({
  name: "Message",
  fields: { author: null, body: "", date: new Date() },
  statics: {
    fromData(data, ctx) {
      return this.make({
        author: ctx.users[data.userId],
        body: data.text,
        date: new Date(data.timestamp),
      });
    },
  },
});

// Usage
const msg = Message.Class.fromData(rawData, context);
```

## Dynamic Context

Share data down the component tree:

```javascript
export const Provider = component({
  name: "Provider",
  fields: { theme: "light" },
  dynamic: {
    currentTheme: ".theme",
  },
  on: {
    stackEnter(stack) {
      return stack.withDynamicBindings(["currentTheme"]);
    },
  },
});

export const Consumer = component({
  name: "Consumer",
  dynamic: {
    theme: { for: "Provider.currentTheme", default: "'dark'" },
  },
  view: html`<div @text="*theme"></div>`,
});
```

Access dynamic values with `*` prefix: `*dynamicName`

## Alter Handlers for Iteration

The `alter` option defines callbacks that modify how `@each` loops behave:

| Callback | Signature | Purpose |
|----------|-----------|---------|
| `loopWith` | `(seq) => context` | Initialize shared context before iteration |
| `when` | `(key, value, context) => boolean` | Filter which items to render |
| `enrichWith` | `(binds, key, value, context) => void` | Add custom `@variables` to each iteration |

```javascript
export const ProductList = component({
  name: "ProductList",
  fields: {
    products: [],
    searchQuery: "",
    minPrice: 0,
    maxPrice: 1000,
    showOutOfStock: false,
  },
  alter: {
    // loopWith: Called ONCE before iteration starts
    // Use to compute expensive values or prepare shared context
    initProductFilter(_seq) {
      return {
        query: this.searchQuery.toLowerCase().trim(),
        min: this.minPrice,
        max: this.maxPrice,
        includeOutOfStock: this.showOutOfStock,
      };
    },

    // when: Called for EACH item to decide if it should render
    // Return true to include, false to skip
    filterProduct(_key, product, ctx) {
      // Skip out of stock if not showing them
      if (!ctx.includeOutOfStock && product.stock === 0) {
        return false;
      }
      // Price range filter
      if (product.price < ctx.min || product.price > ctx.max) {
        return false;
      }
      // Search query filter
      if (ctx.query && !product.name.toLowerCase().includes(ctx.query)) {
        return false;
      }
      return true;
    },

    // enrichWith: Called for EACH rendered item
    // Mutate `binds` to add custom @variables accessible in template
    enrichProductBindings(binds, key, product, _ctx) {
      binds.index = key + 1;  // 1-based index -> @index
      binds.formattedPrice = `$${product.price.toFixed(2)}`;  // -> @formattedPrice
      binds.stockStatus = product.stock > 0 ? "In Stock" : "Out of Stock";  // -> @stockStatus
      binds.isLowStock = product.stock > 0 && product.stock < 5;  // -> @isLowStock
      binds.cssClass = product.stock === 0 ? "opacity-50" : "";  // -> @cssClass
    },
  },
  view: html`<div>
    <input
      type="search"
      placeholder="Search products..."
      :value=".searchQuery"
      @on.input=".setSearchQuery value"
    />

    <ul>
      <li
        @each=".products"
        @loop-with="initProductFilter"
        @when="filterProduct"
        @enrich-with="enrichProductBindings"
        :class="product-item {@cssClass}"
      >
        <span class="index" @text="@index"></span>
        <span class="name" @text="@value.name"></span>
        <span class="price" @text="@formattedPrice"></span>
        <span class="stock" @text="@stockStatus"></span>
        <span class="warning" @show="@isLowStock">Low stock!</span>
      </li>
    </ul>
  </div>`,
});
```

### Simpler Example with Just @when

```javascript
export const TaskList = component({
  name: "TaskList",
  fields: { tasks: [], hideCompleted: false },
  alter: {
    shouldShowTask(_key, task, _ctx) {
      return !this.hideCompleted || !task.done;
    },
  },
  view: html`<ul>
    <li @each=".tasks" @when="shouldShowTask">
      <x render-it></x>
    </li>
  </ul>`,
});
```

### Using @enrich-with for Display Labels

```javascript
export const UserSelect = component({
  name: "UserSelect",
  fields: { users: {} },  // Map keyed by ID
  alter: {
    addUserLabel(binds, id, user) {
      binds.label = `${user.name} (${user.email})`;
      binds.initials = user.name.split(" ").map(n => n[0]).join("");
    },
  },
  view: html`<select>
    <option
      @each=".users"
      @enrich-with="addUserLabel"
      :value="@key"
      @text="@label"
    ></option>
  </select>`,
});
```

## Multiple Views

```javascript
export const Card = component({
  name: "Card",
  fields: { title: "", expanded: false },
  view: html`<div class="card">
    <h2 @text=".title"></h2>
    <div @show=".expanded">Full content</div>
  </div>`,
  views: {
    compact: html`<span @text=".title"></span>`,
    editor: html`<input :value=".title" @on.input=".setTitle value" />`,
  },
});

// Usage in templates
<x render=".card"></x>              <!-- uses main view -->
<x render=".card" as="compact"></x> <!-- uses compact view -->
<x render-it as="editor"></x>       <!-- in @each loops -->
```

## Request Handlers (Async Operations)

```javascript
// Register request handlers
scope.registerRequestHandlers({
  async fetchData(scope, component) {
    const response = await fetch("/api/data");
    return response.json();
  },
});

// In component
export const App = component({
  name: "App",
  input: {
    onLoad(fetchData) {
      fetchData();  // Call the request
      return this;
    },
  },
  response: {
    fetchData(result, error) {
      if (error) return this;
      return this.setData(result);
    },
  },
  view: html`<button @on.click="onLoad !fetchData">Load</button>`,
});
```

Request references use `!` prefix: `!requestName`

## EventContext (ctx) - Advanced Event Dispatching

The `ctx` argument provides methods for dispatching events across the component tree:

```javascript
export const Editor = component({
  name: "Editor",
  input: {
    onSave(ctx) {
      // Dispatch logic event at current path
      ctx.logic("save", [this.data]);

      // Dispatch bubbling event (goes up the tree)
      ctx.bubble("documentSaved", [this.id]);

      // Make async request
      ctx.request("saveToServer", [this.toJSON()]);

      return this;
    },
    onNestedAction(ctx) {
      // Dispatch to a nested path
      ctx.at.items[0].logic("activate", []);

      // Look up component type in current scope
      const ItemComp = ctx.lookupTypeFor("Item", this);
      return this.pushInItems(ItemComp.make());
    },
  },
  view: html`<button @on.click="onSave ctx">Save</button>`,
});
```

### ctx Methods

| Method | Description |
|--------|-------------|
| `ctx.logic(name, args, opts)` | Dispatch logic event at current path |
| `ctx.bubble(name, args, opts)` | Dispatch bubbling event (propagates up) |
| `ctx.request(name, args, opts)` | Make async request to registered handler |
| `ctx.at.field.logic(...)` | Dispatch to a nested path |
| `ctx.lookupTypeFor(name, instance)` | Look up component type in scope |
| `ctx.stopPropagation()` | Stop event bubbling |

## Logic and Bubble Events

Logic events call `logic` handlers, bubble events call `bubble` handlers and propagate up:

```javascript
export const TodoList = component({
  name: "TodoList",
  fields: { items: [], lastAction: "" },
  logic: {
    // Called via ctx.logic("itemAdded", [item])
    itemAdded(item, ctx) {
      return this.setLastAction(`Added: ${item.name}`);
    },
    // Called on app init
    init(ctx) {
      const Item = ctx.lookupTypeFor("TodoItem", this);
      return this.pushInItems(Item.make({ name: "First task" }));
    },
  },
  bubble: {
    // Called when child dispatches ctx.bubble("itemCompleted", [...])
    itemCompleted(itemId, ctx) {
      // Can stop propagation
      ctx.stopPropagation();
      return this.updateInItemsAt(itemId, (item) => item.setDone(true));
    },
  },
});

// Child component bubbling events
export const TodoItem = component({
  name: "TodoItem",
  fields: { name: "", done: false },
  input: {
    onComplete(ctx) {
      // Bubbles up to parent's bubble.itemCompleted
      ctx.bubble("itemCompleted", [this.id], { bubbles: true });
      return this;
    },
  },
});
```

## List Operations with @key

Use `@key` in templates to reference the current iteration index:

```javascript
export const EditableList = component({
  name: "EditableList",
  fields: { items: [] },
  methods: {
    addItemAt(index, ItemComponent) {
      return this.insertInItemsAt(index, ItemComponent.make());
    },
  },
  view: html`<ul>
    <li @each=".items" class="group">
      <!-- Insert button before this item -->
      <button @on.click=".addItemAt @key Item">+</button>

      <!-- Render the item -->
      <x render-it></x>

      <!-- Remove this item -->
      <button @on.click=".removeInItemsAt @key">×</button>

      <!-- Update this specific item -->
      <button @on.click=".updateInItemsAt @key .toggleDone">Toggle</button>
    </li>
  </ul>`,
});
```

The `@key` is the index (for Lists) or key (for Maps/OrderedMaps) of the current item.

## Delayed Actions with callAfterWith

Schedule actions to run after a delay:

```javascript
export const Notifications = component({
  name: "Notifications",
  fields: { items: [] },
  input: {
    onAddNotification(message, callAfterWith) {
      const id = Date.now();
      // Schedule removal after 3 seconds
      callAfterWith.withOpts(
        3000,                              // delay in ms
        { type: "removeNotification", id }, // payload
        {
          onOkName: "onNotificationTimeout",     // response handler on success
          onErrorName: "onNotificationError",    // response handler on error
        },
      );
      return this.pushInItems(Notification.make({ id, message }));
    },
  },
  response: {
    onNotificationTimeout(info) {
      return this.updateItems((items) =>
        items.filter((n) => n.id !== info.id)
      );
    },
    onNotificationError(err) {
      console.error("Notification timeout error", err);
      return this;
    },
  },
  view: html`<button @on.click="onAddNotification 'Hello!' !callAfterWith">
    Add Notification
  </button>`,
});
```

## Response Handlers with Custom Names

Specify different handlers for success and error:

```javascript
export const DataLoader = component({
  name: "DataLoader",
  fields: { data: null, error: null, loading: false },
  input: {
    onLoad(fetchData) {
      // Using default response handler name
      fetchData(this.id);
      return this.setLoading(true);
    },
    onLoadWithCustomHandlers(fetchData) {
      // Call with custom response handler options
      fetchData.withOpts([this.id], {
        onOkName: "onDataReceived",
        onErrorName: "onDataFailed",
      });
      return this.setLoading(true);
    },
  },
  response: {
    // Default handler (matches request name)
    fetchData(result, error) {
      if (error) return this.setError(error.message).setLoading(false);
      return this.setData(result).setLoading(false);
    },
    // Custom success handler
    onDataReceived(data) {
      return this.setData(data).setLoading(false).setError(null);
    },
    // Custom error handler
    onDataFailed(error) {
      return this.setError(error.message).setLoading(false);
    },
  },
});
```

## Drag and Drop

Use `dragInfo` and data attributes for drag and drop:

```javascript
export const DraggableList = component({
  name: "DraggableList",
  fields: { items: [] },
  input: {
    onDrop(e, dragInfo) {
      // dragInfo contains: path, value, type, stack
      const draggedItem = dragInfo.value;
      const dropIndex = e.target.dataset.index;
      return this.insertInItemsAt(+dropIndex, draggedItem);
    },
  },
  view: html`<ul @on.drop="onDrop event dragInfo">
    <li
      @each=".items"
      draggable="true"
      data-dragtype="item"
      data-droptarget
      :data-index="@key"
    >
      <x render-it></x>
    </li>
  </ul>`,
});
```

Required attributes:
- `draggable="true"` - Make element draggable
- `data-dragtype="typeName"` - Identify drag type
- `data-droptarget` - Mark as valid drop target

## Conditional Class with @if.class

Apply classes conditionally:

```html
<button
  @if.class=".isActive"
  @then="'btn btn-primary'"
  @else="'btn btn-ghost'"
  @on.click=".toggleIsActive"
>
  Toggle
</button>

<div
  @if.class=".expanded"
  @then="'panel panel-open'"
  @else="'panel panel-closed'"
>
  Content
</div>
```

## Template Syntax Reference

| Prefix | Usage | Example |
|--------|-------|---------|
| `.` | Field/method on current component | `.count`, `.formatDate` |
| `$` | Computed property | `$isValid`, `$totalPrice` |
| `*` | Dynamic context value | `*theme`, `*currentUser` |
| `^` | Macro variable | `^label`, `^handler` |
| `@` | Iteration variable | `@key`, `@value`, `@label` |
| `!` | Request handler reference | `!fetchData`, `!save` |
| `'...'` | String literal | `'default text'` |

## Component Definition Checklist

```javascript
export const MyComponent = component({
  name: "MyComponent",                    // Required: unique name

  fields: {                               // State (becomes Immutable Record)
    fieldName: defaultValue,
  },

  statics: {                              // Static methods (on Class)
    fromData(data) { return this.make({...}); },
  },

  methods: {                              // Instance methods (return new state)
    doSomething() { return this.setField(newValue); },
  },

  computed: {                             // Cached computed values
    derivedValue() { return this.a + this.b; },
  },

  input: {                                // Event handlers from view
    onEvent(arg1, arg2) { return this; },
  },

  logic: {                                // Business logic events
    onInit(ctx) { return this; },
  },

  bubble: {                               // Bubbling event handlers
    onChildEvent(data, ctx) { return this; },
  },

  response: {                             // Async response handlers
    requestName(result, error) { return this; },
  },

  alter: {                                // Iteration modifiers
    loopWith(seq) { return {}; },
    when(key, val, ctx) { return true; },
    enrichWith(binds, key, val) { binds.x = val; },
  },

  dynamic: {                              // Context values
    valueName: ".field",
    aliasName: { for: "Other.value", default: "'fallback'" },
  },

  on: {                                   // Lifecycle hooks
    stackEnter(stack) { return stack.withDynamicBindings([...]); },
  },

  view: html`...`,                        // Main template
  views: { alt: html`...` },              // Alternative views
  style: "color: red;",                   // Scoped CSS
  commonStyle: "display: block;",         // CSS for all views
});
