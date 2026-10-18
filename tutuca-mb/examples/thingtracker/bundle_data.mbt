// The bundles that ship with thing-tracker (src/bundles/definitions.ts), from bundle-defs.js:
// groups of things, each thing optionally recording measurements in a preferred unit. Slugs
// are identity; titles and emoji are presentation.

///|
pub let bundle_defs : Array[BundleDef] = [
  {
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
          {
            slug: "breakfast",
            emoji: "🥣",
            title: "Breakfast",
            measures: [],
          },
          { slug: "lunch", emoji: "🥗", title: "Lunch", measures: [], },
          { slug: "dinner", emoji: "🍽️", title: "Dinner", measures: [], },
          { slug: "snack", emoji: "🍪", title: "Snack", measures: [], },
          { slug: "takeaway", emoji: "🥡", title: "Takeaway", measures: [], },
          {
            slug: "sweets",
            emoji: "🍫",
            title: "Something sweet",
            measures: [],
          },
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
              { slug: "distance", unit: "km", },
              { slug: "duration", unit: "min", },
            ],
          },
          {
            slug: "walk",
            emoji: "🚶",
            title: "Walk",
            measures: [{ slug: "duration", unit: "min", }],
          },
          {
            slug: "gym",
            emoji: "🏋️",
            title: "Gym",
            measures: [{ slug: "duration", unit: "min", }],
          },
          {
            slug: "yoga",
            emoji: "🧘",
            title: "Yoga",
            measures: [{ slug: "duration", unit: "min", }],
          },
          {
            slug: "cycle",
            emoji: "🚴",
            title: "Cycle",
            measures: [
              { slug: "distance", unit: "km", },
              { slug: "duration", unit: "min", },
            ],
          },
          {
            slug: "stretch",
            emoji: "🤸",
            title: "Stretch",
            measures: [{ slug: "duration", unit: "min", }],
          },
        ],
      },
      {
        slug: "sleep",
        title: "Sleep",
        emoji: "😴",
        things: [
          {
            slug: "bedtime",
            emoji: "🛏️",
            title: "Went to bed",
            measures: [],
          },
          { slug: "wake", emoji: "🌅", title: "Woke up", measures: [], },
          {
            slug: "nap",
            emoji: "💤",
            title: "Nap",
            measures: [{ slug: "duration", unit: "min", }],
          },
          {
            slug: "woke-in-night",
            emoji: "🌙",
            title: "Woke in the night",
            measures: [],
          },
        ],
      },
      {
        slug: "activities",
        title: "Activities",
        emoji: "🎨",
        things: [
          { slug: "read", emoji: "📖", title: "Read", measures: [], },
          {
            slug: "music-practice",
            emoji: "🎸",
            title: "Practised music",
            measures: [],
          },
          {
            slug: "gaming",
            emoji: "🎮",
            title: "Gaming",
            measures: [{ slug: "duration", unit: "min", }],
          },
          {
            slug: "create",
            emoji: "🎨",
            title: "Made something",
            measures: [],
          },
          { slug: "chores", emoji: "🧹", title: "Chores", measures: [], },
          {
            slug: "outdoors",
            emoji: "🌳",
            title: "Went outdoors",
            measures: [],
          },
        ],
      },
    ],
  },
  {
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
          { slug: "great", emoji: "🤩", title: "Great", measures: [], },
          { slug: "happy", emoji: "😊", title: "Happy", measures: [], },
          { slug: "calm", emoji: "😌", title: "Calm", measures: [], },
          { slug: "okay", emoji: "🙂", title: "Okay", measures: [], },
          { slug: "meh", emoji: "😐", title: "Meh", measures: [], },
          { slug: "tired", emoji: "🥱", title: "Tired", measures: [], },
          { slug: "anxious", emoji: "😰", title: "Anxious", measures: [], },
          { slug: "low", emoji: "😔", title: "Low", measures: [], },
          { slug: "angry", emoji: "😠", title: "Angry", measures: [], },
          {
            slug: "overwhelmed",
            emoji: "🫠",
            title: "Overwhelmed",
            measures: [],
          },
        ],
      },
    ],
  },
  {
    slug: "hydration",
    title: "Hydration & caffeine",
    emoji: "💧",
    description: "What you drink through the day, from water to the evening wine.",
    version: 3,
    groups: [
      {
        slug: "drinks",
        title: "Drinks",
        emoji: "💧",
        things: [
          {
            slug: "water",
            emoji: "💧",
            title: "Water",
            measures: [{ slug: "volume", unit: "ml", }],
          },
          { slug: "coffee", emoji: "☕", title: "Coffee", measures: [], },
          { slug: "tea", emoji: "🍵", title: "Tea", measures: [], },
          {
            slug: "mate",
            emoji: "🧉",
            title: "Mate",
            measures: [{ slug: "volume", unit: "l", }],
          },
          {
            slug: "soft-drink",
            emoji: "🥤",
            title: "Soft drink",
            measures: [],
          },
          { slug: "beer", emoji: "🍺", title: "Beer", measures: [], },
          { slug: "wine", emoji: "🍷", title: "Wine", measures: [], },
        ],
      },
    ],
  },
  {
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
          {
            slug: "meds",
            emoji: "💊",
            title: "Took medication",
            measures: [],
          },
          {
            slug: "missed-meds",
            emoji: "❗",
            title: "Missed a dose",
            measures: [],
          },
          {
            slug: "injection",
            emoji: "💉",
            title: "Injection",
            measures: [],
          },
        ],
      },
      {
        slug: "symptoms",
        title: "Symptoms",
        emoji: "🤕",
        things: [
          { slug: "headache", emoji: "🤕", title: "Headache", measures: [], },
          { slug: "unwell", emoji: "🤒", title: "Felt unwell", measures: [], },
          {
            slug: "temperature",
            emoji: "🌡️",
            title: "Temperature",
            measures: [{ slug: "temperature", unit: "c", }],
          },
          { slug: "allergy", emoji: "🤧", title: "Allergy", measures: [], },
          { slug: "pain", emoji: "🦴", title: "Pain", measures: [], },
        ],
      },
      {
        slug: "care",
        title: "Care",
        emoji: "🩺",
        things: [
          {
            slug: "appointment",
            emoji: "🩺",
            title: "Appointment",
            measures: [],
          },
          {
            slug: "weight",
            emoji: "⚖️",
            title: "Weighed in",
            measures: [{ slug: "weight", unit: "kg", }],
          },
          { slug: "dental", emoji: "🦷", title: "Dental care", measures: [], },
        ],
      },
    ],
  },
  {
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
            measures: [{ slug: "duration", unit: "min", }],
          },
          { slug: "meeting", emoji: "📅", title: "Meeting", measures: [], },
          { slug: "call", emoji: "📞", title: "Call", measures: [], },
          { slug: "admin", emoji: "📝", title: "Admin", measures: [], },
          { slug: "break", emoji: "⏸️", title: "Break", measures: [], },
          {
            slug: "distraction",
            emoji: "🚫",
            title: "Got distracted",
            measures: [],
          },
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
            measures: [{ slug: "duration", unit: "min", }],
          },
          {
            slug: "reading",
            emoji: "📖",
            title: "Reading",
            measures: [{ slug: "duration", unit: "min", }],
          },
          {
            slug: "language",
            emoji: "🗣️",
            title: "Language practice",
            measures: [],
          },
          { slug: "course", emoji: "🎓", title: "Course", measures: [], },
        ],
      },
    ],
  },
  {
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
            measures: [{ slug: "duration", unit: "min", }],
          },
          {
            slug: "social",
            emoji: "💬",
            title: "Social media",
            measures: [],
          },
          {
            slug: "tv",
            emoji: "📺",
            title: "TV",
            measures: [{ slug: "duration", unit: "min", }],
          },
          {
            slug: "gaming",
            emoji: "🎮",
            title: "Gaming",
            measures: [{ slug: "duration", unit: "min", }],
          },
          {
            slug: "phone-free",
            emoji: "📵",
            title: "Phone-free time",
            measures: [],
          },
        ],
      },
    ],
  },
  {
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
          { slug: "dishes", emoji: "🍴", title: "Dishes", measures: [], },
          { slug: "laundry", emoji: "🧺", title: "Laundry", measures: [], },
          { slug: "tidy", emoji: "🧹", title: "Tidied", measures: [], },
          { slug: "clean", emoji: "🧽", title: "Deep clean", measures: [], },
          { slug: "bins", emoji: "🗑️", title: "Bins out", measures: [], },
          {
            slug: "groceries",
            emoji: "🛒",
            title: "Groceries",
            measures: [],
          },
          {
            slug: "plants",
            emoji: "🪴",
            title: "Watered plants",
            measures: [],
          },
        ],
      },
    ],
  },
  {
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
          {
            slug: "walk",
            emoji: "🐕",
            title: "Walk",
            measures: [{ slug: "duration", unit: "min", }],
          },
          { slug: "feed", emoji: "🍖", title: "Fed", measures: [], },
          { slug: "meds", emoji: "💊", title: "Medication", measures: [], },
          { slug: "vet", emoji: "🏥", title: "Vet", measures: [], },
          { slug: "groom", emoji: "✂️", title: "Groomed", measures: [], },
          { slug: "play", emoji: "🎾", title: "Play", measures: [], },
        ],
      },
    ],
  },
]
