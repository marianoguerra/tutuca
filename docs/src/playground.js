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
          <button data-tab="component" hidden>Component</button>
          <button data-tab="instance" hidden>Instance</button>
          <button data-tab="lint" hidden>Lint</button>
          <button data-tab="test" hidden>Test</button>
          <button data-tab="activity" hidden>Activity</button>
          <button class="eject-btn" title="Eject to folder">&#x23CF;&#xFE0F;</button>
        </div>
        <div class="tab-panel active" data-panel="preview"></div>
        <div class="undo-slider" data-panel="undo"></div>
        <div class="tab-panel" data-panel="component"></div>
        <div class="tab-panel" data-panel="instance"></div>
        <div class="tab-panel" data-panel="lint"></div>
        <div class="tab-panel" data-panel="test"></div>
        <div class="tab-panel" data-panel="activity"></div>
      </div>
    `;

    this.editor = this.shadowRoot.querySelector("code-mirror");
    this.preview = this.shadowRoot.querySelector('[data-panel="preview"]');
    // Inspector tabs (Component/Instance/Lint/Test) render tutuca/components
    // inspector view instances built by buildInspectorViews — same as the storybook.
    this._inspectorTabs = ["component", "instance", "lint", "test", "activity"];
    this._inspectorApp = null;
    this._inspectorRoot = null;
    this._inspectorViews = null;
    // Per-tab live state, so expansions survive switching tabs (one app, root swapped).
    this._liveViews = {};
    this._activeInspector = null;

    this.shadowRoot.querySelector(".tab-bar").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-tab]");
      if (!btn) return;
      this._activateTab(btn.dataset.tab);
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

  _activateTab(name) {
    for (const b of this.shadowRoot.querySelectorAll(".tab-bar button[data-tab]")) {
      b.classList.toggle("active", b.dataset.tab === name);
    }
    for (const p of this.shadowRoot.querySelectorAll(".tab-panel")) {
      p.classList.toggle("active", p.dataset.panel === name);
    }
    if (this._inspectorTabs.includes(name)) this._showInspector(name);
    this._syncUndoVisibility();
  }

  // The history slider belongs to the live preview only — show it on the Preview
  // tab once there's history, hide it on every inspector tab.
  _syncUndoVisibility() {
    if (!this._undoContainer) return;
    const onPreview =
      this.shadowRoot.querySelector(".tab-bar button.active")?.dataset.tab === "preview";
    this._undoContainer.style.display = this._undoActive && onPreview ? "block" : "none";
  }

  // Reveal the inspector tab buttons whose view is available, hide the rest.
  _updateInspectorTabs(views) {
    const has = {
      component: views.hasComponent,
      instance: views.hasInspect,
      lint: views.hasLint,
      test: views.hasTest,
      // Activity is always available: it fills as you interact with the preview.
      activity: true,
    };
    for (const name of this._inspectorTabs) {
      const btn = this.shadowRoot.querySelector(`.tab-bar button[data-tab="${name}"]`);
      if (btn) btn.hidden = !has[name];
    }
    // If the previously-active inspector tab is gone, fall back to Preview.
    const active = this.shadowRoot.querySelector(".tab-bar button.active");
    if (active?.hidden) this._activateTab("preview");
    else if (active && this._inspectorTabs.includes(active.dataset.tab)) {
      this._showInspector(active.dataset.tab);
    }
  }

  // Render an inspector view instance in its panel via a single persistent tutuca
  // app whose root is swapped per tab (the playground's own tab shell). Each tab's
  // live state is snapshotted on the way out and restored on the way back in, so
  // expansions survive switching tabs.
  _showInspector(name) {
    // The instance view tracks live preview state: rebuild it from the current
    // root on each show (and drop any stale cached expand state for it).
    if (name === "instance" && this._rebuildInstanceView && this._inspectorViews) {
      this._inspectorViews.instanceView = this._rebuildInstanceView();
      delete this._liveViews.instance;
    }
    // Activity grows live as you interact; always show the latest accumulated log
    // (drop any stale per-tab snapshot with expand state).
    if (name === "activity" && this._activityLog && this._inspectorViews) {
      this._inspectorViews.activityView = this._activityLog;
      delete this._liveViews.activity;
    }
    // tab name (e.g. "component") → view key ("componentView")
    const pristine = this._inspectorViews?.[`${name}View`];
    if (!pristine) return;
    // Persist the outgoing tab's current (possibly-expanded) state.
    if (this._activeInspector && this._activeInspector !== name && this._inspectorApp) {
      this._liveViews[this._activeInspector] = this._inspectorApp.state.val;
    }
    const view = this._liveViews[name] ?? pristine;
    if (!this._inspectorApp) {
      this._inspectorRoot = document.createElement("div");
      const app = this._tutuca(this._inspectorRoot);
      app.registerComponents(this._inspectorComponents);
      app.state.set(view);
      app.start({ head: this.shadowRoot });
      app.sendAtRoot("init", []);
      this._inspectorApp = app;
    } else {
      this._inspectorApp.state.set(view);
    }
    this._activeInspector = name;
    this.shadowRoot.querySelector(`[data-panel="${name}"]`).replaceChildren(this._inspectorRoot);
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
    // Tear down the previous inspector app + views (and per-tab live state).
    this._inspectorApp?.stop();
    this._inspectorApp = null;
    this._inspectorRoot = null;
    this._inspectorViews = null;
    this._liveViews = {};
    this._activeInspector = null;
    this._rebuildInstanceView = null;
    // Stop the previous activity subscription and reset its log.
    this._activitySub?.();
    this._activitySub = null;
    this._activityLog = null;
    this._undoActive = false;
    this._syncUndoVisibility();
    for (const name of this._inspectorTabs) {
      this.shadowRoot.querySelector(`[data-panel="${name}"]`)?.replaceChildren();
    }

    const code = await this.resolveImports(this.editor.code);
    const blob = new Blob([code], { type: "text/javascript" });
    this._blobUrl = URL.createObjectURL(blob);

    try {
      const mod = await import(this._blobUrl);
      const tutucaApi = await import(this._resolveSpecifier("tutuca"));
      const { tutuca, compileClassesToStyleText, LintClassCollectorCtx } = tutucaApi;
      const { compile } = await import(this._resolveSpecifier("margaui"));
      // The inspector tabs are the SAME ones the storybook renders: built by
      // buildInspectorViews from tutuca/components, with lint/test data produced
      // by the dev build (already loaded as tutucaApi via the "tutuca" specifier).
      const {
        ActivityLog,
        buildInspectorViews,
        getComponents: getInspectorComponents,
        InstanceInspector,
        makeInspect,
        recordToEntry,
      } = await import(this._resolveSpecifier("tutuca/components"));

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
      // Register the inspector components into the app too, so the single compiled
      // margaui sheet covers their classes (collectAppClassesInSet scans every
      // registered component). They render in a separate inspector app (below).
      this._inspectorComponents = getInspectorComponents();
      this._tutuca = tutuca;
      app.registerComponents(this._inspectorComponents);

      app.state.set(mod.getRoot());
      const styleText = await compileClassesToStyleText(app, compile, LintClassCollectorCtx);
      const margauiSheet = new CSSStyleSheet();
      margauiSheet.replaceSync(styleText);
      this._adoptStyles(margauiSheet);

      app.start({ head: this.shadowRoot });

      const undoContainer = this.shadowRoot.querySelector('[data-panel="undo"]');
      this._undoContainer = undoContainer;
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
            this._undoActive = true;
            this._syncUndoVisibility();
          }
          slider.max = undo.size - 1;
          slider.value = undo.size - 1;
        }
      });

      // Build the inspector views for the running root (snapshot, like the
      // storybook). `name: null` runs the whole module's tests, not just the
      // root component's. Lint uses the non-mutating shadowCheckComponent.
      const dev = {
        shadowCheckComponent: tutucaApi.shadowCheckComponent,
        runTests: tutucaApi.runTests,
        expect: tutucaApi.expect,
      };
      this._inspectorViews = await buildInspectorViews(app.state.val, scope, {
        getTests: typeof mod.getTests === "function" ? mod.getTests : null,
        components,
        dev,
        name: null,
      });
      // The instance view reflects LIVE state: rebuilt from the preview app's
      // current root each time the Instance tab is shown (Component/Lint/Test are
      // definition-based and stay snapshots).
      this._rebuildInstanceView = () =>
        InstanceInspector.Class.fromData(app.state.val, scope.getCompFor(app.state.val));

      // Live Activity tab: subscribe to the transaction observer and accumulate a
      // shared ActivityLog. Reuses the same recordToEntry/makeInspect/ActivityLog as
      // the storybook (tutuca/components) — no reimplemented display here. The root is
      // the whole component, so no path routing is needed; every record is logged.
      const inspect = makeInspect(app);
      this._activityLog = ActivityLog.make({});
      this._inspectorViews.activityView = this._activityLog;
      this._activitySub = app.observe((record) => {
        this._activityLog = this._activityLog.appendEntry(recordToEntry(record, { inspect }));
        this._inspectorViews.activityView = this._activityLog;
        if (this._activeInspector === "activity" && this._inspectorApp) {
          this._inspectorApp.state.set(this._activityLog);
        }
      });

      this._updateInspectorTabs(this._inspectorViews);

      if (this.hasAttribute("auto-run-tests") && this._inspectorViews.hasTest) {
        this._activateTab("test");
      }
    } catch (e) {
      this.preview.textContent = `Error: ${e.message}`;
      console.error(e);
    }
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
