// A grid of status cells (rows × columns, a header row and a label column), laid out as one
// list for a CSS grid so a view renders it with one each() and sourceKey() finds the cell.
import { BADGE } from "./expect.js";

const label = (text) => ({
	label: text,
	cls: "font-mono text-xs opacity-70 text-left",
	title: "",
	fixed: true,
	row: -1,
	col: -1,
	status: "label",
});

// { cells, gridStyle, statuses, at(i) → { row, col } | null } for rows × cols. cell(row, col)
// gives { status, label, title?, cls?, fixed? } (fixed: a cell that can't be clicked); rowLabel(row) and colLabel(col) the labels; columns is
// the CSS track of the cells.
export const grid = ({
	rows,
	cols,
	cell,
	rowLabel = String,
	colLabel = String,
	corner = "",
	columns = "max-content",
	classes = BADGE,
}) => {
	const cells = [label(corner), ...cols.map((c) => label(colLabel(c)))];
	const statuses = [];
	rows.forEach((r, ri) => {
		cells.push(label(rowLabel(r)));
		cols.forEach((c, ci) => {
			const x = cell(r, c);
			statuses.push(x.status);
			cells.push({
				...x,
				label: x.label,
				title: x.title ?? "",
				cls: x.cls ?? classes[x.status] ?? classes.none,
				fixed: x.fixed ?? false,
				row: ri,
				col: ci,
				status: x.status,
			});
		});
	});
	return {
		cells,
		statuses,
		gridStyle: `grid-template-columns: max-content repeat(${cols.length}, ${columns})`,
		at: (i) => (cells[i] && !cells[i].fixed ? { row: cells[i].row, col: cells[i].col } : null),
	};
};
