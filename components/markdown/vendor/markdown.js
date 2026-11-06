export function mkToHtml(path) {
  let _lib = null;
  function loadMarkdownLib() {
    if (_lib === null) {
      // TODO: make path relative
      _lib = import(path).then((mod) => {
        return mod.default().then(() => mod);
      });
    }

    return _lib;
  }
  return async function toHtml(md) {
    const { mdToHtml } = await loadMarkdownLib();
    return mdToHtml(md);
  };
}
