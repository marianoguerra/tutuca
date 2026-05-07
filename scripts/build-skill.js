#!/usr/bin/env bun
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const srcDir = resolve(repo, "docs/llm");
const outDir = resolve(repo, "skill/tutuca");

const SKILL_FRONTMATTER = `---
name: tutuca
description: Authoring or reviewing tutuca components, html\`\` views, macros, or running the \`tutuca\` CLI. Covers field types, @-directives, bubble/receive/response handlers, and the post-edit \`tutuca <module> lint\` + \`tutuca <module> render --title …\` verification recipe.
---

`;

const SKILL_BODY = `# Tutuca

Tutuca is an immutable-state SPA framework: components have typed
\`fields\`, auto-generated mutators (\`setX\`, \`pushInX\`, …), HTML-template
\`view\`s with \`@\`-prefixed directives, and \`bubble\` / \`receive\` /
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
| Drag & drop, dynamic bindings (\`*x\`), pseudo-\`x\`, custom seq types, Tailwind/MargaUI | [advanced.md](./advanced.md)   |
| Authoring tests — \`getTests\` shape, calling methods/input/receive/bubble/response/alter handlers, designing handlers for testability | [testing.md](./testing.md) |

Read \`core.md\` first. Reach for \`cli.md\`, \`advanced.md\`, or
\`testing.md\` only when the task touches them — all three are
referenced inline from \`core.md\` so you'll be pointed there when
relevant.
`;

function build() {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  for (const name of ["core", "cli", "advanced", "testing"]) {
    cpSync(resolve(srcDir, `${name}.md`), resolve(outDir, `${name}.md`));
  }

  writeFileSync(resolve(outDir, "SKILL.md"), SKILL_FRONTMATTER + SKILL_BODY);

  process.stdout.write(`built skill/ from docs/llm/ → ${outDir}\n`);
}

build();
