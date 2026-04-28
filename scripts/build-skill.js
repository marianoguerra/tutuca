#!/usr/bin/env bun
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const srcDir = resolve(repo, "docs/llm");
const outDir = resolve(repo, "skill");

const SKILL_FRONTMATTER = `---
name: tutuca
description: Authoring or reviewing tutuca components, html\`\` views, macros, or running the \`tutuca\` CLI. Covers field types, @-directives, bubble/logic/response handlers, and the post-edit \`tutuca <module> lint\` + \`tutuca <module> render --title …\` verification recipe.
---

`;

const SKILL_BODY = `# Tutuca

Tutuca is an immutable-state SPA framework: components have typed
\`fields\`, auto-generated mutators (\`setX\`, \`pushInX\`, …), HTML-template
\`view\`s with \`@\`-prefixed directives, and \`bubble\` / \`logic\` /
\`response\` handlers for orchestration.

## Verifying changes

After editing a tutuca module, run two checks before declaring the edit
done:

1. **Lint** — catches undefined fields/handlers/macros/events. Exits
   \`2\` on any error-level finding.

   \`\`\`sh
   tutuca <module-path> lint
   \`\`\`

2. **Render the example that exercises the feature you changed** —
   confirms the component mounts in a headless DOM with the new
   behavior. Exits \`3\` on render crash.

   \`\`\`sh
   tutuca <module-path> render --title "<example title>"
   \`\`\`

   If no example covers the feature, add one to \`getExamples()\` first —
   that's how the feature becomes verifiable.

## Routing

| Task                                                                                           | File                            |
| ---------------------------------------------------------------------------------------------- | ------------------------------- |
| Authoring \`component({...})\`, \`html\\\`...\\\`\` views, macros, fields, events, lists, styles | [core.md](./core.md)           |
| CLI commands, flags, exit codes, full linter rule list                                         | [cli.md](./cli.md)             |
| Drag & drop, dynamic bindings (\`*x\`), pseudo-\`x\`, \`KList\`, custom seq types, Tailwind/MargaUI | [advanced.md](./advanced.md)   |

Read \`core.md\` first. Reach for \`cli.md\` or \`advanced.md\` only when the
task touches them — both files are referenced inline from \`core.md\` so
you'll be pointed there when relevant.
`;

function build() {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  for (const name of ["core", "cli", "advanced"]) {
    const src = readFileSync(resolve(srcDir, `${name}.txt`), "utf8");
    // Rewrite cross-references: every `core.txt` / `cli.txt` / `advanced.txt`
    // mention (link href, link text, prose) becomes the .md equivalent so the
    // skill is internally consistent.
    const rewritten = src.replace(/\b(core|cli|advanced)\.txt\b/g, "$1.md");
    writeFileSync(resolve(outDir, `${name}.md`), rewritten);
  }

  writeFileSync(resolve(outDir, "SKILL.md"), SKILL_FRONTMATTER + SKILL_BODY);

  process.stdout.write(`built skill/ from docs/llm/ → ${outDir}\n`);
}

build();
