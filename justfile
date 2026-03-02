dist: dist-tutuca
  rm -rf dist
  cp -r tutuca/dist dist

dist-vdom target="vdom-render":
  cd {{target}} && just dist

dist-immutable repo="https://github.com/marianoguerra/immutable-js.git" branch="7.x":
  git clone --depth 1 --branch {{branch}} {{repo}}
  cd immutable-js; npm install; npm run build; cp dist/immutable.js ../tutuca/deps/immutable.js
  rm -rf immutable-js

dist-tutuca: dist-vdom dist-immutable
  cp vdom/dist/vdom.js tutuca/deps/vdom.js
  cd tutuca && just dist
