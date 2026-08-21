import { CodeMirror, setCodeMirrorPath } from "./code-editor.js";
import { HtmlPlayground } from "./html-playground.js";
import { TutucaPlayground } from "./playground.js";

function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
}

function detectTheme() {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)");
  setTheme(prefersDark.matches ? "dark" : "light");
  prefersDark.addEventListener("change", (e) => setTheme(e.matches ? "dark" : "light"));
}

export async function init() {
  detectTheme();
  setCodeMirrorPath("../deps/codemirror.js");
  CodeMirror.isVimMode = new URLSearchParams(location.search).has("vim");
  customElements.define("code-mirror", CodeMirror);

  const [lightResp, darkResp] = await Promise.all([
    fetch("./styles/light.css"),
    fetch("./styles/dark.css"),
  ]);
  const lightCss = await lightResp.text();
  const darkCss = await darkResp.text();
  const themeSheet = new CSSStyleSheet();
  await themeSheet.replace(`${lightCss}\n${darkCss}`);
  document.adoptedStyleSheets.push(themeSheet);

  // The [data-theme=dark] palette above is adopted at the document level, so it
  // also matches a playground host that mirrors the page theme (see
  // TutucaPlayground._syncTheme); the vars it sets on the host inherit across
  // the shadow boundary into margaui's preview. margaui no longer pins its
  // theme defaults to :host, so no shadow-scoped override is needed.

  customElements.define("tutuca-playground", TutucaPlayground);
  customElements.define("html-playground", HtmlPlayground);
}

export function scrollToHash() {
  if (location.hash) {
    const scrollToEl = () => {
      const el = document.querySelector(location.hash);
      if (el) el.scrollIntoView();
    };
    addEventListener("load", scrollToEl);
    setTimeout(scrollToEl, 500);
  }
}
