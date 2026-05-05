// Damerau-Levenshtein distance with adjacent transpositions counted as one
// edit. Used for "did you mean" suggestions on lint findings — small inputs
// (identifier-shaped strings, candidate sets in the tens), so no need for a
// banded variant.
export function editDistance(a, b) {
  if (a === b) return 0;
  const la = a.length;
  const lb = b.length;
  if (la === 0) return lb;
  if (lb === 0) return la;
  const prev2 = new Array(lb + 1);
  const prev1 = new Array(lb + 1);
  const curr = new Array(lb + 1);
  for (let j = 0; j <= lb; j++) prev1[j] = j;
  for (let i = 1; i <= la; i++) {
    curr[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= lb; j++) {
      const cb = b.charCodeAt(j - 1);
      const cost = ca === cb ? 0 : 1;
      let v = Math.min(curr[j - 1] + 1, prev1[j] + 1, prev1[j - 1] + cost);
      if (i > 1 && j > 1 && ca === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === cb) {
        v = Math.min(v, prev2[j - 2] + 1);
      }
      curr[j] = v;
    }
    for (let j = 0; j <= lb; j++) {
      prev2[j] = prev1[j];
      prev1[j] = curr[j];
    }
  }
  return prev1[lb];
}

// Returns the candidate closest to `name` within `maxDistance` edits, or
// null if nothing is close enough. `candidates` may be an iterable; an
// empty iterable returns null. Case-insensitive comparison is done first
// (a pure-case typo always wins), then edit distance.
export function closestName(name, candidates, maxDistance = 2) {
  if (!name) return null;
  const lower = name.toLowerCase();
  let best = null;
  let bestDist = maxDistance + 1;
  for (const cand of candidates) {
    if (cand === name) return null; // exact match — caller shouldn't have asked
    if (cand.toLowerCase() === lower) return cand; // pure case typo
    const d = editDistance(name, cand);
    if (d < bestDist) {
      best = cand;
      bestDist = d;
    }
  }
  return bestDist <= maxDistance ? best : null;
}
