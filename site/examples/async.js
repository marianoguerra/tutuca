// 4. Talking to the outside world: a component asks, a handler answers later. ctx.ask
// names a handler registered next to the components; its result comes back to the
// component's answers.lookup.ok, and a failure to answers.lookup.error. Handlers are
// swappable: these stories answer from a table, an app would call fetch.
import { $if, component, field, send, t, tag, targetValue } from "tutuca";
import { step, stories } from "tutuca/storybook";

const { button, div, form, input, p, span } = tag;

export const Weather = component({
	name: "Weather",
	fields: {
		city: t.string("Lisbon"),
		status: t.enum("idle", "loading", "done", "failed"),
		report: t.string(),
	},
	methods: {
		get isLoading() {
			return this.status === "loading";
		},
		get hasReport() {
			return this.status === "done" || this.status === "failed";
		},
		get reportClass() {
			return this.status === "failed" ? "alert alert-error" : "alert alert-info";
		},
	},
	view: div(
		{ class: "flex max-w-sm flex-col gap-3" },
		form(
			{ class: "join", "on:submit": send("lookup") },
			input({
				class: "input join-item",
				"aria-label": "City",
				value: field("city"),
				"on:input": send("setCity", targetValue()),
			}),
			button({ class: "btn btn-primary join-item" }, "Look up"),
		),
		$if(field("isLoading"), span({ class: "loading loading-dots" }), ""),
		$if(field("hasReport"), p({ class: field("reportClass") }, field("report")), ""),
	),
	on: {
		setCity(next, [city]) {
			next.city = city;
		},
		lookup: {
			args: [],
			emits: { ask: ["lookup"] },
			run(next, _args, ctx) {
				ctx.event?.preventDefault();
				next.status = "loading";
				ctx.ask("lookup", [this.city]);
			},
		},
	},
	answers: {
		lookup: {
			ok(next, [report]) {
				next.status = "done";
				next.report = report;
			},
			error(next, [error]) {
				next.status = "failed";
				next.report = String(error?.message ?? error);
			},
		},
	},
});

const FORECASTS = { lisbon: "☀️ 24°C", oslo: "🌧️ 9°C", tokyo: "⛅ 18°C" };
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export default stories({
	title: "Weather",
	components: { Weather },
	askHandlers: {
		// Answers after a short wait, so the loading state shows.
		async lookup([city]) {
			await wait(600);
			const forecast = FORECASTS[city.trim().toLowerCase()];
			if (forecast === undefined) throw new Error(`No forecast for ${city}. Try Oslo or Tokyo.`);
			return `${city}: ${forecast}`;
		},
	},
	stories: {
		Lisbon: {
			make: (C) => C.Weather(),
			// Steps run right away, so they send the reply instead of waiting for it.
			sequences: {
				"ask, then answer": [
					step.event("submit", "form"),
					step.check("loading", (s) => s.isLoading),
					step.answer("lookup", "ok", "Lisbon: ☀️ 24°C"),
					step.check("shows the forecast", (s) => s.report.includes("24°C")),
				],
				"ask, then fail": [
					step.event("submit", "form"),
					step.answer("lookup", "error", "offline"),
					step.check("shows the error", (s) => s.status === "failed"),
				],
			},
		},
		Unknown: { make: (C) => C.Weather({ city: "Atlantis" }) },
	},
});
