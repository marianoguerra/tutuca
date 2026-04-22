import { writeFileSync } from "node:fs";
import { formatResult } from "../format/index.js";

export async function emit(result, { format, pretty, output }) {
  const text = await formatResult(format, result, { pretty });
  if (output) {
    writeFileSync(output, text);
  } else {
    process.stdout.write(text);
    if (!text.endsWith("\n")) process.stdout.write("\n");
  }
}
