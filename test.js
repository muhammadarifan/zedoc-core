// node test.js - the smallest check that fails if the flow or resolve rules break.
const assert = require('node:assert')
const { flowBoxes } = require('./index.js')

// a text that wraps to more lines pushes every later sibling by exactly its overflow
let boxes = [
  { top: 0, height: 20, textHeight: 50 },
  { top: 30, height: 10 },
  { top: 60, height: 10, textHeight: 10 },
]
let r = flowBoxes(boxes)
assert.deepStrictEqual(boxes.map((b) => [b.y, b.h]), [[0, 50], [60, 10], [90, 10]])
assert.strictEqual(r.shift, 30)
assert.strictEqual(r.bottom, 100)

// never shrinks
boxes = [{ top: 0, height: 40, textHeight: 10 }, { top: 40, height: 10 }]
flowBoxes(boxes)
assert.deepStrictEqual(boxes.map((b) => [b.y, b.h]), [[0, 40], [40, 10]])

// order in the array does not matter, only `top`
boxes = [{ top: 50, height: 10 }, { top: 0, height: 20, textHeight: 30 }]
flowBoxes(boxes)
assert.deepStrictEqual(boxes.map((b) => b.y), [60, 0])

// containers grow with their children, recursively (repeat item -> group -> text)
const text = { top: 10, height: 20, textHeight: 45 }
const under = { top: 40, height: 10 }
const item = { top: 0, height: 60, children: [{ top: 0, height: 50, children: [text, under] }] }
const next = { top: 60, height: 60, children: [] }
boxes = [item, next]
r = flowBoxes(boxes)
assert.strictEqual(item.h, 85) // 60 + 25 overflow
assert.strictEqual(under.y, 65)
assert.strictEqual(next.y, 85)
assert.strictEqual(r.shift, 25)

// a stretch background covers the growth of the siblings that start inside it
const card = { top: 0, height: 100, stretch: true }
const venue = { top: 20, height: 20, textHeight: 60 }
const below = { top: 120, height: 10 } // outside the card: shifts, does not stretch it
boxes = [card, venue, below]
flowBoxes(boxes)
assert.strictEqual(card.h, 140)
assert.strictEqual(below.y, 160)

// a stretch box never itself pushes anything
boxes = [{ top: 0, height: 10, stretch: true, textHeight: 99 }, { top: 10, height: 10 }]
flowBoxes(boxes)
assert.strictEqual(boxes[1].y, 10)

// --- resolve layer ---------------------------------------------------------
const core = require('./index.js')
const theme = { palette: { ink: '#111', accent: '#c00' }, fonts: { display: 'Serif', body: 'Sans' } }
const ctx = (extra) => ({ theme, assets: [{ id: 'a1', src: '/assets/x.webp' }], data: { fields: { judul: 'F', nama_panggilan_mempelai_1: 'Dimas' }, links: { link_konfirmasi_wa: 'wa' }, audio: { background_music: 'mp3' }, images: {} }, ...extra })
const textNode = (o) => ({ type: 'text', name: '', text: 'literal', ...o })

assert.strictEqual(core.FIELDS.length, 68)
assert.ok(core.isKnownField('judul_acara') && !core.isKnownField('nama_acara'))
assert.strictEqual(core.resolveColor({ kind: 'token', token: 'accent' }, theme), '#c00')
assert.strictEqual(core.resolveFont({ kind: 'custom', family: 'X' }, theme), 'X')

// bound text: data wins, literal is the fallback, a repeat item wins for item keys only
assert.strictEqual(core.resolveText(textNode({ binding: { key: 'nama_panggilan_mempelai_1' } }), ctx()), 'Dimas')
assert.strictEqual(core.resolveText(textNode({ binding: { key: 'nama_panggilan_mempelai_2' } }), ctx()), 'literal')
assert.strictEqual(core.resolveText(textNode({ binding: { key: 'venue' } }), ctx({ repeatItem: { venue: 'Aula' } })), 'Aula')
assert.strictEqual(core.resolveText(textNode({ binding: { key: 'judul_acara' } }), ctx({ repeatItem: { judul_acara: 'item' } })), 'literal') // known key ignores the item
assert.strictEqual(core.resolveText(textNode({ binding: { key: 'venue' } }), ctx({ preferLiteralText: true })), 'literal')
// buckets: vocabulary kinds first, then where the data really has an unlisted key
assert.strictEqual(core.resolveText(textNode({ binding: { key: 'link_konfirmasi_wa' } }), ctx()), 'wa')
assert.strictEqual(core.resolveText(textNode({ binding: { key: 'background_music' } }), ctx()), 'mp3')
// the combined "Groom & Bride" nodes show the real names
assert.strictEqual(core.resolveText(textNode({ name: 'Cover names' }), ctx()), 'Dimas & Larasati')

// images / fills go through mapSrc so the designer can prefix its origin
const img = { assetId: 'a1' }
assert.strictEqual(core.resolveImageSrc(img, ctx()), '/assets/x.webp')
assert.strictEqual(core.resolveImageSrc(img, ctx(), (s) => 'http://o' + s), 'http://o/assets/x.webp')
assert.strictEqual(core.resolveFill({ kind: 'image', assetId: 'a1', fit: 'cover', opacity: 1 }, ctx(), (s) => 'H' + s).backgroundImage, 'url(H/assets/x.webp)')
assert.deepStrictEqual(core.resolveFill({ kind: 'none' }, ctx()), {})

// style output carries units and skips the transform when there is none
const fs = core.frameStyle({ x: 1, y: 2, w: 3, h: 4, rotate: 0, flipX: false, flipY: true }, 0.5)
assert.deepStrictEqual([fs.left, fs.top, fs.width, fs.height, fs.transform], ['1px', '2px', '3px', '4px', 'scaleY(-1)'])
assert.strictEqual(core.frameStyle({ x: 0, y: 0, w: 1, h: 1, rotate: 0 }, 1).transform, undefined)

// a group's font override wins for token fonts only
const node = { style: { font: { kind: 'token', token: 'display' }, size: 10, weight: 400, italic: false, underline: false } }
assert.strictEqual(core.resolveTextStyle(node, { fontStyleOverride: { display: { size: 30 } } }).size, 30)
node.style.font = { kind: 'custom', family: 'F' }
assert.strictEqual(core.resolveTextStyle(node, { fontStyleOverride: { display: { size: 30 } } }).size, 10)

// --- node views + serializer ---------------------------------------------------
const tnode = { name: '', text: 'Hi <b>', binding: null, style: { font: { kind: 'token', token: 'display' }, size: 20, weight: 400, lineHeight: 1.2, letterSpacing: 0, align: 'center', color: { kind: 'token', token: 'ink' }, italic: false, underline: false, transform: 'none' } }
const tv = core.textView(tnode, ctx())
assert.strictEqual(tv.style.height, '100%') // the guest fills the frame...
assert.strictEqual(core.textView(tnode, ctx(), { autoHeight: true }).style.height, undefined) // ...the canvas measures content height
assert.strictEqual(core.toHtml(tv), '<div style="font-family:Serif;font-size:20px;font-weight:400;line-height:1.2;letter-spacing:0px;text-align:center;color:#111;font-style:normal;text-decoration:none;width:100%;height:100%;white-space:pre-wrap;word-break:break-word;">Hi &lt;b&gt;</div>')

const iv = core.imageView({ binding: null, assetId: 'a1', radius: 4, alt: 'a"b', fit: 'cover' }, ctx({ mapSrc: (s) => 'H' + s, repeatListKey: 'gallery' }))
assert.deepStrictEqual(Object.keys(iv.attrs), ['src', 'alt', 'draggable', 'data-zd-gallery-src']) // serialised attribute order
assert.strictEqual(core.toHtml(iv).startsWith('<img src="H/assets/x.webp" alt="a&quot;b" draggable="false" data-zd-gallery-src="H/assets/x.webp" style="'), true)
assert.strictEqual(core.imageView({ binding: null, assetId: null, radius: 0, alt: '', fit: 'cover' }, ctx()).tag, 'div') // empty image -> checkerboard placeholder

const line = core.shapeView({ shape: 'line', radius: 0, fill: { kind: 'none' }, stroke: { width: 0, style: 'solid', color: { kind: 'token', token: 'ink' } } }, ctx())
assert.strictEqual(line.children[0].style.height, '1px') // a line is at least 1px thick
assert.strictEqual(core.toHtml(core.svgView({ markup: '<svg/>' })), '<div style="width:100%;height:100%;"><svg/></div>')

console.log('zedoc-core: ok')
