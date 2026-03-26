import { injectCss } from "./src/app.js";
import { ParseCtxClassSetCollector } from "./src/util/parsectx.js";

export { KList } from "./extra/klist.js";
export * from "./index.js";

export async function compileClassesToStyle(
  app,
  compileClasses,
  styleId = "margaui-css",
) {
  app.ParseContext = ParseCtxClassSetCollector;
  app.compile();
  const t1 = performance.now();
  const classes = new Set();
  for (const Comp of app.comps.byId.values()) {
    for (const key in Comp.views) {
      const view = Comp.views[key];
      for (const name of view.ctx.classes) {
        classes.add(name);
      }
    }
  }
  const css = await compileClasses(Array.from(classes));
  const t2 = performance.now();
  injectCss(styleId, css);
  return t2 - t1;
}
