// Runs a landing page example's tui in this terminal, from the state one of its stories makes:
// node scripts/tui.js counter ["From ten"]. The first story without a name; Ctrl+C quits.
// --log file writes what the terminal sends, what it parsed to, the element under each mouse
// event and each message the app handled, one JSON line each.
import { appendFileSync, writeFileSync } from "node:fs";
import { runTui } from "tutuca/tui";

const argv = process.argv.slice(2);
const logAt = argv.indexOf("--log");
const logFile = logAt === -1 ? null : argv.splice(logAt, 2)[1];
const [name = "counter", storyName] = argv;
const { default: book } = await import(`../site/examples/${name}.js`);
const story =
	storyName === undefined ? book.stories[0] : book.stories.find((s) => s.name === storyName);
if (story === undefined) {
	const names = book.stories.map((s) => JSON.stringify(s.name)).join(", ");
	console.error(`${name} has no story named ${JSON.stringify(storyName)}: it has ${names}`);
	process.exit(1);
}
if (story.make === undefined) {
	console.error(`${story.id} makes its state from an arbitrary: pick a story with make`);
	process.exit(1);
}
let log = null;
if (logFile) {
	writeFileSync(logFile, "");
	log = (entry) => appendFileSync(logFile, `${JSON.stringify(entry)}\n`);
}
// What a mouse event lands on: the element and its text, as the screen's hit test finds it.
const describe = (el) => el && { tag: el.localName, text: el.textContent.slice(0, 30) };
const { done, host, screen } = runTui({
	components: book.components,
	root: (C) => story.make(C),
	onInput:
		log &&
		((data, events) => {
			const hits = events.map((e) =>
				e.kind === "mouse" && screen.layout ? describe(screen.hitAt(e.x, e.y)) : null,
			);
			log({ data, events, hits, focused: describe(screen.focused) });
		}),
});
if (log)
	host.listen(
		(r) => r.kind === "transition" && log({ handled: r.name, outcome: r.outcome, args: r.args }),
	);
await done;
process.exit(0);
