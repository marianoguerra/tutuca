// `tutuca storybook [dir]` — zero-setup storybook for a project.
//
// Convention over configuration: recursively discovers co-located `*.dev.js`
// modules (dev-only modules holding stories + tests + helpers, never shipped),
// then serves an ephemeral page that mounts them via the `tutuca/storybook`
// library. By default it also runs the modules' getTests() in the terminal and
// wires margaui styling + an in-browser check(app); each is disablable.
//
// This command runs in Node and only globs files, runs tests, and generates/
// serves text — it NEVER imports the browser storybook bundle.
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { dirname, join, normalize, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
// deps/chai.js re-exports chai with tutuca's jest-style matchers, matching the
// `tutuca test` runner (see commands/_registry.js).
import { expect } from "../../../deps/chai.js";
import { normalizeModule } from "../../core/module.js";
import { runTests } from "../../core/test.js";
import { createNodeEnv } from "../env.js";
import { CODES, emitError } from "../errors.js";

export const describe =
  "Serve a storybook for the project's co-located *.dev.js modules (auto-discovered).";

const BOOTSTRAP_URL = "/__tutuca_storybook__.js";
const DIST_PREFIX = "/__tutuca__/"; // virtual route serving the CLI's own dist/

const MIME = {
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".html": "text/html; charset=utf-8",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".map": "application/json",
};

const MARGAUI_CDN = "https://cdn.jsdelivr.net/npm/margaui/+esm";
const MARGAUI_THEME = "https://marianoguerra.github.io/margaui/themes/theme.css";

// Recursively collect *.dev.js as server-absolute, forward-slashed URL paths,
// skipping node_modules and dotdirs. Mirrors install-skill.js listFiles.
function findDevModules(root, dir, acc) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".") || e.name === "node_modules") continue;
    const full = resolve(dir, e.name);
    if (e.isDirectory()) {
      findDevModules(root, full, acc);
    } else if (e.isFile() && e.name.endsWith(".dev.js")) {
      acc.push(`/${relative(root, full).split(sep).join("/")}`);
    }
  }
  return acc;
}

// Resolve the CLI's own package.json + dist dir from both dev (tools/cli/
// commands/storybook.js) and released (dist/tutuca-cli.js) locations.
function findSelf() {
  const here = dirname(fileURLToPath(import.meta.url));
  const pkgCandidates = [
    resolve(here, "..", "..", "..", "package.json"),
    resolve(here, "..", "package.json"),
  ];
  const pkgPath = pkgCandidates.find(existsSync);
  const version = pkgPath ? JSON.parse(readFileSync(pkgPath, "utf8")).version : "latest";
  const distCandidates = [resolve(here, "..", "..", "..", "dist"), resolve(here, ".")];
  const distRoot =
    distCandidates.find((d) => existsSync(resolve(d, "tutuca-storybook.js"))) ?? null;
  return { version, distRoot };
}

// Pick where tutuca's bundles come from: a local install, else the CLI's own
// dist (served via a virtual route), else the CDN pinned to this CLI's version.
// All three tutuca specifiers resolve to the SINGLE dev bundle so there is one
// framework runtime (component scope/identity requires it).
function resolveTutucaBase(projectDir, self, forCdn) {
  if (forCdn)
    return { base: `https://cdn.jsdelivr.net/npm/tutuca@${self.version}/dist`, serveDist: null };
  const nm = resolve(projectDir, "node_modules", "tutuca", "dist");
  if (existsSync(resolve(nm, "tutuca-dev.js"))) {
    return { base: "/node_modules/tutuca/dist", serveDist: null };
  }
  if (self.distRoot) return { base: DIST_PREFIX.replace(/\/$/, ""), serveDist: self.distRoot };
  return { base: `https://cdn.jsdelivr.net/npm/tutuca@${self.version}/dist`, serveDist: null };
}

// Human label for where the tutuca runtime is loaded from, given a resolved base.
function tutucaSource(base) {
  if (base.startsWith("http")) return "CDN";
  if (base.startsWith("/node_modules")) return "node_modules";
  return "local dist";
}

function buildImports(base, { margaui }) {
  const dev = `${base}/tutuca-dev.js`;
  const imports = {
    tutuca: dev,
    "tutuca/extra": dev,
    "tutuca/dev": dev,
    "tutuca/storybook": `${base}/tutuca-storybook.js`,
  };
  if (margaui) imports.margaui = MARGAUI_CDN;
  return imports;
}

function renderIndexHtml(imports, { margaui, bootstrapUrl }) {
  const theme = margaui ? `\n    <link rel="stylesheet" href="${MARGAUI_THEME}" />` : "";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Storybook</title>${theme}
    <script type="importmap">
${JSON.stringify({ imports }, null, 6)}
    </script>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="${bootstrapUrl}"></script>
  </body>
</html>
`;
}

function renderBootstrap(devModuleUrls, { margaui, check }) {
  const lines = ['import { mountStorybook } from "tutuca/storybook";'];
  if (margaui) {
    lines.push('import { compileClassesToStyleText } from "tutuca/extra";');
    lines.push('import { compile } from "margaui";');
  }
  if (check) lines.push('import { check } from "tutuca/dev";');
  devModuleUrls.forEach((url, i) => {
    lines.push(`import * as m${i} from ${JSON.stringify(url)};`);
  });
  const modules = devModuleUrls.map((_, i) => `m${i}`).join(", ");
  const opts = margaui ? "{ compileCss: (app) => compileClassesToStyleText(app, compile) }" : "{}";
  lines.push("");
  lines.push(`const app = await mountStorybook("#app", [${modules}], ${opts});`);
  if (check) lines.push("check(app);");
  lines.push("");
  return lines.join("\n");
}

// Run getTests() from the discovered modules through the same machinery as
// `tutuca test`. Best-effort: a module that fails to import (e.g. tutuca not
// installed in the project) is reported as a warning, not fatal.
async function runDevTests(projectDir, devModuleUrls) {
  await createNodeEnv(); // sets globalThis.document for tests that render
  let totalTests = 0;
  let failedTests = 0;
  let withTests = 0;
  const failures = [];
  const importErrors = [];

  for (const url of devModuleUrls) {
    const abs = resolve(projectDir, url.slice(1));
    let mod;
    try {
      mod = await import(abs);
    } catch (e) {
      importErrors.push({ url, message: e.message });
      continue;
    }
    if (typeof mod.getTests !== "function") continue;
    withTests++;
    const { normalized } = normalizeModule(mod, { path: abs });
    const report = await runTests({
      getTests: mod.getTests,
      components: normalized.components,
      path: abs,
      expect,
      requestHandlers: normalized.requestHandlers,
      macros: normalized.macros,
    });
    const m = report.modules[0];
    totalTests += m.counts.total;
    failedTests += m.counts.fail;
    for (const suite of m.suites) collectFailures(suite, failures);
  }
  return { totalTests, failedTests, withTests, failures, importErrors };
}

// Import + normalize each dev module in Node (no browser bundle). Mirrors what
// buildStorybook does in the browser, but returns plain data and captures any
// import/shape error per module instead of throwing — the core of the dry-run.
async function discoverModules(projectDir, devModuleUrls) {
  await createNodeEnv();
  const modules = [];
  for (const url of devModuleUrls) {
    const abs = resolve(projectDir, url.slice(1));
    try {
      const mod = await import(abs);
      const { normalized, present } = normalizeModule(mod, { path: abs });
      modules.push({
        url,
        present: [...present],
        components: normalized.components.map((c) => c.name),
        sections: normalized.sections.map((s) => ({
          title: s.title,
          description: s.description,
          items: s.items.map((it) => ({
            title: it.title,
            view: it.view,
            componentName: it.componentName,
            requestHandlers: it.requestHandlerNames,
          })),
        })),
        macros: normalized.macros ? Object.keys(normalized.macros) : [],
        requestHandlers: normalized.requestHandlers ? Object.keys(normalized.requestHandlers) : [],
        error: null,
      });
    } catch (e) {
      modules.push({
        url,
        error: { code: e.code ?? null, message: e.message, where: e.where ?? null },
      });
    }
  }
  return modules;
}

function collectFailures(node, acc) {
  if (node.children) {
    for (const child of node.children) collectFailures(child, acc);
  } else if (node.status === "fail") {
    acc.push(node);
  }
}

function safeJoin(rootDir, urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const p = normalize(join(rootDir, decoded));
  if (p !== rootDir && !p.startsWith(rootDir + sep)) return null;
  return p;
}

function serveFile(res, filePath) {
  if (!filePath || !existsSync(filePath) || statSync(filePath).isDirectory()) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  const dot = filePath.lastIndexOf(".");
  const ext = dot >= 0 ? filePath.slice(dot) : "";
  res.setHeader("Content-Type", MIME[ext] ?? "application/octet-stream");
  createReadStream(filePath).pipe(res);
}

export async function run(argv, opts = {}) {
  const parsed = parseArgs({
    args: argv,
    options: {
      port: { type: "string" },
      out: { type: "string" },
      "no-margaui": { type: "boolean", default: false },
      "no-check": { type: "boolean", default: false },
      "no-tests": { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: true,
  });

  if (parsed.values.help) {
    process.stdout.write(
      "tutuca storybook [dir] [--port <n>] [--out <dir>] [--dry-run]\n" +
        "                 [--no-margaui] [--no-check] [--no-tests]\n" +
        "\n" +
        "  Auto-discovers co-located *.dev.js modules (recursively, skipping\n" +
        "  node_modules/dotdirs) and serves a live storybook that mounts them via\n" +
        "  the tutuca/storybook library. Zero setup.\n" +
        "\n" +
        "  [dir]          project root to scan and serve (default: cwd)\n" +
        "  --port <n>     preferred port (default 4321; falls back to a free port)\n" +
        "  --out <dir>    write a static index.html + bootstrap (CDN import map)\n" +
        "                 instead of serving; host it from the project root\n" +
        "  --dry-run      do all the prep (discover, import and normalize modules,\n" +
        "                 resolve the runtime, run tests) and print what would be\n" +
        "                 shown instead of serving; pass --json for structured output\n" +
        "  --no-margaui   skip margaui styling (renders functional but unstyled)\n" +
        "  --no-check     skip the in-browser check(app) dev validation\n" +
        "  --no-tests     skip running the modules' getTests() before serving\n",
    );
    return;
  }

  const projectDir = resolve(parsed.positionals[0] ?? process.cwd());
  if (!existsSync(projectDir) || !statSync(projectDir).isDirectory()) {
    emitError(opts, {
      code: CODES.USAGE_MISSING_ARGUMENT,
      message: `not a directory: ${projectDir}`,
      hint: "Pass a project directory to scan, or omit it to use the current directory.",
    });
  }

  const devModuleUrls = findDevModules(projectDir, projectDir, []);
  if (devModuleUrls.length === 0) {
    emitError(opts, {
      code: CODES.USAGE_MISSING_ARGUMENT,
      message: `no *.dev.js modules found under ${projectDir}`,
      hint: "Create a co-located <name>.dev.js exporting getComponents() and getExamples().",
    });
  }

  const margaui = !parsed.values["no-margaui"];
  const check = !parsed.values["no-check"];
  const self = findSelf();

  // --out: emit a portable static artifact (CDN import map), no server.
  if (parsed.values.out) {
    const outDir = resolve(parsed.values.out);
    mkdirSync(outDir, { recursive: true });
    const { base } = resolveTutucaBase(projectDir, self, true);
    const imports = buildImports(base, { margaui });
    const bootstrapName = "tutuca-storybook.bootstrap.js";
    writeFileSync(
      resolve(outDir, "index.html"),
      renderIndexHtml(imports, { margaui, bootstrapUrl: `./${bootstrapName}` }),
    );
    writeFileSync(
      resolve(outDir, bootstrapName),
      renderBootstrap(devModuleUrls, { margaui, check }),
    );
    process.stdout.write(
      `wrote static storybook → ${relative(process.cwd(), outDir) || "."}/\n` +
        `  index.html + ${bootstrapName} (${devModuleUrls.length} dev modules, CDN import map)\n` +
        "  Host it from the project root so /*.dev.js paths resolve.\n",
    );
    return;
  }

  // --dry-run: do all the Node-side prep the server would do (discover, import
  // and normalize modules, resolve the runtime, run tests) and print what would
  // be shown instead of serving — lets agents verify setup without a browser.
  if (parsed.values["dry-run"]) {
    const { base } = resolveTutucaBase(projectDir, self, false);
    const imports = buildImports(base, { margaui });
    const modules = await discoverModules(projectDir, devModuleUrls);
    const tests = parsed.values["no-tests"] ? null : await runDevTests(projectDir, devModuleUrls);
    const source = tutucaSource(base);
    const result = {
      projectDir,
      tutuca: { source, base, version: self.version },
      options: { margaui, check, runTests: !parsed.values["no-tests"] },
      imports,
      modules,
      tests,
    };

    if (opts.format === "json") {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }

    process.stdout.write(
      `tutuca storybook dry run (no server started)\n` +
        `  project: ${projectDir}\n` +
        `  tutuca runtime: ${source} (${base}, version ${self.version})\n` +
        `  margaui: ${margaui ? "on" : "off"}, in-browser check: ${check ? "on" : "off"}\n` +
        `  ${modules.length} dev module(s):\n`,
    );
    for (const m of modules) {
      if (m.error) {
        process.stdout.write(`    error ${m.url} — ${m.error.message}\n`);
        continue;
      }
      const sectionItems = m.sections.reduce((n, s) => n + s.items.length, 0);
      process.stdout.write(
        `    ok ${m.url} — ${m.components.length} component(s), ` +
          `${m.sections.length} section(s), ${sectionItems} example(s)\n`,
      );
    }
    if (tests) {
      for (const ie of tests.importErrors) {
        process.stdout.write(`  ! skipped tests for ${ie.url}: ${ie.message}\n`);
      }
      if (tests.withTests === 0) {
        process.stdout.write("  tests: no getTests() in any dev module\n");
      } else {
        process.stdout.write(
          `  tests: ${tests.totalTests - tests.failedTests}/${tests.totalTests} passed ` +
            `across ${tests.withTests} module(s)\n`,
        );
        for (const f of tests.failures) {
          process.stdout.write(`    failed ${f.fullPath}: ${f.error?.message ?? "failed"}\n`);
        }
      }
    } else {
      process.stdout.write("  tests: skipped (--no-tests)\n");
    }
    return;
  }

  // Run tests in the terminal before serving (best-effort dev loop).
  if (!parsed.values["no-tests"]) {
    const r = await runDevTests(projectDir, devModuleUrls);
    for (const ie of r.importErrors) {
      process.stdout.write(`  ! skipped tests for ${ie.url}: ${ie.message}\n`);
    }
    if (r.withTests === 0) {
      process.stdout.write("tests: no getTests() in any dev module\n");
    } else {
      process.stdout.write(
        `tests: ${r.totalTests - r.failedTests}/${r.totalTests} passed across ${r.withTests} module(s)\n`,
      );
      for (const f of r.failures) {
        process.stdout.write(`  ✗ ${f.fullPath}: ${f.error?.message ?? "failed"}\n`);
      }
    }
  }

  const { base, serveDist } = resolveTutucaBase(projectDir, self, false);
  const imports = buildImports(base, { margaui });
  const indexHtml = renderIndexHtml(imports, { margaui, bootstrapUrl: BOOTSTRAP_URL });
  const bootstrapJs = renderBootstrap(devModuleUrls, { margaui, check });

  const server = createServer((req, res) => {
    const path = req.url.split("?")[0];
    if (path === "/" || path === "/index.html") {
      res.setHeader("Content-Type", MIME[".html"]);
      res.end(indexHtml);
      return;
    }
    if (path === BOOTSTRAP_URL) {
      res.setHeader("Content-Type", MIME[".js"]);
      res.end(bootstrapJs);
      return;
    }
    if (serveDist && path.startsWith(DIST_PREFIX)) {
      serveFile(res, safeJoin(serveDist, `/${path.slice(DIST_PREFIX.length)}`));
      return;
    }
    serveFile(res, safeJoin(projectDir, path));
  });

  const preferred = Number.parseInt(parsed.values.port ?? "4321", 10);
  server.on("error", (e) => {
    if (e.code === "EADDRINUSE") {
      server.listen(0); // let the OS pick a free port
    } else {
      throw e;
    }
  });
  server.on("listening", () => {
    const actual = server.address().port;
    const where = tutucaSource(base);
    process.stdout.write(
      `tutuca storybook: http://localhost:${actual}/  ` +
        `(${devModuleUrls.length} dev modules, tutuca from ${where})\n`,
    );
  });
  server.listen(preferred);
}
