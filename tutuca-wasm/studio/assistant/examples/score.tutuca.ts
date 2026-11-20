// Example: whole numbers (numbers constrained with int), arithmetic and comparisons on them,
// Math.floor, Math.ceil, Math.min and Math.max, a loop over range, and a query with an argument
// a view reads. A scoreboard for two teams playing to a target, as in truco: points are added,
// the leader and the gap are computed, and a game is won once a team reaches the target.
import { button, div, field, input, progress, query, send, span, targetValue, when } from "tutuca/view";
import { range } from "tutuca/data";

/** A team, as an add's or undo's argument. */
export type Team = "ours" | "theirs";

/** A box for every 5 points, then the rest: 13 is "▣▣ +3". */
function tally(points: number): string {
	let text = "";
	for (const _ of range(0, Math.floor(points / 5))) text += "▣";
	const rest = points % 5;
	return rest > 0 ? `${text} +${rest}` : text;
}

/** Two teams' points, up to target. */
export type Score = {
	oursName: string;
	theirsName: string;
	ours: number;
	theirs: number;
	/** Points that win a game: 15, 24 or 30. */
	target: number;
	/** "Us leads by 3", "Tied", or "Them won". */
	readonly status: string;
	/** The points still missing for the leader: target minus the higher score. */
	readonly left: number;
	/** The higher score as a share of the target, rounded up to a percent. */
	readonly percent: number;
	/** Whether a team has reached the target. */
	readonly over: boolean;
	/** Each team's points tallied as truco does, a box per 5 and the rest: "▣▣ +3" for 13. */
	readonly oursTally: string;
	readonly theirsTally: string;
};

export const Score = {
	defaults: { oursName: "Us", theirsName: "Them", ours: 0, theirs: 0, target: 30 },
	constraints: {
		ours: { int: true, min: 0, max: 99 },
		theirs: { int: true, min: 0, max: 99 },
		target: { int: true, min: 1, max: 99 },
		left: { int: true, min: 0 },
		percent: { int: true, min: 0, max: 100 },
	},
	queries: {
		get over(): boolean {
			return this.ours >= this.target || this.theirs >= this.target;
		},
		get left(): number {
			return Math.max(this.target - Math.max(this.ours, this.theirs), 0);
		},
		/** Rounded up: 7 of 30 is 23.3%, shown as 24. */
		get percent(): number {
			return Math.min(Math.ceil((Math.max(this.ours, this.theirs) * 100) / this.target), 100);
		},
		get status(): string {
			if (this.ours === this.theirs) return "Tied";
			const leader = this.ours > this.theirs ? this.oursName : this.theirsName;
			if (this.over) return `${leader} won`;
			return `${leader} leads by ${Math.abs(this.ours - this.theirs)}`;
		},
		get oursTally(): string {
			return tally(this.ours);
		},
		get theirsTally(): string {
			return tally(this.theirs);
		},
		/** Whether the target is n: the setting's button shown active. */
		targetIs(n: number): boolean {
			return this.target === n;
		},
	},
	on: {
		/** Points for a team, kept within the target; none once the game is over. pre is only
		 * checked in dev mode: the handler checks it too. */
		add: {
			pure: true,
			changes: ["ours", "theirs"],
			constraints: { points: { int: true, min: 1, max: 4 } },
			pre(prev, [team, points]: [Team, number]) {
				return !this.over;
			},
			run(next, [team, points]: [Team, number]) {
				if (this.over) return;
				if (team === "ours") next.ours = Math.min(this.ours + points, this.target);
				else next.theirs = Math.min(this.theirs + points, this.target);
			},
		},
		/** Takes a point back from a team, never below 0. */
		undo: {
			pure: true,
			changes: ["ours", "theirs"],
			run(next, [team]: [Team]) {
				if (team === "ours") next.ours = Math.max(this.ours - 1, 0);
				else next.theirs = Math.max(this.theirs - 1, 0);
			},
		},
		/** A lower target brings the scores down to it. */
		setTarget: {
			pure: true,
			changes: ["target", "ours", "theirs"],
			constraints: { target: { int: true, min: 1, max: 99 } },
			run(next, [target]: [number]) {
				next.target = target;
				next.ours = Math.min(this.ours, target);
				next.theirs = Math.min(this.theirs, target);
			},
		},
		rename: {
			pure: true,
			changes: ["oursName", "theirsName"],
			constraints: { name: { maxLength: 24 } },
			run(next, [team, name]: [Team, string]) {
				if (team === "ours") next.oursName = name;
				else next.theirsName = name;
			},
		},
		reset: {
			pure: true,
			changes: ["ours", "theirs"],
			post(prev, next, []: []) {
				return next.ours === 0 && next.theirs === 0;
			},
			run(next, []: []) {
				next.ours = 0;
				next.theirs = 0;
			},
		},
	},
	view: div(
		{ class: "score card card-border bg-base-100 p-4 gap-3" },
		div(
			{ class: "grid grid-cols-2 gap-4 text-center" },
			div(
				{ class: "flex flex-col gap-1" },
				span({ class: "text-sm opacity-70" }, field("oursName")),
				span({ class: "score-ours text-4xl font-bold tabular-nums" }, field("ours")),
				span({ class: "score-tally text-sm opacity-70" }, field("oursTally")),
				div(
					{ class: "join justify-center" },
					button({ class: "btn btn-xs join-item", "on:click": send("undo", "ours") }, "−1"),
					button({ class: "btn btn-xs join-item", "on:click": send("add", "ours", 1) }, "+1"),
					button({ class: "btn btn-xs join-item", "on:click": send("add", "ours", 3) }, "+3"),
				),
			),
			div(
				{ class: "flex flex-col gap-1" },
				span({ class: "text-sm opacity-70" }, field("theirsName")),
				span({ class: "score-theirs text-4xl font-bold tabular-nums" }, field("theirs")),
				span({ class: "score-tally text-sm opacity-70" }, field("theirsTally")),
				div(
					{ class: "join justify-center" },
					button({ class: "btn btn-xs join-item", "on:click": send("undo", "theirs") }, "−1"),
					button({ class: "btn btn-xs join-item", "on:click": send("add", "theirs", 1) }, "+1"),
					button({ class: "btn btn-xs join-item", "on:click": send("add", "theirs", 3) }, "+3"),
				),
			),
		),
		progress({ class: "progress progress-primary w-full", max: "100", value: field("percent") }),
		div(
			{ class: "flex items-center gap-2 text-sm" },
			span(
				{ class: when(field("over"), "score-status flex-1 font-semibold text-success", "score-status flex-1") },
				field("status"),
			),
			span({ class: "opacity-60 tabular-nums" }, field("left"), " left"),
			button({ class: "btn btn-xs btn-ghost", "on:click": send("reset") }, "reset"),
		),
	),
	views: {
		layoutEdit: div(
			{ class: "score card card-border border-dashed bg-base-100 p-4 gap-2" },
			input({
				class: "input input-xs",
				"aria-label": "Our name",
				value: field("oursName"),
				"on:input": send("rename", "ours", targetValue()),
			}),
			input({
				class: "input input-xs",
				"aria-label": "Their name",
				value: field("theirsName"),
				"on:input": send("rename", "theirs", targetValue()),
			}),
			div(
				{ class: "flex items-center gap-2 text-sm" },
				span({}, "Play to"),
				div(
					{ class: "join" },
					button(
						{
							class: when(query("targetIs", 15), "btn btn-xs join-item btn-active", "btn btn-xs join-item"),
							"on:click": send("setTarget", 15),
						},
						"15",
					),
					button(
						{
							class: when(query("targetIs", 24), "btn btn-xs join-item btn-active", "btn btn-xs join-item"),
							"on:click": send("setTarget", 24),
						},
						"24",
					),
					button(
						{
							class: when(query("targetIs", 30), "btn btn-xs join-item btn-active", "btn btn-xs join-item"),
							"on:click": send("setTarget", 30),
						},
						"30",
					),
				),
			),
		),
	},
	examples: {
		playToTheEnd: {
			start: { target: 15 },
			steps: [
				{ send: "add", args: ["ours", 4] },
				{ send: "add", args: ["ours", 4] },
				{ send: "add", args: ["ours", 4] },
				{ send: "add", args: ["ours", 4] },
				{ expect: { ours: 15, over: true } },
			],
		},
		undoStopsAtZero: {
			start: { ours: 1 },
			steps: [{ send: "undo", args: ["ours"] }, { send: "undo", args: ["ours"] }, { expect: { ours: 0 } }],
		},
	},
};

export const register = { Score: "Score" };
