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
  constructor({ items }) {
    this.items = items;
  }
}

export class ExampleIndex {
  constructor({ section }) {
    this.section = section;
  }
}

export class ComponentDocs {
  constructor({ items }) {
    this.items = items;
  }
}

export class LintFinding {
  constructor({ id, level, info }) {
    this.id = id;
    this.level = level;
    this.info = info;
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
  constructor({ groupTitle = null, title, description = null, componentName, view, html, error = null }) {
    this.groupTitle = groupTitle;
    this.title = title;
    this.description = description;
    this.componentName = componentName;
    this.view = view;
    this.html = html;
    this.error = error;
  }
}

export class RenderBatch {
  constructor({ section, items }) {
    this.section = section;
    this.items = items;
  }
  get hasErrors() {
    return this.items.some((i) => i.error !== null);
  }
}

export class DoctorReport {
  constructor({ lint, renders }) {
    this.lint = lint;
    this.renders = renders;
  }
  get ok() {
    return !this.lint.hasErrors && !this.renders.hasErrors;
  }
}
