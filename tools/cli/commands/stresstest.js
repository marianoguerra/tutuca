import { parseArgs } from "node:util";
import { stresstest } from "../../core/stresstest.js";
import { createNodeEnv } from "../env.js";
import { emit } from "../output.js";

export const describe = "VDOM fuzz stresstest (no module required).";

export async function run(argv, globalOpts) {
  const { values } = parseArgs({
    args: argv,
    options: {
      iterations: { type: "string" },
      seed: { type: "string" },
    },
    allowPositionals: true,
  });
  const iterations = values.iterations ? parseInt(values.iterations, 10) : 100000;
  const seed = values.seed ? parseInt(values.seed, 10) : null;
  const env = createNodeEnv();

  if (!globalOpts.quiet) {
    process.stderr.write(`Running ${iterations.toLocaleString()} stress test iterations...\n`);
  }

  const result = stresstest({
    iterations,
    seed,
    makeDocument: env.makeDocument,
    onProgress: globalOpts.quiet
      ? null
      : ({ i, total, elapsedMs }) => {
          const rate = Math.round((i / elapsedMs) * 1000);
          process.stderr.write(
            `  ${i.toLocaleString()} / ${total.toLocaleString()} (${(elapsedMs / 1000).toFixed(1)}s, ${rate}/s)\n`,
          );
        },
  });

  await emit(result, { format: globalOpts.format ?? "cli", pretty: globalOpts.pretty, output: globalOpts.output });
  if (!result.ok) process.exit(3);
}
