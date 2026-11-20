// The names of the tour's agents: a manner, a material and a tree dweller, whose emoji is the
// agent's mark on the tree. 12 of each, 1728 names.
export const MANNERS = [
	"Quiet",
	"Brisk",
	"Patient",
	"Wary",
	"Nimble",
	"Stubborn",
	"Drowsy",
	"Bold",
	"Curious",
	"Restless",
	"Gentle",
	"Sly",
];
export const MATERIALS = [
	"Copper",
	"Amber",
	"Slate",
	"Indigo",
	"Moss",
	"Ivory",
	"Cobalt",
	"Saffron",
	"Ash",
	"Coral",
	"Juniper",
	"Onyx",
];
export const DWELLERS = [
	{ name: "Squirrel", icon: "🐿️" },
	{ name: "Owl", icon: "🦉" },
	{ name: "Sloth", icon: "🦥" },
	{ name: "Gecko", icon: "🦎" },
	{ name: "Koala", icon: "🐨" },
	{ name: "Monkey", icon: "🐒" },
	{ name: "Spider", icon: "🕷️" },
	{ name: "Ant", icon: "🐜" },
	{ name: "Parrot", icon: "🦜" },
	{ name: "Beetle", icon: "🪲" },
	{ name: "Snail", icon: "🐌" },
	{ name: "Bat", icon: "🦇" },
];

// The name of the manner, material and dweller at those indexes: { name, icon }.
export const nameFrom = ([manner, material, dweller]) => ({
	name: `${MANNERS[manner]} ${MATERIALS[material]} ${DWELLERS[dweller].name}`,
	icon: DWELLERS[dweller].icon,
});

const pick = (list, random) => list[Math.floor(random() * list.length) % list.length];
// A name for a new agent among taken ([{ name, icon }], the agents there are): a dweller none
// of them has while one is free, and a name none of them has. random is Math.random's shape.
export const pickName = (taken = [], random = Math.random) => {
	const icons = new Set(taken.map((agent) => agent.icon));
	const names = new Set(taken.map((agent) => agent.name));
	const all = DWELLERS.map((_, i) => i);
	const free = all.filter((i) => !icons.has(DWELLERS[i].icon));
	const dwellers = free.length > 0 ? free : all;
	const indexes = MANNERS.map((_, i) => i);
	for (let tries = 0; tries < 200; tries++) {
		const found = nameFrom([pick(indexes, random), pick(indexes, random), pick(dwellers, random)]);
		if (!names.has(found.name)) return found;
	}
	// Every try was taken: the first name that isn't, in order.
	for (const dweller of dwellers) {
		for (const manner of indexes) {
			for (const material of indexes) {
				const found = nameFrom([manner, material, dweller]);
				if (!names.has(found.name)) return found;
			}
		}
	}
	return { name: `Agent ${taken.length + 1}`, icon: "🤖" };
};
