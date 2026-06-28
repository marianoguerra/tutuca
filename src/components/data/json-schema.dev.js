import { JsonViewer } from "./json.js";
import {
  classifySchema,
  SchemaArray,
  SchemaBoolean,
  SchemaBranch,
  SchemaCombinator,
  SchemaConst,
  SchemaEnum,
  SchemaObject,
  SchemaProperty,
  SchemaRef,
  SchemaScalar,
  SchemaViewer,
} from "./json-schema.js";

export { getComponents } from "./json-schema.js";

const SV = SchemaViewer.Class;

// Recursively expand a classified schema tree so an example renders open.
const deepExpand = (c) => {
  if (c == null || typeof c !== "object") return c;
  let n = c;
  if (typeof n.setIsExpanded === "function") {
    n = n.setIsExpanded(true);
  }
  // single-child fields (viewer value + raw, not-child, if/then/else nodes)
  for (const k of ["value", "raw", "child", "ifNode", "thenNode", "elseNode"]) {
    const setter = `set${k[0].toUpperCase()}${k.slice(1)}`;
    if (typeof n[setter] === "function" && n[k] && typeof n[k] === "object") {
      n = n[setter](deepExpand(n[k]));
    }
  }
  if (typeof n.setItems === "function" && n.items?.map) {
    n = n.setItems(
      n.items.map((item) =>
        item && typeof item.setChild === "function"
          ? item.setChild(deepExpand(item.child))
          : deepExpand(item),
      ),
    );
  }
  return n;
};

export function getExamples() {
  // ---- Phase B: 2-level nested aggregations -------------------------------
  const objOfArrayOfObjects = {
    type: "object",
    properties: {
      users: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "integer", minimum: 1 },
            name: { type: "string", minLength: 1 },
          },
          required: ["id", "name"],
        },
      },
    },
    required: ["users"],
  };

  const arrayOfConstrainedObjects = {
    type: "array",
    minItems: 1,
    uniqueItems: true,
    items: {
      type: "object",
      properties: {
        sku: { type: "string", pattern: "^[A-Z]{3}-\\d+$" },
        price: { type: "number", exclusiveMinimum: 0 },
      },
      required: ["sku", "price"],
    },
  };

  const combinatorInCombinator = {
    anyOf: [{ allOf: [{ type: "object" }, { required: ["id"] }] }, { type: "null" }],
  };

  const refToDefs = {
    type: "object",
    properties: {
      home: { $ref: "#/$defs/address" },
      work: { $ref: "#/$defs/address" },
    },
    $defs: {
      address: {
        type: "object",
        properties: {
          street: { type: "string" },
          city: { type: "string" },
        },
        required: ["street", "city"],
      },
    },
  };

  const conditional = {
    type: "object",
    properties: { kind: { type: "string" } },
    if: { properties: { kind: { const: "card" } } },
    // biome-ignore lint/suspicious/noThenProperty: JSON Schema if/then/else keyword
    then: {
      type: "object",
      properties: { cardNumber: { type: "string", pattern: "^\\d{16}$" } },
      required: ["cardNumber"],
    },
    else: {
      type: "object",
      properties: { account: { type: "string" } },
      required: ["account"],
    },
  };

  const enumOfObjects = {
    title: "Preset",
    enum: [
      { name: "small", size: 1 },
      { name: "large", size: 100 },
    ],
  };

  // ---- Phase C: kitchen sink ----------------------------------------------
  const kitchenSink = {
    title: "User",
    description: "A registered user account.",
    type: "object",
    deprecated: false,
    additionalProperties: false,
    minProperties: 2,
    properties: {
      id: { type: "integer", minimum: 1, readOnly: true },
      email: { type: "string", format: "email", maxLength: 254 },
      role: { enum: ["admin", "editor", "viewer"] },
      status: { const: "active" },
      age: {
        type: "integer",
        minimum: 0,
        maximum: 150,
        default: 18,
      },
      tags: {
        type: "array",
        items: { type: "string" },
        uniqueItems: true,
        maxItems: 10,
      },
      score: {
        allOf: [{ type: "number", minimum: 0 }, { multipleOf: 0.5 }],
      },
      contact: {
        anyOf: [
          { type: "string", format: "email" },
          { type: "string", format: "uri" },
        ],
      },
      address: { $ref: "#/$defs/address" },
      metadata: {
        type: "object",
        patternProperties: { "^x-": { type: "string" } },
        propertyNames: { pattern: "^[a-z]" },
      },
      coords: {
        type: "array",
        prefixItems: [{ type: "number" }, { type: "number" }],
        items: false,
      },
    },
    required: ["id", "email"],
    if: { properties: { role: { const: "admin" } } },
    // biome-ignore lint/suspicious/noThenProperty: JSON Schema if/then/else keyword
    then: { required: ["email"] },
    else: { properties: { age: { type: "integer" } } },
    not: { required: ["password"] },
    examples: [{ id: 1, email: "a@b.com" }],
    $defs: {
      address: {
        type: "object",
        properties: {
          street: { type: "string" },
          city: { type: "string" },
        },
        required: ["city"],
      },
    },
  };

  return {
    title: "SchemaViewer",
    description:
      "High-level, human-readable view of a JSON Schema (2020-12, tolerant of draft-07): type labels, constraint badges, required markers, and a collapsible tree of properties / applicators / combinators / conditionals. Embedded literal values (const, enum members, default, examples) are rendered with JsonViewer from json.js. A future option will toggle to the raw schema (the original is retained on the viewer).",
    items: [
      // ---- Phase A: individual constructs ----
      { title: "string", value: SV.fromData({ type: "string" }) },
      { title: "number", value: SV.fromData({ type: "number" }) },
      { title: "integer", value: SV.fromData({ type: "integer" }) },
      { title: "boolean", value: SV.fromData({ type: "boolean" }) },
      { title: "null", value: SV.fromData({ type: "null" }) },
      {
        title: "multi-type (string | null)",
        value: SV.fromData({ type: ["string", "null"] }),
      },
      {
        title: "string with minLength / maxLength",
        value: SV.fromData({ type: "string", minLength: 3, maxLength: 20 }),
      },
      {
        title: "string with pattern",
        value: SV.fromData({ type: "string", pattern: "^[a-z]+$" }),
      },
      {
        title: "string with format (email)",
        value: SV.fromData({ type: "string", format: "email" }),
      },
      {
        title: "string with format (date-time)",
        value: SV.fromData({ type: "string", format: "date-time" }),
      },
      {
        title: "number with minimum / maximum",
        value: SV.fromData({ type: "number", minimum: 0, maximum: 100 }),
      },
      {
        title: "number with exclusive bounds",
        value: SV.fromData({
          type: "number",
          exclusiveMinimum: 0,
          exclusiveMaximum: 1,
        }),
      },
      {
        title: "integer with multipleOf",
        value: SV.fromData({ type: "integer", multipleOf: 5 }),
      },
      {
        title: "object with required (expanded)",
        value: deepExpand(
          SV.fromData({
            type: "object",
            properties: {
              id: { type: "integer" },
              name: { type: "string" },
            },
            required: ["id"],
          }),
        ),
      },
      {
        title: "object, no additional properties (expanded)",
        value: deepExpand(
          SV.fromData({
            type: "object",
            properties: { a: { type: "string" } },
            additionalProperties: false,
          }),
        ),
      },
      {
        title: "object with additionalProperties schema (expanded)",
        value: deepExpand(
          SV.fromData({
            type: "object",
            additionalProperties: { type: "number" },
          }),
        ),
      },
      {
        title: "object with patternProperties (expanded)",
        value: deepExpand(
          SV.fromData({
            type: "object",
            patternProperties: { "^x-": { type: "string" } },
          }),
        ),
      },
      {
        title: "object with propertyNames (expanded)",
        value: deepExpand(
          SV.fromData({
            type: "object",
            propertyNames: { pattern: "^[a-z]+$" },
          }),
        ),
      },
      {
        title: "object with min/maxProperties",
        value: SV.fromData({
          type: "object",
          minProperties: 1,
          maxProperties: 5,
        }),
      },
      {
        title: "array with items (expanded)",
        value: deepExpand(SV.fromData({ type: "array", items: { type: "string" } })),
      },
      {
        title: "tuple via prefixItems (expanded)",
        value: deepExpand(
          SV.fromData({
            type: "array",
            prefixItems: [{ type: "number" }, { type: "string" }],
            items: false,
          }),
        ),
      },
      {
        title: "draft-07 tuple via array items (expanded)",
        value: deepExpand(
          SV.fromData({
            type: "array",
            items: [{ type: "number" }, { type: "boolean" }],
          }),
        ),
      },
      {
        title: "array with min/maxItems + uniqueItems",
        value: SV.fromData({
          type: "array",
          minItems: 1,
          maxItems: 10,
          uniqueItems: true,
        }),
      },
      {
        title: "array with contains (expanded)",
        value: deepExpand(SV.fromData({ type: "array", contains: { type: "integer" } })),
      },
      {
        title: "enum (expanded)",
        value: deepExpand(SV.fromData({ enum: ["red", "green", "blue"] })),
      },
      {
        title: "const (expanded)",
        value: deepExpand(SV.fromData({ const: 42 })),
      },
      {
        title: "default (expanded)",
        value: deepExpand(SV.fromData({ type: "string", default: "anonymous" })),
      },
      {
        title: "examples (expanded)",
        value: deepExpand(SV.fromData({ type: "integer", examples: [1, 2, 3] })),
      },
      {
        title: "allOf (expanded)",
        value: deepExpand(
          SV.fromData({
            allOf: [{ type: "object" }, { required: ["id"] }],
          }),
        ),
      },
      {
        title: "anyOf (expanded)",
        value: deepExpand(
          SV.fromData({
            anyOf: [{ type: "string" }, { type: "number" }],
          }),
        ),
      },
      {
        title: "oneOf (expanded)",
        value: deepExpand(
          SV.fromData({
            oneOf: [
              { type: "string", format: "email" },
              { type: "string", format: "uri" },
            ],
          }),
        ),
      },
      {
        title: "not (expanded)",
        value: deepExpand(SV.fromData({ not: { type: "null" } })),
      },
      {
        title: "if / then / else (expanded)",
        value: deepExpand(
          SV.fromData({
            if: { properties: { kind: { const: "a" } } },
            // biome-ignore lint/suspicious/noThenProperty: JSON Schema if/then/else keyword
            then: { required: ["x"] },
            else: { required: ["y"] },
          }),
        ),
      },
      {
        title: "$ref",
        value: SV.fromData({ $ref: "#/$defs/address" }),
      },
      {
        title: "cyclic $ref is safe (does not loop)",
        value: SV.fromData({ $ref: "#" }),
      },
      {
        title: "draft-07 definitions (expanded)",
        value: deepExpand(
          SV.fromData({
            type: "object",
            properties: { a: { $ref: "#/definitions/x" } },
            definitions: { x: { type: "string" } },
          }),
        ),
      },
      {
        title: "metadata (title / description / deprecated / readOnly)",
        value: SV.fromData({
          type: "string",
          title: "Legacy field",
          description: "No longer used; kept for compatibility.",
          deprecated: true,
          readOnly: true,
        }),
      },
      {
        title: "boolean schema (true = any)",
        value: SV.fromData(true),
      },
      {
        title: "boolean schema (false = none)",
        value: SV.fromData(false),
      },
      { title: "empty schema {}", value: SV.fromData({}) },

      // ---- Phase B: nested aggregations ----
      {
        title: "object → array of objects (expanded)",
        value: deepExpand(SV.fromData(objOfArrayOfObjects)),
      },
      {
        title: "array of constrained objects (expanded)",
        value: deepExpand(SV.fromData(arrayOfConstrainedObjects)),
      },
      {
        title: "anyOf containing allOf (expanded)",
        description:
          "A combinator branch that is itself a combinator — exercises recursion through SchemaBranch.",
        value: deepExpand(SV.fromData(combinatorInCombinator)),
      },
      {
        title: "$ref + $defs (expanded)",
        value: deepExpand(SV.fromData(refToDefs)),
      },
      {
        title: "if/then/else with object branches (expanded)",
        value: deepExpand(SV.fromData(conditional)),
      },
      {
        title: "enum of objects (expanded)",
        description: "Embedded enum members are arbitrary JSON, rendered via JsonViewer.",
        value: deepExpand(SV.fromData(enumOfObjects)),
      },

      // ---- Phase C: kitchen sink ----
      {
        title: "kitchen sink (expanded)",
        description:
          "One object schema exercising every supported construct: metadata, string/numeric/array/nested-object properties, required, additionalProperties:false, patternProperties, propertyNames, prefixItems tuple, allOf/anyOf, if/then/else, not, const/default/examples, $ref, and $defs.",
        value: deepExpand(SV.fromData(kitchenSink)),
      },
      {
        title: "raw schema view (toggled, expanded)",
        description:
          "Same schema with the raw view toggled on — the original JSON Schema rendered with JsonViewer from json.js. Click the button to switch back to the high-level view.",
        value: deepExpand(SV.fromData(kitchenSink).toggleShowRaw()),
      },
    ],
  };
}

export function getTests({ describe, test, expect }) {
  describe(SchemaViewer, () => {
    describe("fromData()", () => {
      test("boolean true schema → SchemaBoolean", () => {
        const v = SchemaViewer.Class.fromData(true);
        expect(v.value).toBeInstanceOf(SchemaBoolean.Class);
        expect(v.value.value).toBe(true);
      });

      test("boolean false schema → SchemaBoolean", () => {
        const v = SchemaViewer.Class.fromData(false);
        expect(v.value).toBeInstanceOf(SchemaBoolean.Class);
        expect(v.value.value).toBe(false);
      });

      test("$ref → SchemaRef (label only, not resolved)", () => {
        const v = SchemaViewer.Class.fromData({ $ref: "#/$defs/x" });
        expect(v.value).toBeInstanceOf(SchemaRef.Class);
        expect(v.value.target).toBe("#/$defs/x");
      });

      test("cyclic $ref does not loop", () => {
        const v = SchemaViewer.Class.fromData({ $ref: "#" });
        expect(v.value).toBeInstanceOf(SchemaRef.Class);
      });

      test("typed object → SchemaObject", () => {
        const v = SchemaViewer.Class.fromData({ type: "object" });
        expect(v.value).toBeInstanceOf(SchemaObject.Class);
        expect(v.value.typeLabel).toBe("object");
      });

      test("empty schema {} → childless SchemaScalar (any)", () => {
        const v = SchemaViewer.Class.fromData({});
        expect(v.value).toBeInstanceOf(SchemaScalar.Class);
        expect(v.value.typeLabel).toBe("any");
        expect(v.value.isItemsEmpty()).toBe(true);
      });

      test("retains the original schema in rawSchema", () => {
        const v = SchemaViewer.Class.fromData({ type: "string" });
        expect(v.rawSchema.type).toBe("string");
      });
    });

    describe("classifySchema()", () => {
      test("required array marks matching property", () => {
        const node = classifySchema({
          type: "object",
          properties: { id: { type: "integer" }, name: { type: "string" } },
          required: ["id"],
        });
        const id = node.items.find((p) => p.key === "id");
        const name = node.items.find((p) => p.key === "name");
        expect(id).toBeInstanceOf(SchemaProperty.Class);
        expect(id.required).toBe(true);
        expect(name.required).toBe(false);
      });

      test("enum → SchemaEnum whose members render via JsonViewer", () => {
        const node = classifySchema({ enum: [1, 2, 3] });
        expect(node).toBeInstanceOf(SchemaEnum.Class);
        expect(node.items.size).toBe(3);
        expect(node.items.first()).toBeInstanceOf(JsonViewer.Class);
      });

      test("const → SchemaConst whose value renders via JsonViewer", () => {
        const node = classifySchema({ const: 42 });
        expect(node).toBeInstanceOf(SchemaConst.Class);
        expect(node.value).toBeInstanceOf(JsonViewer.Class);
      });

      test("string constraints become badges", () => {
        const node = classifySchema({
          type: "string",
          minLength: 3,
          format: "email",
        });
        expect(node).toBeInstanceOf(SchemaScalar.Class);
        expect(node.badges.toArray()).toContain("format: email");
        expect(node.badges.toArray()).toContain("min length: 3");
      });

      test("multi-type joins with ' | '", () => {
        const node = classifySchema({ type: ["string", "null"] });
        expect(node).toBeInstanceOf(SchemaScalar.Class);
        expect(node.typeLabel).toBe("string | null");
      });

      test("combinator phrases its kind and lists members without keys", () => {
        const node = classifySchema({
          anyOf: [{ allOf: [{ type: "object" }] }],
        });
        expect(node).toBeInstanceOf(SchemaCombinator.Class);
        expect(node.typeLabel).toBe("any of");
        const inner = node.items.first();
        expect(inner).toBeInstanceOf(SchemaCombinator.Class);
        expect(inner.typeLabel).toBe("all of");
      });

      test("array of a bare primitive type is inlined", () => {
        const node = classifySchema({
          type: "array",
          items: { type: "string" },
        });
        expect(node).toBeInstanceOf(SchemaArray.Class);
        expect(node.typeLabel).toBe("array of string");
        expect(node.isItemsEmpty()).toBe(true);
      });

      test("array of a complex item keeps an expandable items row", () => {
        const node = classifySchema({
          type: "array",
          items: { type: "object", properties: { a: { type: "string" } } },
        });
        expect(node.typeLabel).toBe("array");
        expect(node.items.find((b) => b.label === "items")).toBeTruthy();
      });

      test("draft-07 definitions are surfaced like $defs", () => {
        const node = classifySchema({
          type: "object",
          definitions: { x: { type: "string" } },
        });
        const branch = node.items.find((b) => b.label === "$defs/x");
        expect(branch).toBeInstanceOf(SchemaBranch.Class);
        expect(branch.child).toBeInstanceOf(SchemaScalar.Class);
      });
    });
  });
}
