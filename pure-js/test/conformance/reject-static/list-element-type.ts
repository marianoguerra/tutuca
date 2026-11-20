// @signature {"params": [], "result": "string[]"}
// @expect not-assignable
function () {
	const xs: string[] = [1];
	return xs;
}
