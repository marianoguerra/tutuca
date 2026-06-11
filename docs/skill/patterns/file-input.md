# Read a picked file

**Problem:** let the user pick a file and show its metadata.

```js
component({
  name: "FilePicker",
  fields: { name: "", size: 0, type: "", hasFile: false },
  input: {
    // `event` is the raw DOM event; the File is on event.target.files
    onPickFile(event) {
      const file = event.target.files?.[0];
      if (!file) return this.setHasFile(false);
      return this.setName(file.name)
        .setSize(file.size)
        .setType(file.type)
        .setHasFile(true);
    },
  },
  view: html`<section>
    <input type="file" @on.change="onPickFile event" />
    <p @hide=".hasFile">No file selected yet.</p>
    <dl @show=".hasFile">
      <dt>Name</dt><dd @text=".name"></dd>
      <dt>Size</dt><dd @text=".size"></dd>
      <dt>Type</dt><dd @text=".type"></dd>
    </dl>
  </section>`,
});
```

Pass `event` (not `value`) to the handler: for a file input `value` is just the
fake `C:\fakepath\…` string, while `event.target.files` holds the real `File`
objects. The metadata (`name`/`size`/`type`/`lastModified`) is available
synchronously; the *contents* are not — read those with the async `File` API
(`file.text()`, `file.arrayBuffer()`) and feed the result back in through a
`request`/`response` or a follow-up `send`. Flatten what you need into fields so
the view can bind each piece; gate the summary on a `hasFile` flag with
`@show`/`@hide`.
