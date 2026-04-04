# Tutuca

Zero-dependency batteries included SPA framework.

- **Single file, no build, no dependencies, no setup** — a script tag is all you need
- **Batteries included** — state management, side effects, automatic memoization, drag and drop and more
- **Fits in your head** (and the context window)
- **View source friendly** — step through the whole stack
- **As much HTML as possible, as little JS as needed**
- ~107KB minified, ~29KB brotli compressed

## Quick Start

### CDN (no install)

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Tutuca: Getting Started</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module">
      import { component, html, tutuca } from "https://esm.sh/tutuca";

      const Counter = component({
        name: "Counter",
        fields: {
          count: 0,
        },
        methods: {
          inc() {
            return this.setCount(this.count + 1);
          },
          dec() {
            return this.setCount(this.count - 1);
          },
        },
        view: html`<div>
          <button @on.click=".dec">-</button>
          <div @text=".count"></div>
          <button @on.click=".inc">+</button>
        </div>`,
      });

      function main() {
        const app = tutuca("#app");
        app.state.set(Counter.make({}));
        app.registerComponents([Counter]);
        app.start();
      }

      main();
    </script>
  </body>
</html>
```

## License

MIT

## Links

- [Documentation & Playground](https://marianoguerra.github.io/tutuca/)
- [Tutorial](https://marianoguerra.github.io/tutuca/tutorial.html)
- [GitHub](https://github.com/marianoguerra/tutuca)
