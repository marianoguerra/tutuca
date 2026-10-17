// TrackerApp's views: Track, Insights, Manage, Data and the import dialog. They are functions
// that build view trees, called once when the app's component is defined.

import {
	$if,
	button,
	each,
	field,
	lookupBind,
	pushView,
	renderEach,
	send,
	sourceKey,
	tag,
	targetValue,
} from "../../src/tutuca.js";
import { BANNER, ICON_TOGGLE, LINK, MUTED, SEG, STICKY } from "./common.js";

const { div, h1, h2, h3, input, label, li, p, section, span, textarea, ul } = tag;

export function trackView() {
	return $if(
		field("isTrack"),
		div(
			{},
			$if(
				field("hasThings"),
				div(
					{},
					div(
						{ class: `${STICKY} flex items-center gap-2` },
						div(
							{ class: "relative flex-1" },
							span({ class: `absolute top-1/2 left-2.5 -translate-y-1/2 text-sm ${MUTED}` }, "⌕"),
							input({
								type: "search",
								class: "input input-sm w-full pl-8",
								placeholder: "Search things…",
								"aria-label": "Search things",
								value: field("query"),
								"@on.input": send("setQuery", targetValue()),
							}),
						),
						button(
							{
								class: `${ICON_TOGGLE} border-base-300 ${MUTED}`,
								"aria-label": field("collapseLabel"),
								title: field("collapseLabel"),
								"@on.click": send("toggleAllSections"),
							},
							field("collapseIcon"),
						),
						button(
							{
								class: field("compactClass"),
								"aria-label": field("compactLabel"),
								title: field("compactLabel"),
								"aria-pressed": $if(field("compact"), "true", "false"),
								"@on.click": send("toggleCompact"),
							},
							"▦",
						),
					),
					$if(
						field("backupDue"),
						div(
							{ class: BANNER },
							p({ class: "font-medium" }, field("backupTitle")),
							p({ class: `mt-0.5 ${MUTED}` }, field("backupText")),
							div(
								{ class: "mt-1 flex gap-3" },
								button({ class: LINK, "@on.click": send("backupNow") }, "Back up now"),
								button({ class: LINK, "@on.click": send("backupLater") }, "Later"),
							),
						),
						"",
					),
					$if(
						field("noMatches"),
						div(
							{ class: "space-y-3 px-4 py-10 text-center" },
							p({ class: `text-sm ${MUTED}` }, field("noMatchText")),
							button(
								{ class: "btn btn-primary btn-sm", "@on.click": send("newThingFromQuery") },
								field("createText"),
							),
						),
						div({ class: "pb-4" }, pushView(field("gridView"), renderEach(field("sections")))),
					),
				),
				div(
					{ class: "flex flex-col items-center gap-6 px-6 py-16 text-center" },
					div({ class: "text-5xl" }, "⚡"),
					div(
						{ class: "space-y-1.5" },
						h1({ class: "text-lg font-semibold" }, "Nothing to track yet"),
						p(
							{ class: `max-w-xs text-sm ${MUTED}` },
							"Start from a ready-made bundle, or add your own thing. Either way, one tap logs it.",
						),
					),
					div(
						{ class: "flex w-full max-w-xs flex-col gap-2" },
						button(
							{ class: "btn btn-primary", "@on.click": send("browseBundles") },
							"Browse bundles",
						),
						button(
							{ class: "btn btn-outline", "@on.click": send("newThing", "") },
							"Create a thing",
						),
					),
				),
			),
		),
		"",
	);
}

export function insightsView() {
	return $if(
		field("isInsights"),
		div(
			{},
			div(
				{ class: `${STICKY} space-y-2` },
				div(
					{ class: "flex items-center gap-2" },
					div(
						{ class: `${SEG} flex-1`, role: "group", "aria-label": "Granularity" },
						each(
							field("granularityButtons"),
							button(
								{
									class: field("cls"),
									value: field("value"),
									"@on.click": send("setGranularity", targetValue()),
								},
								field("text"),
							),
						),
					),
					button(
						{
							class: `size-9 rounded-md border border-base-300 ${MUTED}`,
							"aria-label": "All entries",
							title: "All entries",
							"@on.click": send("openAllEntries"),
						},
						"☰",
					),
				),
				$if(
					field("hasUsedGroups"),
					div(
						{ class: "-mx-1 flex gap-1.5 overflow-x-auto px-1" },
						button({ class: field("allChipClass"), "@on.click": send("clearGroupFilter") }, "All"),
						each(
							field("groups"),
							button(
								{ class: lookupBind("chip"), "@on.click": send("setGroupFilter", sourceKey()) },
								field("title"),
							),
							"usedGroups",
						),
					),
					"",
				),
			),
			$if(
				field("noEvents"),
				div(
					{ class: "flex flex-col items-center gap-3 px-6 py-16 text-center" },
					div({ class: "text-4xl" }, "🗓️"),
					p(
						{ class: `text-sm ${MUTED}` },
						"Nothing logged yet. Entries show up here grouped by day, week or month.",
					),
				),
				div(renderEach(field("buckets"))),
			),
		),
		"",
	);
}

function searchBox(placeholder) {
	return input({
		type: "search",
		class: "input input-sm mb-3 w-full",
		placeholder,
		"aria-label": placeholder,
		value: field("manageQuery"),
		"@on.input": send("setManageQuery", targetValue()),
	});
}
export function manageView() {
	return $if(
		field("isManage"),
		div(
			{},
			div(
				{ class: STICKY },
				div(
					{ class: SEG, role: "tablist" },
					each(
						field("manageTabs"),
						button(
							{
								class: field("cls"),
								role: "tab",
								value: field("id"),
								"@on.click": send("setManageTab", targetValue()),
							},
							field("text"),
						),
					),
				),
			),
			$if(
				field("isThingsTab"),
				div(
					{ class: "p-4" },
					button(
						{ class: "btn btn-primary mb-3 w-full", "@on.click": send("newThing", "") },
						"＋ New thing",
					),
					$if(
						field("thingsEmpty"),
						p({ class: `text-sm ${MUTED}` }, "No things yet. Add one, or load a bundle."),
						div(
							searchBox("Search things…"),
							ul(
								{ class: "divide-y divide-base-300/60" },
								renderEach(field("things"), "manageThings"),
							),
						),
					),
				),
				"",
			),
			$if(
				field("isGroupsTab"),
				div(
					{ class: "p-4" },
					button(
						{ class: "btn btn-primary mb-3 w-full", "@on.click": send("newTag") },
						"＋ New tag",
					),
					searchBox("Search tags…"),
					p(
						{ class: `mb-3 text-xs ${MUTED}` },
						"Tags are yours alone — they organise your things and are what you share. Someone importing your tags can file the same things however they like.",
					),
					$if(
						field("groupsEmpty"),
						p(
							{ class: `text-sm ${MUTED}` },
							"No tags yet. Things without tags still show up under “Ungrouped”.",
						),
						ul(
							{ class: "divide-y divide-base-300/60" },
							renderEach(field("groups"), "manageGroups"),
						),
					),
				),
				"",
			),
			$if(
				field("isUnitsTab"),
				div(
					{ class: "p-4" },
					p(
						{ class: `mb-3 text-xs ${MUTED}` },
						"Quantities a thing can record. Metric and imperial units sit inside the same measurement, so values are stored once and everyone reads them in whichever unit they think in.",
					),
					searchBox("Search measurements…"),
					ul(
						{ class: "divide-y divide-base-300/60" },
						each(
							field("unitRows"),
							li(
								{ class: "py-2.5" },
								div(
									{ class: "flex items-center gap-3" },
									span({ class: "emoji text-xl" }, field("emoji")),
									span({ class: "flex-1 text-sm font-medium" }, field("name")),
									span({ class: `text-xs ${MUTED}` }, field("usage")),
								),
								div({ class: `pl-8 text-xs ${MUTED}` }, field("units")),
							),
						),
					),
				),
				"",
			),
			$if(
				field("isBundlesTab"),
				div(
					{ class: "p-4" },
					p(
						{ class: `mb-3 text-xs ${MUTED}` },
						"Ready-made sets of things to track. Everyone who loads a bundle gets the same identifiers, so data recorded against it can be compared later.",
					),
					searchBox("Search bundles…"),
					div(
						{ class: "flex flex-col gap-2" },
						each(
							field("bundleCards"),
							div(
								{
									class:
										"flex items-start gap-3 rounded-xl border border-base-300/60 bg-base-100 p-3",
								},
								span({ class: "emoji text-2xl" }, field("emoji")),
								div(
									{ class: "min-w-0 flex-1" },
									h3(
										{ class: "flex items-baseline gap-2 truncate text-sm font-medium" },
										field("title"),
										$if(field("added"), span({ class: `text-[0.6875rem] ${MUTED}` }, "added"), ""),
									),
									p({ class: `text-xs ${MUTED}` }, field("description")),
									p({ class: "text-[0.6875rem] opacity-50" }, field("counts")),
								),
								button(
									{
										class: field("cls"),
										value: field("id"),
										"@on.click": send("addBundle", targetValue()),
									},
									field("action"),
								),
							),
						),
					),
				),
				"",
			),
			$if(field("isDataTab"), dataView(), ""),
		),
		"",
	);
}
function dataView() {
	const heading = (text) => h2({ class: "text-sm font-medium" }, text);
	const hr = div({ class: "h-px w-full bg-base-300" });
	return div(
		{ class: "space-y-5 p-4" },
		section(
			{ class: "space-y-1" },
			heading("On this device"),
			p({ class: "text-sm" }, field("countsText")),
			p(
				{ class: `text-xs ${MUTED}` },
				"Everything lives in this browser. No account, no server — which also means a backup is the only copy that survives clearing site data.",
			),
		),
		hr,
		section(
			{ class: "space-y-2" },
			heading("Backup"),
			p(
				{ class: `text-xs ${MUTED}` },
				"A single JSON file with every thing, tag and entry — for safekeeping or for analysing elsewhere.",
			),
			button(
				{ class: "btn btn-primary w-full", "@on.click": send("exportAll") },
				"⤓ Export everything",
			),
			p({ class: `text-xs ${MUTED}` }, field("backupStatus")),
			div(
				{ class: "flex flex-wrap items-center gap-1.5" },
				span({ class: `text-xs ${MUTED}` }, "Remind me every"),
				each(
					field("intervalChips"),
					button(
						{
							class: field("cls"),
							value: field("value"),
							"@on.click": send("setInterval", targetValue()),
						},
						field("text"),
					),
				),
			),
		),
		hr,
		section(
			{ class: "space-y-2" },
			heading("Restore or import"),
			p(
				{ class: `text-xs ${MUTED}` },
				"Open a backup or a shared tag pack. You'll see exactly what changes before anything is written.",
			),
			div(
				{ class: "flex gap-2" },
				each(
					field("modeButtons"),
					button(
						{
							class: field("cls"),
							value: field("value"),
							"@on.click": send("setImportMode", targetValue()),
						},
						field("text"),
					),
				),
			),
			p({ class: `text-xs ${MUTED}` }, field("modeText")),
			label(
				{ class: "btn btn-outline w-full" },
				"⤒ Choose a file",
				input({
					type: "file",
					accept: "application/json,.json",
					class: "hidden",
					"@on.change": send("chooseFile"),
				}),
			),
			textarea({
				class: "textarea w-full font-mono text-xs",
				rows: "3",
				placeholder: "…or paste a backup or tag pack",
				"aria-label": "Paste a file",
				value: field("importText"),
				"@on.input": send("setImportText", targetValue()),
			}),
			button(
				{ class: "btn btn-outline btn-sm w-full", "@on.click": send("previewImport") },
				"Preview import",
			),
		),
	);
}
export function importDialog() {
	return div(
		{ class: "absolute inset-0 z-50 flex items-center justify-center bg-black/50 p-4" },
		div(
			{
				class:
					"grid w-full max-w-md gap-4 rounded-lg border border-base-300 bg-base-100 p-6 shadow-lg",
				role: "dialog",
				"aria-label": "Import preview",
			},
			div(
				{ class: "flex flex-col gap-2" },
				h2({ class: "text-lg leading-none font-semibold" }, field("importTitle")),
				p({ class: `text-sm ${MUTED}` }, field("previewDescription")),
			),
			ul(
				{ class: "space-y-1 text-sm" },
				each(field("previewLines"), li("· ", lookupBind("value"))),
			),
			ul(
				{ class: `space-y-1 text-xs ${MUTED}` },
				each(field("previewWarnings"), li("⚠ ", lookupBind("value"))),
			),
			$if(
				field("previewCanOverwrite"),
				label(
					{ class: "flex items-start gap-2 text-sm" },
					input({
						type: "checkbox",
						class: "checkbox checkbox-sm",
						checked: field("overwrite"),
						"@on.change": send("setOverwrite", targetValue()),
					}),
					span(
						{},
						"Update details of things I already have",
						span(
							{ class: `block text-xs ${MUTED}` },
							"Names, emoji and what gets recorded — so ticking this is how an updated bundle adds a measurement to a thing you already have. Off by default: your own edits win. Ids never change either way, so entries you've already recorded stay attached.",
						),
					),
				),
				"",
			),
			div(
				{ class: "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end" },
				button({ class: "btn btn-outline btn-sm", "@on.click": send("cancelImport") }, "Cancel"),
				button(
					{
						class: field("confirmImportClass"),
						disabled: field("previewNoop"),
						"@on.click": send("confirmImport"),
					},
					field("confirmImportLabel"),
				),
			),
		),
	);
}
