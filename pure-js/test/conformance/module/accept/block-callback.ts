// @entries {"Grid.queries.*": {"this": "read State"}}
// @run {"entry": "Grid.queries.cells", "this": {"rows": [[1, 2], [3, 40], [5]]}, "args": []}
export type State = { rows: number[][] };

export const Grid = {
	queries: {
		cells(): string[] {
			return this.rows.map((row, i) => {
				let total = 0;
				for (const x of row) {
					if (x > 10) break;
					total += x;
				}
				const big = row.find((x) => {
					if (x > 2) {
						return true;
					}
					return false;
				});
				return `${i}:${total}:${big ?? -1}`;
			});
		},
	},
};
