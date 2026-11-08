// A worked example to start from, and to make each kind with: a weather tool, called once.
export const WEATHER = {
	system:
		"You are a helpful assistant. Use the tools you're given when they help, and answer in a sentence or two.",
	user: "What's the weather like in Buenos Aires right now?",
	tool: {
		name: "get_weather",
		description: "Get the current weather in a city.",
		parameters: {
			type: "object",
			properties: {
				city: { type: "string", description: "The city's name, like Buenos Aires." },
				unit: { type: "string", enum: ["celsius", "fahrenheit"] },
			},
			required: ["city"],
		},
	},
	call: { id: "call_1", name: "get_weather", input: { city: "Buenos Aires", unit: "celsius" } },
	result: { temperature: 18, conditions: "partly cloudy" },
	assistant: "It's 18 °C and partly cloudy in Buenos Aires right now.",
	model: "claude-haiku-5-5",
	// What each of the two calls took: the second reads the first's prompt from the cache.
	usage: {
		toolUse: { input: 412, output: 38, cacheRead: 0, cacheWrite: 0 },
		stop: { input: 61, output: 17, cacheRead: 412, cacheWrite: 0 },
	},
	output: {
		schema: {
			type: "object",
			properties: {
				city: { type: "string" },
				temperature: { type: "number" },
				conditions: { type: "string", enum: ["sunny", "partly cloudy", "cloudy", "rainy"] },
			},
			required: ["city", "temperature", "conditions"],
			additionalProperties: false,
		},
		value: { city: "Buenos Aires", temperature: 18, conditions: "partly cloudy" },
	},
};

// The JSON a card holds: a dropped JSON file replaces it.
