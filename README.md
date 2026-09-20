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
