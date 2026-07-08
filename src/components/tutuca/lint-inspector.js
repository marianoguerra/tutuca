import { component, html } from "tutuca";
import { getComponents as getImComponents, ImInspector } from "../data/immutable-inspector.js";
import {
  compositeAlter,
  compositeFields,
  compositeMethods,
  makeCompositeView,
} from "../data/json.js";

// --- human-readable messages -------------------------------------------------
// The --json envelope carries only the rule id + info, not the prose. These
// mirror the CLI's own `lintIdToMessage` (tutuca-cli.js) for the common rules,
// with a humanized-id fallback for the rest, so a finding reads as a sentence
// instead of a CONSTANT_CASE id.

const tagDisplay = (tag) => (tag ? String(tag).toLowerCase() : "");

function originSuffix(info) {
  if (!info) return "";
  const parts = [];
  if (info.originAttr) {
    const branch = info.branch ? `[${info.branch}]` : "";
    parts.push(`in ${info.originAttr}${branch}`);
  }
  if (info.handlerName) {
    parts.push(
      `handler '${info.handlerName}'${info.argIndex !== undefined ? ` arg ${info.argIndex}` : ""}`,
    );
  }
  const t = tagDisplay(info.tag);
  if (t && t !== "x") parts.push(`on <${t}>`);
  return parts.length ? ` (${parts.join(", ")})` : "";
}

function tagSuffix(info) {
  const t = tagDisplay(info?.tag);
  return t && t !== "x" ? ` on <${t}>` : "";
}

function eventSuffix(info) {
  if (info?.originAttr) return ` in ${info.originAttr}`;
  if (info?.eventName) return ` in @on.${info.eventName}`;
  return "";
}

function humanizeId(id) {
  if (!id) return "Lint finding";
  const s = id.toLowerCase().replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function lintMessage(id, info = {}) {
  switch (id) {
    case "FIELD_VAL_NOT_DEFINED":
      return `Field '.${info.name}' is not defined${originSuffix(info)}`;
    case "FIELD_VAL_IS_METHOD":
      return `'.${info.name}' reads a field, but '${info.name}' is a method — use '$${info.name}'${originSuffix(info)}`;
    case "METHOD_VAL_NOT_DEFINED":
      return `Method '$${info.name}' is not defined${originSuffix(info)}`;
    case "METHOD_VAL_IS_FIELD":
      return `'$${info.name}' calls a method, but '${info.name}' is a field — use '.${info.name}'${originSuffix(info)}`;
    case "INPUT_HANDLER_NOT_IMPLEMENTED":
      return `Input handler '${info.name}' is not implemented${eventSuffix(info)}`;
    case "INPUT_HANDLER_METHOD_NOT_IMPLEMENTED":
      return `Method '$${info.name}' is not implemented${eventSuffix(info)}`;
    case "INPUT_HANDLER_NOT_REFERENCED":
      return `Input handler '${info.name}' is defined but never used`;
    case "ALT_HANDLER_NOT_DEFINED":
      return `Alter handler '${info.name}' is not defined${originSuffix(info)}`;
    case "DYN_VAL_NOT_DEFINED":
      return `Dynamic variable '*${info.name}' is not defined${originSuffix(info)}`;
    case "UNKNOWN_COMPONENT_NAME":
      return `Unknown component '${info.name}'${originSuffix(info)}`;
    case "UNKNOWN_DIRECTIVE":
      return `Unknown directive '@${info.name}'${tagSuffix(info)}`;
    case "IF_NO_BRANCH_SET":
      return `'@if.${info.attr}' has no '@then' or '@else' branch${tagSuffix(info)}`;
    case "REDUNDANT_TEMPLATE_STRING":
      return `Redundant template string — '{${info.simpler}}' should be just '${info.simpler}'${originSuffix(info)}`;
    case "PLACEHOLDERLESS_TEMPLATE_STRING":
      return `Template string has no dynamic parts — use the literal ${info.literal} instead${originSuffix(info)}`;
    case "CONSTANT_CONDITION":
      return `Constant condition ${info.literal} — reference a field ('.name') or method ('$name')${originSuffix(info)}`;
    case "ASYNC_HANDLER":
      return `Handler '${info.name}' in '${info.channel}' is async — handlers must be synchronous`;
    case "UNKNOWN_COMPONENT_SPEC_KEY":
      return `Unknown component spec key '${info.key}' — ignored at runtime`;
    default:
      return `${humanizeId(id)}${originSuffix(info)}`;
  }
}

// Turn a lint suggestion ({kind, from, to} or {kind, text}) into a short line.
function suggestionText(s) {
  if (!s) return "";
  if (s.to != null) return `${s.from ?? ""} → ${s.to}`;
  return s.text ?? s.kind ?? "";
}

// --- components --------------------------------------------------------------
// Colour is reserved for severity (the level badge + the header tallies);
// everything structural stays neutral so the eye goes to what matters.

const componentView = makeCompositeView({
  typeClass: "font-semibold",
  borderClass: "border-base-content/15",
});

// One finding: a soft severity badge, a human-readable message, an optional fix
// suggestion, and the full id/info/context via ImInspector (collapsed).
export const LintFinding = component({
  name: "LintFinding",
  fields: { id: "", level: "", message: "", suggestion: "", detail: null },
  methods: {
    levelBadgeClass() {
      const base = "badge badge-sm badge-soft";
      switch (this.level) {
        case "error":
          return `${base} badge-error`;
        case "warn":
          return `${base} badge-warning`;
        default:
          return `${base} badge-neutral`;
      }
    },
    hasSuggestion() {
      return this.suggestion !== "";
    },
    hasDetail() {
      return this.detail != null;
    },
  },
  // Decoy so the runtime-built soft badge colours survive the class scan.
  views: {
    _palette: html`<span
      class="badge-soft badge-error badge-warning badge-neutral"
    ></span>`,
  },
  view: html`<div class="flex flex-col gap-1.5 py-1.5 leading-snug">
    <div class="flex items-baseline gap-2 flex-wrap">
      <span :class="$levelBadgeClass" @text=".level"></span>
      <span class="text-sm text-base-content/90" @text=".message"></span>
    </div>
    <div
      @show="$hasSuggestion"
      class="ml-3 flex items-baseline gap-1.5 text-xs text-base-content/60"
    >
      <span>fix</span>
      <span class="font-mono" @text=".suggestion"></span>
    </div>
    <div @show="$hasDetail" class="ml-3"><x render=".detail"></x></div>
  </div>`,
});

function buildFinding(f) {
  const info = f.info ?? {};
  const ctx = f.context ?? {};
  return LintFinding.make({
    id: f.id ?? "",
    level: f.level ?? "",
    message: lintMessage(f.id, info),
    suggestion: suggestionText(f.suggestion),
    detail: ImInspector.Class.fromData({ id: f.id, info, context: ctx }),
  });
}

// Per-component group of findings, collapsible/paginated; neutral framing,
// expanded by default when it has error-level findings.
export const LintComponent = component({
  name: "LintComponent",
  fields: { ...compositeFields, componentName: "", errors: 0, warns: 0, hints: 0 },
  methods: {
    ...compositeMethods,
    typeText() {
      return this.componentName;
    },
    countText() {
      const parts = [];
      if (this.errors) parts.push(`${this.errors} error${this.errors === 1 ? "" : "s"}`);
      if (this.warns) parts.push(`${this.warns} warning${this.warns === 1 ? "" : "s"}`);
      if (this.hints) parts.push(`${this.hints} hint${this.hints === 1 ? "" : "s"}`);
      return parts.length ? parts.join(", ") : "ok";
    },
  },
  alter: compositeAlter,
  view: componentView,
});

// Top-level lint report: a neutral title + soft severity tallies, over the
// per-component groups (clean components are omitted).
export const LintReport = component({
  name: "LintReport",
  fields: {
    title: "",
    path: "",
    errors: 0,
    warnings: 0,
    hints: 0,
    clean: true,
    components: [],
  },
  methods: {
    errText() {
      return `${this.errors} error${this.errors === 1 ? "" : "s"}`;
    },
    warnText() {
      return `${this.warnings} warning${this.warnings === 1 ? "" : "s"}`;
    },
    hintText() {
      return `${this.hints} hint${this.hints === 1 ? "" : "s"}`;
    },
    hasErrors() {
      return this.errors > 0;
    },
    hasWarnings() {
      return this.warnings > 0;
    },
    hasHints() {
      return this.hints > 0;
    },
  },
  statics: {
    fromData(report, { title = "Lint", path = "" } = {}) {
      const comps = report?.components ?? [];
      let errors = 0;
      let warnings = 0;
      let hints = 0;
      const built = [];
      for (const c of comps) {
        const findings = c.findings ?? [];
        if (findings.length === 0) continue;
        const e = findings.filter((f) => f.level === "error").length;
        const w = findings.filter((f) => f.level === "warn").length;
        const h = findings.filter((f) => f.level === "hint").length;
        errors += e;
        warnings += w;
        hints += h;
        built.push(
          LintComponent.make({
            componentName: c.componentName,
            errors: e,
            warns: w,
            hints: h,
            items: findings.map(buildFinding),
            isExpanded: e > 0,
          }),
        );
      }
      return this.make({
        title,
        path,
        errors,
        warnings,
        hints,
        clean: built.length === 0,
        components: built,
      });
    },
  },
  // Decoy so the runtime-absent soft tally colours are emitted.
  views: {
    _palette: html`<span
      class="badge-soft badge-error badge-warning badge-neutral badge-success"
    ></span>`,
  },
  view: html`<div class="font-mono text-sm leading-snug flex flex-col gap-3">
    <div class="flex items-center gap-2 flex-wrap">
      <span class="font-semibold" @text=".title"></span>
      <span class="text-base-content/40 text-xs" @text=".path"></span>
      <span
        @show="$hasErrors"
        class="badge badge-sm badge-soft badge-error"
        @text="$errText"
      ></span>
      <span
        @show="$hasWarnings"
        class="badge badge-sm badge-soft badge-warning"
        @text="$warnText"
      ></span>
      <span
        @show="$hasHints"
        class="badge badge-sm badge-soft badge-neutral"
        @text="$hintText"
      ></span>
      <span
        @show=".clean"
        class="badge badge-sm badge-soft badge-success"
        >✓ clean</span
      >
    </div>
    <x render-each=".components"></x>
  </div>`,
});

export function getComponents() {
  return [LintReport, LintComponent, LintFinding, ...getImComponents()];
}
