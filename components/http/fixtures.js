// A worked example to start from, and to make each kind with: a tasks API, a web page on
// app.example.com reading one task from api.example.com.
export const TASK = {
	type: "object",
	properties: {
		id: { type: "integer" },
		title: { type: "string", minLength: 1 },
		done: { type: "boolean" },
	},
	required: ["id", "title", "done"],
	additionalProperties: false,
};
const ERROR = {
	type: "object",
	properties: { message: { type: "string" } },
	required: ["message"],
};
export const TASKS = {
	operation: {
		method: "GET",
		path: "/tasks/{taskId}",
		operationId: "getTask",
		summary: "Get a task by its id.",
		parameters: [
			{ name: "taskId", in: "path", required: true, schema: { type: "integer", minimum: 1 } },
			{ name: "fields", in: "query", schema: { type: "string" } },
		],
		responses: [
			{ status: "200", description: "The task.", schema: TASK },
			{ status: "404", description: "There's no task with that id.", schema: ERROR },
		],
	},
	request: {
		method: "GET",
		url: "https://api.example.com/v1/tasks/42?fields=title,done",
		headers: [
			["Accept", "application/json"],
			["Origin", "https://app.example.com"],
			["Authorization", "Bearer eyJhbGciOi…"],
		],
	},
	response: {
		status: 200,
		headers: [
			["Content-Type", "application/json"],
			["Cache-Control", "private, max-age=60"],
			["ETag", '"v7"'],
			["Access-Control-Allow-Origin", "https://app.example.com"],
			["Vary", "Origin"],
		],
		body: { id: 42, title: "Explain HTTP on a canvas", done: false },
	},
	// The other operation: creating a task, whose body follows a schema.
	newTask: {
		schema: {
			type: "object",
			properties: { title: { type: "string", minLength: 1 }, done: { type: "boolean" } },
			required: ["title"],
			additionalProperties: false,
		},
	},
	create: {
		operation: {
			method: "POST",
			path: "/tasks",
			operationId: "createTask",
			summary: "Create a task.",
			parameters: [],
			responses: [
				{ status: "201", description: "The task, created.", schema: TASK },
				{ status: "4XX", description: "The task isn't valid.", schema: ERROR },
			],
		},
		request: {
			method: "POST",
			url: "https://api.example.com/v1/tasks",
			headers: [["Content-Type", "application/json"]],
			body: { title: "Write the stories" },
		},
		response: {
			status: 201,
			headers: [
				["Content-Type", "application/json"],
				["Location", "/v1/tasks/43"],
			],
			body: { id: 43, title: "Write the stories", done: false },
		},
	},
};
