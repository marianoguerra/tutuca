// What the tracker's components share: its look (after shadcn's zinc theme in daisyUI terms),
// small helpers, field types and the app's panels, intervals and tabs.

// Looks, after shadcn's zinc theme in daisyUI terms.
export const MUTED = "text-base-content/60";
export const STICKY =
	"sticky top-0 z-20 border-b border-base-300 bg-base-100/85 px-4 py-2.5 backdrop-blur-lg";
const PILL = "rounded-full border px-3 py-1 text-xs font-medium whitespace-nowrap shrink-0";
const PILL_ON = `${PILL} border-transparent bg-primary text-primary-content`;
const PILL_OFF = `${PILL} border-base-300 ${MUTED}`;
export const SEG = "flex rounded-lg bg-base-200 p-0.5 text-sm font-medium";
const SEG_ON = "flex-1 rounded-md px-1.5 py-1.5 text-xs sm:text-sm bg-base-100 shadow-sm";
const SEG_OFF = `flex-1 rounded-md px-1.5 py-1.5 text-xs sm:text-sm ${MUTED}`;
export const ICON_TOGGLE = "flex size-9 shrink-0 items-center justify-center rounded-md border";
export const BANNER = "mx-4 mt-3 rounded-lg border border-base-300 bg-base-200/40 p-3 text-xs";
export const LINK = "underline underline-offset-2 cursor-pointer";
export const pick = (on) => (on ? PILL_ON : PILL_OFF);
export const seg = (on) => (on ? SEG_ON : SEG_OFF);

export const measureRef = (t) => t.record({ measurementId: t.string(), unit: t.string() });
export const eventRecord = (t) =>
	t.record({
		id: t.string(),
		thingId: t.string(),
		recordedAt: t.number().int(),
		actualAt: t.number().int(),
		measurements: t.array(t.record({ measurementId: t.string(), value: t.number().min(0) })),
		notes: t.string(),
	});

export const PANELS = ["MeasurementWizard", "EventEditor", "ThingEditor", "TagEditor", "EntryList"];
export const INTERVALS = [
	[1, "day"],
	[3, "3d"],
	[7, "week"],
	[14, "14d"],
	[30, "month"],
	[90, "90d"],
	[0, "never"],
];
export const MANAGE_TABS = [
	["things", "Things"],
	["groups", "Tags"],
	["units", "Units"],
	["bundles", "Bundles"],
	["data", "Data"],
];
export const TABS = [
	["track", "⚡", "Track"],
	["insights", "🗓", "Insights"],
	["manage", "⚙", "Manage"],
];
