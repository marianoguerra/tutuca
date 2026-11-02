// A micro-agent is a tdata message of kind "microagent": its manifest (with the tq query that
// picks the data it opens), system prompt, skills (a read-only filesystem, path → text), tool
// descriptions, module source and samples. packAgent builds one from an agent's folder;
// unpackAgent reads one back; agentMessage builds one from the parts.
import { dataJson, decodeMessage, fromJson, message, messages, TdataError } from "./tdata.js";

export const AGENT_KIND = "microagent";
export const PART = {
	manifest: "microagent/manifest",
	prompt: "microagent/prompt",
	skills: "microagent/skills",
	tools: "microagent/tools",
	module: "microagent/module",
	sample: "microagent/sample",
};
export const MANIFEST_KEYS = ["id", "title", "description", "needs", "icon", "version", "query"];
export const EMPTY_SAMPLE = "empty";

// The message for an agent's parts: { manifest, prompt, skills, tools, module, samples: [{ id,
// message }] }.
export const agentMessage = ({ manifest, prompt, skills, tools, module, samples }) =>
	messages(`agent/${manifest.id}`, AGENT_KIND, [
		message("manifest", PART.manifest, fromJson(pick(manifest, MANIFEST_KEYS))),
		message("prompt", PART.prompt, prompt),
		message("skills", PART.skills, fromJson(skills)),
		message("tools", PART.tools, fromJson(tools)),
		message("module", PART.module, module),
		...samples.map((s) => messages(s.id, PART.sample, [s.message])),
	]);

const pick = (o, keys) =>
	Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

// The parts of an agent message, or a TdataError saying what's missing.
export const unpackAgent = (msg) => {
	if (msg.kind !== AGENT_KIND || msg.messages === undefined) {
		throw new TdataError(`not a micro-agent: its kind is "${msg.kind}"`);
	}
	const part = (kind) => msg.messages.find((m) => m.kind === kind);
	const need = (kind) => {
		const m = part(kind);
		if (m === undefined) throw new TdataError(`the agent has no ${kind} part`);
		return m;
	};
	const manifest = dataJson(need(PART.manifest), {});
	for (const key of ["id", "title", "query"]) {
		if (typeof manifest[key] !== "string" || manifest[key] === "") {
			throw new TdataError(`the agent's manifest needs a "${key}"`);
		}
	}
	const module = need(PART.module).data;
	if (typeof module !== "string") throw new TdataError("the agent's module must be a String");
	return {
		manifest,
		prompt: part(PART.prompt)?.data ?? "",
		skills: dataJson(part(PART.skills), {}),
		tools: dataJson(part(PART.tools), []),
		module,
		samples: msg.messages
			.filter((m) => m.kind === PART.sample && m.messages?.length === 1)
			.map((m) => ({ id: m.id, message: m.messages[0] })),
	};
};

// The agent message for the folder at dir, read with readText(path) → Promise<string>. The
// folder has manifest.json (with the skills and the samples' ids), prompt.md,
// skills/<path>, tools.json, agent.js and samples/<id>.tdata.json.
export const packAgent = async (readText, dir) => {
	const at = (path) => readText(`${dir}/${path}`);
	const {
		skills: skillList = [],
		samples = [],
		...manifest
	} = JSON.parse(await at("manifest.json"));
	// skills lists paths under skills/, or maps each path to the file it comes from, relative
	// to skills/ (to share a file, such as AGENTS.md, without copying it).
	const skillSources = Array.isArray(skillList)
		? Object.fromEntries(skillList.map((p) => [p, p]))
		: skillList;
	const skills = Object.keys(skillSources);
	const [prompt, tools, module, skillTexts, sampleTexts] = await Promise.all([
		at("prompt.md"),
		at("tools.json").then(JSON.parse),
		at("agent.js"),
		Promise.all(skills.map((path) => at(`skills/${skillSources[path]}`))),
		Promise.all(samples.map((id) => at(`samples/${id}.tdata.json`))),
	]);
	return agentMessage({
		manifest,
		prompt,
		tools,
		module,
		skills: Object.fromEntries(skills.map((path, i) => [path, skillTexts[i]])),
		samples: samples.map((id, i) => ({ id, message: decodeMessage(sampleTexts[i]) })),
	});
};
