// The key of the <tutuca-app> a story runs in: `${prefix}${storyId}@${seed}`. A new prefix gives
// the same stories new keys, so their apps mount again.
export const storyAppKey = (prefix, id, seed = 0) => `${prefix}${id}@${seed}`;
// The { id, seed } a key under prefix names; null for a key that isn't under it.
export const parseStoryAppKey = (prefix, key) => {
	if (!key?.startsWith(prefix)) return null;
	const rest = key.slice(prefix.length);
	const at = rest.lastIndexOf("@");
	if (at < 0) return { id: rest, seed: 0 };
	return { id: rest.slice(0, at), seed: Number(rest.slice(at + 1)) || 0 };
};
