export class ModuleInfo {
  constructor({ path = null, present = new Set(), counts = {}, warnings = [] }) {
    this.path = path;
    this.present = present;
    this.counts = counts;
    this.warnings = warnings;
  }
}

export class ComponentSummary {
  constructor({ name, views, fields }) {
    this.name = name;
    this.views = views;
    this.fields = fields;
  }
}

export class ComponentList {
  constructor({ items, total = null, truncated = false }) {
    this.items = items;
    this.total = total ?? items.length;
    this.truncated = truncated;
  }
}

export class ExampleIndex {
  constructor({ sections, total = null, truncated = false }) {
    this.sections = sections;
    this.total = total ?? sections.reduce((n, s) => n + (s.items?.length ?? 0), 0);
    this.truncated = truncated;
  }
}

export class ComponentDocs {
  constructor({ items }) {
    this.items = items;
  }
}

export class LintFinding {
  constructor({ id, level, info, context = {}, suggestion = null }) {
    this.id = id;
    this.level = level;
    this.info = info;
    this.context = context;
    this.suggestion = suggestion;
  }
}

export class LintComponentResult {
  constructor({ componentName, findings }) {
    this.componentName = componentName;
    this.findings = findings;
  }
  get errorCount() {
    return this.findings.filter((f) => f.level === "error").length;
  }
  get warnCount() {
    return this.findings.filter((f) => f.level === "warn").length;
  }
}

export class LintReport {
  constructor({ components }) {
    this.components = components;
  }
  get hasErrors() {
    return this.components.some((c) => c.errorCount > 0);
  }
  get totalErrors() {
    return this.components.reduce((n, c) => n + c.errorCount, 0);
  }
  get totalWarnings() {
    return this.components.reduce((n, c) => n + c.warnCount, 0);
  }
}

export class RenderedExample {
  constructor({ title, description = null, componentName, view, html, error = null }) {
    this.title = title;
    this.description = description;
    this.componentName = componentName;
    this.view = view;
    this.html = html;
    this.error = error;
  }
}

export class RenderedSection {
  constructor({ title, description = null, items }) {
    this.title = title;
    this.description = description;
    this.items = items;
  }
}

export class RenderBatch {
  constructor({ sections }) {
    this.sections = sections;
  }
  get hasErrors() {
    return this.sections.some((s) => s.items.some((i) => i.error !== null));
  }
}

export class TestResult {
  constructor({ title, fullPath, componentName = null, status, durationMs = 0, error = null }) {
    this.title = title;
    this.fullPath = fullPath;
    this.componentName = componentName;
    this.status = status;
    this.durationMs = durationMs;
    this.error = error;
  }
}

export class DescribeResult {
  constructor({ title, componentName = null, children = [] }) {
    this.title = title;
    this.componentName = componentName;
    this.children = children;
  }
}

export class ModuleTestReport {
  constructor({ path = null, suites = [], counts = { pass: 0, fail: 0, skip: 0, total: 0 } }) {
    this.path = path;
    this.suites = suites;
    this.counts = counts;
  }
}

export class TestReport {
  constructor({ modules = [] }) {
    this.modules = modules;
  }
  get totals() {
    return this.modules.reduce(
      (acc, m) => ({
        pass: acc.pass + m.counts.pass,
        fail: acc.fail + m.counts.fail,
        skip: acc.skip + m.counts.skip,
        total: acc.total + m.counts.total,
      }),
      { pass: 0, fail: 0, skip: 0, total: 0 },
    );
  }
  get hasFailures() {
    return this.modules.some((m) => m.counts.fail > 0);
  }
}
