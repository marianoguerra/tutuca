// @expect const-order
const TOTAL = sum();
function sum(): number {
	return BASE + 1;
}
const BASE = 2;
