// Executes stress batches; the caller owns the timeline and any saved counterexample.
import { stressProperty } from "./stories.js";
import { STRESS_IDLE, STRESS_LOG_MAX } from "./ui/common.js";

export async function runStress({
	story,
	fc,
	A,
	root,
	from,
	events,
	maxCommands,
	createDocument,
	numRuns,
	seed,
	isCancelled,
	onProgress,
	onFailure,
}) {
	const total = numRuns;
	const log = [];
	let runs = 0;
	let shrinks = -1;
	const onRun = (ops, error) => {
		if (shrinks >= 0) {
			shrinks += 1;
			return;
		}
		runs += 1;
		const message = String(error?.message ?? error).replace(/\s*\n\s*/g, " ");
		const outcome = error === null ? "ok" : `failed: ${message}`;
		log.push(`run ${runs}, ${ops.length} ops, ${outcome}`);
		for (const [i, op] of ops.entries()) log.push(`  ${i + 1}. ${op}`);
		if (error !== null) shrinks = 0;
		if (log.length > STRESS_LOG_MAX) log.splice(0, log.length - STRESS_LOG_MAX);
	};
	const result = (r) => ({ ...STRESS_IDLE, total, log: [...log], ...r });
	let property;
	try {
		property = stressProperty(story, {
			fc,
			A,
			root,
			from,
			events,
			maxCommands,
			document: createDocument(),
			onRun,
		});
	} catch (error) {
		return result({ status: "unavailable", error: error.message });
	}
	const batch = Math.max(1, Math.min(10, numRuns));
	let done = 0;
	while (done < numRuns) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		if (isCancelled()) return result({ status: "cancelled", done });
		const runSeed = seed + done;
		const details = fc.check(property, {
			numRuns: Math.min(batch, numRuns - done),
			seed: runSeed,
		});
		done += details.numRuns;
		if (details.failed) {
			const [failedRoot, cmds] = details.counterexample;
			const commands = [...cmds];
			const message = String(details.errorInstance?.message ?? details.errorInstance);
			const error = `${message}\n(seed ${runSeed}, path "${details.counterexamplePath}")`;
			log.push(`shrunk to ${commands.length} ops in ${shrinks} attempts`);
			onFailure({ root: failedRoot, commands });
			return result({ status: "failed", done, error, commands: commands.map(String) });
		}
		onProgress({ status: "running", done, total, log: [...log] });
	}
	return result({ status: "passed", done });
}
