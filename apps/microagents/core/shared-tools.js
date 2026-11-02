// The tools every agent has, run by the shell: reading the agent's skills (a read-only
// filesystem), the state and the TData an export would write.
export const SHARED_TOOLS = [
	{
		name: "skills_list",
		description: "List the files in the agent's skills folder, or under a directory of it.",
		params: [{ name: "dir", type: "string", description: 'A directory, "" for all of them.' }],
	},
	{
		name: "skills_read",
		description: "Read a file of the agent's skills folder.",
		params: [{ name: "path", type: "string" }],
	},
	{
		name: "get_state",
		description: "The data being worked on, as JSON (long values are cut short).",
		params: [],
	},
	{
		name: "export_preview",
		description: "The TData message an export would write now, as canonical JSON.",
		params: [],
	},
];
export const SHARED_NAMES = new Set(SHARED_TOOLS.map((t) => t.name));

export const skillsList = (skills, dir = "") => {
	const prefix = dir === "" || dir.endsWith("/") ? dir : `${dir}/`;
	const paths = Object.keys(skills).filter((p) => p.startsWith(prefix));
	return paths.length > 0 ? paths : { error: `no files under "${dir}"` };
};
export const skillsRead = (skills, path) =>
	skills[path] ?? { error: `no file "${path}"; skills_list shows the files` };

// The skills as the system prompt lists them: each SKILL.md's description, then every path.
export const skillsIndex = (skills) => {
	const paths = Object.keys(skills);
	if (paths.length === 0) return "";
	const lines = paths.map((p) => {
		const description = /^description:\s*(.+)$/m.exec(skills[p])?.[1];
		return description ? `- ${p}: ${description}` : `- ${p}`;
	});
	return `The skills folder (read files with skills_read):\n${lines.join("\n")}`;
};

// JSON text cut to about max characters.
export const clip = (text, max = 8000) =>
	text.length <= max ? text : `${text.slice(0, max)}\n… (${text.length - max} more characters)`;
