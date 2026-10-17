// The bundles that ship with thing-tracker (src/bundles/definitions.ts), verbatim: groups
// of things, each thing optionally recording measurements in a preferred unit.
/**
 * The bundles that ship with the app.
 *
 * Slugs are identity — see README.md. Titles and emoji are presentation and can
 * be improved freely; slugs cannot be renamed or reused for a new meaning.
 */

const habits = {
	slug: "habits",
	title: "Habits",
	emoji: "🔁",
	description: "Food, exercise, sleep and everyday activities — a broad starting point.",
	version: 1,
	groups: [
		{
			slug: "food",
			title: "Food",
			emoji: "🍎",
			things: [
				{ slug: "breakfast", emoji: "🥣", title: "Breakfast" },
				{ slug: "lunch", emoji: "🥗", title: "Lunch" },
				{ slug: "dinner", emoji: "🍽️", title: "Dinner" },
				{ slug: "snack", emoji: "🍪", title: "Snack" },
				{ slug: "takeaway", emoji: "🥡", title: "Takeaway" },
				{ slug: "sweets", emoji: "🍫", title: "Something sweet" },
			],
		},
		{
			slug: "exercise",
			title: "Exercise",
			emoji: "🏃",
			things: [
				{
					slug: "run",
					emoji: "🏃",
					title: "Run",
					measures: [
						{ slug: "distance", unit: "km" },
						{ slug: "duration", unit: "min" },
					],
				},
				{ slug: "walk", emoji: "🚶", title: "Walk", measures: [{ slug: "duration", unit: "min" }] },
				{ slug: "gym", emoji: "🏋️", title: "Gym", measures: [{ slug: "duration", unit: "min" }] },
				{ slug: "yoga", emoji: "🧘", title: "Yoga", measures: [{ slug: "duration", unit: "min" }] },
				{
					slug: "cycle",
					emoji: "🚴",
					title: "Cycle",
					measures: [
						{ slug: "distance", unit: "km" },
						{ slug: "duration", unit: "min" },
					],
				},
				{
					slug: "stretch",
					emoji: "🤸",
					title: "Stretch",
					measures: [{ slug: "duration", unit: "min" }],
				},
			],
		},
		{
			slug: "sleep",
			title: "Sleep",
			emoji: "😴",
			things: [
				{ slug: "bedtime", emoji: "🛏️", title: "Went to bed" },
				{ slug: "wake", emoji: "🌅", title: "Woke up" },
				{ slug: "nap", emoji: "💤", title: "Nap", measures: [{ slug: "duration", unit: "min" }] },
				{ slug: "woke-in-night", emoji: "🌙", title: "Woke in the night" },
			],
		},
		{
			slug: "activities",
			title: "Activities",
			emoji: "🎨",
			things: [
				{ slug: "read", emoji: "📖", title: "Read" },
				{ slug: "music-practice", emoji: "🎸", title: "Practised music" },
				{
					slug: "gaming",
					emoji: "🎮",
					title: "Gaming",
					measures: [{ slug: "duration", unit: "min" }],
				},
				{ slug: "create", emoji: "🎨", title: "Made something" },
				{ slug: "chores", emoji: "🧹", title: "Chores" },
				{ slug: "outdoors", emoji: "🌳", title: "Went outdoors" },
			],
		},
	],
};

const mood = {
	slug: "mood",
	title: "Mood",
	emoji: "😊",
	description: "How you're feeling, one tap at a time. Log as often as it changes.",
	version: 1,
	groups: [
		{
			slug: "mood",
			title: "Mood",
			emoji: "😊",
			things: [
				{ slug: "great", emoji: "🤩", title: "Great" },
				{ slug: "happy", emoji: "😊", title: "Happy" },
				{ slug: "calm", emoji: "😌", title: "Calm" },
				{ slug: "okay", emoji: "🙂", title: "Okay" },
				{ slug: "meh", emoji: "😐", title: "Meh" },
				{ slug: "tired", emoji: "🥱", title: "Tired" },
				{ slug: "anxious", emoji: "😰", title: "Anxious" },
				{ slug: "low", emoji: "😔", title: "Low" },
				{ slug: "angry", emoji: "😠", title: "Angry" },
				{ slug: "overwhelmed", emoji: "🫠", title: "Overwhelmed" },
			],
		},
	],
};

const hydration = {
	slug: "hydration",
	title: "Hydration & caffeine",
	emoji: "💧",
	description: "What you drink through the day, from water to the evening wine.",
	// v2 added mate; v3 gave it a volume in litres — a thermos is measured in
	// litres where a glass of water is in millilitres, which is exactly why the
	// unit belongs to the thing rather than to the measurement.
	version: 3,
	groups: [
		{
			slug: "drinks",
			title: "Drinks",
			emoji: "💧",
			things: [
				{ slug: "water", emoji: "💧", title: "Water", measures: [{ slug: "volume", unit: "ml" }] },
				{ slug: "coffee", emoji: "☕", title: "Coffee" },
				{ slug: "tea", emoji: "🍵", title: "Tea" },
				{ slug: "mate", emoji: "🧉", title: "Mate", measures: [{ slug: "volume", unit: "l" }] },
				{ slug: "soft-drink", emoji: "🥤", title: "Soft drink" },
				{ slug: "beer", emoji: "🍺", title: "Beer" },
				{ slug: "wine", emoji: "🍷", title: "Wine" },
			],
		},
	],
};

const health = {
	slug: "health",
	title: "Health & symptoms",
	emoji: "💊",
	description: "Medication, symptoms and appointments — useful to show a doctor.",
	version: 1,
	groups: [
		{
			slug: "medication",
			title: "Medication",
			emoji: "💊",
			things: [
				{ slug: "meds", emoji: "💊", title: "Took medication" },
				{ slug: "missed-meds", emoji: "❗", title: "Missed a dose" },
				{ slug: "injection", emoji: "💉", title: "Injection" },
			],
		},
		{
			slug: "symptoms",
			title: "Symptoms",
			emoji: "🤕",
			things: [
				{ slug: "headache", emoji: "🤕", title: "Headache" },
				{ slug: "unwell", emoji: "🤒", title: "Felt unwell" },
				{
					slug: "temperature",
					emoji: "🌡️",
					title: "Temperature",
					measures: [{ slug: "temperature", unit: "c" }],
				},
				{ slug: "allergy", emoji: "🤧", title: "Allergy" },
				{ slug: "pain", emoji: "🦴", title: "Pain" },
			],
		},
		{
			slug: "care",
			title: "Care",
			emoji: "🩺",
			things: [
				{ slug: "appointment", emoji: "🩺", title: "Appointment" },
				{
					slug: "weight",
					emoji: "⚖️",
					title: "Weighed in",
					measures: [{ slug: "weight", unit: "kg" }],
				},
				{ slug: "dental", emoji: "🦷", title: "Dental care" },
			],
		},
	],
};

const focus = {
	slug: "focus",
	title: "Focus & work",
	emoji: "🎯",
	description: "Deep work, meetings and the things that break your concentration.",
	version: 1,
	groups: [
		{
			slug: "work",
			title: "Work",
			emoji: "🎯",
			things: [
				{
					slug: "deep-work",
					emoji: "🎯",
					title: "Deep work",
					measures: [{ slug: "duration", unit: "min" }],
				},
				{ slug: "meeting", emoji: "📅", title: "Meeting" },
				{ slug: "call", emoji: "📞", title: "Call" },
				{ slug: "admin", emoji: "📝", title: "Admin" },
				{ slug: "break", emoji: "⏸️", title: "Break" },
				{ slug: "distraction", emoji: "🚫", title: "Got distracted" },
			],
		},
		{
			slug: "learning",
			title: "Learning",
			emoji: "📚",
			things: [
				{
					slug: "study",
					emoji: "📚",
					title: "Study",
					measures: [{ slug: "duration", unit: "min" }],
				},
				{
					slug: "reading",
					emoji: "📖",
					title: "Reading",
					measures: [{ slug: "duration", unit: "min" }],
				},
				{ slug: "language", emoji: "🗣️", title: "Language practice" },
				{ slug: "course", emoji: "🎓", title: "Course" },
			],
		},
	],
};

const screen = {
	slug: "screen",
	title: "Screen time",
	emoji: "📱",
	description: "Where the hours go — and the times you deliberately stepped away.",
	version: 1,
	groups: [
		{
			slug: "screens",
			title: "Screens",
			emoji: "📱",
			things: [
				{
					slug: "phone",
					emoji: "📱",
					title: "Phone",
					measures: [{ slug: "duration", unit: "min" }],
				},
				{ slug: "social", emoji: "💬", title: "Social media" },
				{ slug: "tv", emoji: "📺", title: "TV", measures: [{ slug: "duration", unit: "min" }] },
				{
					slug: "gaming",
					emoji: "🎮",
					title: "Gaming",
					measures: [{ slug: "duration", unit: "min" }],
				},
				{ slug: "phone-free", emoji: "📵", title: "Phone-free time" },
			],
		},
	],
};

const home = {
	slug: "home",
	title: "Home & chores",
	emoji: "🧹",
	description: "The recurring household jobs that are easy to lose track of.",
	version: 1,
	groups: [
		{
			slug: "chores",
			title: "Chores",
			emoji: "🧹",
			things: [
				{ slug: "dishes", emoji: "🍴", title: "Dishes" },
				{ slug: "laundry", emoji: "🧺", title: "Laundry" },
				{ slug: "tidy", emoji: "🧹", title: "Tidied" },
				{ slug: "clean", emoji: "🧽", title: "Deep clean" },
				{ slug: "bins", emoji: "🗑️", title: "Bins out" },
				{ slug: "groceries", emoji: "🛒", title: "Groceries" },
				{ slug: "plants", emoji: "🪴", title: "Watered plants" },
			],
		},
	],
};

const pets = {
	slug: "pets",
	title: "Pets",
	emoji: "🐾",
	description: "Walks, feeds, medication and vet visits — shareable with whoever else helps.",
	version: 1,
	groups: [
		{
			slug: "care",
			title: "Pet care",
			emoji: "🐾",
			things: [
				{ slug: "walk", emoji: "🐕", title: "Walk", measures: [{ slug: "duration", unit: "min" }] },
				{ slug: "feed", emoji: "🍖", title: "Fed" },
				{ slug: "meds", emoji: "💊", title: "Medication" },
				{ slug: "vet", emoji: "🏥", title: "Vet" },
				{ slug: "groom", emoji: "✂️", title: "Groomed" },
				{ slug: "play", emoji: "🎾", title: "Play" },
			],
		},
	],
};

export const BUNDLE_DEFS = [habits, mood, hydration, health, focus, screen, home, pets];
