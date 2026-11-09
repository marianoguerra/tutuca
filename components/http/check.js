// What an HTTP exchange means, on plain JSON: a request is { method, url, headers, body,
// bodyType }, a response { status, headers, body, bodyType }, headers a list of [name, value],
// body a JSON value, or text when bodyType is "text", or undefined; an operation is OpenAPI's, with its method and path. Each check is { ok, text }.
import { validate } from "../llm/validate.js";

// The value of the header name in headers, whatever its case, or undefined.
export const headerOf = (headers, name) =>
	headers.find(([n]) => n.toLowerCase() === name.toLowerCase())?.[1];

// What each method promises: safe ones don't change anything, idempotent ones change it the
// same however many times they're sent.
export const METHODS = {
	GET: { safe: true, idempotent: true, body: false },
	HEAD: { safe: true, idempotent: true, body: false },
	OPTIONS: { safe: true, idempotent: true, body: false },
	POST: { safe: false, idempotent: false, body: true },
	PUT: { safe: false, idempotent: true, body: true },
	PATCH: { safe: false, idempotent: false, body: true },
	DELETE: { safe: false, idempotent: true, body: false },
};
export const methodTraits = (method) => {
	const m = METHODS[method];
	if (m === undefined) return "";
	if (m.safe) return "Safe: it only reads, so it can be retried, prefetched and cached.";
	if (m.idempotent) return "Idempotent: sending it twice leaves the same as sending it once.";
	return "Neither safe nor idempotent: sending it twice may do it twice.";
};

// A URL's parts: its origin, path and query parameters, or ok false when it doesn't parse.
export const parseUrl = (url) => {
	try {
		const u = new URL(url);
		return {
			ok: true,
			origin: u.origin,
			path: u.pathname,
			query: [...u.searchParams.entries()],
			target: u.pathname + u.search,
			host: u.host,
		};
	} catch {
		return { ok: false, origin: "", path: "", query: [], target: url, host: "" };
	}
};

export const REASONS = {
	100: "Continue",
	101: "Switching Protocols",
	200: "OK",
	201: "Created",
	202: "Accepted",
	204: "No Content",
	206: "Partial Content",
	301: "Moved Permanently",
	302: "Found",
	303: "See Other",
	304: "Not Modified",
	307: "Temporary Redirect",
	308: "Permanent Redirect",
	400: "Bad Request",
	401: "Unauthorized",
	403: "Forbidden",
	404: "Not Found",
	405: "Method Not Allowed",
	406: "Not Acceptable",
	409: "Conflict",
	410: "Gone",
	412: "Precondition Failed",
	415: "Unsupported Media Type",
	422: "Unprocessable Content",
	429: "Too Many Requests",
	500: "Internal Server Error",
	502: "Bad Gateway",
	503: "Service Unavailable",
	504: "Gateway Timeout",
};
// A status's class: what its first digit says, and the badge it shows with.
export const STATUS_CLASSES = {
	1: { label: "Informational", badge: "badge-neutral", means: "Hold on: more is coming." },
	2: { label: "Success", badge: "badge-success", means: "It worked." },
	3: {
		label: "Redirection",
		badge: "badge-info",
		means: "Look elsewhere: another URL, or the copy you already have.",
	},
	4: {
		label: "Client error",
		badge: "badge-warning",
		means: "The request is wrong: sending it again as it is won't help.",
	},
	5: {
		label: "Server error",
		badge: "badge-error",
		means: "The server failed: the same request may work later.",
	},
};
// The class of a status HTTP doesn't define.
const UNKNOWN_STATUS = {
	label: "Unknown",
	badge: "badge-ghost",
	means: "Not a status HTTP defines.",
};
export const statusClass = (status) => STATUS_CLASSES[Math.floor(status / 100)] ?? UNKNOWN_STATUS;
// Every badge a status shows with, as statusClass gives them.
export const STATUS_BADGES = [...Object.values(STATUS_CLASSES), UNKNOWN_STATUS]
	.map((c) => c.badge)
	.join(" ");

// What some headers are for, to explain them where they show.
export const HEADER_DOCS = {
	accept: "The media types the client takes in the response, most wanted first.",
	"accept-encoding": "The compressions the client can undo, like gzip or br.",
	"access-control-allow-origin":
		"Which origin's scripts may read the response (CORS): one origin, or * for any.",
	"access-control-allow-methods": "The methods a cross-origin request may use (CORS preflight).",
	"access-control-allow-headers": "The headers a cross-origin request may send (CORS preflight).",
	authorization: "The client's credentials, like Bearer and a token.",
	"cache-control": "Who may keep a copy of the response, and for how long.",
	"content-length": "How many bytes the body has.",
	"content-type": "The media type of the body, like application/json.",
	cookie: "The cookies the client has for this site.",
	etag: "A version of the resource: send it back in If-None-Match to ask if it changed.",
	"if-none-match": "Answer 304 Not Modified when the resource's ETag is still this.",
	"last-modified": "When the resource last changed.",
	location: "Where the new resource is (201) or where to go instead (3xx).",
	origin: "The origin of the page that sent the request, for CORS.",
	"retry-after": "How many seconds to wait before trying again.",
	"set-cookie": "A cookie for the client to keep and send back.",
	"user-agent": "What client sent the request.",
	vary: "The request headers the response depends on, for caches to key it by.",
	"www-authenticate": "How to authenticate, with a 401.",
};
export const headerDoc = (name) => HEADER_DOCS[name.toLowerCase()] ?? "";

// What caches may do with a response, said in a few sentences.
export const cachingOf = ({ status, headers }) => {
	const cc = (headerOf(headers, "Cache-Control") ?? "")
		.split(",")
		.map((d) => d.trim().toLowerCase())
		.filter((d) => d !== "");
	const has = (d) => cc.includes(d);
	const maxAge = cc.find((d) => d.startsWith("max-age="))?.slice(8);
	const out = [];
	if (has("no-store")) return ["No cache keeps it (no-store): every request goes to the server."];
	if (cc.length === 0) {
		out.push(
			[200, 203, 204, 300, 301, 404, 405, 410, 414, 501].includes(status)
				? "No Cache-Control: caches may keep it for as long as their heuristics say."
				: "No Cache-Control, and this status isn't cacheable by default: nobody keeps it.",
		);
	}
	if (has("private")) out.push("Only the browser's own cache keeps it (private), no shared ones.");
	else if (has("public")) out.push("Shared caches, like CDNs, may keep it too (public).");
	if (has("no-cache"))
		out.push("A cache keeps it but asks the server before every use (no-cache).");
	else if (maxAge !== undefined) {
		out.push(`It's fresh for ${maxAge} seconds: until then a cache answers without asking.`);
	}
	const etag = headerOf(headers, "ETag");
	if (etag !== undefined) {
		out.push(
			`Once stale, a cache asks with If-None-Match: ${etag}, and a 304 means its copy is still good.`,
		);
	}
	return out;
};

// The message as it goes over the wire in HTTP/1.1.
const bodyText = (body) =>
	body === undefined ? "" : `\n${typeof body === "string" ? body : JSON.stringify(body, null, 2)}`;
const headerLines = (headers) => headers.map(([n, v]) => `${n}: ${v}\n`).join("");
export const rawRequest = ({ method, url, headers, body }) => {
	const { target, host } = parseUrl(url);
	const hostLine = host === "" || headerOf(headers, "Host") !== undefined ? "" : `Host: ${host}\n`;
	return `${method} ${target} HTTP/1.1\n${hostLine}${headerLines(headers)}${bodyText(body)}`;
};
export const rawResponse = ({ status, headers, body }) =>
	`HTTP/1.1 ${status} ${REASONS[status] ?? ""}\n${headerLines(headers)}${bodyText(body)}`;

// An OpenAPI path, like /tasks/{taskId}, against a URL's path: the path parameters and the base
// before it (the server's, like /v1), or null when it doesn't match.
export const matchPath = (template, path) => {
	const want = template.split("/").filter(Boolean);
	const got = path.split("/").filter(Boolean);
	if (got.length < want.length) return null;
	const base = got.slice(0, got.length - want.length);
	const rest = got.slice(base.length);
	const params = {};
	for (let i = 0; i < want.length; i++) {
		const m = /^\{(.+)\}$/.exec(want[i]);
		if (m) params[m[1]] = decodeURIComponent(rest[i]);
		else if (want[i] !== rest[i]) return null;
	}
	return { params, base: base.length === 0 ? "" : `/${base.join("/")}` };
};

// A parameter's text as its schema's type reads it: a number, a boolean, or the text.
const coerce = (text, schema) => {
	const type = schema?.type;
	if ((type === "integer" || type === "number") && text.trim() !== "" && !Number.isNaN(+text)) {
		return Number(text);
	}
	if (type === "boolean" && (text === "true" || text === "false")) return text === "true";
	return text;
};
const problemsText = (problems) => problems.map((p) => `${p.path} ${p.message}`).join("; ");
const JSON_TYPE = "application/json";
const mediaType = (message) =>
	(headerOf(message.headers, "Content-Type") ?? "").split(";")[0].trim().toLowerCase();
const parsed = (text) => {
	try {
		return { ok: true, value: JSON.parse(text) };
	} catch {
		return { ok: false };
	}
};
// The body as a schema reads it: a JSON body as it is, a text one parsed when its Content-Type
// says JSON and it parses, or as a string.
const bodyValue = (message) => {
	if (message.bodyType !== "text" || mediaType(message) !== JSON_TYPE) return message.body;
	const p = parsed(message.body);
	return p.ok ? p.value : message.body;
};
const jsonSchemaOf = (content) => content?.[JSON_TYPE]?.schema;

// The response an operation documents for status: its own, its class's (2XX) or the default.
export const documentedResponse = (responses, status) => {
	const key = [String(status), `${String(status)[0]}XX`, "default"].find((k) => k in responses);
	return key === undefined ? null : { key, ...responses[key] };
};

// Whether an exchange follows an operation, and what the browser makes of it.
export const checkExchange = (operation, request, response) => {
	const checks = [];
	const check = (ok, text) => checks.push({ ok, text });
	const url = parseUrl(request.url);
	if (!url.ok) {
		check(false, `${request.url} isn't a URL.`);
		return checks;
	}
	if (operation !== null) {
		const op = `${operation.method} ${operation.path}`;
		const match = matchPath(operation.path, url.path);
		if (operation.method !== request.method) {
			check(false, `It's ${request.method}, the operation ${op} is ${operation.method}.`);
		} else if (match === null) {
			check(false, `${url.path} isn't ${operation.path}.`);
		} else {
			check(
				true,
				`${request.method} ${url.path} is ${op}${match.base === "" ? "" : `, under ${match.base}`}.`,
			);
		}
		const pathParams = match?.params ?? {};
		for (const param of operation.parameters ?? []) {
			const where = param.in;
			const text =
				where === "path"
					? pathParams[param.name]
					: where === "query"
						? url.query.find(([k]) => k === param.name)?.[1]
						: where === "header"
							? headerOf(request.headers, param.name)
							: undefined;
			const what = `The ${where} parameter ${param.name}`;
			if (text === undefined) {
				if (param.required || where === "path") check(false, `${what} is missing.`);
				continue;
			}
			const problems = param.schema ? validate(param.schema, coerce(text, param.schema)) : [];
			if (problems.length === 0) check(true, `${what} is ${JSON.stringify(text)}.`);
			else check(false, `${what}, ${JSON.stringify(text)}: ${problemsText(problems)}.`);
		}
		const requestSchema = jsonSchemaOf(operation.requestBody?.content);
		if (request.body === undefined) {
			if (operation.requestBody?.required) check(false, "The request needs a body, and has none.");
		} else if (operation.requestBody === undefined) {
			check(false, "The request has a body the operation doesn't take.");
		} else if (requestSchema !== undefined) {
			const problems = validate(requestSchema, bodyValue(request));
			check(
				problems.length === 0,
				problems.length === 0
					? "The request's body matches its schema."
					: `The request's body doesn't match its schema: ${problemsText(problems)}.`,
			);
		}
		const documented = documentedResponse(operation.responses ?? {}, response.status);
		if (documented === null) {
			check(false, `The operation doesn't document a ${response.status} response.`);
		} else {
			check(true, `${response.status} is documented: ${documented.description ?? ""}`.trim());
			const schema = jsonSchemaOf(documented.content);
			if (schema !== undefined && response.body !== undefined) {
				const problems = validate(schema, bodyValue(response));
				check(
					problems.length === 0,
					problems.length === 0
						? "The response's body matches its schema."
						: `The response's body doesn't match its schema: ${problemsText(problems)}.`,
				);
			} else if (schema !== undefined) {
				check(false, `A ${documented.key} response has a body, and this one has none.`);
			}
		}
	}
	for (const [message, side] of [
		[request, "request"],
		[response, "response"],
	]) {
		if (message.body === undefined) continue;
		const type = headerOf(message.headers, "Content-Type") ?? "";
		const isJson = mediaType(message) === JSON_TYPE;
		if (message.bodyType === "text") {
			if (type === "") check(false, `The ${side} has a text body and no Content-Type.`);
			else if (isJson && !parsed(message.body).ok) {
				check(false, `The ${side}'s Content-Type is ${type}, and its text isn't JSON.`);
			} else check(true, `The ${side}'s Content-Type is ${type}.`);
			continue;
		}
		check(
			isJson,
			type === ""
				? `The ${side} has a JSON body and no Content-Type.`
				: `The ${side}'s Content-Type is ${type}${isJson ? "" : ", its body is JSON"}.`,
		);
	}
	if (request.body !== undefined && METHODS[request.method]?.body === false) {
		check(false, `A ${request.method} with a body: servers and caches may ignore it.`);
	}
	const origin = headerOf(request.headers, "Origin");
	if (origin !== undefined && origin !== url.origin) {
		const allowed = headerOf(response.headers, "Access-Control-Allow-Origin");
		if (allowed === "*" || allowed === origin) {
			check(true, `CORS: ${allowed} lets a page on ${origin} read the response.`);
		} else {
			check(
				false,
				allowed === undefined
					? `CORS: no Access-Control-Allow-Origin, so the browser hides the response from ${origin}.`
					: `CORS: it allows ${allowed}, not ${origin}: the browser hides the response.`,
			);
		}
	}
	return checks;
};
