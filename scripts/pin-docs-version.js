// Pin the docs import maps to the version in package.json.
//
// The docs pages load several files from one release (tutuca-dev.js, immer.js,
// tutuca-components.js, …) and the module graph only works when they all come from
// the SAME build. `tutuca@latest` cannot guarantee that: jsDelivr caches each file
// under the `latest` tag independently for up to 12h, so right after a release a page
// can get the new tutuca-dev.js next to the previous release's tutuca-components.js
// and die on a missing export. Pinning the tag makes the whole graph one version.
//
// Run as part of `npm run release`, before publishing. Rewrites in place, so a release
// leaves the version bump visible in the docs diff.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Every page whose import map resolves bare "tutuca*" specifiers to the CDN.
const PAGES = [
  "docs/index.html",
  "docs/more-examples.html",
  "docs/show.html",
  "docs/tutorial.html",
  "docs/universal.html",
  "docs/storybook/index.html",
];

// Only the versioned /dist/ URLs the import maps use. The unversioned
// `npm/tutuca/+esm` links in the prose stay on latest on purpose: they are the
// quick-start snippet readers copy, and a single file has no cross-file skew.
const PINNED_URL_RE = /(cdn\.jsdelivr\.net\/npm\/tutuca)@[^/"]+(\/dist\/)/g;

const { version } = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));

for (const page of PAGES) {
  const path = resolve(ROOT, page);
  const src = readFileSync(path, "utf8");
  const out = src.replace(PINNED_URL_RE, `$1@${version}$2`);
  if (out === src) {
    console.log(`pin-docs-version: ${page} already at ${version}`);
    continue;
  }
  writeFileSync(path, out);
  console.log(`pin-docs-version: ${page} → tutuca@${version}`);
}
