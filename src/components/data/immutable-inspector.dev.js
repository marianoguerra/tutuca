import { IMap, ISet, List, OMap, OrderedSet, Range, Record, Stack } from "tutuca";
import { ImInspector } from "./immutable-inspector.js";

export { getComponents } from "./immutable-inspector.js";

export function getExamples() {
  const II = ImInspector.Class;

  const longList = List(Array.from({ length: 25 }, (_, i) => i + 1));
  const personMap = IMap({ name: "Alice", age: 30, active: true });
  const orderedMap = OMap([
    ["first", 1],
    ["second", 2],
    ["third", 3],
  ]);
  const tagSet = ISet(["admin", "early-access", "beta"]);
  const orderedTags = OrderedSet(["a", "b", "c", "a"]);
  const stackTrace = Stack(["frame3", "frame2", "frame1"]);
  const Person = Record({ name: "", age: 0, email: "" }, "Person");
  const alice = Person({ name: "Alice", age: 30 });
  const range10 = Range(0, 10);
  const mixed = IMap({
    users: List([
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" },
    ]),
    count: 2,
    active: ISet(["admin"]),
  });
  const nested = List([IMap({ a: 1 }), IMap({ a: 2 })]);
  const deepMixed = List([
    {
      label: "first",
      stats: IMap({ score: 99, active: true, name: "Alice" }),
    },
    {
      label: "second",
      stats: IMap({ score: 42, active: false, name: "Bob" }),
    },
  ]);

  const deepExpand = (c) => {
    if (c == null || typeof c !== "object") return c;
    let n = c;
    if (typeof n.setIsExpanded === "function") {
      n = n.setIsExpanded(true);
    }
    if (typeof n.setValue === "function" && n.value && typeof n.value === "object") {
      return n.setValue(deepExpand(n.value));
    }
    if (typeof n.setItems === "function" && n.items?.map) {
      return n.setItems(
        n.items.map((item) =>
          item && typeof item.setChild === "function"
            ? item.setChild(deepExpand(item.child))
            : item,
        ),
      );
    }
    return n;
  };

  const expandedList = II.fromData(longList).toggleIsExpanded();
  const expandedMap = II.fromData(personMap).toggleIsExpanded();
  const expandedRecord = II.fromData(alice).toggleIsExpanded();
  const expandedMixed = II.fromData(mixed).toggleIsExpanded();
  const expandedNested = II.fromData(nested).toggleIsExpanded();
  const expandedDeepMixed = deepExpand(II.fromData(deepMixed));

  return {
    title: "ImmutableInspector",
    description:
      "Chrome devtools-style display for Immutable.js values. Detects List, Stack, Map, OrderedMap, Set, OrderedSet, Record, and Range; falls back to JsonViewer's per-type components for plain JS values. Composites support collapse/expand and pagination (10 items per page).",
    items: [
      { title: "null", value: II.fromData(null) },
      { title: "true", value: II.fromData(true) },
      { title: "integer", value: II.fromData(42) },
      { title: "string", value: II.fromData("hello, world") },
      { title: "plain array", value: II.fromData([1, 2, 3]) },
      {
        title: "plain object",
        value: II.fromData({ a: 1, b: 2 }),
      },
      { title: "empty List", value: II.fromData(List()) },
      {
        title: "List of primitives",
        value: II.fromData(List([1, "two", true, null])),
      },
      {
        title: "List 25 (expanded, paginated)",
        value: expandedList,
      },
      { title: "Stack", value: II.fromData(stackTrace) },
      { title: "small Map", value: II.fromData(personMap) },
      { title: "Map (expanded)", value: expandedMap },
      { title: "OrderedMap", value: II.fromData(orderedMap) },
      { title: "Set", value: II.fromData(tagSet) },
      {
        title: "OrderedSet (with dup removed)",
        value: II.fromData(orderedTags),
      },
      {
        title: "Record (Person, expanded)",
        value: expandedRecord,
      },
      { title: "Range 0…10", value: II.fromData(range10) },
      {
        title: "mixed Immutable + JSON (expanded)",
        value: expandedMixed,
      },
      {
        title: "nested Immutable in Immutable (expanded)",
        value: expandedNested,
      },
      {
        title: "List → JS object → IMap → JS scalars (deeply expanded)",
        description:
          "Demonstrates the full dispatch chain: an Immutable List whose items are plain JS objects, each containing an Immutable Map of plain JS scalars.",
        value: expandedDeepMixed,
      },
    ],
  };
}
