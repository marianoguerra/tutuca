import { component, html, macro } from "tutuca";
import { produce } from "tutuca/immer";

const editable = (value) =>
  value && Object.hasOwn(value, "editing")
    ? produce(value, (draft) => {
        draft.editing = true;
      })
    : value;

const expandableEditorReceive = {
  toggleExpanded(draft) {
    draft.expanded = !draft.expanded;
  },
  toggleEditing(draft) {
    draft.editing = !draft.editing;
  },
  removeInItemsAt(draft, index) {
    draft.items.splice(index, 1);
  },
};

function instr(name, label) {
  return component({ name, view: html`<span>${label}</span>` });
}

function type(name, label) {
  return component({
    name,
    receive: {
      setType(draft, typeId) {
        return TYPE_BY_ID[typeId].make();
      },
    },
    view: html`<span class="font-italic text-amber-400">${label}</span>`,
    views: {
      editor: html`<select
        class="select select-ghost px-0 font-italic text-amber-400"
        value="${label}"
        @on.input="setType e.value"
      >
        <option value="i32">i32</option>
        <option value="i64">i64</option>
        <option value="f32">f32</option>
        <option value="f64">f64</option>
      </select>`,
    },
  });
}

function instrImmInt(name, label, parse) {
  return component({
    name,
    fields: { value: 0, rawValue: "0" },
    methods: {
      getInputWidth() {
        return `${this.rawValue.length + 2}em`;
      },
    },
    view: html`<div class="flex gap-3 items-baseline">
      <span>${label}</span>
      <input
        class="input px-1 py-0 m-0 h-auto input-ghost font-mono text-blue-400"
        :value=".value"
        :style="$'width: {$getInputWidth}; outline: none'"
        @on.input="setFromRawValue e.value"
      />
    </div>`,

    receive: {
      setFromRawValue(draft, s) {
        const v = parse(s);
        draft.rawValue = s;
        if (!Number.isNaN(v)) draft.value = v;
      },
    },
  });
}

const parseInteger = (s) => Number.parseInt(s, 10);
const I32Const = instrImmInt("I32Const", "i32.const", parseInteger);
const I64Const = instrImmInt("I64Const", "i64.const", parseInteger);
const F32Const = instrImmInt("F32Const", "f32.const", parseFloat);
const F64Const = instrImmInt("F64Const", "f64.const", parseFloat);
const TypeI32 = type("TypeI32", "i32");
const TypeI64 = type("TypeI64", "i64");
const TypeF32 = type("TypeF32", "f32");
const TypeF64 = type("TypeF64", "f64");
const TYPE_BY_ID = {
  i32: TypeI32,
  i64: TypeI64,
  f32: TypeF32,
  f64: TypeF64,
};

const Br = instr("Br", "br");
const BrIf = instr("BrIf", "br_if");
const Nop = instr("Nop", "nop");
const Drop = instr("Drop", "drop");

const I32Add = instr("I32Add", "i32.add");
const I32Sub = instr("I32Sub", "i32.sub");
const I32Mul = instr("I32Mul", "i32.mul");
const I32DivS = instr("I32DivS", "i32.div_s");
const I32DivU = instr("I32DivU", "i32.div_u");
const I32Eq = instr("I32Eq", "i32.eq");
const I32Ne = instr("I32Ne", "i32.ne");
const I32GtS = instr("I32GtS", "i32.gt_s");
const I32GeS = instr("I32GeS", "i32.ge_s");
const I32LtS = instr("I32LtS", "i32.lt_s");
const I32LeS = instr("I32LeS", "i32.le_s");
const I32GtU = instr("I32GtU", "i32.gt_u");
const I32GeU = instr("I32GeU", "i32.ge_u");
const I32LtU = instr("I32LtU", "i32.lt_u");
const I32LeU = instr("I32LeU", "i32.le_u");

const I64Add = instr("I64Add", "i64.add");
const I64Sub = instr("I64Sub", "i64.sub");
const I64Mul = instr("I64Mul", "i64.mul");
const I64DivS = instr("I64DivS", "i64.div_s");
const I64DivU = instr("I64DivU", "i64.div_u");
const I64Eq = instr("I64Eq", "i64.eq");
const I64Ne = instr("I64Ne", "i64.ne");
const I64GtS = instr("I64GtS", "i64.gt_s");
const I64GeS = instr("I64GeS", "i64.ge_s");
const I64LtS = instr("I64LtS", "i64.lt_s");
const I64LeS = instr("I64LeS", "i64.le_s");
const I64GtU = instr("I64GtU", "i64.gt_u");
const I64GeU = instr("I64GeU", "i64.ge_u");
const I64LtU = instr("I64LtU", "i64.lt_u");
const I64LeU = instr("I64LeU", "i64.le_u");

const F32Add = instr("F32Add", "f32.add");
const F32Sub = instr("F32Sub", "f32.sub");
const F32Mul = instr("F32Mul", "f32.mul");
const F32Div = instr("F32DivU", "f32.div");
const F32Eq = instr("F32Eq", "f32.eq");
const F32Ne = instr("F32Ne", "f32.ne");
const F32Gt = instr("F32Gt", "f32.gt");
const F32Ge = instr("F32Ge", "f32.ge");
const F32Lt = instr("F32Lt", "f32.lt");
const F32Le = instr("F32Le", "f32.le");

const F64Add = instr("F64Add", "f64.add");
const F64Sub = instr("F64Sub", "f64.sub");
const F64Mul = instr("F64Mul", "f64.mul");
const F64Div = instr("F64DivU", "f64.div");
const F64Eq = instr("F64Eq", "f64.eq");
const F64Ne = instr("F64Ne", "f64.ne");
const F64Gt = instr("F64Gt", "f64.gt");
const F64Ge = instr("F64Ge", "f64.ge");
const F64Lt = instr("F64Lt", "f64.lt");
const F64Le = instr("F64Le", "f64.le");

const LocalGet = instrImmInt("LocalGet", "local.get", parseInteger);
const LocalSet = instrImmInt("LocalSet", "local.set", parseInteger);
const LocalTee = instrImmInt("LocalTee", "local.tee", parseInteger);

const GlobalGet = instrImmInt("GlobalGet", "global.get", parseInteger);
const GlobalSet = instrImmInt("GlobalSet", "global.set", parseInteger);

const Types = component({
  name: "Types",
  fields: { items: [] },
  receive: {
    removeInItemsAt(draft, key) {
      draft.items.splice(key, 1);
    },
    addItemAt(draft, i, TypeComp) {
      draft.items.splice(i, 0, TypeComp.make());
    },
    appendItem(draft, TypeComp) {
      draft.items.push(TypeComp.make());
    },
  },
  view: html`<div class="flex gap-3"><x render-each=".items"></x></div>`,
  views: {
    editor: html`<div class="flex items-center">
      <div @each=".items" class="flex items-center group">
        <button
          class="btn btn-xs btn-soft btn-circle btn-success mx-3"
          @on.click="addItemAt @key TypeI32"
        >
          +
        </button>
        <x render-it as="editor"></x>
        <button
          class="btn btn-xs btn-soft btn-circle btn-error max-sm:opacity-100 opacity-0 group-hover:opacity-100"
          @on.click="removeInItemsAt @key"
        >
          ⛔
        </button>
      </div>
      <button
        class="btn btn-xs btn-soft btn-circle btn-success mx-3"
        @on.click="appendItem TypeI32"
      >
        +
      </button>
    </div>`,
  },
});

function i32(value) {
  return I32Const.make({ value, rawValue: `${value}` });
}
function i64(value) {
  return I64Const.make({ value, rawValue: `${value}` });
}
function f32(value) {
  return F32Const.make({ value, rawValue: `${value}` });
}
function f64(value) {
  return F64Const.make({ value, rawValue: `${value}` });
}

const BlockType = component({
  name: "BlockType",
  fields: { args: Types.make(), returns: Types.make() },
  view: html`<div class="flex gap-1">
    <span class="font-mono text-gray-400">[</span>
    <x render=".args"></x>
    <span class="font-mono text-gray-400">] → [</span>
    <x render=".returns"></x>
    <span class="font-mono text-gray-400">]</span>
  </div>`,
  views: {
    editor: html`<div class="flex gap-1 items-center">
      <span class="font-mono text-gray-400">[</span>
      <x render=".args" as="editor"></x>
      <span class="font-mono text-gray-400">] → [</span>
      <x render=".returns" as="editor"></x>
      <span class="font-mono text-gray-400">]</span>
    </div>`,
  },
});

const Block = component({
  name: "Block",
  fields: {
    items: [],
    blockType: BlockType.make(),
    expanded: true,
    editing: false,
  },
  methods: {
    expandedAndEditing() {
      return this.expanded && this.editing;
    },
    expandedAndReadOnly() {
      return this.expanded && !this.editing;
    },
  },
  view: html`<section class="border-l border-l-gray-400 pl-3 ml-3 flex flex-col gap-3">
    <div class="flex gap-3 items-center group">
      <x:btn-toggle-expand></x:btn-toggle-expand>
      <span class="text-sm text-gray-400">block</span>
      <div @hide=".editing">
        <x render=".blockType"></x>
      </div>
      <x:btn-toggle-edit></x:btn-toggle-edit>
    </div>
    <div @show=".editing">
      <x render=".blockType" as="editor"></x>
    </div>
    <div @show="$expandedAndReadOnly" class="flex flex-col gap-3">
      <x render-each=".items"></x>
    </div>
    <x:items-editing></x:items-editing>
  </section>`,
  views: {
    compact: html`<section>block ...</section>`,
  },

  receive: {
    ...expandableEditorReceive,
    addItemAt(draft, i, InstructionPicker) {
      draft.items.splice(i, 0, InstructionPicker.make());
    },
    appendItem(draft, InstructionPicker) {
      draft.items.push(InstructionPicker.make());
    },
  },
});

const Loop = component({
  name: "Loop",
  fields: {
    items: [],
    blockType: BlockType.make(),
    expanded: true,
    editing: false,
  },
  methods: {
    expandedAndEditing() {
      return this.expanded && this.editing;
    },
    expandedAndReadOnly() {
      return this.expanded && !this.editing;
    },
  },
  view: html`<section class="border-l border-l-gray-400 pl-3 ml-3 flex flex-col gap-3">
    <div class="flex gap-3 items-center group">
      <x:btn-toggle-expand></x:btn-toggle-expand>
      <span class="text-sm text-gray-400">loop</span>
      <div @hide=".editing">
        <x render=".blockType"></x>
      </div>
      <x:btn-toggle-edit></x:btn-toggle-edit>
    </div>
    <div @show=".editing">
      <x render=".blockType" as="editor"></x>
    </div>
    <div @show="$expandedAndReadOnly" class="flex flex-col gap-3">
      <x render-each=".items"></x>
    </div>
    <x:items-editing></x:items-editing>
  </section>`,
  views: {
    compact: html`<section>loop ...</section>`,
  },

  receive: {
    ...expandableEditorReceive,
    addItemAt(draft, i, InstructionPicker) {
      draft.items.splice(i, 0, InstructionPicker.make());
    },
    appendItem(draft, InstructionPicker) {
      draft.items.push(InstructionPicker.make());
    },
  },
});

const If = component({
  name: "If",
  fields: {
    thn: [], // don't use then, (thenable)
    else: [],
    blockType: BlockType.make(),
    expanded: true,
    editingIf: false,
    editingThn: false,
    editingElse: false,
  },
  receive: {
    toggleExpanded(draft) {
      draft.expanded = !draft.expanded;
    },
    toggleEditingIf(draft) {
      draft.editingIf = !draft.editingIf;
    },
    toggleEditingThn(draft) {
      draft.editingThn = !draft.editingThn;
    },
    toggleEditingElse(draft) {
      draft.editingElse = !draft.editingElse;
    },
    addThnAt(draft, i, InstructionPicker) {
      draft.thn.splice(i, 0, InstructionPicker.make());
    },
    appendInThn(draft, InstructionPicker) {
      draft.thn.push(InstructionPicker.make());
    },
    removeInThnAt(draft, index) {
      draft.thn.splice(index, 1);
    },
    addElseAt(draft, i, InstructionPicker) {
      draft.else.splice(i, 0, InstructionPicker.make());
    },
    appendInElse(draft, InstructionPicker) {
      draft.else.push(InstructionPicker.make());
    },
    removeInElseAt(draft, index) {
      draft.else.splice(index, 1);
    },
  },
  view: html`<section class="border-l border-l-gray-400 pl-3 ml-3 flex flex-col gap-3">
    <div class="flex gap-3 items-center group">
      <x:btn-toggle-expand></x:btn-toggle-expand>
      <span class="text-sm text-gray-400">if</span>
      <div @hide=".editingIf">
        <x render=".blockType"></x>
      </div>
      <x:btn-toggle-edit :value=".editingIf" :handler="toggleEditingIf"></x:btn-toggle-edit>
    </div>
    <div @show=".editingIf">
      <x render=".blockType" as="editor"></x>
    </div>
    <div @show=".expanded" class="border-l border-l-gray-400 pl-3 ml-3">
      <div class="flex gap-3 items-center group">
        <span class="text-sm text-slate-400">then</span>
        <x:btn-toggle-edit :value=".editingThn" :handler="toggleEditingThn"></x:btn-toggle-edit>
      </div>
      <div class="my-3 pl-3 flex flex-col gap-3" @hide=".editingThn">
        <x render-each=".thn"></x>
      </div>
      <x:items-editing
        :showval=".editingThn"
        :items=".thn"
        :onadd="addThnAt"
        :onremove="removeInThnAt"
        :onappend="appendInThn"
      ></x:items-editing>
      <div class="flex gap-3 items-center group">
        <span class="text-sm text-slate-400">else</span>
        <x:btn-toggle-edit :value=".editingElse" :handler="toggleEditingElse"></x:btn-toggle-edit>
      </div>
      <div class="my-3 pl-3 flex flex-col gap-3" @hide=".editingElse">
        <x render-each=".else"></x>
      </div>
      <x:items-editing
        :showval=".editingElse"
        :items=".else"
        :onadd="addElseAt"
        :onremove="removeInElseAt"
        :onappend="appendInElse"
      ></x:items-editing>
      <span class="text-sm text-slate-400">end</span>
    </div>
  </section>`,
  views: {
    compact: html`<section>if ...</section>`,
  },
});

const Func = component({
  name: "Func",
  fields: {
    items: [],
    blockType: BlockType.make(),
    locals: Types.make(),
    expanded: true,
    editing: false,
  },
  methods: {
    expandedAndEditing() {
      return this.expanded && this.editing;
    },
    expandedAndReadOnly() {
      return this.expanded && !this.editing;
    },
  },
  view: html`<section class="border-l border-l-gray-400 ml-1 pl-3 flex flex-col gap-3">
    <div class="flex gap-3 items-center group">
      <x:btn-toggle-expand></x:btn-toggle-expand>
      <span class="text-sm text-gray-400">func</span>
      <div @hide=".editing">
        <x render=".blockType"></x>
      </div>
      <x:btn-toggle-edit></x:btn-toggle-edit>
    </div>
    <div @show=".editing">
      <x render=".blockType" as="editor"></x>
    </div>
    <div class="flex gap-3 ml-3 items-baseline" @show=".expanded">
      <span class="text-sm text-gray-400">locals</span>
      <div @hide=".editing">
        <x render=".locals"></x>
      </div>
      <div @show=".editing">
        <x render=".locals" as="editor"></x>
      </div>
    </div>
    <div @show="$expandedAndReadOnly" class="flex flex-col gap-3">
      <x render-each=".items"></x>
    </div>
    <x:items-editing></x:items-editing>
  </section>`,

  receive: {
    ...expandableEditorReceive,
    addItemAt(draft, i, InstructionPicker) {
      draft.items.splice(i, 0, InstructionPicker.make());
    },
    appendItem(draft, InstructionPicker) {
      draft.items.push(InstructionPicker.make());
    },
  },
});

const Section = component({
  name: "Section",
  fields: {
    id: 0,
    name: "Section",
    items: [],
    expanded: true,
    defaultItem: null,
  },
  receive: {
    toggleExpanded(draft) {
      draft.expanded = !draft.expanded;
    },
    addDefaultItem(draft) {
      draft.items.push(editable(this.defaultItem));
    },
  },
  view: html`<section class="flex flex-col gap-3">
    <p class="flex gap-3 items-center">
      <x:btn-toggle-expand></x:btn-toggle-expand>
      <span @text=".name"></span>
      <button class="btn btn-xs btn-soft btn-primary" @on.click="addDefaultItem">+</button>
    </p>
    <div class="flex flex-col gap-3 ml-2" @show=".expanded">
      <x render-each=".items"></x>
    </div>
  </section>`,
});

const Memory = component({
  name: "Memory",
  fields: {
    n: 1,
    m: 1,
  },
  receive: {
    setNFromString(draft, s) {
      draft.n = parseInt(s, 10);
    },
    setMFromString(draft, s) {
      draft.m = parseInt(s, 10);
    },
  },
  view: html`<div class="flex gap-3 items-center">
    <label class="input input-ghost outline-0 items-baseline h-auto"
      >Pages
      <input
        class="px-1 py-0 m-0 h-auto w-auto font-mono text-blue-400"
        type="number"
        :value=".n"
        @on.input="setNFromString e.value"
      />
    </label>
    <label class="input input-ghost outline-0 items-baseline h-auto"
      >Max Pages
      <input
        class="px-1 py-0 m-0 h-auto w-auto font-mono text-blue-400"
        type="number"
        :value=".m"
        @on.input="setMFromString e.value"
      />
    </label>
  </div>`,
});

const Module = component({
  name: "Module",
  fields: {
    mem: Section.make({ id: 5, name: "Memory", defaultItem: Memory.make() }),
    func: Section.make({ id: 3, name: "Functions" }),
  },
  view: html`<section class="flex flex-col gap-3">
    <x render=".mem"></x>
    <x render=".func"></x>
  </section>`,
});

const INSTRUCTION_COMPONENTS_BY_ID = {
  "i32.const": I32Const,
  "i32.add": I32Add,
  "i32.sub": I32Sub,
  "i32.mul": I32Mul,
  "i32.div_s": I32DivS,
  "i32.div_u": I32DivU,
  "i32.eq": I32Eq,
  "i32.ne": I32Ne,
  "i32.gt_s": I32GtS,
  "i32.ge_s": I32GeS,
  "i32.lt_s": I32LtS,
  "i32.le_s": I32LeS,
  "i32.gt_u": I32GtU,
  "i32.ge_u": I32GeU,
  "i32.lt_u": I32LtU,
  "i32.le_u": I32LeU,
  "i64.const": I64Const,
  "i64.add": I64Add,
  "i64.sub": I64Sub,
  "i64.mul": I64Mul,
  "i64.div_s": I64DivS,
  "i64.div_u": I64DivU,
  "i64.eq": I64Eq,
  "i64.ne": I64Ne,
  "i64.gt_s": I64GtS,
  "i64.ge_s": I64GeS,
  "i64.lt_s": I64LtS,
  "i64.le_s": I64LeS,
  "i64.gt_u": I64GtU,
  "i64.ge_u": I64GeU,
  "i64.lt_u": I64LtU,
  "i64.le_u": I64LeU,
  "f32.const": F32Const,
  "f32.add": F32Add,
  "f32.sub": F32Sub,
  "f32.mul": F32Mul,
  "f32.div": F32Div,
  "f32.eq": F32Eq,
  "f32.ne": F32Ne,
  "f32.gt_s": F32Gt,
  "f32.ge_s": F32Ge,
  "f32.lt_s": F32Lt,
  "f32.le_s": F32Le,
  "f64.const": F64Const,
  "f64.add": F64Add,
  "f64.sub": F64Sub,
  "f64.mul": F64Mul,
  "f64.div": F64Div,
  "f64.eq": F64Eq,
  "f64.ne": F64Ne,
  "f64.gt_s": F64Gt,
  "f64.ge_s": F64Ge,
  "f64.lt_s": F64Lt,
  "f64.le_s": F64Le,
  if: If,
  block: Block,
  loop: Loop,
  br: Br,
  br_if: BrIf,
  "local.get": LocalGet,
  "local.set": LocalSet,
  "local.tee": LocalTee,
  "global.get": GlobalGet,
  "global.set": GlobalSet,
  nop: Nop,
  drop: Drop,
};

const INSTRUCTIONS_BY_CATEGORY = {
  i32: [
    "i32.add",
    "i32.const",
    "i32.div_s",
    "i32.div_u",
    "i32.eq",
    "i32.ge_s",
    "i32.ge_u",
    "i32.gt_s",
    "i32.gt_u",
    "i32.le_s",
    "i32.le_u",
    "i32.lt_s",
    "i32.lt_u",
    "i32.mul",
    "i32.ne",
    "i32.sub",
  ],
  i64: [
    "i64.add",
    "i64.const",
    "i64.div_s",
    "i64.div_u",
    "i64.eq",
    "i64.ge_s",
    "i64.ge_u",
    "i64.gt_s",
    "i64.gt_u",
    "i64.le_s",
    "i64.le_u",
    "i64.lt_s",
    "i64.lt_u",
    "i64.mul",
    "i64.ne",
    "i64.sub",
  ],
  f32: [
    "f32.add",
    "f32.const",
    "f32.div",
    "f32.eq",
    "f32.ge",
    "f32.gt",
    "f32.le",
    "f32.lt",
    "f32.mul",
    "f32.ne",
    "f32.sub",
  ],
  f64: [
    "f64.add",
    "f64.const",
    "f64.div",
    "f64.eq",
    "f64.ge",
    "f64.gt",
    "f64.le",
    "f64.lt",
    "f64.mul",
    "f64.ne",
    "f64.sub",
  ],
  control: ["block", "br", "br_if", "drop", "if", "loop", "nop"],
  vars: ["global.get", "global.set", "local.get", "local.set", "local.tee"],
};
INSTRUCTIONS_BY_CATEGORY.all = Object.keys(INSTRUCTION_COMPONENTS_BY_ID).sort();

const InstructionPicker = component({
  name: "InstructionPicker",
  fields: {
    currentSection: "all",
    instructions: INSTRUCTIONS_BY_CATEGORY.all,
    filter: "",
  },
  methods: {
    currentIsAll() {
      return this.currentSection === "all";
    },
    currentIsI32() {
      return this.currentSection === "i32";
    },
    currentIsI64() {
      return this.currentSection === "i64";
    },
    currentIsF32() {
      return this.currentSection === "f32";
    },
    currentIsF64() {
      return this.currentSection === "f64";
    },
    currentIsControl() {
      return this.currentSection === "control";
    },
    currentIsVars() {
      return this.currentSection === "vars";
    },
  },
  receive: {
    setFilter(draft, value) {
      draft.filter = value;
    },
    selectSection(draft, v) {
      draft.currentSection = v;
      draft.instructions = INSTRUCTIONS_BY_CATEGORY[v] ?? [];
    },
    setCurrentAll(draft) {
      InstructionPicker.receive.selectSection.call(this, draft, "all");
    },
    setCurrentI32(draft) {
      InstructionPicker.receive.selectSection.call(this, draft, "i32");
    },
    setCurrentI64(draft) {
      InstructionPicker.receive.selectSection.call(this, draft, "i64");
    },
    setCurrentF32(draft) {
      InstructionPicker.receive.selectSection.call(this, draft, "f32");
    },
    setCurrentF64(draft) {
      InstructionPicker.receive.selectSection.call(this, draft, "f64");
    },
    setCurrentControl(draft) {
      InstructionPicker.receive.selectSection.call(this, draft, "control");
    },
    setCurrentVars(draft) {
      InstructionPicker.receive.selectSection.call(this, draft, "vars");
    },

    selectInstructionById(draft, target) {
      const id = target.dataset.value;
      const Comp = INSTRUCTION_COMPONENTS_BY_ID[id];
      if (Comp) {
        return editable(Comp.make());
      }
      return this;
    },
  },
  alter: {
    loopWith(_seq) {
      return { iterData: { filter: this.filter.toLowerCase() } };
    },
    when(_key, val, { filter }) {
      return val.toLowerCase().includes(filter);
    },
  },
  view: html`<section class="flex flex-col gap-3 w-xl">
    <input
      type="search"
      class="input w-full outline-0"
      placeholder="Filter instructions"
      :value=".filter"
      @on.input="setFilter e.value"
    />
    <div class="flex gap-3 text-xs justify-between">
      <label class="flex gap-2">
        <input
          type="radio"
          class="radio radio-success radio-xs"
          @on.input="setCurrentAll"
          :checked="$currentIsAll"
        />
        all
      </label>
      <label class="flex gap-2">
        <input
          type="radio"
          class="radio radio-info radio-xs"
          @on.input="setCurrentI32"
          :checked="$currentIsI32"
        />
        i32
      </label>
      <label class="flex gap-2 text-xs">
        <input
          type="radio"
          class="radio radio-info radio-xs"
          @on.input="setCurrentI64"
          :checked="$currentIsI64"
        />
        i64
      </label>
      <label class="flex gap-2 text-xs">
        <input
          type="radio"
          class="radio radio-primary radio-xs"
          @on.input="setCurrentF32"
          :checked="$currentIsF32"
        />
        f32
      </label>
      <label class="flex gap-2 text-xs">
        <input
          type="radio"
          class="radio radio-primary radio-xs"
          @on.input="setCurrentF64"
          :checked="$currentIsF64"
        />
        f64
      </label>
      <label class="flex gap-2 text-xs">
        <input
          type="radio"
          class="radio radio-error radio-xs"
          @on.input="setCurrentControl"
          :checked="$currentIsControl"
        />
        control
      </label>
      <label class="flex gap-2 text-xs">
        <input
          type="radio"
          class="radio radio-warning radio-xs"
          @on.input="setCurrentVars"
          :checked="$currentIsVars"
        />
        vars
      </label>
    </div>
    <div class="flex flex-col gap-1 max-h-[25vh] overflow-y-auto">
      <button
        class="btn btn-block"
        @each=".instructions"
        @loop-with="loopWith"
        @when="when"
        :data-value="@value"
        @on.click="selectInstructionById e.target"
      >
        <x text="@value"></x>
      </button>
    </div>
  </section>`,
});

export function getComponents() {
  return [
    Module,
    Section,
    Func,
    Memory,
    TypeI32,
    TypeI64,
    TypeF32,
    TypeF64,
    Types,
    BlockType,
    Block,
    Loop,
    If,
    Nop,
    Drop,
    Br,
    BrIf,
    I32Const,
    I32Add,
    I32Sub,
    I32Mul,
    I32DivS,
    I32DivU,
    I32Eq,
    I32Ne,
    I32GtS,
    I32GeS,
    I32LtS,
    I32LeS,
    I32GtU,
    I32GeU,
    I32LtU,
    I32LeU,
    I64Const,
    I64Add,
    I64Sub,
    I64Mul,
    I64DivS,
    I64DivU,
    I64Eq,
    I64Ne,
    I64GtS,
    I64GeS,
    I64LtS,
    I64LeS,
    I64GtU,
    I64GeU,
    I64LtU,
    I64LeU,
    F32Const,
    F32Add,
    F32Sub,
    F32Mul,
    F32Div,
    F32Eq,
    F32Ne,
    F32Gt,
    F32Ge,
    F32Lt,
    F32Le,
    F64Const,
    F64Add,
    F64Sub,
    F64Mul,
    F64Div,
    F64Eq,
    F64Ne,
    F64Gt,
    F64Ge,
    F64Lt,
    F64Le,
    LocalGet,
    LocalSet,
    LocalTee,
    GlobalGet,
    GlobalSet,
    //
    InstructionPicker,
  ];
}

export function getMacros() {
  return {
    "btn-toggle-expand": macro(
      {},
      html`<button
        @if.class=".expanded"
        @then="'btn btn-xs btn-soft btn-primary btn-circle'"
        @else="'btn btn-xs btn-soft btn-success btn-circle'"
        @on.click="toggleExpanded"
      >
        <span @show=".expanded">▽</span>
        <span @hide=".expanded">▷</span>
      </button>`,
    ),
    "btn-toggle-edit": macro(
      { value: ".editing", handler: "toggleEditing" },
      html`<button
        @if.class="^value"
        @then="'btn btn-xs btn-soft btn-primary btn-circle'"
        @else="'btn btn-xs btn-soft btn-success btn-circle max-sm:opacity-100 opacity-0 group-hover:opacity-100'"
        @on.click="^handler"
      >
        <span @show="^value">🔒</span>
        <span @hide="^value">✏️</span>
      </button>`,
    ),
    "items-editing": macro(
      {
        showval: "$expandedAndEditing",
        items: ".items",
        onadd: "addItemAt",
        onremove: "removeInItemsAt",
        onappend: "appendItem",
      },
      html` <div @show="^showval" class="flex flex-col gap-3">
        <div @each="^items" class="flex flex-col gap-3">
          <div>
            <button
              class="btn btn-xs btn-soft btn-circle btn-success"
              @on.click="^onadd @key InstructionPicker"
            >
              +
            </button>
          </div>
          <div class="flex gap-5 items-center">
            <button class="btn btn-xs btn-soft btn-circle btn-error" @on.click="^onremove @key">
              ⛔
            </button>
            <x render-it as="compact"></x>
          </div>
        </div>
        <button
          class="btn btn-xs btn-soft btn-circle btn-success"
          @on.click="^onappend InstructionPicker"
        >
          +
        </button>
      </div>`,
    ),
  };
}

const blockType = (args, returns) =>
  BlockType.make({
    args: Types.make({ items: args }),
    returns: Types.make({ items: returns }),
  });

const NOP = Nop.make();

export function getExamples() {
  return {
    title: "Visual Wasm",
    description: "Visual editor for WebAssembly modules",
    items: [
      {
        title: "Empty Module",
        description: "Module with empty memory and functions sections",
        value: Module.make(),
      },
      {
        title: "Sample Module",
        description: "Module with a function containing nested control flow",
        value: getRoot(),
      },
      {
        title: "Instruction Picker",
        description: "Standalone instruction picker",
        value: InstructionPicker.make(),
      },
      {
        title: "Block Type Editor",
        description: "Editing arg/return types",
        value: BlockType.make({
          args: Types.make({ items: [TypeI32.make(), TypeI64.make()] }),
          returns: Types.make({ items: [TypeF32.make()] }),
        }),
      },
      {
        title: "Block Type (editor view)",
        description: "Same BlockType rendered under the 'editor' view",
        view: "editor",
        value: BlockType.make({
          args: Types.make({ items: [TypeI32.make(), TypeI64.make()] }),
          returns: Types.make({ items: [TypeF32.make()] }),
        }),
      },
      {
        title: "Types (editor view)",
        description: "Type list rendered under the 'editor' view",
        view: "editor",
        value: Types.make({
          items: [TypeI32.make(), TypeF64.make(), TypeI64.make()],
        }),
      },
      {
        title: "Block (compact view)",
        description: "Block rendered under the 'compact' view",
        view: "compact",
        value: Block.make({
          blockType: blockType([TypeI32.make()], [TypeI64.make()]),
          items: [i32(1), i32(2), I32Add.make()],
        }),
      },
      {
        title: "Loop (compact view)",
        description: "Loop rendered under the 'compact' view",
        view: "compact",
        value: Loop.make({
          blockType: blockType([TypeI32.make()]),
          items: [LocalGet.make(), Br.make()],
        }),
      },
      {
        title: "If (compact view)",
        description: "If rendered under the 'compact' view",
        view: "compact",
        value: If.make({
          blockType: blockType([], [TypeI32.make()]),
          thn: [i32(1)],
          else: [i32(0)],
        }),
      },
    ],
  };
}

export function getRoot() {
  return Module.make({
    func: Section.make({
      id: 3,
      name: "Functions",
      defaultItem: Func.make(),
      items: [
        Func.make({
          blockType: blockType([TypeI64.make()], [TypeI32.make()]),
          locals: Types.make({ items: [TypeF32.make(), TypeF64.make()] }),
          items: [
            Block.make({
              blockType: blockType([TypeI64.make()], [TypeI32.make(), TypeI32.make()]),
              items: [
                Loop.make({
                  blockType: blockType([TypeI64.make(), TypeI32.make()]),
                  items: [
                    If.make({
                      blockType: blockType([], [TypeI32.make()]),
                      thn: [i32(15), NOP],
                      else: [i32(10), NOP],
                    }),
                    I32Add.make(),
                    GlobalGet.make(),
                    GlobalSet.make(),
                    BrIf.make(),
                    Br.make(),
                  ],
                }),
                Drop.make(),
                i64(100),
                f32(1.5),
                f64(10.4),
                NOP,
              ],
            }),
            LocalGet.make(),
            LocalSet.make(),
            LocalTee.make(),
          ],
        }),
      ],
    }),
  });
}
