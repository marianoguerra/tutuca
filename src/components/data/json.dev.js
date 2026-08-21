import { produce } from "tutuca/immer";
import { JsonViewer } from "./json.js";

export { getComponents } from "./json.js";

export function getExamples() {
  const expanded = (value) =>
    produce(value, (draft) => {
      draft.isExpanded = true;
    });
  const longArray = Array.from({ length: 25 }, (_, i) => i + 1);
  const longObject = Object.fromEntries(
    Array.from({ length: 15 }, (_, i) => [`key_${i + 1}`, (i + 1) * 10]),
  );
  const apiResponseShape = {
    id: "user_42",
    active: true,
    score: 99.5,
    tags: ["admin", "early-access", null],
    profile: {
      name: "Alice",
      email: "alice@example.com",
      meta: { joined: "2026-01-15", verified: true },
    },
  };

  const expandedSmallArray = expanded(JsonViewer.fromData([1, "two", true, null]));
  const expandedPaginated = expanded(JsonViewer.fromData(longArray));
  const expandedNested = expanded(JsonViewer.fromData(apiResponseShape));

  const allTypesThreeLevels = {
    name: "demo",
    active: true,
    count: 42,
    ratio: -3.14,
    empty: null,
    tags: ["alpha", "beta", null, true, 7],
    config: {
      enabled: false,
      threshold: 0.5,
      label: "level-2",
      nested: {
        ratio: 1.5,
        label: "level-3",
        flags: [true, false, null],
        notes: "deepest string",
        count: 0,
        empty_arr: [],
        empty_obj: {},
      },
      items: [
        { id: 1, value: "first", active: true },
        { id: 2, value: "second", active: false, child: null },
      ],
    },
  };
  const expandedAllTypes = expanded(JsonViewer.fromData(allTypesThreeLevels));

  return {
    title: "JsonViewer",
    description:
      "Chrome devtools–style display of a JSON value. Wraps a per-type component (JsonNull, JsonBoolean, JsonNumber, JsonString, JsonArray, JsonObject); composites support collapse/expand and pagination (default 10 items per page).",
    items: [
      { title: "null", value: JsonViewer.fromData(null) },
      { title: "true", value: JsonViewer.fromData(true) },
      { title: "false", value: JsonViewer.fromData(false) },
      { title: "integer", value: JsonViewer.fromData(42) },
      { title: "negative integer", value: JsonViewer.fromData(-7) },
      // biome-ignore lint/suspicious/noApproximativeNumericConstant: literal float demonstration, not Math.PI
      { title: "float", value: JsonViewer.fromData(3.14159) },
      { title: "zero", value: JsonViewer.fromData(0) },
      {
        title: "string",
        value: JsonViewer.fromData("hello, world"),
      },
      {
        title: "empty string",
        value: JsonViewer.fromData(""),
      },
      {
        title: "string with quotes",
        value: JsonViewer.fromData('she said "hi"'),
      },
      {
        title: "very long string",
        value: JsonViewer.fromData(
          "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.",
        ),
      },
      {
        title: "empty array",
        value: JsonViewer.fromData([]),
      },
      {
        title: "empty object",
        value: JsonViewer.fromData({}),
      },
      {
        title: "small array (collapsed)",
        value: JsonViewer.fromData([1, "two", true, null]),
      },
      {
        title: "small array (expanded)",
        value: expandedSmallArray,
      },
      {
        title: "nested array",
        value: JsonViewer.fromData([
          [1, 2],
          [3, 4],
        ]),
      },
      {
        title: "small object",
        value: JsonViewer.fromData({
          name: "Alice",
          active: true,
          score: 99.5,
        }),
      },
      {
        title: "API response shape (expanded)",
        value: expandedNested,
      },
      {
        title: "3-level nested, all types (expanded)",
        value: expandedAllTypes,
      },
      {
        title: "paginated array (25 items, expanded)",
        value: expandedPaginated,
      },
      {
        title: "paginated object (15 keys)",
        value: JsonViewer.fromData(longObject),
      },
      {
        title: "function (rendered as null)",
        value: JsonViewer.fromData(function namedFn() {}),
      },
      {
        title: "arrow function (rendered as null)",
        value: JsonViewer.fromData(() => 42),
      },
      {
        title: "symbol (rendered as null)",
        value: JsonViewer.fromData(Symbol("sym")),
      },
      {
        title: "Map (rendered as empty object)",
        value: JsonViewer.fromData(
          new Map([
            ["a", 1],
            ["b", 2],
          ]),
        ),
      },
      {
        title: "Set (rendered as empty object)",
        value: JsonViewer.fromData(new Set([1, 2, 3])),
      },
      {
        title: "object with non-JSON values (expanded)",
        value: expanded(
          JsonViewer.fromData({
            fn: function namedFn() {},
            arrow: () => 1,
            sym: Symbol("x"),
            map: new Map([["k", "v"]]),
            set: new Set([1, 2]),
            ok: "string is fine",
          }),
        ),
      },
    ],
  };
}
