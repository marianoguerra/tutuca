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
    .api-docs h3 { margin: 0.75rem 0 0.25rem; font-size: 1.1rem; }
    .api-docs h4 { margin: 0.5rem 0 0.15rem; font-size: 0.95rem; }
    .api-docs ul { margin: 0.15rem 0 0.5rem 1.25rem; padding: 0; }
    .api-docs li { margin: 0.1rem 0; font-size: 0.85rem; }
    .api-docs code { font-size: 0.85em; background: #e8eaf0; color: #212121; padding: 0.1em 0.3em; border-radius: 3px; }
    .lint-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 1.1em;
      height: 1.1em;
      border-radius: 50%;
      font-size: 0.7em;
      line-height: 1;
      padding: 0.1em;
      background: var(--b3, #2a323c);
      color: inherit;
      margin-left: 0.3em;
    }
    .lint-badge.has-issues {
      background: var(--error-color, #e53935);
      color: #fff;
    }
    .lint-results h4 { margin: 0.75rem 0 0.25rem; font-size: 1rem; }
    .lint-results ul { margin: 0.15rem 0 0.5rem 1.25rem; padding: 0; }
    .lint-results li { margin: 0.2rem 0; font-size: 0.85rem; }
    .lint-results .level-error { color: var(--error-color, #e53935); }
    .lint-results .level-warn { color: var(--warn-color, #f9a825); }
    .lint-results .level-hint { color: var(--hint-color, #888); }
    .lint-results code { font-size: 0.85em; background: #e8eaf0; color: #212121; padding: 0.1em 0.3em; border-radius: 3px; }
    @media (prefers-color-scheme: dark) {
      .api-docs code, .lint-results code { background: #1e2530; color: #dcdcdc; }
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
        <code-mirror lang="javascript"></code-mirror>
      </div>
      <div class="preview-container">
        <div class="tab-bar">
          <button class="active" data-tab="preview">Preview</button>
          <button data-tab="api-docs">API Docs</button>
          <button data-tab="lint">Lint <span class="lint-badge">0</span></button>
          <button class="eject-btn" title="Eject to folder">&#x23CF;&#xFE0F;</button>
        </div>
        <div class="tab-panel active" data-panel="preview"></div>
        <div class="undo-slider" data-panel="undo"></div>
        <div class="tab-panel api-docs" data-panel="api-docs"></div>
        <div class="tab-panel lint-results" data-panel="lint"></div>
      </div>
    `;

    this.editor = this.shadowRoot.querySelector("code-mirror");
    this.preview = this.shadowRoot.querySelector('[data-panel="preview"]');
    this.apiDocsPanel = this.shadowRoot.querySelector('[data-panel="api-docs"]');
    this.lintPanel = this.shadowRoot.querySelector('[data-panel="lint"]');
    this.lintBadge = this.shadowRoot.querySelector(".lint-badge");

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
    btn.disabled = true;
    try {
      const tutucaUrl = this._resolveSpecifier("tutuca");
      const margauiUrl = this._resolveSpecifier("margaui");
      const src = this.getAttribute("src") || "./src/counter.js";
      const exampleName = src.split("/").pop().replace(/\.js$/, "");
      const folder = `tutuca-${exampleName}`;
      const { zipSync, strToU8 } = await import("https://esm.sh/fflate");
      const zipped = zipSync({
        [folder]: {
          "index.html": strToU8(EJECT_INDEX_HTML(tutucaUrl, margauiUrl)),
          "README.md": strToU8(EJECT_README_MD),
          "src/app.js": strToU8(EJECT_APP_JS),
          "src/components.js": strToU8(this.editor.code),
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
    }
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

    const code = await this.resolveImports(this.editor.code);
    const blob = new Blob([code], { type: "text/javascript" });
    this._blobUrl = URL.createObjectURL(blob);

    try {
      const mod = await import(this._blobUrl);
      const {
        tutuca,
        compileClassesToStyleText,
        checkComponent,
        LintClassCollectorCtx,
        lintIdToMessage,
        getComponentsDocs,
      } = await import(this._resolveSpecifier("tutuca"));
      const { compile } = await import(this._resolveSpecifier("margaui"));

      const app = tutuca(appRoot);
      const components = mod.getComponents();
      const scope = app.registerComponents(components);
      if (mod.getMacros) {
        scope.registerMacros(mod.getMacros());
      }
      if (mod.getRequestHandlers) {
        scope.registerRequestHandlers(mod.getRequestHandlers());
      }
      let extraCSSClasses = new Set();
      if (mod.getExtraCSSClasses) {
        extraCSSClasses = new Set(mod.getExtraCSSClasses());
      }
      app.state.set(mod.getRoot());
      const styleText = await compileClassesToStyleText(
        app,
        compile,
        extraCSSClasses,
        LintClassCollectorCtx,
      );
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
            reports: [{ id: "LINT_ERROR", info: { message: e.message }, level: "error" }],
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

      app.dispatchLogicAtRoot("init", []);

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
  const extraCSSClasses = new Set(mod.getExtraCSSClasses?.() ?? []);
  const styleText = await compileClassesToStyleText(app, compile, extraCSSClasses);
  const style = document.createElement("style");
  style.textContent = styleText;
  document.head.appendChild(style);
  app.state.set(mod.getRoot());
  app.start();
  app.dispatchLogicAtRoot("init", []);
}

main();
`;

const EJECT_README_MD = `# Ejected Tutuca App

This folder is a Tutuca app ejected from the playground. No build step —
open \`index.html\` through a static server.

## Structure

- \`index.html\` — entry point. Links the margaui theme stylesheet
  (light + dark variables), declares an importmap that points
  \`tutuca\` and \`margaui\` at their esm.sh URLs, and loads
  \`src/app.js\` as a module.
- \`src/app.js\` — bootstraps the app: creates the tutuca root, registers
  the components exported by \`src/components.js\`, compiles margaui
  classes into a \`<style>\`, and starts the app.
- \`src/components.js\` — your component source. Edit this to change the
  app. It imports \`tutuca\` and \`margaui\` by bare specifier; those
  resolve through the importmap in \`index.html\`.

## Running

Serve the folder with any static server, e.g.:

    python3 -m http.server 8000

Then open http://localhost:8000/ in a browser. Opening \`index.html\`
directly via \`file://\` will not work because the importmap needs an
http(s) origin.

## Notes

- \`tutuca\` and \`margaui\` are loaded from esm.sh at runtime — the app
  therefore needs network access the first time each module is
  requested (the browser then caches them).
- To pin versions, edit the URLs in the importmap inside \`index.html\`.
- To go fully offline, download the modules, place them alongside the
  app, and update the importmap to point at the local paths.
`;

