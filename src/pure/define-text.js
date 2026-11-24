// define.js's reports as text for people and agents: each error and warning with where it is
// (line and column, the line of source, the span underlined) and how to fix it when that's
// known, then what a define registered and what of the app's state didn't carry as it was.

import { jsonText, pathText } from "../tree/index.js";

// One diagnostic: code and message, then where it is. A pure-js one shows its line of source
// with the span underlined, a tutuca one the component and view it's in.
export const diagnosticText = (d) => {
	const head = `${d.severity}[${d.code}]: ${d.message}`;
	const out = [head];
	if (d.line !== null) {
		const gutter = " ".repeat(String(d.line).length);
		const width =
			d.endLine === d.line
				? Math.max(1, d.endColumn - d.column)
				: Math.max(1, d.sourceLine.length - d.column + 1);
		out.push(
			`${gutter} --> line ${d.line}, column ${d.column}`,
			`${gutter} |`,
			`${d.line} | ${d.sourceLine}`,
			// Under the line's own tabs, tabs: the span lines up however wide they show.
			`${gutter} | ${d.sourceLine.slice(0, d.column - 1).replace(/[^\t]/g, " ")}${"^".repeat(width)}`,
		);
	} else if (d.component !== null) {
		const where = d.view === null ? `in ${d.component}` : `in ${d.component}, view ${d.view}`;
		out.push(`  --> ${where}${d.path === null || d.path === "" ? "" : ` (at ${d.path})`}`);
	}
	if (d.exclusion === "by-design") out.push("  = note: pure-js leaves this out by design");
	else if (d.exclusion === "omitted") {
		const by = d.profile === null ? "" : `; the ${d.profile} profile admits it`;
		out.push(`  = note: pure-js doesn't have this yet${by}`);
	}
	if (d.help !== null) out.push(`  = help: ${d.help}`);
	return out.join("\n");
};

const countText = (n, what, plural = "s") => `${n} ${what}${n === 1 ? "" : plural}`;
const listText = (names) => names.join(", ");
// The errors and warnings, counted and in full, then the notes, a line each.
const diagnosticsText = (all) => {
	const notes = all.filter((d) => d.severity === "note");
	const diagnostics = all.filter((d) => d.severity !== "note");
	const errors = diagnostics.filter((d) => d.severity === "error").length;
	const warnings = diagnostics.length - errors;
	const out =
		diagnostics.length === 0
			? []
			: [
					`${countText(errors, "error")}, ${countText(warnings, "warning")}:`,
					"",
					diagnostics.map(diagnosticText).join("\n\n"),
				];
	return [...out, ...notes.map((d) => `note: ${d.message}.`)];
};

// A param's type as the outline has it: a bare kind ("number") without its quotes.
const paramType = (type) => (type === null ? "?" : type.replace(/^"([a-z]+)"$/, "$1"));
// What each component's agent will have (a report's agents, agentOutline's by name): its tools
// as calls, those that only read marked, and what it sees every step. Lines.
export const agentsText = (agents = {}) =>
	Object.entries(agents).map(([name, { tools, summary }]) => {
		const calls = tools.map((tool) => {
			const params = tool.params.map((p) => `${p.name}: ${paramType(p.type)}`).join(", ");
			return `${tool.name}(${params})${tool.kind === "query" ? " (reads)" : ""}`;
		});
		const sees = summary === null ? "its state as JSON" : summary;
		const list = calls.length === 0 ? "no tools" : `tools ${calls.join(", ")}`;
		return `${name}'s agent will have ${list}; it sees ${sees} every step.`;
	});

// How many of the examples pass, when there are any (those that fail are diagnostics).
const examplesText = (examples = []) => {
	if (examples.length === 0) return [];
	const passed = examples.filter((e) => e.ok).length;
	const names = examples.map((e) => `${e.ok ? "✓" : "✗"} ${e.component}.${e.name}`);
	return [`Examples: ${passed} of ${examples.length} pass (${names.join(", ")}).`];
};

// checkComponentSource's report.
export const checkReportText = (report) => {
	const lines = [];
	if (report.ok) {
		lines.push(`It checks: defines ${listText(report.components)}.`);
		if (report.replaces.length > 0) {
			lines.push(
				`Defining it gives ${listText(report.replaces)} a new definition: the instances there are now move onto it, with their state.`,
			);
		}
		for (const name of report.shadows ?? []) {
			lines.push(`${name} here would be its own, over the ${name} above it.`);
		}
		lines.push(...agentsText(report.agents));
		lines.push(...examplesText(report.examples));
	} else {
		lines.push("It doesn't check, so it can't be defined.");
		lines.push(...examplesText(report.examples));
	}
	lines.push(...diagnosticsText(report.diagnostics));
	return lines.join("\n");
};

// defineComponentSource's (or the defineComponent ask's) answer.
export const defineReportText = (answer) => {
	if (!answer.ok) {
		return ["Nothing was defined.", ...diagnosticsText(answer.diagnostics)].join("\n");
	}
	const shadowed = answer.shadowed ?? [];
	const fresh = answer.registered.filter(
		(name) => !answer.replaced.includes(name) && !shadowed.includes(name),
	);
	const where = answer.scope ? ` in scope ${answer.scope}` : "";
	const lines = [];
	if (fresh.length > 0) lines.push(`Defined ${listText(fresh)}${where}.`);
	for (const name of shadowed) lines.push(`Defined ${name}${where}, over the ${name} above it.`);
	if (answer.replaced.length > 0) {
		lines.push(
			`Gave ${listText(answer.replaced)}${where} a new definition; the instances there were moved onto it.`,
		);
		for (const path of answer.added) lines.push(`  ${pathText(path)} added, at its default`);
		for (const { path, before, after } of answer.reset) {
			lines.push(`  ${pathText(path)} reset: ${jsonText(before)} → ${jsonText(after)}`);
		}
		for (const path of answer.dropped) lines.push(`  ${pathText(path)} dropped`);
	}
	lines.push(...agentsText(answer.agents));
	lines.push(...diagnosticsText(answer.diagnostics));
	return lines.join("\n");
};

// listScopes' list: each scope below, its components and how many of each are in use.
export const scopesText = (scopes) => {
	if (scopes.length === 0) return "There are no scopes below this one.";
	return scopes
		.map(({ path, components }) => {
			const names = components.map(
				({ name, live }) => `${name} (${countText(live, "in use", "")})`,
			);
			return `${path}: ${names.length === 0 ? "no components" : names.join(", ")}`;
		})
		.join("\n");
};
// unregisterComponent's or removeScope's answer.
export const removedText = (answer) => {
	const what =
		answer.name === ""
			? `scope ${answer.scope}`
			: `${answer.name}${answer.scope === "" ? "" : ` from ${answer.scope}`}`;
	if (answer.ok) return `Removed ${what}.`;
	if (answer.inUse.length === 0) return `Can't remove ${what}: ${answer.error}.`;
	const paths = answer.inUse.map((path) => `  ${pathText(path)}`);
	return [`Can't remove ${what}: it's in use at`, ...paths, "Remove those first."].join("\n");
};
