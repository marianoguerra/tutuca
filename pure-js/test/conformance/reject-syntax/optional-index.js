// @expect optional-computed-member
function (next, [i]) { next.text = next.items?.[i]?.title ?? ""; }
