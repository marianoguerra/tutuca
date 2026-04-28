import { component, html } from "tutuca";

const TableRow = component({
  name: "TableRow",
  fields: { name: "", qty: 0, price: 0 },
  view: html`<tr>
    <td @text=".name"></td>
    <td @text=".qty"></td>
    <td @text=".price"></td>
  </tr>`,
});

const ItemTable = component({
  name: "ItemTable",
  fields: { rows: [] },
  view: html`<table class="table">
    <thead>
      <tr>
        <th>Name</th>
        <th>Qty</th>
        <th>Price</th>
      </tr>
    </thead>
    <tbody>
      <tr @x render-each=".rows"></tr>
    </tbody>
  </table>`,
});

const SelectOption = component({
  name: "SelectOption",
  fields: { value: "", label: "" },
  view: html`<option :value=".value" @text=".label"></option>`,
});

const ItemSelect = component({
  name: "ItemSelect",
  fields: { options: [], current: "" },
  view: html`<select class="select" :value=".current" @on.input=".setCurrent value">
    <option @x render-each=".options"></option>
  </select>`,
});

const PseudoXDemo = component({
  name: "PseudoXDemo",
  fields: { table: null, select: null },
  view: html`<div>
    <x render=".table"></x>
    <x render=".select"></x>
  </div>`,
});

export function getComponents() {
  return [PseudoXDemo, ItemTable, TableRow, ItemSelect, SelectOption];
}

export function getRoot() {
  return PseudoXDemo.make({
    table: ItemTable.make({
      rows: [
        TableRow.make({ name: "Apple", qty: 3, price: 1.5 }),
        TableRow.make({ name: "Bread", qty: 1, price: 2.25 }),
        TableRow.make({ name: "Cheese", qty: 2, price: 4.0 }),
      ],
    }),
    select: ItemSelect.make({
      current: "b",
      options: [
        SelectOption.make({ value: "a", label: "Alpha" }),
        SelectOption.make({ value: "b", label: "Beta" }),
        SelectOption.make({ value: "c", label: "Gamma" }),
      ],
    }),
  });
}

export function getExamples() {
  return {
    title: "Pseudo-x (@x)",
    description:
      "Escape the HTML parser by attaching @x as the first attribute on a legal child tag. Without it, <x> inside <table> or <select> would be silently stripped.",
    items: [
      {
        title: "Table with row components",
        description:
          "Each row is its own component. The <tr @x render-each=...> attribute pretends to be an <x> tag and renders one row component per item.",
        value: ItemTable.make({
          rows: [
            TableRow.make({ name: "Apple", qty: 3, price: 1.5 }),
            TableRow.make({ name: "Bread", qty: 1, price: 2.25 }),
            TableRow.make({ name: "Cheese", qty: 2, price: 4.0 }),
          ],
        }),
      },
      {
        title: "Select with option components",
        description:
          "Each option is a SelectOption component. The <option @x render-each=...> attribute does the same trick inside <select>.",
        value: ItemSelect.make({
          current: "b",
          options: [
            SelectOption.make({ value: "a", label: "Alpha" }),
            SelectOption.make({ value: "b", label: "Beta" }),
            SelectOption.make({ value: "c", label: "Gamma" }),
          ],
        }),
      },
    ],
  };
}
