import { TutucaPlayground } from "./playground.js";
import { CodeMirror, setCodeMirrorPath } from "./code-editor.js";

function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
}

function detectTheme() {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)");
  setTheme(prefersDark.matches ? "dark" : "light");
  prefersDark.addEventListener("change", (e) =>
    setTheme(e.matches ? "dark" : "light"),
  );
}

async function main() {
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
  await themeSheet.replace(lightCss + "\n" + darkCss);
  document.adoptedStyleSheets.push(themeSheet);
  customElements.define("tutuca-playground", TutucaPlayground);
}

main();
