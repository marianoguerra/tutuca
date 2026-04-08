import { getComponentsDocs } from "./docs.js";

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
    .tab-panel {
      flex: 1;
      overflow: auto;
      padding: 0.5rem;
      display: none;
    }
    .tab-panel.active {
      display: block;
    }
    .api-docs h3 { margin: 0.75rem 0 0.25rem; font-size: 1.1rem; }
    .api-docs h4 { margin: 0.5rem 0 0.15rem; font-size: 0.95rem; }
    .api-docs ul { margin: 0.15rem 0 0.5rem 1.25rem; padding: 0; }
    .api-docs li { margin: 0.1rem 0; font-size: 0.85rem; }
    .api-docs code { font-size: 0.85em; background: var(--b2, #1e2530); padding: 0.1em 0.3em; border-radius: 3px; }
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
        </div>
        <div class="tab-panel active" data-panel="preview"></div>
        <div class="tab-panel api-docs" data-panel="api-docs"></div>
      </div>
    `;

    this.editor = this.shadowRoot.querySelector("code-mirror");
    this.preview = this.shadowRoot.querySelector('[data-panel="preview"]');
    this.apiDocsPanel = this.shadowRoot.querySelector('[data-panel="api-docs"]');

    this.shadowRoot.querySelector(".tab-bar").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-tab]");
      if (!btn) return;
      for (const b of this.shadowRoot.querySelectorAll(".tab-bar button")) {
        b.classList.toggle("active", b === btn);
      }
      for (const p of this.shadowRoot.querySelectorAll(".tab-panel")) {
        p.classList.toggle("active", p.dataset.panel === btn.dataset.tab);
      }
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
      const { tutuca, compileClassesToStyleText } = await import(this._resolveSpecifier("tutuca"));
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
      const styleText = await compileClassesToStyleText(app, compile, extraCSSClasses);
      const margauiSheet = new CSSStyleSheet();
      margauiSheet.replaceSync(styleText);
      this._adoptStyles(margauiSheet);
      app.start({ head: this.shadowRoot });
      app.dispatchLogicAtRoot("init", []);

      const docs = getComponentsDocs(components);
      this.apiDocsPanel.replaceChildren(this._docsToDOM(docs));
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
}
