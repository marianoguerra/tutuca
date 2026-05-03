import { ValueHistory } from "./undo.js";

export class TutucaPlayground extends HTMLElement {
  static styles = [];
  static layoutSheet = `
    :host {
      display: flex;
      gap: 1rem;
      width: 100%;
      max-height: var(--playground-max-height, 80vh);
      overflow: hidden;
    }
    .editor {
      font-size: initial;
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      overflow: auto;
      border: 1px solid var(--b3, #2a323c);
      border-radius: 0.5rem;
      position: relative;
    }
    .editor code-mirror {
      width: 100%;
      flex: 1;
      min-height: 400px;
      overflow: auto;
    }
    .editor kbd {
      font-size: 0.75em;
      opacity: 0.6;
    }
    .collapse-btn {
      position: absolute;
      top: 0.25rem;
      right: 1.25rem;
      z-index: 1;
      width: 1.5rem;
      height: 1.5rem;
      padding: 0;
      border: 1px solid var(--b3, #2a323c);
      border-radius: 0.25rem;
      background: var(--bg-content-100, #aaaaaa);
      color: #212121;
      cursor: pointer;
      font-size: 0.85rem;
      line-height: 1;
    }
    .editor.collapsed {
      flex: 0 0 auto;
      width: 2rem;
      min-height: 2rem;
    }
    .editor.collapsed code-mirror {
      display: none;
    }
    .editor.collapsed .collapse-btn {
      right: 0.25rem;
    }
    .preview-container {
      flex: 1;
      display: flex;
      flex-direction: column;
      border: 1px solid var(--b3, #2a323c);
      border-radius: 0.5rem;
      overflow: hidden;
    }
    .tab-bar {
      display: flex;
      border-bottom: 1px solid var(--b3, #2a323c);
    }
    .tab-bar button {
      flex: 1;
      padding: 0.4rem 0.75rem;
      border: none;
      background: transparent;
      cursor: pointer;
      font-size: 0.85rem;
      color: inherit;
      opacity: 0.6;
    }
    .tab-bar button.active {
      opacity: 1;
      border-bottom: 2px solid currentColor;
    }
    .tab-bar .eject-btn {
      flex: 0 0 auto;
      margin-left: auto;
    }
    .tab-panel {
      flex: 1;
      overflow: auto;
      padding: 0.5rem;
      display: none;
    }
    .tab-panel.active {
      display: block;
    }
    .undo-slider {
      display: none;
      width: 100%;
      padding: 0.25rem 0.5rem;
      box-sizing: border-box;
    }
    .api-docs h3 {
      margin: 0.75rem 0 0.25rem;
      font-size: 1.1rem;
    }
    .api-docs h4 {
      margin: 0.5rem 0 0.15rem;
      font-size: 0.95rem;
    }
    .api-docs ul {
      margin: 0.15rem 0 0.5rem 1.25rem;
      padding: 0;
    }
    .api-docs li {
      margin: 0.1rem 0;
      font-size: 0.85rem;
    }
    .api-docs code {
      font-size: 0.85em;
      background: #e8eaf0;
      color: #212121;
      padding: 0.1em 0.3em;
      border-radius: 3px;
    }
    .lint-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      font-size: 0.8em;
      font-weight: bold;
      line-height: 1;
      padding: 0.5em;
      background: var(--b3, #2a323c);
      color: inherit;
      margin-left: 0.3em;
    }
    .lint-badge.has-issues {
      background: var(--error-color, #e53935);
      color: #fff;
    }
    .lint-badge[hidden] {
      display: none;
    }
    .lint-results h4 {
      margin: 0.75rem 0 0.25rem;
      font-size: 1rem;
    }
    .lint-results ul {
      margin: 0.15rem 0 0.5rem 1.25rem;
      padding: 0;
    }
    .lint-results li {
      margin: 0.2rem 0;
      font-size: 0.85rem;
    }
    .lint-results .level-error {
      color: var(--error-color, #e53935);
    }
    .lint-results .level-warn {
      color: var(--warn-color, #f9a825);
    }
    .lint-results .level-hint {
      color: var(--hint-color, #888);
    }
    .lint-results code {
      font-size: 0.85em;
      background: #e8eaf0;
      color: #212121;
      padding: 0.1em 0.3em;
      border-radius: 3px;
    }
    .test-results .test-toolbar {
      display: flex;
      gap: 0.5rem;
      align-items: center;
      margin-bottom: 0.5rem;
    }
    .test-results .run-tests-btn {
      padding: 0.4rem 0.75rem;
      font-size: 0.85rem;
      cursor: pointer;
      border: 1px solid var(--b3, #2a323c);
      border-radius: 0.25rem;
      background: var(--bg-content-100, #aaaaaa);
      color: #212121;
    }
    .test-results .run-tests-btn:disabled {
      opacity: 0.5;
      cursor: wait;
    }
    .test-results .test-suite {
      margin: 0.5rem 0;
      padding-left: 0.75rem;
      border-left: 2px solid var(--b3, #2a323c);
    }
    .test-results h4 {
      margin: 0.5rem 0 0.25rem;
      font-size: 0.95rem;
    }
    .test-results ul {
      margin: 0.15rem 0 0.5rem 0;
      padding: 0;
      list-style: none;
    }
    .test-results li {
      margin: 0.2rem 0;
      font-size: 0.85rem;
    }
    .test-results .status-pass {
      color: var(--success-color, #2e7d32);
    }
    .test-results .status-fail {
      color: var(--error-color, #e53935);
      font-weight: bold;
    }
    .test-results .status-skip {
      color: var(--hint-color, #888);
    }
    .test-results .test-error {
      font-family: monospace;
      font-size: 0.8em;
      background: #fdecea;
      color: #b71c1c;
      padding: 0.4rem 0.5rem;
      border-radius: 3px;
      margin: 0.25rem 0 0.5rem 1rem;
      white-space: pre-wrap;
    }
    .test-results .test-summary {
      margin-top: 0.75rem;
      padding-top: 0.5rem;
      border-top: 1px solid var(--b3, #2a323c);
      font-weight: bold;
    }
    .test-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      font-size: 0.8em;
      font-weight: bold;
      line-height: 1;
      padding: 0.5em;
      background: var(--b3, #2a323c);
      color: inherit;
      margin-left: 0.3em;
    }
    .test-badge.has-failures {
      background: var(--error-color, #e53935);
      color: #fff;
    }
    .test-badge[hidden] {
      display: none;
    }
    @media (prefers-color-scheme: dark) {
      .api-docs code,
      .lint-results code {
        background: #1e2530;
        color: #dcdcdc;
      }
      .test-results .test-error {
        background: #3a1414;
        color: #ff8a80;
      }
    }
    @media (max-width: 768px) {
      :host {
        flex-direction: column;
        max-height: none;
      }
      .editor {
        height: 40vh;
        flex: none;
      }
      .editor code-mirror {
        min-height: 0;
      }
      .editor.collapsed {
        height: 2rem;
        width: auto;
        min-height: 2rem;
      }
      .preview-container {
        height: 40vh;
        flex: none;
      }
    }
  `;

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._blobUrl = null;
  }

  _adoptStyles(...extra) {
    const layout = new CSSStyleSheet();
    layout.replaceSync(TutucaPlayground.layoutSheet);
    this.shadowRoot.adoptedStyleSheets = [layout, ...TutucaPlayground.styles, ...extra];
  }

  async connectedCallback() {
    this._adoptStyles();

    this.shadowRoot.innerHTML = `
      <div class="editor">
        <button class="collapse-btn" title="Collapse code">&#x2039;</button>
        <code-mirror lang="javascript"></code-mirror>
      </div>
      <div class="preview-container">
        <div class="tab-bar">
          <button class="active" data-tab="preview">Preview</button>
          <button data-tab="api-docs">API Docs</button>
          <button data-tab="lint">Lint <span class="lint-badge" hidden>0</span></button>
          <button data-tab="test">Test <span class="test-badge" hidden>0</span></button>
          <button class="eject-btn" title="Eject to folder">&#x23CF;&#xFE0F;</button>
        </div>
        <div class="tab-panel active" data-panel="preview"></div>
        <div class="undo-slider" data-panel="undo"></div>
        <div class="tab-panel api-docs" data-panel="api-docs"></div>
        <div class="tab-panel lint-results" data-panel="lint"></div>
        <div class="tab-panel test-results" data-panel="test">
          <div class="test-toolbar">
            <button class="run-tests-btn">Run Tests</button>
          </div>
          <div class="test-results-content"></div>
        </div>
      </div>
    `;

    this.editor = this.shadowRoot.querySelector("code-mirror");
    this.preview = this.shadowRoot.querySelector('[data-panel="preview"]');
    this.apiDocsPanel = this.shadowRoot.querySelector('[data-panel="api-docs"]');
    this.lintPanel = this.shadowRoot.querySelector('[data-panel="lint"]');
    this.lintBadge = this.shadowRoot.querySelector(".lint-badge");
    this.testPanel = this.shadowRoot.querySelector('[data-panel="test"]');
    this.testResultsContent = this.shadowRoot.querySelector(".test-results-content");
    this.testBadge = this.shadowRoot.querySelector(".test-badge");
    this.runTestsBtn = this.shadowRoot.querySelector(".run-tests-btn");
    this.runTestsBtn.addEventListener("click", () => this._runTests());

    this.shadowRoot.querySelector(".tab-bar").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-tab]");
      if (!btn) return;
      for (const b of this.shadowRoot.querySelectorAll(".tab-bar button[data-tab]")) {
        b.classList.toggle("active", b === btn);
      }
      for (const p of this.shadowRoot.querySelectorAll(".tab-panel")) {
        p.classList.toggle("active", p.dataset.panel === btn.dataset.tab);
      }
    });

    this.shadowRoot.querySelector(".eject-btn").addEventListener("click", () => this._eject());

    const editorEl = this.shadowRoot.querySelector(".editor");
    const collapseBtn = this.shadowRoot.querySelector(".collapse-btn");
    collapseBtn.addEventListener("click", () => {
      const collapsed = editorEl.classList.toggle("collapsed");
      collapseBtn.innerHTML = collapsed ? "&#x203A;" : "&#x2039;";
      collapseBtn.title = collapsed ? "Expand code" : "Collapse code";
    });

    this.editor.addEventListener("code-editor-update", (e) => {
      this.editor._code = e.detail.code;
    });
    this.editor.addEventListener("code-editor-save", () => this.run());
    this.shadowRoot.addEventListener(
      "keydown",
      (e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          this.run();
        }
      },
      true,
    );

    this.loadDefaultContent();
  }

  async loadDefaultContent() {
    const src = this.getAttribute("src") || "./src/counter.js";
    const resp = await fetch(src);
    this.editor.code = await resp.text();
    this.run();
  }

  async _eject() {
    const btn = this.shadowRoot.querySelector(".eject-btn");
    const originalHTML = btn.innerHTML;
    const originalTitle = btn.title;
    btn.disabled = true;
    btn.textContent = "⏳ Ejecting…";
    btn.title = "Ejecting…";
    try {
      const tutucaUrl = this._resolveSpecifier("tutuca");
      const margauiUrl = this._resolveSpecifier("margaui");
      const src = this.getAttribute("src") || "./src/counter.js";
      const exampleName = src.split("/").pop().replace(/\.js$/, "");
      const folder = `tutuca-${exampleName}`;
      const { zipSync, strToU8 } = await import("https://cdn.jsdelivr.net/npm/fflate/+esm");
      const skills = await this._fetchSkillBundle();
      const zipped = zipSync({
        [folder]: {
          "index.html": strToU8(EJECT_INDEX_HTML(tutucaUrl, margauiUrl)),
          "README.md": strToU8(EJECT_README_MD),
          "package.json": strToU8(EJECT_PACKAGE_JSON(folder)),
          "src/app.js": strToU8(EJECT_APP_JS),
          "src/components.js": strToU8(this.editor.code),
          ...skills,
        },
      });

      const blob = new Blob([zipped], { type: "application/zip" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${folder}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      alert(`Eject failed: ${e.message}`);
    } finally {
      btn.disabled = false;
      btn.innerHTML = originalHTML;
      btn.title = originalTitle;
    }
  }

  async _fetchSkillBundle() {
    const { version } = await fetch("https://data.jsdelivr.com/v1/package/resolve/npm/tutuca").then(
      (r) => r.json(),
    );
    const base = `https://cdn.jsdelivr.net/npm/tutuca@${version}`;
    const idx = await fetch(`https://data.jsdelivr.com/v1/package/npm/tutuca@${version}/flat`).then(
      (r) => r.json(),
    );
    const entries = idx.files.filter((f) => f.name.startsWith("/skill/"));
    const out = {};
    await Promise.all(
      entries.map(async (f) => {
        const buf = await fetch(base + f.name).then((r) => r.arrayBuffer());
        const rel = f.name.replace(/^\/skill\//, ".claude/skills/");
        out[rel] = new Uint8Array(buf);
      }),
    );
    return out;
  }

  _getImportMap() {
    const importMapEl = document.querySelector('script[type="importmap"]');
    if (!importMapEl) return {};
    const { imports } = JSON.parse(importMapEl.textContent);
    return imports || {};
  }

  _resolveSpecifier(specifier) {
    const imports = this._getImportMap();
    const url = imports[specifier];
    if (!url) return specifier;
    return new URL(url, location.href).href;
  }

  _resolveBareImports(code) {
    const imports = this._getImportMap();
    for (const [specifier, url] of Object.entries(imports)) {
      const resolved = new URL(url, location.href).href;
      const re = new RegExp(`(from\\s+)["']${specifier}["']`, "g");
      code = code.replace(re, `$1"${resolved}"`);
    }
    return code;
  }

  async _resolveRelativeImports(code, baseUrl, cache = new Map()) {
    const matches = [...code.matchAll(/from\s+["'](\.\.?\/[^"']+)["']/g)];
    for (const match of matches) {
      const relPath = match[1];
      const resolvedUrl = new URL(relPath, baseUrl).href;

      if (!cache.has(resolvedUrl)) {
        const resp = await fetch(resolvedUrl);
        let depCode = await resp.text();
        depCode = this._resolveBareImports(depCode);
        depCode = await this._resolveRelativeImports(depCode, resolvedUrl, cache);
        const blob = new Blob([depCode], { type: "text/javascript" });
        cache.set(resolvedUrl, URL.createObjectURL(blob));
      }

      const escaped = relPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      code = code.replace(
        new RegExp(`(from\\s+)["']${escaped}["']`, "g"),
        `$1"${cache.get(resolvedUrl)}"`,
      );
    }
    return code;
  }

  async resolveImports(code) {
    const srcUrl = new URL(this.getAttribute("src"), location.href);
    const cache = new Map();
    code = this._resolveBareImports(code);
    code = await this._resolveRelativeImports(code, srcUrl, cache);
    this._depBlobUrls = [...cache.values()];
    return code;
  }

  async run() {
    if (this._blobUrl) URL.revokeObjectURL(this._blobUrl);
    if (this._depBlobUrls) this._depBlobUrls.forEach(URL.revokeObjectURL);

    this.preview.innerHTML = "";
    const appRoot = document.createElement("div");
    this.preview.appendChild(appRoot);

    this._currentModule = null;
    this.testResultsContent.replaceChildren();
    this.testBadge.hidden = true;
    this.testBadge.classList.remove("has-failures");

    const code = await this.resolveImports(this.editor.code);
    const blob = new Blob([code], { type: "text/javascript" });
    this._blobUrl = URL.createObjectURL(blob);

    try {
      const mod = await import(this._blobUrl);
      const tutucaApi = await import(this._resolveSpecifier("tutuca"));
      const {
        tutuca,
        compileClassesToStyleText,
        checkComponent,
        LintClassCollectorCtx,
        lintIdToMessage,
        getComponentsDocs,
      } = tutucaApi;
      const { compile } = await import(this._resolveSpecifier("margaui"));

      const app = tutuca(appRoot);
      const components = mod.getComponents();
      this._currentModule = { mod, components, tutucaApi, path: this.getAttribute("src") };
      const scope = app.registerComponents(components);
      if (mod.getMacros) {
        scope.registerMacros(mod.getMacros());
      }
      if (mod.getRequestHandlers) {
        scope.registerRequestHandlers(mod.getRequestHandlers());
      }
      app.state.set(mod.getRoot());
      const styleText = await compileClassesToStyleText(app, compile, LintClassCollectorCtx);
      const margauiSheet = new CSSStyleSheet();
      margauiSheet.replaceSync(styleText);
      this._adoptStyles(margauiSheet);

      const lintResults = [];
      for (const comp of components) {
        try {
          const lx = checkComponent(comp);
          if (lx.reports.length > 0) {
            lintResults.push({ name: comp.name, reports: lx.reports });
          }
        } catch (e) {
          lintResults.push({
            name: comp.name,
            reports: [
              {
                id: "LINT_ERROR",
                info: { message: e.message },
                level: "error",
              },
            ],
          });
        }
      }
      this._renderLintResults(lintResults, lintIdToMessage);

      const docs = getComponentsDocs(components);
      this.apiDocsPanel.replaceChildren(this._docsToDOM(docs));

      app.start({ head: this.shadowRoot });

      const undoContainer = this.shadowRoot.querySelector('[data-panel="undo"]');
      undoContainer.innerHTML = "";
      const undo = new ValueHistory(1000);
      const slider = undo.mountSlider(undoContainer, ({ index, entry }) => {
        app.state.set(entry.val, { isUndo: true, index });
        slider.value = index;
      });
      slider.style.width = "100%";

      app.sendAtRoot("init", []);

      let changes = 0;
      app.state.onChange((info) => {
        console.log("transaction", info);
        changes += 1;
        if (!info.info?.isUndo) {
          undo.onChange(info);
          if (changes > 1) {
            undoContainer.style.display = "block";
          }
          slider.max = undo.size - 1;
          slider.value = undo.size - 1;
        }
      });
    } catch (e) {
      this.preview.textContent = `Error: ${e.message}`;
      console.error(e);
    }
  }

  async _runTests() {
    if (!this._currentModule) {
      this.testResultsContent.textContent = "Run the module first (Ctrl+Enter).";
      return;
    }
    const { mod, components, tutucaApi, path } = this._currentModule;
    if (typeof tutucaApi.test !== "function") {
      this.testResultsContent.textContent = "tutuca/test is not available in the loaded build.";
      return;
    }
    this.runTestsBtn.disabled = true;
    this.runTestsBtn.textContent = "Running…";
    this.testResultsContent.textContent = "";
    try {
      const report = await tutucaApi.test({
        getTests: mod.getTests,
        components,
        path,
      });
      this._renderTestReport(report);
    } catch (e) {
      console.error(e);
      this.testResultsContent.textContent = `Test runner crashed: ${e.message}`;
    } finally {
      this.runTestsBtn.disabled = false;
      this.runTestsBtn.textContent = "Run Tests";
    }
  }

  _renderTestReport(report) {
    const frag = document.createDocumentFragment();
    let totalsAccum = { pass: 0, fail: 0, skip: 0, total: 0 };
    for (const m of report.modules) {
      if (m.suites.length === 0) {
        const p = document.createElement("p");
        p.className = "status-skip";
        p.textContent = "(no tests)";
        frag.appendChild(p);
      } else {
        for (const s of m.suites) frag.appendChild(this._testNodeToDOM(s));
      }
      const c = m.counts;
      totalsAccum = {
        pass: totalsAccum.pass + c.pass,
        fail: totalsAccum.fail + c.fail,
        skip: totalsAccum.skip + c.skip,
        total: totalsAccum.total + c.total,
      };
      const summary = document.createElement("div");
      summary.className = "test-summary";
      const cls = c.fail > 0 ? "status-fail" : c.total === 0 ? "status-skip" : "status-pass";
      summary.classList.add(cls);
      summary.textContent = `${c.pass} passed, ${c.fail} failed, ${c.skip} skipped (${c.total} total)`;
      frag.appendChild(summary);
    }
    this.testResultsContent.replaceChildren(frag);

    if (totalsAccum.total === 0) {
      this.testBadge.hidden = true;
      this.testBadge.classList.remove("has-failures");
    } else {
      this.testBadge.hidden = false;
      this.testBadge.textContent =
        totalsAccum.fail > 0 ? `${totalsAccum.fail}` : `${totalsAccum.total}`;
      this.testBadge.classList.toggle("has-failures", totalsAccum.fail > 0);
    }
  }

  _testNodeToDOM(node) {
    if (node.children) {
      const wrap = document.createElement("div");
      wrap.className = "test-suite";
      const heading = document.createElement("h4");
      heading.textContent = node.componentName
        ? `${node.title} [${node.componentName}]`
        : node.title;
      wrap.appendChild(heading);
      const ul = document.createElement("ul");
      for (const child of node.children) {
        const li = document.createElement("li");
        const childDOM = this._testNodeToDOM(child);
        li.appendChild(childDOM);
        ul.appendChild(li);
      }
      wrap.appendChild(ul);
      return wrap;
    }

    const wrap = document.createElement("div");
    const line = document.createElement("span");
    line.className = `status-${node.status}`;
    const mark = node.status === "pass" ? "✓" : node.status === "fail" ? "✗" : "○";
    const dur = node.status === "skip" ? " (skipped)" : ` (${Math.round(node.durationMs)}ms)`;
    line.textContent = `${mark} ${node.title}${dur}`;
    wrap.appendChild(line);

    if (node.status === "fail" && node.error) {
      const pre = document.createElement("pre");
      pre.className = "test-error";
      const parts = [node.error.message ?? "(no message)"];
      if ("expected" in node.error || "actual" in node.error) {
        parts.push(`expected: ${JSON.stringify(node.error.expected)}`);
        parts.push(`actual:   ${JSON.stringify(node.error.actual)}`);
      }
      pre.textContent = parts.join("\n");
      wrap.appendChild(pre);
    }
    return wrap;
  }

  _docsToDOM(docs) {
    const frag = document.createDocumentFragment();

    for (const comp of docs) {
      const h3 = document.createElement("h3");
      h3.textContent = comp.name;
      frag.appendChild(h3);

      if (comp.methods.length > 0) {
        const h4 = document.createElement("h4");
        h4.textContent = "Methods";
        frag.appendChild(h4);
        frag.appendChild(this._sigList(comp.methods));
      }

      if (comp.input.length > 0) {
        const h4 = document.createElement("h4");
        h4.textContent = "Input Handlers";
        frag.appendChild(h4);
        frag.appendChild(this._sigList(comp.input));
      }

      for (const field of comp.fields) {
        const h4 = document.createElement("h4");
        h4.innerHTML = `Field: <code>${field.name}</code> (${field.type}, default: <code>${JSON.stringify(field.default)}</code>)`;
        frag.appendChild(h4);

        const ul = document.createElement("ul");
        for (const m of field.methods) {
          const li = document.createElement("li");
          const code = document.createElement("code");
          code.textContent = m.sig;
          li.appendChild(code);
          li.append(` — ${m.desc}`);
          ul.appendChild(li);
        }
        frag.appendChild(ul);
      }
    }

    return frag;
  }

  _sigList(items) {
    const ul = document.createElement("ul");
    for (const item of items) {
      const li = document.createElement("li");
      const code = document.createElement("code");
      code.textContent = item.sig;
      li.appendChild(code);
      ul.appendChild(li);
    }
    return ul;
  }

  _renderLintResults(results, lintIdToMessage) {
    const total = results.reduce((s, r) => s + r.reports.length, 0);
    this.lintBadge.textContent = total;
    this.lintBadge.classList.toggle("has-issues", total > 0);
    this.lintBadge.hidden = total === 0;

    const frag = document.createDocumentFragment();
    for (const { name, reports } of results) {
      const h4 = document.createElement("h4");
      h4.textContent = name;
      frag.appendChild(h4);

      const ul = document.createElement("ul");
      for (const report of reports) {
        const li = document.createElement("li");
        li.className = `level-${report.level}`;
        const code = document.createElement("code");
        code.textContent = report.level;
        li.appendChild(code);
        li.append(` ${lintIdToMessage(report.id, report.info)}`);
        ul.appendChild(li);
      }
      frag.appendChild(ul);
    }
    this.lintPanel.replaceChildren(frag);
  }
}

const EJECT_INDEX_HTML = (tutucaUrl, margauiUrl) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Tutuca App</title>
    <link
      rel="stylesheet"
      href="https://marianoguerra.github.io/margaui/themes/theme.css"
    />
    <script type="importmap">
      {
        "imports": {
          "tutuca": "${tutucaUrl}",
          "margaui": "${margauiUrl}"
        }
      }
    </script>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="./src/app.js"></script>
  </body>
</html>
`;

const EJECT_APP_JS = `import { compile } from "margaui";
import { compileClassesToStyleText, tutuca } from "tutuca";
import * as mod from "./components.js";

function detectTheme() {
  const setTheme = (t) => document.documentElement.setAttribute("data-theme", t);
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  setTheme(mq.matches ? "dark" : "light");
  mq.addEventListener("change", (e) => setTheme(e.matches ? "dark" : "light"));
}

async function main() {
  detectTheme();
  const app = tutuca("#app");
  const components = mod.getComponents();
  const scope = app.registerComponents(components);
  if (mod.getMacros) scope.registerMacros(mod.getMacros());
  if (mod.getRequestHandlers) scope.registerRequestHandlers(mod.getRequestHandlers());
  const styleText = await compileClassesToStyleText(app, compile);
  const style = document.createElement("style");
  style.textContent = styleText;
  document.head.appendChild(style);
  app.state.set(mod.getRoot());
  app.start();
  app.sendAtRoot("init", []);
}

main();
`;

const EJECT_README_MD = `# Ejected Tutuca App

This folder is a Tutuca app ejected from the playground. No build step —
open \`index.html\` through a static server.

## Structure

- \`index.html\` — entry point. Links the margaui theme stylesheet
  (light + dark variables), declares an importmap that points
  \`tutuca\` and \`margaui\` at their jsDelivr URLs, and loads
  \`src/app.js\` as a module.
- \`src/app.js\` — bootstraps the app: creates the tutuca root, registers
  the components exported by \`src/components.js\`, compiles margaui
  classes into a \`<style>\`, and starts the app.
- \`src/components.js\` — your component source. Edit this to change the
  app. It imports \`tutuca\` and \`margaui\` by bare specifier; those
  resolve through the importmap in \`index.html\`.
- \`package.json\` — declares \`tutuca\` + \`margaui\` as devDependencies
  so the \`tutuca\` CLI can resolve those bare imports when run from
  Node. Also wires \`npm run lint\` / \`npm run render\` shortcuts.
- \`.claude/skills/\` — bundled Claude Code skills (\`tutuca\`,
  \`margaui\`, \`immutable-js\`). Auto-discovered when this folder is
  opened in Claude Code.

## Running

Serve the folder with any static server, e.g.:

    python3 -m http.server 8000

Then open http://localhost:8000/ in a browser. Opening \`index.html\`
directly via \`file://\` will not work because the importmap needs an
http(s) origin.

## Running the Tutuca CLI

The \`tutuca\` CLI runs the post-edit verification recipe (lint +
render an example) against \`src/components.js\`. Install once, then:

    npm install
    npm run lint
    npm run render -- --title "<example title>"

\`npm run lint\` exits \`2\` on error-level findings; \`npm run render\`
exits \`3\` on a render crash. For the full reference (other commands,
flags like \`--view\`, \`-f html --pretty -o out.html\`, etc.), run:

    npx tutuca help

## Claude Code skills

\`.claude/skills/\` contains the \`tutuca\`, \`margaui\`, and
\`immutable-js\` skill assets. When you open this folder in Claude
Code, those skills are picked up automatically and the assistant can
reference them. To refresh them later from the installed CLI:

    npm run install-skills

## Notes

- \`tutuca\` and \`margaui\` are loaded from jsDelivr at runtime — the
  app therefore needs network access the first time each module is
  requested (the browser then caches them).
- To pin versions, edit the URLs in the importmap inside \`index.html\`
  (and the matching \`devDependencies\` in \`package.json\`).
- To go fully offline, download the modules, place them alongside the
  app, and update the importmap to point at the local paths.
`;

const EJECT_PACKAGE_JSON = (name) =>
  `${JSON.stringify(
    {
      name,
      private: true,
      type: "module",
      scripts: {
        lint: "tutuca ./src/components.js lint",
        render: "tutuca ./src/components.js render",
        "install-skills": "tutuca install-skill --all --force",
      },
      devDependencies: { tutuca: "latest", margaui: "latest" },
    },
    null,
    2,
  )}\n`;
