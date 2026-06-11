import { component, html } from "tutuca";

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
  input: {
    // `event` is the raw DOM change event; the chosen File lives on
    // `event.target.files`. The metadata-copying lives in the `withFile` method
    // so it stays directly callable from tests.
    onPickFile(event) {
      return this.withFile(event.target.files?.[0]);
    },
  },
  methods: {
    // File objects can't be read synchronously, but their metadata
    // (name/size/type/lastModified) is available immediately.
    withFile(file) {
      if (!file) return this.setHasFile(false);
      return this.setName(file.name)
        .setSize(file.size)
        .setType(file.type)
        .setLastModified(file.lastModified)
        .setHasFile(true);
    },
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
      <input type="file" class="file-input" @on.change="onPickFile event" />
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
    describe("withFile()", () => {
      test("copies the selected file's metadata into fields", () => {
        const fp = FilePicker.make().withFile({
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
        const fp = FilePicker.make({ hasFile: true }).withFile(undefined);
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
