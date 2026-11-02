// Packs an agent folder (AGENTS.md) into its tdata message, as JSON:
//   node apps/microagents/pack-agent.js <folder> [out.tdata.json]
// The Agent Builder's samples are its examples packed this way (`just pack-agents`).
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { packAgent } from "./core/pack.js";
import { encodeMessage } from "./core/tdata.js";

export const packFolder = async (dir) =>
	encodeMessage(await packAgent((path) => readFile(resolve(path), "utf8"), resolve(dir)));

if (import.meta.url === `file://${process.argv[1]}`) {
	const [dir, out] = process.argv.slice(2);
	if (!dir) throw new Error("usage: node apps/microagents/pack-agent.js <folder> [out.tdata.json]");
	const text = await packFolder(dir);
	if (out) await writeFile(out, `${text}\n`);
	else console.log(text);
}
