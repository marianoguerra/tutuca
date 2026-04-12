import * as tutuca from "tutuca";
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
  customElements.define("tutuca-playground", TutucaPlayground);
  customElements.define("html-playground", HtmlPlayground);
  maybeAddImmutableDevTools();
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

async function maybeAddImmutableDevTools() {
  if (hasImmutableDevTools()) {
    return;
  }

  console.group("Immutable DevTools not found, installing for your convenience");
  console.info("You may need to enable custom formatters in your browser");
  console.info(
    "https://firefox-source-docs.mozilla.org/devtools-user/custom_formatters/index.html",
  );
  console.info(
    "https://docs.google.com/document/d/1FTascZXT9cxfetuPRT2eXPQKXui4nWFivUnS_335T3U/preview?tab=t.0#heading=h.xuvxhsd2bp05",
  );
  console.groupEnd();

  const install = await import("https://esm.sh/@immutable/devtools");
  // tutuca exports the immutable data structures
  install.default(tutuca);
}

function hasImmutableDevTools() {
  const l = tutuca.List();
  const formatters = window.devtoolsFormatters ?? [];
  for (const formatter of formatters) {
    if (typeof formatter?.header === "function" && formatter.header(l) !== null) {
      return true;
    }
  }
  return false;
}
