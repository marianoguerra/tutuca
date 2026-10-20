// The chrome of a full screen panel; each panel has the messages of closing().

import { $if, button, field, send, tag } from "../../src/tutuca.js";
import { MUTED } from "./common.js";

const { div, footer, header, h2, p } = tag;

export const panel = ({ title, description, extra = "", progress = null, body, foot }) =>
	div(
		{
			class: "absolute inset-0 z-40 flex flex-col bg-base-100",
			role: "dialog",
			"aria-modal": "true",
			"on:keydown": send("key"),
		},
		header(
			{ class: "shrink-0 border-b border-base-300 pt-2 pb-2" },
			div(
				{ class: "mx-auto flex max-w-2xl items-center gap-2 px-3" },
				button(
					{
						class: "btn btn-ghost btn-square",
						"aria-label": "Close",
						"on:click": send("requestClose"),
					},
					"✕",
				),
				div(
					{ class: "min-w-0 flex-1" },
					div({ class: "truncate text-sm font-medium" }, title),
					$if(description, div({ class: `truncate text-xs ${MUTED}` }, description), ""),
				),
				extra,
			),
		),
		progress === null
			? ""
			: div(
					{ class: "h-0.5 bg-base-200" },
					div({ class: "h-full bg-primary transition-all", style: progress }),
				),
		div(
			{ class: "min-h-0 flex-1 overflow-y-auto overscroll-contain" },
			div({ class: "mx-auto max-w-2xl px-4 py-4" }, body),
		),
		footer(
			{ class: "shrink-0 border-t border-base-300 pt-3 pb-3" },
			div({ class: "mx-auto flex max-w-2xl gap-2 px-4" }, foot),
		),
		$if(
			field("confirming"),
			div(
				{ class: "absolute inset-0 z-50 flex items-center justify-center bg-black/50 p-4" },
				div(
					{
						class:
							"grid w-full max-w-xs gap-4 rounded-lg border border-base-300 bg-base-100 p-6 shadow-lg",
						role: "alertdialog",
					},
					div(
						{ class: "flex flex-col gap-2" },
						h2({ class: "text-lg leading-none font-semibold" }, field("confirmTitle")),
						p({ class: `text-sm ${MUTED}` }, field("confirmText")),
					),
					div(
						{ class: "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end" },
						button(
							{ class: "btn btn-outline btn-sm", "on:click": send("keepEditing") },
							field("keepLabel"),
						),
						button({ class: "btn btn-error btn-sm", "on:click": send("discard") }, "Discard"),
					),
				),
			),
			"",
		),
	);
// Escape and ✕ ask first when the panel has something to lose.
export const closing = (needsConfirm) => ({
	requestClose: {
		args: [],
		emits: { notify: ["closePanel"] },
		run(draft, _args, ctx) {
			if (needsConfirm.call(this)) draft.confirming = true;
			else ctx.notify("closePanel");
		},
	},
	key: {
		args: [],
		emits: { notify: ["closePanel"] },
		run(draft, _args, ctx) {
			if (ctx.event?.key !== "Escape") return;
			if (this.confirming) draft.confirming = false;
			else if (needsConfirm.call(this)) draft.confirming = true;
			else ctx.notify("closePanel");
		},
	},
	keepEditing: {
		args: [],
		run(draft) {
			draft.confirming = false;
		},
	},
	discard: {
		args: [],
		emits: { notify: ["closePanel"] },
		run(draft, _args, ctx) {
			draft.confirming = false;
			ctx.notify("closePanel");
		},
	},
});
export const always = () => true;
