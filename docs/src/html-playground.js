import { TutucaPlayground } from "./playground.js";

export class HtmlPlayground extends HTMLElement {
  static styles = [];

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    const layout = new CSSStyleSheet();
    layout.replaceSync(TutucaPlayground.layoutSheet);

    const iframeSheet = new CSSStyleSheet();
    iframeSheet.replaceSync(`
      .preview iframe {
        width: 100%;
        height: 100%;
        border: none;
        border-radius: 0.5rem;
        background: white;
      }
    `);

    this.shadowRoot.adoptedStyleSheets = [
      layout,
      ...HtmlPlayground.styles,
      iframeSheet,
    ];

    this.shadowRoot.innerHTML = `
      <div class="editor">
        <code-mirror lang="html"></code-mirror>
      </div>
      <div class="preview">
        <iframe sandbox="allow-scripts"></iframe>
      </div>
    `;

    this.editor = this.shadowRoot.querySelector("code-mirror");
    this.iframe = this.shadowRoot.querySelector("iframe");

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
    const src = this.getAttribute("src");
    if (!src) return;
    const resp = await fetch(src);
    this.editor.code = await resp.text();
    this.run();
  }

  run() {
    this.iframe.srcdoc = this.editor.code;
  }
}
