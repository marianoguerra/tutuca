import { injectCss } from "./src/app.js";
import { collectAppClassesInSet, ParseCtxClassSetCollector } from "./src/util/parsectx.js";

export * from "./index.js";
export async function compileClassesToStyle(app, compileClasses, styleId = "margaui-css") {
  const t1 = performance.now();
  const css = await compileClassesToStyleText(app, compileClasses);
  const t2 = performance.now();
  injectCss(styleId, css);
  return t2 - t1;
}
export async function compileClassesToStyleText(
  app,
  compileClasses,
  Ctx = ParseCtxClassSetCollector,
) {
  app.ParseContext = Ctx;
  app.compile();
  return await compileClasses(Array.from(collectAppClassesInSet(app)));
}
