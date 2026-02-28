dist: dist-vdom dist-tutuca
    cp -r tutuca/dist dist

dist-vdom target="vdom-render":
    cd {{target}} && just dist

dist-tutuca: dist-vdom
    cp vdom/dist/vdom.js tutuca/deps/vdom.js
    cd tutuca && just dist
