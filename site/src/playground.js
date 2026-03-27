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
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      overflow: auto;
    }
    .editor code-mirror {
      width: 100%;
      flex: 1;
      min-height: 400px;
      border: 1px solid var(--b3, #2a323c);
      border-radius: 0.5rem;
      overflow: auto;
    }
    .editor kbd {
      font-size: 0.75em;
      opacity: 0.6;
    }
    .preview {
      flex: 1;
      padding: 1rem;
      overflow: auto;
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
    this.shadowRoot.adoptedStyleSheets = [
      layout,
      ...TutucaPlayground.styles,
      ...extra,
    ];
  }

  async connectedCallback() {
    this._adoptStyles();

    this.shadowRoot.innerHTML = `
      <div class="editor">
        <code-mirror lang="javascript"></code-mirror>
      </div>
      <div class="preview"></div>
    `;

    this.editor = this.shadowRoot.querySelector("code-mirror");
    this.preview = this.shadowRoot.querySelector(".preview");

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

  resolveImports(code) {
    const importMapEl = document.querySelector('script[type="importmap"]');
    if (!importMapEl) return code;
    const { imports } = JSON.parse(importMapEl.textContent);
    if (!imports) return code;
    for (const [specifier, url] of Object.entries(imports)) {
      const resolved = new URL(url, location.href).href;
      const re = new RegExp(`(from\\s+)["']${specifier}["']`, "g");
      code = code.replace(re, `$1"${resolved}"`);
    }
    return code;
  }

  async run() {
    if (this._blobUrl) URL.revokeObjectURL(this._blobUrl);

    this.preview.innerHTML = "";
    const appRoot = document.createElement("div");
    this.preview.appendChild(appRoot);

    const code = this.resolveImports(this.editor.code);
    const blob = new Blob([code], { type: "text/javascript" });
    this._blobUrl = URL.createObjectURL(blob);

    try {
      const mod = await import(this._blobUrl);
      const { tutuca, compileClassesToStyleText } = await import("tutuca");
      const { compile } = await import("margaui");

      const app = tutuca(appRoot);
      const scope = app.registerComponents(mod.getComponents());
      if (mod.getMacros) {
        scope.registerMacros(mod.getMacros());
      }
      app.state.set(mod.getRoot());
      const styleText = await compileClassesToStyleText(app, compile);
      const margauiSheet = new CSSStyleSheet();
      margauiSheet.replaceSync(styleText);
      this._adoptStyles(margauiSheet);
      app.start();
    } catch (e) {
      this.preview.textContent = `Error: ${e.message}`;
      console.error(e);
    }
  }
}
