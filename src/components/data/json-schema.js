import { component, html } from "tutuca";
import {
  chain,
  compositeAlter,
  compositeFields,
  compositeMethods,
  getComponents as getJsonComponents,
  JsonViewer,
} from "./json.js";

// ---------------------------------------------------------------------------
// Shared building blocks
// ---------------------------------------------------------------------------

// Fields/methods every collapsible schema node shares: the json.js composite
// state (items/isExpanded/pagination) plus a type label, constraint badges and
// title/description/deprecated metadata.
const schemaNodeFields = {
  ...compositeFields,
  typeLabel: "",
  badges: [],
  title: "",
  description: "",
  deprecated: false,
};

function schemaNodeMethods(extra = {}) {
  return {
    ...compositeMethods,
    typeText() {
      return this.typeLabel;
    },
    ...extra,
  };
}

// Body of a collapsible node. `grid` (key/value rows) aligns every row's value
// into one column via a 2-column CSS grid whose rows are `display: contents`
// (SchemaProperty / SchemaBranch each contribute exactly a label cell + a value
// cell). `list` stacks single-element items (enum members) one per line.
const GRID_BODY = html`<div
  @show=".isExpanded"
  class="ml-1 grid gap-x-2 gap-y-0.5 items-baseline border-l border-base-content/10 pl-2 mt-0.5"
  style="grid-template-columns: auto 1fr"
>
  <x render-each=".items" loop-with="getPageRange"></x>
</div>`;

const LIST_BODY = html`<div
  @show=".isExpanded"
  class="ml-1 flex flex-col gap-0.5 border-l border-base-content/10 pl-2 mt-0.5"
>
  <x render-each=".items" loop-with="getPageRange"></x>
</div>`;

// The shared collapsible chrome: chevron + type label + count + badges +
// title/description + a body (grid or list). `accent` colours the type label; it
// is interpolated as a literal so the margaui scanner sees it.
function makeSchemaView(accent, body = GRID_BODY) {
  return html`<span class="font-mono text-sm leading-tight inline-block">
    <span class="inline-flex items-center gap-2 flex-wrap">
      <button
        type="button"
        class="cursor-pointer text-base-content/70 hover:text-base-content inline-flex items-center gap-1"
        :disabled="$isItemsEmpty"
        @on.click="$toggleIsExpanded"
      >
        <span @hide="$isItemsEmpty" @text="$arrowText"></span>
        <span class="${accent} font-semibold" @text="$typeText"></span>
        <span class="text-base-content/50" @text="$countText"></span>
      </button>
      <span
        @each=".badges"
        class="badge badge-xs badge-ghost font-mono font-normal"
        ><x text="@value"></x
      ></span>
      <span @show=".deprecated" class="badge badge-xs badge-warning"
        >deprecated</span
      >
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
    <span
      @show="truthy? .title"
      class="block text-base-content/80 italic"
      @text=".title"
    ></span>
    <span
      @show="truthy? .description"
      class="block text-base-content/50"
      @text=".description"
    ></span>
    ${body}
  </span>`;
}

function metaOf(schema) {
  return {
    title: typeof schema.title === "string" ? schema.title : "",
    description: typeof schema.description === "string" ? schema.description : "",
    deprecated: schema.deprecated === true,
  };
}

function displayType(schema, fallback) {
  const t = schema.type;
  if (Array.isArray(t)) return t.join(" | ");
  if (typeof t === "string") return t;
  return fallback;
}

// A schema whose only keyword is a primitive `type` (e.g. {type:"string"}) — the
// kind that can be inlined into a parent's label ("array of string") instead of
// rendered as an expandable child. Returns the type name, or null if not simple.
function simpleScalarType(schema) {
  if (schema == null || typeof schema !== "object") return null;
  const t = schema.type;
  const typeOk =
    typeof t === "string" || (Array.isArray(t) && t.every((x) => typeof x === "string"));
  if (!typeOk) return null;
  if (Object.keys(schema).some((k) => k !== "type")) return null;
  return Array.isArray(t) ? t.join(" | ") : t;
}

function combinatorPhrasing(kind) {
  if (kind === "allOf") return "all of";
  if (kind === "anyOf") return "any of";
  if (kind === "oneOf") return "one of";
  return "combination";
}

// Constraint keywords as human-readable badge text (this is a view for people to
// read, so "max length" rather than "maxLength").
function collectBadges(schema) {
  const b = [];
  // string
  if (schema.format != null) b.push(`format: ${schema.format}`);
  if (schema.minLength != null) b.push(`min length: ${schema.minLength}`);
  if (schema.maxLength != null) b.push(`max length: ${schema.maxLength}`);
  if (schema.pattern != null) b.push(`pattern: /${schema.pattern}/`);
  // numeric
  if (schema.minimum != null) b.push(`≥ ${schema.minimum}`);
  if (schema.maximum != null) b.push(`≤ ${schema.maximum}`);
  if (schema.exclusiveMinimum != null) b.push(`> ${schema.exclusiveMinimum}`);
  if (schema.exclusiveMaximum != null) b.push(`< ${schema.exclusiveMaximum}`);
  if (schema.multipleOf != null) b.push(`multiple of ${schema.multipleOf}`);
  // array
  if (schema.minItems != null) b.push(`min items: ${schema.minItems}`);
  if (schema.maxItems != null) b.push(`max items: ${schema.maxItems}`);
  if (schema.uniqueItems) b.push("unique items");
  // object
  if (schema.minProperties != null) b.push(`min properties: ${schema.minProperties}`);
  if (schema.maxProperties != null) b.push(`max properties: ${schema.maxProperties}`);
  if (schema.additionalProperties === false) b.push("no additional properties");
  // metadata flags
  if (schema.readOnly) b.push("read-only");
  if (schema.writeOnly) b.push("write-only");
  return b;
}

function valueBranch(label, value) {
  return SchemaBranch.make({
    label,
    child: JsonViewer.Class.fromData(value),
    labelClass: "text-info",
  });
}

// Cross-cutting keywords that can coexist with any primary type. `primary` names
// the family the host component already renders itself, so it is skipped here.
function collectExtras(schema, recurse, primary) {
  const rows = [];
  if (primary !== "const" && "const" in schema) rows.push(valueBranch("const", schema.const));
  if (primary !== "enum" && Array.isArray(schema.enum)) rows.push(valueBranch("enum", schema.enum));
  if ("default" in schema) rows.push(valueBranch("default", schema.default));
  if ("examples" in schema) rows.push(valueBranch("examples", schema.examples));
  if (primary !== "combinator") {
    for (const k of ["allOf", "anyOf", "oneOf"]) {
      if (Array.isArray(schema[k])) {
        for (const s of schema[k]) {
          rows.push(
            SchemaBranch.make({
              label: combinatorPhrasing(k),
              child: recurse(s),
              labelClass: "text-accent",
            }),
          );
        }
      }
    }
  }
  if (primary !== "not" && schema.not !== undefined) {
    rows.push(
      SchemaBranch.make({
        label: "not",
        child: recurse(schema.not),
        labelClass: "text-error",
      }),
    );
  }
  if (primary !== "conditional") {
    if (schema.if !== undefined)
      rows.push(SchemaBranch.make({ label: "if", child: recurse(schema.if) }));
    if (schema.then !== undefined)
      rows.push(SchemaBranch.make({ label: "then", child: recurse(schema.then) }));
    if (schema.else !== undefined)
      rows.push(SchemaBranch.make({ label: "else", child: recurse(schema.else) }));
  }
  const defs = schema.$defs || schema.definitions;
  if (defs && typeof defs === "object") {
    for (const [name, s] of Object.entries(defs)) {
      rows.push(
        SchemaBranch.make({
          label: `$defs/${name}`,
          child: recurse(s),
          labelClass: "text-secondary",
        }),
      );
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Leaf rows (reused by composites)
// ---------------------------------------------------------------------------

// One object property row: key, optional required marker, then the child schema.
export const SchemaProperty = component({
  name: "SchemaProperty",
  fields: { key: "", child: null, required: false },
  // `contents` so the key cell and value cell land directly in the parent's
  // grid, aligning values across rows.
  view: html`<div class="contents">
    <span class="font-mono text-sm flex items-center gap-1 leading-tight">
      <span class="text-base-content/60" @text=".key"></span>
      <span @show=".required" class="text-error font-bold" title="required"
        >*</span
      >
      <span class="text-base-content/30">:</span>
    </span>
    <x render=".child"></x>
  </div>`,
});

// A labeled wrapper around a nested schema, used for object extras, applicators,
// $defs entries and embedded values where a dedicated component isn't warranted.
export const SchemaBranch = component({
  name: "SchemaBranch",
  fields: { label: "", child: null, labelClass: "text-accent" },
  methods: {
    labelCssClass() {
      return `font-mono text-sm ${this.labelClass}`;
    },
  },
  // `contents` so the label cell and value cell land directly in the parent's
  // grid, aligning values across rows.
  view: html`<div class="contents">
    <span class="flex items-center gap-1 leading-tight">
      <span :class="$labelCssClass" @text=".label"></span>
      <span class="text-base-content/30">:</span>
    </span>
    <x render=".child"></x>
  </div>`,
  views: {
    // Decoy: labelClass colours are chosen in JS, so they never appear as
    // literals for the margaui scanner.
    _margauiClasses: html`<p
      class="text-accent text-secondary text-info text-error"
    ></p>`,
  },
});

// ---------------------------------------------------------------------------
// Per-construct schema components
// ---------------------------------------------------------------------------

// Primitive type(s): string / number / integer / boolean / null / multi-type.
// Compact and chevron-less unless it carries extras (default, examples, ...).
export const SchemaScalar = component({
  name: "SchemaScalar",
  fields: schemaNodeFields,
  methods: schemaNodeMethods({
    countText() {
      return "";
    },
  }),
  alter: compositeAlter,
  statics: {
    fromData(schema, recurse) {
      return this.make({
        typeLabel: displayType(schema, "any"),
        badges: collectBadges(schema),
        ...metaOf(schema),
        items: collectExtras(schema, recurse, "scalar"),
      });
    },
  },
  view: makeSchemaView("text-success"),
});

// Object schema: property rows (with required markers) plus object-specific
// branches (additionalProperties / patternProperties / propertyNames).
export const SchemaObject = component({
  name: "SchemaObject",
  fields: schemaNodeFields,
  methods: schemaNodeMethods({
    countText() {
      return this.items.size > 0 ? `{${this.items.size}}` : "";
    },
  }),
  alter: compositeAlter,
  statics: {
    fromData(schema, recurse) {
      const required = Array.isArray(schema.required) ? schema.required : [];
      const items = [];
      if (schema.properties && typeof schema.properties === "object") {
        for (const [k, v] of Object.entries(schema.properties)) {
          items.push(
            SchemaProperty.make({
              key: k,
              required: required.includes(k),
              child: recurse(v),
            }),
          );
        }
      }
      if (schema.patternProperties && typeof schema.patternProperties === "object") {
        for (const [pat, v] of Object.entries(schema.patternProperties)) {
          items.push(
            SchemaBranch.make({
              label: `/${pat}/`,
              child: recurse(v),
              labelClass: "text-secondary",
            }),
          );
        }
      }
      if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
        items.push(
          SchemaBranch.make({
            label: "additional properties",
            child: recurse(schema.additionalProperties),
            labelClass: "text-secondary",
          }),
        );
      }
      if (schema.propertyNames !== undefined) {
        items.push(
          SchemaBranch.make({
            label: "property names",
            child: recurse(schema.propertyNames),
            labelClass: "text-secondary",
          }),
        );
      }
      items.push(...collectExtras(schema, recurse, "object"));
      return this.make({
        typeLabel: displayType(schema, "object"),
        badges: collectBadges(schema),
        ...metaOf(schema),
        items,
      });
    },
  },
  view: makeSchemaView("text-primary"),
});

// Array schema: a single `items` schema, or a positional `prefixItems` tuple,
// plus `contains` and array constraints (as badges).
export const SchemaArray = component({
  name: "SchemaArray",
  fields: schemaNodeFields,
  methods: schemaNodeMethods({
    countText() {
      return this.items.size > 0 ? `[${this.items.size}]` : "";
    },
  }),
  alter: compositeAlter,
  statics: {
    fromData(schema, recurse) {
      const items = [];
      const isTuple = Array.isArray(schema.prefixItems);
      // Inline a bare primitive item type into the label ("array of string")
      // instead of an expandable `items` row.
      const inlineType =
        !isTuple && !Array.isArray(schema.items) ? simpleScalarType(schema.items) : null;
      if (isTuple) {
        schema.prefixItems.forEach((s, i) => {
          items.push(SchemaBranch.make({ label: `item ${i}`, child: recurse(s) }));
        });
      }
      if (Array.isArray(schema.items)) {
        // draft-07 tuple form
        schema.items.forEach((s, i) => {
          items.push(SchemaBranch.make({ label: `item ${i}`, child: recurse(s) }));
        });
      } else if (schema.items !== undefined && inlineType == null) {
        items.push(SchemaBranch.make({ label: "items", child: recurse(schema.items) }));
      }
      if (schema.contains !== undefined) {
        items.push(
          SchemaBranch.make({
            label: "contains",
            child: recurse(schema.contains),
          }),
        );
      }
      items.push(...collectExtras(schema, recurse, "array"));
      const typeLabel = isTuple
        ? "tuple"
        : inlineType != null
          ? `array of ${inlineType}`
          : displayType(schema, "array");
      return this.make({
        typeLabel,
        badges: collectBadges(schema),
        ...metaOf(schema),
        items,
      });
    },
  },
  view: makeSchemaView("text-primary"),
});

// Enumerated allowed values — each rendered with JsonViewer (json.js reuse).
export const SchemaEnum = component({
  name: "SchemaEnum",
  fields: schemaNodeFields,
  methods: schemaNodeMethods({
    countText() {
      return this.items.size > 0 ? `(${this.items.size})` : "";
    },
  }),
  alter: compositeAlter,
  statics: {
    fromData(schema, recurse) {
      const members = Array.isArray(schema.enum) ? schema.enum : [];
      const items = members.map((v) => JsonViewer.Class.fromData(v));
      items.push(...collectExtras(schema, recurse, "enum"));
      return this.make({
        typeLabel: "enum",
        badges: collectBadges(schema),
        ...metaOf(schema),
        items,
      });
    },
  },
  // list layout: each enum member is a single value rendered one per line.
  view: makeSchemaView("text-info", LIST_BODY),
});

// A single constant value — terminal, rendered inline via JsonViewer.
export const SchemaConst = component({
  name: "SchemaConst",
  fields: { value: null },
  statics: {
    fromData(schema) {
      return this.make({ value: JsonViewer.Class.fromData(schema.const) });
    },
  },
  view: html`<span
    class="font-mono text-sm leading-tight inline-flex items-center gap-2"
  >
    <span class="text-info font-semibold">const</span>
    <span class="text-base-content/30">=</span>
    <x render=".value"></x>
  </span>`,
});

// Combinator: allOf / anyOf / oneOf. The header phrases the semantics
// ("all of" / "any of" / "one of") and the subschemas are listed without keys.
export const SchemaCombinator = component({
  name: "SchemaCombinator",
  fields: schemaNodeFields,
  methods: schemaNodeMethods({
    countText() {
      return this.items.size > 0 ? `(${this.items.size})` : "";
    },
  }),
  alter: compositeAlter,
  statics: {
    fromData(schema, recurse) {
      const items = [];
      let kind = null;
      for (const k of ["allOf", "anyOf", "oneOf"]) {
        if (Array.isArray(schema[k])) {
          kind = kind ?? k;
          for (const s of schema[k]) items.push(recurse(s));
        }
      }
      items.push(...collectExtras(schema, recurse, "combinator"));
      return this.make({
        typeLabel: combinatorPhrasing(kind),
        badges: collectBadges(schema),
        ...metaOf(schema),
        items,
      });
    },
  },
  // list layout: members are full schema nodes listed one per line, no keys.
  view: makeSchemaView("text-accent", LIST_BODY),
});

// Conditional applicator: if / then / else, shown as three labeled regions.
export const SchemaConditional = component({
  name: "SchemaConditional",
  fields: {
    ifNode: null,
    thenNode: null,
    elseNode: null,
    title: "",
    description: "",
    deprecated: false,
  },
  statics: {
    fromData(schema, recurse) {
      return this.make({
        ifNode: schema.if !== undefined ? recurse(schema.if) : null,
        thenNode: schema.then !== undefined ? recurse(schema.then) : null,
        elseNode: schema.else !== undefined ? recurse(schema.else) : null,
        ...metaOf(schema),
      });
    },
  },
  view: html`<span class="font-mono text-sm leading-tight inline-block">
    <span class="inline-flex items-center gap-2 flex-wrap">
      <span class="text-accent font-semibold">conditional</span>
      <span @show=".deprecated" class="badge badge-xs badge-warning"
        >deprecated</span
      >
    </span>
    <span
      @show="truthy? .title"
      class="block text-base-content/80 italic"
      @text=".title"
    ></span>
    <span
      @show="truthy? .description"
      class="block text-base-content/50"
      @text=".description"
    ></span>
    <div
      class="ml-1 grid gap-x-2 gap-y-0.5 items-baseline border-l border-base-content/10 pl-2 mt-0.5"
      style="grid-template-columns: auto 1fr"
    >
      <div @show="truthy? .ifNode" class="contents">
        <span class="font-mono text-sm flex items-center gap-1 leading-tight">
          <span class="text-info">if</span>
          <span class="text-base-content/30">:</span>
        </span>
        <x render=".ifNode"></x>
      </div>
      <div @show="truthy? .thenNode" class="contents">
        <span class="font-mono text-sm flex items-center gap-1 leading-tight">
          <span class="text-success">then</span>
          <span class="text-base-content/30">:</span>
        </span>
        <x render=".thenNode"></x>
      </div>
      <div @show="truthy? .elseNode" class="contents">
        <span class="font-mono text-sm flex items-center gap-1 leading-tight">
          <span class="text-warning">else</span>
          <span class="text-base-content/30">:</span>
        </span>
        <x render=".elseNode"></x>
      </div>
    </div>
  </span>`,
});

// Negation: the value must NOT match the wrapped schema.
export const SchemaNot = component({
  name: "SchemaNot",
  fields: { child: null },
  statics: {
    fromData(schema, recurse) {
      return this.make({ child: recurse(schema.not) });
    },
  },
  view: html`<span
    class="font-mono text-sm leading-tight inline-flex items-center gap-2"
  >
    <span class="text-error font-semibold">not</span>
    <span class="text-base-content/30">:</span>
    <x render=".child"></x>
  </span>`,
});

// Boolean schemas: `true` accepts any value, `false` accepts none.
export const SchemaBoolean = component({
  name: "SchemaBoolean",
  fields: { value: true },
  methods: {
    text() {
      return this.value ? "any value (true)" : "no value allowed (false)";
    },
    cssClass() {
      const base = "font-mono text-sm leading-tight italic";
      return `${base} ${this.value ? "text-success" : "text-error"}`;
    },
  },
  view: html`<span :class="$cssClass" @text="$text"></span>`,
  views: {
    // Decoy: cssClass() builds these at runtime, so they never appear as
    // literals the margaui scanner can find.
    _margauiClasses: html`<p class="text-success text-error"></p>`,
  },
});

// A `$ref`. Rendered as a label only — never resolved/followed, so recursive
// schemas (`{ "$ref": "#" }`) cannot loop.
export const SchemaRef = component({
  name: "SchemaRef",
  fields: { target: "" },
  view: html`<span class="font-mono text-sm leading-tight text-secondary"
    >→ <span @text=".target"></span
  ></span>`,
});

// ---------------------------------------------------------------------------
// Top-level viewer + dispatch
// ---------------------------------------------------------------------------

// Holds the classified high-level tree in `value` and a JsonViewer of the
// original schema in `raw` (built with json.js); `showRaw` toggles between them.
// `rawSchema` keeps the plain schema for inspection.
export const SchemaViewer = component({
  name: "SchemaViewer",
  fields: {
    value: null,
    raw: null,
    rawSchema: null,
    showRaw: false,
  },
  methods: {
    toggleIsExpanded() {
      return typeof this.value?.toggleIsExpanded === "function"
        ? this.setValue(this.value.toggleIsExpanded())
        : this;
    },
    toggleLabel() {
      return this.showRaw ? "high-level view" : "raw schema";
    },
  },
  statics: {
    fromData(schema) {
      return this.make({
        value: dispatch(schema),
        raw: JsonViewer.Class.fromData(schema),
        rawSchema: schema,
      });
    },
  },
  view: html`<div class="inline-flex flex-col items-start gap-1">
    <button
      type="button"
      class="btn btn-xs btn-ghost self-end"
      @on.click="$toggleShowRaw"
      @text="$toggleLabel"
    ></button>
    <x render=".value" hide=".showRaw"></x>
    <x render=".raw" show=".showRaw"></x>
  </div>`,
});

function hasObjectKeywords(schema) {
  const t = schema.type;
  if (t === "object" || (Array.isArray(t) && t.includes("object"))) return true;
  return (
    schema.properties !== undefined ||
    schema.required !== undefined ||
    schema.patternProperties !== undefined ||
    schema.propertyNames !== undefined ||
    schema.additionalProperties !== undefined ||
    schema.minProperties != null ||
    schema.maxProperties != null
  );
}

function hasArrayKeywords(schema) {
  const t = schema.type;
  if (t === "array" || (Array.isArray(t) && t.includes("array"))) return true;
  return (
    schema.items !== undefined ||
    schema.prefixItems !== undefined ||
    schema.contains !== undefined ||
    schema.minItems != null ||
    schema.maxItems != null ||
    schema.uniqueItems !== undefined
  );
}

export function classifySchema(schema, recurse = classifySchema) {
  if (schema === true || schema === false) return SchemaBoolean.make({ value: schema });
  if (schema === null || typeof schema !== "object") return JsonViewer.Class.fromData(schema);
  if (typeof schema.$ref === "string") return SchemaRef.make({ target: schema.$ref });

  if (hasObjectKeywords(schema)) return SchemaObject.Class.fromData(schema, recurse);
  if (hasArrayKeywords(schema)) return SchemaArray.Class.fromData(schema, recurse);
  if (Array.isArray(schema.enum)) return SchemaEnum.Class.fromData(schema, recurse);
  if ("const" in schema) return SchemaConst.Class.fromData(schema, recurse);
  if (schema.allOf || schema.anyOf || schema.oneOf)
    return SchemaCombinator.Class.fromData(schema, recurse);
  if (schema.not !== undefined) return SchemaNot.Class.fromData(schema, recurse);
  if (schema.if !== undefined || schema.then !== undefined || schema.else !== undefined)
    return SchemaConditional.Class.fromData(schema, recurse);

  return SchemaScalar.Class.fromData(schema, recurse);
}

const dispatch = chain(classifySchema);

export function getComponents() {
  // Embedded literal values (const / enum members / default / examples) are
  // rendered with JsonViewer.Class.fromData, so the json.js leaf components
  // must be registered too — otherwise those nested `<x render=".child">`
  // targets resolve to nothing.
  return [
    SchemaViewer,
    SchemaScalar,
    SchemaObject,
    SchemaArray,
    SchemaEnum,
    SchemaConst,
    SchemaCombinator,
    SchemaConditional,
    SchemaNot,
    SchemaProperty,
    SchemaBranch,
    SchemaBoolean,
    SchemaRef,
    ...getJsonComponents(),
  ];
}
