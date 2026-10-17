import { parseDueWords } from "./dates.js";

// Parses a quick add line as Todoist does: "Buy milk tomorrow p1 #Errands @shop" is the
// task "Buy milk", due tomorrow, priority 1, in the Errands project, labelled shop.
// projects are the known project names; a #name that isn't one stays in the title.
// Without a today, due words are kept as dueText but not resolved.
export const parseQuickAdd = (text, { today = null, projects = [] } = {}) => {
	const words = text.trim().split(/\s+/).filter(Boolean);
	const title = [];
	const labels = [];
	let due = "";
	let dueText = "";
	let priority = 4;
	let project = null;
	for (let i = 0; i < words.length; i++) {
		const word = words[i];
		const p = /^p([1-4])$/i.exec(word);
		if (p !== null) {
			priority = Number(p[1]);
			continue;
		}
		if (word.length > 1 && word.startsWith("@")) {
			const label = word.slice(1).toLowerCase();
			if (!labels.includes(label)) labels.push(label);
			continue;
		}
		if (word.length > 1 && word.startsWith("#")) {
			const name = word.slice(1).toLowerCase();
			const match = projects.find((known) => known.toLowerCase() === name);
			if (match !== undefined || today === null) {
				project = match ?? word.slice(1);
				continue;
			}
		}
		const date = parseDueWords(words, i, today ?? "2000-01-03");
		if (date !== null && dueText === "") {
			dueText = words.slice(i, i + date.used).join(" ");
			if (today !== null) due = date.due;
			i += date.used - 1;
			continue;
		}
		title.push(word);
	}
	return { title: title.join(" "), due, dueText, priority, project, labels };
};
