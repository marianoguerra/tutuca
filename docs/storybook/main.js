// Bootstrap for the published storybook page (docs/storybook/index.html).
//
// Imports every demo module in this folder via RELATIVE paths (so it works at the
// site root /storybook/) and mounts them. margaui CSS is compiled into the page via
// the compileCss callback, exactly like docs/src/storybook.js.
//
// The live CLI serve (`bun run storybook`) does NOT use this file — it generates its
// own bootstrap pointing at the local dist. This file is what GitHub Pages serves.
import { compile } from "margaui";
// "tutuca" maps to tutuca-dev.js here (see index.html import map), so the dev
// helpers (check, shadowCheckComponent, runTests, expect) resolve from it.
import { check, compileClassesToStyleText, expect, runTests, shadowCheckComponent } from "tutuca";
import { mountStorybook } from "tutuca/storybook";

import * as m01 from "./01-basics.dev.js";
import * as m02 from "./02-sections.dev.js";
import * as m03 from "./03-views.dev.js";
import * as m04 from "./04-macros.dev.js";
import * as m05 from "./05-requests.dev.js";
import * as m06 from "./06-lifecycle-on.dev.js";
import * as m07 from "./07-tests-drive.dev.js";
import * as m08 from "./08-getroot-inception.dev.js";

const modules = [m01, m02, m03, m04, m05, m06, m07, m08];

const app = await mountStorybook("#app", modules, {
  compileCss: (a) => compileClassesToStyleText(a, compile),
  dev: { shadowCheckComponent, runTests, expect },
});
check(app);
