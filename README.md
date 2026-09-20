# @ze/zedoc-core

Framework-free ZeDocument layout primitives shared by `ze-designer` and the
guest renderer in `be-invitation`.

The package owns repeat grid placement, repeat-count reflow, and background
growth. DOM-specific text measurement and guest interactions remain adapters.

## Guest renderer (`engine.js`)

`render(doc, data, opts)` turns a ZeDocument into a complete HTML page string.
It is the single guest-facing renderer: be-invitation serves it, and
ze-designer's Preview embeds it (`iframe srcDoc`). UMD, ES5, no build step —
in a browser load `index.js` first, then `engine.js` (`window.ZeDocEngine`).

## Text flow (`flowBoxes`)

`flowBoxes(boxes)` in `index.js` is the single rule for how grown text lays out:
a text box grows to its measured height, later siblings shift, containers
(groups, repeat items) grow with their children, and `stretch` backgrounds
cover the growth inside their span. The guest renderer inlines its source into
the page's runtime script (DOM adapter); the designer canvas calls it with
boxes built from the document (`ze-designer/src/render/flow.ts`). Keep it
self-contained - it is stringified with `Function.prototype.toString`.
`npm test` runs the self-check.
