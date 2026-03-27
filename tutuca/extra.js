import { injectCss } from "./src/app.js";
import { ParseCtxClassSetCollector } from "./src/util/parsectx.js";

export { KList } from "./extra/klist.js";
export * from "./index.js";

export async function compileClassesToStyle(app, compileClasses, styleId = "margaui-css") {
  const t1 = performance.now();
  const css = await compileClassesToStyleText(app, compileClasses);
  const t2 = performance.now();
  injectCss(styleId, css);
  return t2 - t1;
}

export async function compileClassesToStyleText(app, compileClasses) {
  app.ParseContext = ParseCtxClassSetCollector;
  app.compile();
  const classes = new Set();
  for (const Comp of app.comps.byId.values()) {
    for (const key in Comp.views) {
      const view = Comp.views[key];
      for (const name of view.ctx.classes) {
        classes.add(name);
      }
    }
  }
  return await compileClasses(Array.from(classes));
}
