// @expect type-assertion
function (next, [x]) { next.text = x as string; }
