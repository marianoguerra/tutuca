import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { CODES, emitError } from "../errors.js";
import { readPackageVersion } from "../pkg.js";

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

function readStdinSync() {
  if (process.stdin.isTTY) return "";
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

export async function run(argv, opts = {}) {
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
    emitError(opts, {
      code: CODES.USAGE_MISSING_ARGUMENT,
      message: "feedback requires a message (positional arg or piped stdin)",
      hint:
        'Example: `tutuca feedback "the lint code FIELD_VAL_NOT_DEFINED was confusing"` ' +
        "or `echo ... | tutuca feedback`.",
    });
  }

  const record = {
    ts: new Date().toISOString(),
    version: readPackageVersion(import.meta.url),
    message,
  };

  const dir = resolve(homedir(), ".tutuca");
  const file = resolve(dir, "feedback.jsonl");
  mkdirSync(dir, { recursive: true });
  appendFileSync(file, `${JSON.stringify(record)}\n`);
  process.stdout.write(`recorded feedback → ${file}\n`);
}
