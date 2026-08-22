import { component, html } from "tutuca";
import { produce } from "tutuca/immer";

const pickFile = (current, file) =>
  produce(current, (draft) =>
    FilePicker.receive.onPickFile.call(current, draft, { target: { files: file ? [file] : [] } }),
  );

const FILE_SIZE_UNITS = ["B", "KB", "MB", "GB", "TB"];

// Format a byte count as a human-readable size. Kept as a plain function so it
// can be unit-tested directly and reused from the component's method.
function formatSize(bytes) {
  let n = bytes;
  let unit = 0;
  while (n >= 1024 && unit < FILE_SIZE_UNITS.length - 1) {
    n /= 1024;
    unit++;
  }
  const rounded = unit === 0 ? n : Math.round(n * 100) / 100;
  return `${rounded} ${FILE_SIZE_UNITS[unit]}`;
}

const FilePicker = component({
  name: "FilePicker",
  // The File metadata is flattened into plain fields so the view can bind each
  // piece reactively. `hasFile` gates the summary vs. the empty-state message.
  fields: {
    name: "",
    size: 0,
    type: "",
    lastModified: 0,
    hasFile: false,
  },
  receive: {
    // e.target is the <input> node; the chosen File lives on its `.files`.
    onPickFile(draft, target) {
      const file = target.files?.[0];
      if (!file) {
        draft.hasFile = false;
        return;
      }
      draft.name = file.name;
      draft.size = file.size;
      draft.type = file.type;
      draft.lastModified = file.lastModified;
      draft.hasFile = true;
    },
  },
  methods: {
    sizeLabel() {
      return formatSize(this.size);
    },
    typeLabel() {
      return this.type === "" ? "unknown" : this.type;
    },
    lastModifiedLabel() {
      return new Date(this.lastModified).toLocaleString();
    },
  },
  view: html`<section class="flex flex-col gap-3">
    <label class="flex flex-col gap-1">
      <span>Pick a file</span>
      <input type="file" class="file-input" @on.change="onPickFile e.target" />
    </label>

    <table class="table" @show=".hasFile">
      <tbody>
        <tr><th>Name</th><td @text=".name"></td></tr>
        <tr><th>Size</th><td @text="$sizeLabel"></td></tr>
        <tr><th>Type</th><td @text="$typeLabel"></td></tr>
        <tr><th>Last modified</th><td @text="$lastModifiedLabel"></td></tr>
      </tbody>
    </table>

    <p @hide=".hasFile">No file selected yet — pick one above.</p>
  </section>`,
});

export function getComponents() {
  return [FilePicker];
}

export function getRoot() {
  return FilePicker.make({});
}

export function getExamples() {
  return {
    title: "File Picker",
    description: "Show metadata about a file chosen with @on.change",
    items: [
      {
        title: "Empty",
        description: "No file selected yet",
        value: FilePicker.make(),
      },
      {
        title: "With a file",
        description: "Pre-populated to show the metadata summary",
        value: FilePicker.make({
          name: "report.pdf",
          size: 245678,
          type: "application/pdf",
          lastModified: 1700000000000,
          hasFile: true,
        }),
      },
    ],
  };
}

export function getTests({ describe, test, expect }) {
  describe(FilePicker, () => {
    describe("onPickFile", () => {
      test("copies the selected file's metadata into fields", () => {
        const fp = pickFile(FilePicker.make(), {
          name: "photo.png",
          size: 2048,
          type: "image/png",
          lastModified: 1700000000000,
        });
        expect(fp.name).toBe("photo.png");
        expect(fp.size).toBe(2048);
        expect(fp.type).toBe("image/png");
        expect(fp.lastModified).toBe(1700000000000);
        expect(fp.hasFile).toBe(true);
      });

      test("clears hasFile when no file is provided", () => {
        const fp = pickFile(FilePicker.make({ hasFile: true }));
        expect(fp.hasFile).toBe(false);
      });
    });

    describe("sizeLabel()", () => {
      test("formats bytes in the largest fitting unit", () => {
        expect(FilePicker.make({ size: 0 }).sizeLabel()).toBe("0 B");
        expect(FilePicker.make({ size: 512 }).sizeLabel()).toBe("512 B");
        expect(FilePicker.make({ size: 2048 }).sizeLabel()).toBe("2 KB");
        expect(FilePicker.make({ size: 245678 }).sizeLabel()).toBe("239.92 KB");
      });
    });

    describe("typeLabel()", () => {
      test("falls back to 'unknown' for a blank MIME type", () => {
        expect(FilePicker.make({ type: "" }).typeLabel()).toBe("unknown");
        expect(FilePicker.make({ type: "text/plain" }).typeLabel()).toBe("text/plain");
      });
    });
  });
}
