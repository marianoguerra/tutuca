import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

export const describe =
  "Record freeform feedback (bug, confusion, suggestion) to ~/.tutuca/feedback.jsonl.";

const HELP =
  "tutuca feedback [message]\n" +
  "\n" +
  "  Append a feedback record to ~/.tutuca/feedback.jsonl (created if missing).\n" +
  "  Use this for bugs, confusing messages, or suggestions about the CLI,\n" +
  "  bundled skills, docs, or the library itself.\n" +
  "\n" +
  "  Provide the message as a positional argument:\n" +
  '    tutuca feedback "the lint code FIELD_VAL_NOT_DEFINED was confusing"\n' +
  "\n" +
  "  ...or via stdin (useful for multi-line notes):\n" +
  '    echo "..." | tutuca feedback\n' +
  "    tutuca feedback < notes.txt\n" +
  "\n" +
  "  Each record is one JSON object per line: {ts, version, message}.\n";

function readPackageVersion() {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, "..", "..", "..", "package.json"),
    resolve(here, "..", "package.json"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        return JSON.parse(readFileSync(p, "utf8")).version ?? null;
      } catch {
        // fall through to next candidate
      }
    }
  }
  return null;
}

function readStdinSync() {
  if (process.stdin.isTTY) return "";
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

export async function run(argv) {
  const parsed = parseArgs({
    args: argv,
    options: { help: { type: "boolean", short: "h", default: false } },
    allowPositionals: true,
  });

  if (parsed.values.help) {
    process.stdout.write(HELP);
    return;
  }

  const positional = parsed.positionals.join(" ").trim();
  const message = positional || readStdinSync().trim();

  if (!message) {
    process.stderr.write(
      "tutuca: feedback requires a message (positional arg or piped stdin).\n" +
        "Run `tutuca help feedback` for usage.\n",
    );
    process.exit(1);
  }

  const record = {
    ts: new Date().toISOString(),
    version: readPackageVersion(),
    message,
  };

  const dir = resolve(homedir(), ".tutuca");
  const file = resolve(dir, "feedback.jsonl");
  mkdirSync(dir, { recursive: true });
  appendFileSync(file, `${JSON.stringify(record)}\n`);
  process.stdout.write(`recorded feedback → ${file}\n`);
}
