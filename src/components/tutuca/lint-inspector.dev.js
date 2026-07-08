import { LintComponent, LintFinding, LintReport, lintMessage } from "./lint-inspector.js";

export { getComponents } from "./lint-inspector.js";

// Real findings copied verbatim from `tutuca lint --json` on a module with a
// handful of deliberate mistakes (one error/warn/hint of each common kind).
const lintReport = {
  components: [
    { componentName: "Good", findings: [] },
    {
      componentName: "Broken",
      findings: [
        {
          id: "INPUT_HANDLER_METHOD_NOT_IMPLEMENTED",
          level: "error",
          info: { name: "missingMethod", eventName: "click", originAttr: "@on.click" },
          context: { componentName: "Broken", viewName: "main" },
          suggestion: null,
        },
        {
          id: "FIELD_VAL_NOT_DEFINED",
          level: "error",
          info: { tag: "SPAN", originAttr: "@text", val: { name: "nope" }, name: "nope" },
          context: { componentName: "Broken", viewName: "main" },
          suggestion: null,
        },
        {
          id: "REDUNDANT_TEMPLATE_STRING",
          level: "warn",
          info: { tag: "I", originAttr: ":class", simpler: ".title" },
          context: { componentName: "Broken", viewName: "main" },
          suggestion: { kind: "rewrite", from: "$'{.title}'", to: ".title" },
        },
        {
          id: "PLACEHOLDERLESS_TEMPLATE_STRING",
          level: "hint",
          info: { tag: "B", originAttr: ":class", literal: "'btn'" },
          context: { componentName: "Broken", viewName: "main" },
          suggestion: { kind: "rewrite", from: "$'btn'", to: "'btn'" },
        },
        {
          id: "CONSTANT_CONDITION",
          level: "warn",
          info: { tag: "DIV", originAttr: "@show", literal: "'open'" },
          context: { componentName: "Broken", viewName: "main" },
          suggestion: null,
        },
        {
          id: "FIELD_VAL_IS_METHOD",
          level: "error",
          info: { tag: "EM", originAttr: "@text", val: { name: "label" }, name: "label" },
          context: { componentName: "Broken", viewName: "main" },
          suggestion: { kind: "rewrite", from: ".label", to: "$label" },
        },
      ],
    },
  ],
};

const cleanReport = {
  components: [
    { componentName: "Good", findings: [] },
    { componentName: "AlsoGood", findings: [] },
  ],
};

export function getExamples() {
  return {
    title: "LintReport",
    description:
      "LintReport renders `tutuca lint --json`: a neutral title with soft severity tallies over per-component groups. Each finding shows a soft level badge, a human-readable message (mirroring the CLI's own wording), an optional fix suggestion, and the full id/info/context via ImInspector. Colour is reserved for severity; structure stays neutral. Clean components are omitted; a fully clean run shows a soft 'clean' badge.",
    items: [
      {
        title: "Module with findings (error component auto-expanded)",
        value: LintReport.Class.fromData(lintReport, { title: "broken.js" }),
      },
      {
        title: "Clean module",
        value: LintReport.Class.fromData(cleanReport, { title: "good.js" }),
      },
    ],
  };
}

export function getTests({ describe, test, expect }) {
  describe(LintReport, () => {
    test("lintMessage renders prose with an origin suffix", () => {
      expect(
        lintMessage("FIELD_VAL_NOT_DEFINED", {
          name: "nope",
          originAttr: "@text",
          tag: "SPAN",
        }),
      ).toBe("Field '.nope' is not defined (in @text, on <span>)");
    });

    test("lintMessage humanizes unknown rule ids as a fallback", () => {
      expect(lintMessage("SOME_NEW_RULE", {})).toBe("Some new rule");
    });

    test("aggregates totals and omits clean components", () => {
      const r = LintReport.Class.fromData(lintReport);
      expect(r.errors).toBe(3);
      expect(r.warnings).toBe(2);
      expect(r.hints).toBe(1);
      expect(r.clean).toBe(false);
      expect(r.components.size).toBe(1); // Good (no findings) omitted
    });

    test("clean report flags clean and has no component groups", () => {
      const r = LintReport.Class.fromData(cleanReport);
      expect(r.clean).toBe(true);
      expect(r.components.size).toBe(0);
    });
  });

  describe(LintComponent, () => {
    test("counts findings by level and expands on error", () => {
      const broken = LintReport.Class.fromData(lintReport).components.first();
      expect(broken).toBeInstanceOf(LintComponent.Class);
      expect(broken.componentName).toBe("Broken");
      expect(broken.countText()).toBe("3 errors, 2 warnings, 1 hint");
      expect(broken.isExpanded).toBe(true);
      expect(broken.items.size).toBe(6);
    });
  });

  describe(LintFinding, () => {
    test("error finding: level, human message, soft badge class", () => {
      const f = LintReport.Class.fromData(lintReport).components.first().items.first();
      expect(f).toBeInstanceOf(LintFinding.Class);
      expect(f.level).toBe("error");
      expect(f.message).toBe("Method '$missingMethod' is not implemented in @on.click");
      expect(f.levelBadgeClass()).toContain("badge-soft");
      expect(f.levelBadgeClass()).toContain("badge-error");
    });

    test("warn finding surfaces the fix suggestion", () => {
      const items = LintReport.Class.fromData(lintReport).components.first().items;
      const warn = items.get(2);
      expect(warn.level).toBe("warn");
      expect(warn.message).toContain("Redundant template string");
      expect(warn.suggestion).toBe("$'{.title}' → .title");
      expect(warn.levelBadgeClass()).toContain("badge-warning");
    });
  });
}
