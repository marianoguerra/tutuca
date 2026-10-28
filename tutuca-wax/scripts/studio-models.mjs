// The models the studio's assistant offers (scripts/studio-server.mjs), out of
// everything pi-ai knows: a provider with a key offers the ones matching a
// rule here. A rule matches a model's id once normalized, so the same model is
// offered by whichever providers carry it (the vendor's own, aggregators,
// clouds): lowercased, without an aggregator's path ("openai/gpt-6-sol"), a
// cloud's region and vendor prefix ("us.anthropic.", "global.xai."), a version
// suffix (Bedrock's "-v1:0"), with "5p3" read as "5.3" (Fireworks).
//
// OpenAI and Anthropic offer their current generations; the others the latest
// of each size they have (small, middle, large), by their price tiers. Ids
// with a date, or a -fast, -free or :batch variant, don't match.
export const MODEL_RULES = [
	// OpenAI: GPT 6 (6.x) and GPT 5.6, every size (astra, luna, sol, terra).
	{ family: "GPT", match: /^gpt-(6(\.\d+)?|5\.6)-[a-z]+$/ },
	// Anthropic: the 5 and 5.5 models.
	{ family: "Claude", match: /^claude-(haiku|sonnet|opus|fable)-5([.-]5)?$/ },
	// DeepSeek: V4.1 Flash (the deepseek provider calls it deepseek-flash), V4 Pro; no middle size.
	{ family: "DeepSeek", size: "small", match: /^deepseek-(v4\.1-flash|flash)$/ },
	{ family: "DeepSeek", size: "large", match: /^deepseek-v4-pro$/ },
	// Meta Muse: Glimmer, Spark, Wonder.
	{ family: "Muse", size: "small", match: /^muse-glimmer-30b$/ },
	{ family: "Muse", size: "middle", match: /^muse-spark-1\.3$/ },
	{ family: "Muse", size: "large", match: /^muse-wonder(-1\.0)?$/ },
	// GLM 5.3: Flash, FlashX, the full one.
	{ family: "GLM", size: "small", match: /^glm-5[.-]3-flash$/ },
	{ family: "GLM", size: "middle", match: /^glm-5[.-]3-flashx$/ },
	{ family: "GLM", size: "large", match: /^glm-5[.-]3$/ },
	// Kimi K3, one size (Kimi For Coding calls it k3).
	{ family: "Kimi", match: /^(kimi-)?k3$/ },
	// Qwen: 3.8 Flash, 3.7 Plus (the latest Plus), 3.8 Max.
	{ family: "Qwen", size: "small", match: /^qwen3\.8-flash$/ },
	{ family: "Qwen", size: "middle", match: /^qwen3\.7-plus$/ },
	{ family: "Qwen", size: "large", match: /^qwen3\.8-max$/ },
	// Xiaomi MiMo V2.6: Flash and Pro; no middle size.
	{ family: "MiMo", size: "small", match: /^mimo-v2\.6-flash$/ },
	{ family: "MiMo", size: "large", match: /^mimo-v2\.6-pro$/ },
	// Grok: 4.1 Fast (the latest small), 4.3 (the middle tier), 4.7.
	{ family: "Grok", size: "small", match: /^grok-4\.1-fast-reasoning$/ },
	{ family: "Grok", size: "middle", match: /^grok-4\.3$/ },
	{ family: "Grok", size: "large", match: /^grok-4\.7$/ },
];

// A model id as the rules read it.
export const normalizedId = (id) =>
	id
		.toLowerCase()
		.split("/")
		.at(-1)
		.replace(/^((global|us|eu|apac|jp|au)\.)?(anthropic|openai|xai|zai|moonshotai|moonshot|qwen|deepseek|meta|xiaomi)\./, "")
		.replace(/-v\d+:\d+$/, "")
		.replace(/(\d)p(\d)/g, "$1.$2");

// The rule a model id matches, or null: the studio offers it when there's one.
export const modelRule = (id) => {
	const n = normalizedId(id);
	return MODEL_RULES.find((r) => r.match.test(n)) ?? null;
};
