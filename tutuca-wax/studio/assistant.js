// The studio's assistant: a chat with a model that edits the component open
// in the editor, when the studio is served with an API (scripts/studio-server.mjs).
// On a static host, like GitHub Pages, ../api/check isn't there, and the
// studio shows no assistant.
//
// The transcript is pi's (@earendil-works/pi-ai): the user's messages, the
// model's assistant messages as the server returns them, and the results of
// its write_component calls. Each request sends the transcript and the
// component as it is now; the server adds the reference (studio/assistant/).
// What the model writes is built with tcd; when it doesn't build, the
// diagnostics (and the signatures of the functions still missing) go back as
// the tool's result, and the model is asked again, a few times at most.
import { el } from "../js/page.js";

const API = new URL("../api/", import.meta.url);
// The model's first try, and the fixes after it.
const MAX_ROUNDS = 4;

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

const MODEL_KEY = "tutuca-wax-studio:model";
const remembered = () => {
	try {
		return localStorage.getItem(MODEL_KEY);
	} catch {
		return null;
	}
};
const remember = (value) => {
	try {
		localStorage.setItem(MODEL_KEY, value);
	} catch {}
};

// A diagnostic as the model reads it: file:line:col: severity code: message (hint).
export const diagnosticText = (d) => `${d.span.file}:${d.span.start.line}:${d.span.start.col}: ${d.severity} ${d.code}: ${d.message}${d.hint ? ` (${d.hint})` : ""}`;

// The panel. component() is the component open, or null; write(files)
// replaces its .tcd and .wax with those given and resolves when the editor
// shows them; check() builds it and resolves with { ok, text }, what the
// model is told; keep() saves the component (its chat included).
export function assistantPanel({ server, UI, component, write, check, keep }) {
	const root = el("aside", { class: UI.chat });
	root.hidden = true;
	const modelSelect = el("select", { class: `st-model ${UI.select}`, "aria-label": "Model" });
	const byProvider = Map.groupBy(server.models, (m) => m.provider);
	for (const [provider, list] of byProvider) {
		const group = el("optgroup", { label: provider });
		for (const m of list) group.append(el("option", { value: `${m.provider}/${m.id}` }, m.name));
		modelSelect.append(group);
	}
	const wanted = remembered();
	if (wanted && server.models.some((m) => `${m.provider}/${m.id}` === wanted)) modelSelect.value = wanted;
	modelSelect.addEventListener("change", () => remember(modelSelect.value));
	const log = el("div", { class: UI.chatLog, "aria-live": "polite" });
	const input = el("textarea", { class: UI.chatInput, placeholder: "Ask for a change (Ctrl/Cmd-Enter sends)", "aria-label": "Message to the assistant" });
	const sendButton = el("button", { class: UI.primary }, "Send");
	const stopButton = el("button", { class: UI.button }, "Stop");
	stopButton.hidden = true;
	const clearButton = el("button", { class: UI.button, title: "Start the conversation over" }, "Clear");
	// What the model is doing while a request is in flight, as the last bubble
	// of the transcript, right under the message it answers.
	const busy = el("span");
	const thinking = el("div", { class: UI.chatThinking, role: "status" }, el("span", { class: UI.chatDots }), busy);
	const promptBox = el("pre", { class: UI.chatPrompt });
	const promptDetails = el("details", {}, el("summary", { class: UI.label }, "what the model is told"), promptBox);
	promptDetails.addEventListener("toggle", async () => {
		if (!promptDetails.open) return;
		const c = component();
		promptBox.textContent = "…";
		try {
			promptBox.textContent = (await post("prompt", { component: c && { name: c.name, tcd: c.tcd, wax: c.wax } })).prompt;
		} catch (error) {
			promptBox.textContent = error.message;
		}
	});
	root.append(
		el("div", { class: UI.row }, el("span", { class: UI.label }, "assistant"), modelSelect),
		log,
		input,
		el("div", { class: UI.row }, sendButton, stopButton, clearButton),
		promptDetails,
	);

	let running = null; // the AbortController of the request in flight
	const chatOf = (c) => (c.chat ??= []);

	// ---- Rendering the transcript -------------------------------------------------------

	const textOf = (content) => (typeof content === "string" ? content : content.filter((b) => b.type === "text").map((b) => b.text).join("\n"));
	const bubble = (kind, ...children) => log.append(el("div", { class: UI[kind] }, ...children));
	const render = () => {
		log.textContent = "";
		const c = component();
		if (!c) return;
		for (const m of chatOf(c)) {
			if (m.role === "user") bubble("chatUser", textOf(m.content));
			if (m.role === "assistant") {
				const text = textOf(m.content);
				if (text) bubble("chatAssistant", text);
				for (const call of m.content.filter((b) => b.type === "toolCall")) {
					const files = Object.keys(call.arguments ?? {}).filter((k) => k === "tcd" || k === "wax");
					bubble("chatTool", `✎ wrote ${files.map((f) => `${c.name}.${f}`).join(" and ") || "nothing"}`);
				}
				if (m.stopReason === "error" || m.stopReason === "aborted") bubble("chatError", m.errorMessage ?? m.stopReason);
			}
			if (m.role === "toolResult") {
				const text = textOf(m.content);
				if (m.isError) bubble("chatError", el("details", {}, el("summary", {}, "✗ it didn't build; the model was told why"), el("pre", { class: "whitespace-pre-wrap" }, text)));
				else bubble("chatOk", `✓ ${text}`);
			}
		}
		if (busy.textContent) log.append(thinking);
		log.scrollTop = log.scrollHeight;
	};

	// ---- Asking -----------------------------------------------------------------------------

	const setBusy = (text) => {
		busy.textContent = text;
		if (text) log.append(thinking);
		else thinking.remove();
		log.scrollTop = log.scrollHeight;
		sendButton.disabled = text !== "";
		stopButton.hidden = text === "";
	};

	async function send() {
		const c = component();
		const text = input.value.trim();
		if (!c || !text || running) return;
		const [provider, ...rest] = modelSelect.value.split("/");
		const model = { provider, id: rest.join("/") };
		input.value = "";
		const chat = chatOf(c);
		chat.push({ role: "user", content: text, timestamp: Date.now() });
		await keep(c);
		render();
		running = new AbortController();
		try {
			for (let round = 0; round < MAX_ROUNDS; round++) {
				setBusy(round === 0 ? "thinking…" : `fixing what didn't build (${round} of ${MAX_ROUNDS - 1})…`);
				const { message } = await post("chat", { model, messages: chat, component: { name: c.name, tcd: c.tcd, wax: c.wax } }, running.signal);
				chat.push(message);
				await keep(c);
				render();
				if (message.stopReason === "error" || message.stopReason === "aborted") break;
				const calls = message.content.filter((b) => b.type === "toolCall");
				if (calls.length === 0) break;
				let built = true;
				for (const call of calls) {
					let result;
					if (call.name !== "write_component") {
						result = { ok: false, text: `There's no tool ${call.name}: use write_component.` };
					} else {
						setBusy("building what it wrote…");
						await write(call.arguments ?? {});
						result = await check();
					}
					chat.push({ role: "toolResult", toolCallId: call.id, toolName: call.name, content: [{ type: "text", text: result.text }], isError: !result.ok, timestamp: Date.now() });
					built &&= result.ok;
				}
				await keep(c);
				render();
				if (built) break;
				if (round === MAX_ROUNDS - 1) bubble("chatError", `Still not building after ${MAX_ROUNDS} tries: the diagnostics are in the editor. Say how to go on.`);
			}
		} catch (error) {
			if (error.name !== "AbortError") bubble("chatError", error.message);
		} finally {
			running = null;
			setBusy("");
		}
	}

	sendButton.addEventListener("click", () => send());
	input.addEventListener("keydown", (e) => {
		if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
			e.preventDefault();
			send();
		}
	});
	stopButton.addEventListener("click", () => running?.abort());
	clearButton.addEventListener("click", async () => {
		const c = component();
		if (!c || running) return;
		c.chat = [];
		await keep(c);
		render();
	});

	return {
		root,
		render,
		// Shown: the transcript of the component as it is now, the input focused.
		show: () => {
			root.hidden = false;
			render();
			input.focus();
		},
	};
}
