// What the page does for the studio's assistant, when the studio is served
// with an API (scripts/studio-server.mjs): ask the server what it offers and
// for the model's turns. The conversation is studio.tcd's Editor's: its
// transcript is pi's (@earendil-works/pi-ai), the user's messages, the
// model's as the server returns them, and the results of its
// write_component calls; each request sends the transcript and the
// component as it is now, and the server adds the reference
// (studio/assistant/). On a static host, like GitHub Pages, ../api/check
// isn't there, and the studio shows no assistant.

const API = new URL("../api/", import.meta.url);

// What the server can do, or null on a static host: { server, assistant,
// models: [{ provider, id, name }] }.
export async function checkServer() {
	try {
		const res = await fetch(new URL("check", API), { cache: "no-store" });
		if (!res.ok) return null;
		const body = await res.json();
		return body?.server ? body : null;
	} catch {
		return null;
	}
}

const post = async (path, body, signal) => {
	const res = await fetch(new URL(path, API), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
	const out = await res.json().catch(() => ({ error: `the server answered ${res.status}` }));
	if (!res.ok || out.error) throw new Error(out.error ?? `the server answered ${res.status}`);
	return out;
};

// The model's next message: model is "provider/id", component { name, tcd,
// wax }.
export async function askChat(model, messages, component, signal) {
	const [provider, ...rest] = model.split("/");
	return (await post("chat", { model: { provider, id: rest.join("/") }, messages, component }, signal)).message;
}

// What the model is told, for the component as it is.
export const askPrompt = async (component) => (await post("prompt", { component })).prompt;

// The model picked last, kept in this browser.
const MODEL_KEY = "tutuca-wax-studio:model";
export const rememberedModel = () => {
	try {
		return localStorage.getItem(MODEL_KEY);
	} catch {
		return null;
	}
};
export const rememberModel = (value) => {
	try {
		localStorage.setItem(MODEL_KEY, value);
	} catch {}
};

// A diagnostic as the model reads it: file:line:col: severity code: message (hint).
export const diagnosticText = (d) => `${d.span.file}:${d.span.start.line}:${d.span.start.col}: ${d.severity} ${d.code}: ${d.message}${d.hint ? ` (${d.hint})` : ""}`;

// The line of source a span points at, with carets under it, "" when it
// isn't one of sources (a file name to its text): the model can't count
// columns in what it wrote.
export const spanExcerpt = (span, sources) => {
	const line = sources[span.file]?.split("\n")[span.start.line - 1];
	if (line === undefined || span.start.line < 1) return "";
	const n = String(span.start.line);
	const width = span.end.line === span.start.line ? Math.max(1, span.end.col - span.start.col) : 1;
	return `\n  ${n} | ${line}\n  ${" ".repeat(n.length)} | ${" ".repeat(Math.max(0, span.start.col - 1))}${"^".repeat(width)}`;
};

// A diagnostic as the model reads it, with the lines it points at, its
// related places' too.
export const diagnosticReport = (d, sources) =>
	diagnosticText(d) +
	spanExcerpt(d.span, sources) +
	(d.related ?? []).map((r) => `\n  at ${r.span.file}:${r.span.start.line}:${r.span.start.col}: ${r.message}${spanExcerpt(r.span, sources)}`).join("");
