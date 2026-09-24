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

// side-by-side boxes do not push each other (a row of countdown digits), but each
// pushes what sits under it; a stack of full-width boxes still accumulates
boxes = [
  { top: 0, height: 20, textHeight: 30, left: 0, width: 50 }, // grows 10
  { top: 0, height: 20, textHeight: 30, left: 60, width: 50 }, // grows 10, beside the first
  { top: 0, height: 20, textHeight: 30, left: 120, width: 50 },
  { top: 30, height: 10, left: 0, width: 50 }, // under the first only
  { top: 30, height: 10, left: 120, width: 50 }, // under the third only
]
r = flowBoxes(boxes)
assert.deepStrictEqual(boxes.map((b) => b.y), [0, 0, 0, 40, 40]) // no staircase
assert.strictEqual(r.shift, 10) // the container grew by how far its lowest content moved
boxes = [
  { top: 0, height: 20, textHeight: 30, left: 0, width: 100 }, // full width, grows 10
  { top: 30, height: 10, left: 0, width: 40 },
  { top: 30, height: 10, left: 60, width: 40 }, // both columns sit under it
  { top: 50, height: 10, textHeight: 25, left: 60, width: 40 }, // grows 15 in the right column only
  { top: 70, height: 10, left: 0, width: 40 }, // left column: moved by the first growth only
  { top: 70, height: 10, left: 60, width: 40 }, // right column: first growth + its own
]
r = flowBoxes(boxes)
assert.deepStrictEqual(boxes.map((b) => b.y), [0, 40, 40, 60, 80, 95])
assert.strictEqual(r.shift, 25)

// the guest page inlines flowBoxes' source into its runtime script, so the function must
// stand alone: rebuilt from its own text with nothing else in scope, it lays out the same
const standalone = new Function('return ' + flowBoxes.toString())()
boxes = [{ top: 0, height: 20, textHeight: 30, left: 0, width: 50 }, { top: 0, height: 20, textHeight: 30, left: 60, width: 50 }, { top: 30, height: 10, left: 0, width: 50 }]
assert.strictEqual(standalone(boxes).shift, 10)
assert.deepStrictEqual(boxes.map((b) => b.y), [0, 0, 40])

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

// a timeline line beside a growing story stretches with it, and does not push its neighbours
const connector = { top: 22, height: 126, stretch: true, left: 6, width: 1 }
const story = { top: 36, height: 78, textHeight: 300, left: 32, width: 346 }
flowBoxes([connector, story])
assert.strictEqual(connector.h, 126 + 222)

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

// --- node trees: groups, repeats, hooks -------------------------------------
const frame = (x, y, w, h) => ({ x, y, w, h, rotate: 0, flipX: false, flipY: false })
const tstyle = tnode.style
const T = (id, name, extra) => ({ id, name, type: 'text', visible: true, opacity: 1, frame: frame(0, 0, 100, 20), text: name, binding: null, style: tstyle, ...extra })
const lctx = (extra) => ({ ...ctx(), mode: 'edit', ...extra })

// hidden nodes are not drawn; a repeat is a fragment of item wrappers
assert.strictEqual(core.nodeView({ ...T('a', 'A'), visible: false }, ctx()), null)
const rep = { id: 'r', name: 'R', type: 'repeat', listKey: 'quotes', visible: true, opacity: 0.5, frame: frame(10, 100, 200, 50), children: [T('q', 'Q', { binding: { key: 'isi_quote' } })] }
const data2 = { ...ctx().data, quotes: [{ isi_quote: 'one' }, { isi_quote: 'two' }] }
const rv = core.nodeView(rep, { ...ctx(), data: data2 }, { y: 120 })
assert.strictEqual(rv.fragment.length, 2)
assert.deepStrictEqual(rv.fragment.map((v) => v.style.top), ['120px', '170px']) // stacked at i * frame.h below the (reflowed) y
assert.strictEqual(rv.fragment[0].style.opacity, 0.5) // the guest applies the repeat's opacity per item
assert.ok(core.toHtml(rv).includes('one') && core.toHtml(rv).includes('two'))
// the canvas draws items inside the repeat's own box: origin 0,0, opacity 1, and the flow may move an item
const items = core.repeatItemViews(rep, { ...lctx(), data: data2, place: (p) => (p === 'r#1' ? { y: 999, h: 60 } : undefined) }, 'r', { frame: rep.frame, origin: { x: 0, y: 0 }, opacity: 1 })
assert.deepStrictEqual(items.map((v) => [v.style.left, v.style.top, v.style.height]), [['0px', '0px', '50px'], ['0px', '999px', '60px']])
assert.strictEqual(items[0].children[0].children[0].measure, 'r#0/q') // text inside an item is measured under its path
// a repeat nested inside a group (a couple's own "block" regroup on canvas):
// origin is the repeat's own position within that group, not 0,0 - a
// flow-placed item's y is local to the repeat (see boxOf() in flow.ts) and
// has to land at origin.y + that offset, not replace origin entirely.
const nestedItems = core.repeatItemViews(rep, { ...lctx(), data: data2, place: (p) => (p === 'r#0' ? { y: 0, h: 50 } : p === 'r#1' ? { y: 50, h: 60 } : undefined) }, 'r', { frame: rep.frame, origin: { x: 0, y: 112 }, opacity: 1 })
assert.deepStrictEqual(nestedItems.map((v) => v.style.top), ['112px', '162px'])
// an empty repeat: one stand-in item on the canvas, nothing for a guest
assert.strictEqual(core.repeatItemViews(rep, { ...lctx(), data: { ...ctx().data, quotes: [] } }, 'r', { frame: rep.frame, origin: { x: 0, y: 0 }, opacity: 1 }).length, 1)
assert.strictEqual(core.repeatItemViews(rep, { ...ctx(), data: { ...ctx().data, quotes: [] } }, 'r', { frame: rep.frame, origin: { x: 0, y: 0 }, opacity: 1 }).length, 0)

// couple / events children resolve through the binding remap, like the compiler
const cp = { ...rep, listKey: 'couple', children: [T('n', 'N', { binding: { key: 'nama_lengkap_mempelai' } })] }
assert.ok(core.toHtml(core.nodeView(cp, { ...ctx(), data: { ...ctx().data, couple: [{ nama: 'Dimas W' }] } })).includes('Dimas W'))
const ev = { ...rep, listKey: 'events', children: [T('e1', 'E1'), T('e2', 'E2'), T('e3', 'E3')] }
const evHtml = core.toHtml(core.nodeView(ev, { ...ctx(), data: { ...ctx().data, events: [{ keterangan: 'KET', venue: 'VEN' }] } }))
assert.ok(evHtml.includes('KET') && evHtml.includes('VEN') && evHtml.includes('E3')) // first two unbound texts bind, the third stays literal

// a frame crops its children; an empty one is a checkerboard on the canvas only
const grp = { id: 'g', name: 'G', type: 'group', visible: true, opacity: 1, frame: frame(0, 0, 50, 50), clip: { shape: 'ellipse' }, children: [] }
assert.ok(core.toHtml(core.nodeView(grp, ctx())).includes('border-radius:50%'))
assert.ok(!core.toHtml(core.nodeView(grp, ctx())).includes('conic'))
assert.ok(core.toHtml(core.nodeView(grp, lctx())).includes('conic'))
// a styled group's palette override applies to its children only
const styled = { ...grp, clip: undefined, style: { palette: { ink: '#abc' } }, children: [T('t', 'T')] }
assert.ok(core.toHtml(core.nodeView(styled, ctx())).includes('color:#abc'))

// the canvas's flow decides where a nested node sits; the guest's reflow override wins over it
const nested = { ...styled, style: undefined, children: [T('t', 'T', { frame: frame(0, 5, 100, 20) })] }
const placedHtml = core.toHtml(core.nodeView(nested, { ...ctx(), place: (p) => (p === 'g/t' ? { y: 77, h: 33 } : undefined) }))
assert.ok(placedHtml.includes('top:77px') && placedHtml.includes('height:33px'))

// guest-only behaviour is layered on through ctx.decorate (view mutated, or replaced)
const deco = core.nodeView(T('d', 'D'), { ...ctx(), decorate: (n, v) => { v.attrs['data-x'] = '1' } })
assert.strictEqual(deco.attrs['data-x'], '1')
assert.strictEqual(core.toHtml(core.nodeView(T('d', 'D'), { ...ctx(), decorate: () => ({ raw: '<b/>' }) })), '<b/>')
// a node type the runtime doesn't know (the retired `block`) is an empty frame, not a crash
const blk = { id: 'b', name: 'B', type: 'block', block: 'x', visible: true, opacity: 1, frame: frame(0, 0, 10, 10) }
assert.ok(core.toHtml(core.nodeView(blk, ctx())).endsWith('></div>'))
// a bare attribute is written without a value
assert.strictEqual(core.toHtml({ tag: 'div', attrs: { 'data-b': true, id: 'i' }, style: {} }), '<div data-b id="i" style=""></div>')

// --- icons -----------------------------------------------------------------------
assert.strictEqual(Object.keys(core.ICONS).length, 41)
const heart = core.iconSvg('Heart', '#c00', 1.5, { width: '100%' })
assert.deepStrictEqual([heart.attrs.stroke, heart.attrs['stroke-width'], heart.attrs.viewBox], ['#c00', '1.5', '0 0 24 24'])
assert.strictEqual(core.iconSvg('NotAnIcon', '#000', 2), null)
assert.strictEqual(core.iconSvg('toString', '#000', 2), null) // catalogue lookups never fall through to Object.prototype
const inode = { icon: 'Star', strokeWidth: 2, color: { kind: 'token', token: 'accent' } }
assert.ok(core.toHtml(core.iconView(inode, ctx())).startsWith('<svg xmlns="http://www.w3.org/2000/svg"'))
assert.ok(core.toHtml(core.iconView(inode, ctx())).includes('stroke="#c00"')) // a theme token resolves
assert.strictEqual(core.iconView({ ...inode, icon: 'Nope' }, ctx()), null) // an unknown icon draws nothing for a guest...
assert.ok(core.iconView({ ...inode, icon: 'Nope' }, lctx()).attrs.title.includes('Nope')) // ...and a dashed placeholder on the canvas
// children without a style object serialise without a style attribute
assert.ok(!core.toHtml(core.iconSvg('Minus', '#000', 2)).includes('<line style'))

// --- guest roles + stretch backgrounds ------------------------------------------
assert.deepStrictEqual(core.guestRole({ name: 'RSVP submit button', type: 'group' }), { name: 'RSVP submit button', type: 'group', role: 'rsvp-submit' })
assert.strictEqual(core.guestRole({ name: 'RSVP submit button', type: 'text' }), null) // wrong type: the guest page ignores it
assert.strictEqual(core.guestRole({ name: 'RSVP Submit Button', type: 'group' }), null) // names are exact
assert.strictEqual(core.guestRole({ name: 'toString', type: 'group' }), null) // never falls through to Object.prototype
assert.strictEqual(core.guestRole({ name: 'Map button', type: 'shape' }).role, 'map-button') // '*' matches any type
assert.strictEqual(core.guestRole({ name: 'Countdown number 3', type: 'text' }).arg, 'm')
assert.strictEqual(new Set(core.GUEST_ROLES.map((entry) => entry.name)).size, core.GUEST_ROLES.length) // a name maps to one role
assert.ok(core.isStretchShape({ name: 'Card background', type: 'shape' }))
assert.ok(!core.isStretchShape({ name: 'Card background', type: 'text' }) && !core.isStretchShape({ name: 'Card', type: 'shape' }))
assert.ok(core.isStretchShape({ name: 'Timeline line', type: 'shape' })) // the connector beside a growing story stretches with it
assert.ok(!core.isStretchShape({ name: 'Timeline dot', type: 'shape' }))

// --- node motion ------------------------------------------------------------------
const engine = require('./engine.js')
const anim = (over) => Object.assign({ preset: 'rise', trigger: 'load', duration: 600, delay: 0, easing: 'ease-out' }, over)
assert.strictEqual(core.motionStyle({}), null) // no animations -> nothing to add
let motion = core.motionStyle({ animations: [anim({ amount: 40 }), anim({ preset: 'fade', trigger: 'reveal', delay: 100 })] })
assert.strictEqual(motion.style.animationName, 'zd-motion-rise, zd-motion-fade')
assert.strictEqual(motion.style['--st-rise-distance'], '40px') // amount feeds the preset's CSS variable
assert.strictEqual(motion.style.animationPlayState, 'running, var(--zd-rv,paused)') // reveal waits for the observer
assert.strictEqual(motion.style.animationFillMode, 'backwards, backwards')
assert.ok(motion.reveal)
motion = core.motionStyle({ animationPlayMode: 'sequence', animations: [anim({ delay: 50 }), anim({ delay: 10 }), anim({ preset: 'pulse', trigger: 'loop' })] })
assert.strictEqual(motion.style.animationDelay, '50ms, 660ms, 1260ms') // each entry starts after the previous one ended
assert.strictEqual(motion.style.animationIterationCount, '1, 1, infinite')
assert.ok(!motion.reveal)

// the guest page: keyframes only for presets in use, hooks only when something animates
const box = (id, extra) => Object.assign({
  id, name: id, type: 'shape', frame: { x: 0, y: 0, w: 50, h: 50, rotate: 0, flipX: false, flipY: false }, opacity: 1, visible: true, locked: false,
  shape: 'rect', fill: { kind: 'solid', color: { kind: 'token', token: 'bg' } }, stroke: { color: { kind: 'token', token: 'line' }, width: 0, style: 'solid' }, radius: 0,
}, extra)
const docOf = (nodes, envelopeNodes) => ({
  format: 'zedocument', version: 1, id: 'd', name: 'd', createdAt: '', updatedAt: '', assets: [], data: {},
  theme: { palette: { bg: '#fff', surface: '#fff', ink: '#000', inkSoft: '#888', accent: '#a00', accentInk: '#fff', line: '#ddd' }, fonts: { display: 'serif', body: 'sans-serif' }, radius: 0 },
  artboards: [{ id: 'a', name: 'a', role: 'invitation', preset: 'invitation', size: { w: 400, h: 200 }, background: { kind: 'solid', color: { kind: 'token', token: 'bg' } }, nodes }].concat(
    envelopeNodes ? [{ id: 'e', name: 'e', role: 'envelope', preset: 'envelope', size: { w: 400, h: 200 }, background: { kind: 'solid', color: { kind: 'token', token: 'bg' } }, nodes: envelopeNodes }] : []),
})
let html = engine.render(docOf([box('plain')]), {})
assert.ok(!/zd-motion|data-zd-motion|zdMotionStart|data-zd-gated/.test(html)) // no animations, no trace
html = engine.render(docOf([box('a1', { animations: [anim()] }), box('a2', { frame: { x: 0, y: 0, w: 50, h: 50, rotate: 30, flipX: false, flipY: false }, animations: [anim({ preset: 'spin', trigger: 'loop' })] })]), {})
assert.ok(html.includes('@keyframes zd-motion-rise') && html.includes('@keyframes zd-motion-spin') && !html.includes('@keyframes zd-motion-pop'))
assert.strictEqual((html.match(/data-zd-motion="1"/g) || []).length, 2)
assert.ok(/transform:rotate\(30deg\)[^"]*animation-name:zd-motion-spin/.test(html)) // the frame's own rotation is left alone
assert.ok(html.includes('zdMotionStart()') && !html.includes('data-zd-gated="1"')) // no gate: starts straight away
html = engine.render(docOf([box('r1', { animations: [anim({ trigger: 'reveal' })] })], [box('g1')]), {})
assert.ok(html.includes('data-zd-motion="reveal"') && html.includes('data-zd-gated="1"')) // behind an envelope gate...
assert.ok(html.includes("window.zdMotionStart&&window.zdMotionStart()")) // ...the gate's click releases it

// --- background music ---------------------------------------------------------------
html = engine.render(docOf([box('plain')]), { audio: { background_music: '' } })
assert.ok(!/zd-music|<audio/.test(html)) // no track, no player
html = engine.render(docOf([box('plain')]), { audio: { background_music: '/images/track"><b.mp3' } })
assert.ok(html.includes('<audio id="zd-music" loop preload="none" src="/images/track&quot;&gt;&lt;b.mp3">')) // the URL is escaped into the attribute
assert.ok(html.includes('id="zd-music-btn"') && html.includes('.zd-ring') && html.includes('zd-music-spin'))
assert.ok(html.includes('right:max(16px, calc(50% - 200px + 16px))')) // sits at the edge of the centred 400px column
assert.ok(html.includes('document.addEventListener("click",first)')) // starts on the first click/tap

// --- sections ------------------------------------------------------------------------
assert.strictEqual(core.SECTIONS.length, 16)
assert.strictEqual(core.SECTIONS[0], 'opening-overlay')
assert.strictEqual(new Set(core.SECTIONS).size, core.SECTIONS.length)
assert.strictEqual(core.sectionOf({ id: 'ab-invitation-rsvp', name: 'RSVP', role: 'invitation' }), 'rsvp') // catalog id
assert.strictEqual(core.sectionOf({ id: 'ab-envelope', name: 'Envelope', role: 'envelope' }), 'opening-overlay')
for (const id of ['amplop-digital', 'tanda-kasih', 'angpao-digital', 'share-love']) assert.strictEqual(core.sectionOf({ id: 'ab-invitation-' + id }), 'envelope') // four ids, one section
assert.strictEqual(core.sectionOf({ id: 'k3Jx9', name: ' gallery ', role: 'invitation' }), 'gallery') // re-id'd by the designer: the catalog name still says which
assert.strictEqual(core.sectionOf({ id: 'k3Jx9', name: 'Tanda Kasih' }), 'envelope')
assert.strictEqual(core.sectionOf({ id: 'ab-invitation-gallery', name: 'Gallery', section: 'wishes' }), 'wishes') // the stamp wins
assert.strictEqual(core.sectionOf({ id: 'ab-invitation-gallery', section: 'not-a-section' }), 'gallery') // an unknown stamp is ignored
assert.strictEqual(core.sectionOf({ id: 'k3Jx9', name: 'Kanvas 1' }), null) // a canvas the couple made
assert.strictEqual(core.sectionOf({ id: 'ab-invitation-footer', name: 'Footer' }), null) // decorative
assert.strictEqual(core.sectionOf({ id: 'ab-invitation-border-strip', name: 'Border Strip' }), null)
assert.strictEqual(core.sectionOf({ id: 'x', name: 'Gallery', role: 'side' }), null) // the backdrop is never a section
assert.strictEqual(core.sectionOf({ id: 'toString', name: 'constructor' }), null) // never falls through to Object.prototype
assert.strictEqual(core.sectionOf(null), null)

// --- wizard section switches ------------------------------------------------------------
const label = (text) => ({
  id: 't-' + text, name: text, type: 'text', frame: { x: 0, y: 0, w: 200, h: 20, rotate: 0, flipX: false, flipY: false }, opacity: 1, visible: true, locked: false, text: text,
  style: { font: { kind: 'token', token: 'body' }, size: 12, weight: 400, lineHeight: 1.2, letterSpacing: 0, align: 'left', color: { kind: 'token', token: 'ink' }, italic: false, underline: false, transform: 'none' },
})
const part = (section, h) => ({ id: 'ab-' + section, name: section, role: 'invitation', preset: 'p', size: { w: 400, h: h || 100 }, section, background: { kind: 'solid', color: { kind: 'token', token: 'bg' } }, nodes: [label('TEXT-' + section)] })
const withSections = (data) => {
  const doc = docOf([])
  doc.artboards = [part('cover', 100), part('gallery', 200), part('send-gift', 300), part('rsvp', 100)]
  return engine.render(doc, data)
}
const shown = (html) => ['cover', 'gallery', 'send-gift', 'rsvp'].filter((name) => html.includes('TEXT-' + name))
assert.deepStrictEqual(shown(withSections({})), ['cover', 'gallery', 'send-gift', 'rsvp']) // no switches: everything
assert.deepStrictEqual(shown(withSections({ sections: { gallery: true, rsvp: true, nonsense: false } })), ['cover', 'gallery', 'send-gift', 'rsvp']) // only an explicit false hides
html = withSections({ sections: { gallery: false } })
assert.deepStrictEqual(shown(html), ['cover', 'send-gift', 'rsvp'])
assert.deepStrictEqual([...html.matchAll(/data-zd-section-index="(\d+)"/g)].map((m) => m[1]), ['0', '1', '2']) // the stack is renumbered
const tops = (h) => [...h.matchAll(/data-zd-section-index="\d+" data-zd-base-height="[^"]+" style="position:absolute;top:(\d+)px/g)].map((m) => +m[1])
assert.deepStrictEqual(tops(html), [0, 100, 400]) // and closes the gap: cover 100, then the full gift section (300), then rsvp
// turning gifts down replaces the section with the couple's message - and the wording depends on the envelope switch
html = withSections({ sections: { 'send-gift': false } })
assert.ok(!html.includes('TEXT-send-gift') && html.includes('mohon untuk tidak memberikan bingkisan'))
assert.deepStrictEqual(tops(html), [0, 100, 300, 524]) // the message section is 224 tall, not the gift section's 300
html = withSections({ sections: { 'send-gift': false, envelope: false } })
assert.ok(html.includes('adalah hadiah yang paling berarti') && !html.includes('bingkisan'))
html = withSections({ sections: { 'send-gift': false }, fields: { teks_pesan_tanpa_kado_fisik: 'Tanpa <b>kado</b>, ya' } })
assert.ok(html.includes('Tanpa &lt;b&gt;kado&lt;/b&gt;, ya') && !html.includes('bingkisan')) // their own words win, and are escaped
html = withSections({ sections: { 'send-gift': false, envelope: false }, fields: { teks_pesan_tanpa_kado: 'Cukup doa', teks_pesan_tanpa_kado_fisik: 'Tanpa kado' } })
assert.ok(html.includes('Cukup doa') && !html.includes('Tanpa kado'))
// a canvas the couple made (no section) is never hidden, whatever the switches say
{
  const doc = docOf([])
  const custom = part('cover', 100); delete custom.section; custom.id = 'k3Jx9'; custom.name = 'Kanvas 1'; custom.nodes = [label('TEXT-custom')]
  doc.artboards = [custom]
  assert.ok(engine.render(doc, { sections: { cover: false, 'k3Jx9': false } }).includes('TEXT-custom'))
}
// the opening gate goes with its switch, and so does the "held until it opens" state
html = engine.render(docOf([box('r1', { animations: [anim()] })], [box('g1')]), {})
assert.ok(html.includes('id="zd-gate"') && html.includes('data-zd-gated="1"'))
html = engine.render(docOf([box('r1', { animations: [anim()] })], [box('g1')]), { sections: { 'opening-overlay': false } })
assert.ok(!html.includes('id="zd-gate"') && !html.includes('data-zd-gated="1"'))

// --- per-guest events ----------------------------------------------------------------
{
  const evs = [{ nama_acara: 'Akad' }, { nama_acara: 'Resepsi' }, { nama_acara: 'Gala' }]
  const names = (r) => r.events.map((e) => e.nama_acara)
  // a preview (no guestId): everything shown, RSVP on, counts always asked, no caps
  let r = core.guestEvents({ events: evs })
  assert.deepStrictEqual(names(r), ['Akad', 'Resepsi', 'Gala'])
  assert.strictEqual(r.canRsvp, true)
  assert.ok(r.events.every((e) => e.rsvpShowInputs && e.rsvpDewasaMax === null && !e.hasQuotaNote && !e.rsvpHasResponded))
  // invited-events filter; empty list = no restriction; the input list is not mutated
  assert.deepStrictEqual(names(core.guestEvents({ events: evs, guestInvitedEvents: ['Gala'] })), ['Gala'])
  assert.strictEqual(core.guestEvents({ events: evs, guestInvitedEvents: [] }).events.length, 3)
  assert.strictEqual(evs[0].rsvpShowInputs, undefined)
  // a real guest without quota data cannot RSVP (and the filter still applies)
  r = core.guestEvents({ events: evs, guestId: 'g1', guestInvitedEvents: ['Akad'] })
  assert.strictEqual(r.canRsvp, false)
  assert.deepStrictEqual(r.events, [{ nama_acara: 'Akad' }])
  // category quota, enforced: caps + note; soft (enforce:false): note only
  const quota = { Akad: { mode: 'category', dewasa: 2, anak: 1 }, Resepsi: { mode: 'category', dewasa: 2, anak: 0, enforce: false }, Gala: { mode: 'total', total: 4 } }
  r = core.guestEvents({ events: evs, guestId: 'g1', guestEventQuota: quota })
  assert.strictEqual(r.canRsvp, true)
  assert.deepStrictEqual([r.events[0].rsvpDewasaMax, r.events[0].rsvpAnakMax, r.events[0].rsvpTotalMax], [2, 1, null])
  assert.ok(r.events[0].quotaNote.endsWith('(jumlah undangan: 2 dewasa dan 1 anak).'))
  assert.deepStrictEqual([r.events[1].rsvpDewasaMax, r.events[1].hasQuotaNote], [null, true])
  assert.deepStrictEqual([r.events[2].rsvpTotalMax, r.events[2].rsvpMode], [4, 'total'])
  assert.ok(r.events[2].quotaNote.endsWith('(jumlah undangan: 4 orang).'))
  // unlimited (or no quota for that event): counts still asked only when a quota exists, no cap, no note
  r = core.guestEvents({ events: evs, guestId: 'g1', guestEventQuota: { Akad: { mode: 'unlimited' } } })
  assert.deepStrictEqual([r.events[0].rsvpShowInputs, r.events[0].rsvpDewasaMax, r.events[0].hasQuotaNote], [true, null, false])
  assert.deepStrictEqual([r.events[1].rsvpShowInputs, r.events[1].rsvpUntracked], [false, true])
  // a previous answer prefills; a stored 0/0 still counts as answered
  r = core.guestEvents({ events: evs, guestId: 'g1', guestEventQuota: quota, guestEventRsvp: { Akad: { dewasa: 2, anak: 1 }, Resepsi: { dewasa: 0, anak: 0 } } })
  assert.deepStrictEqual([r.events[0].rsvpPrefillDewasa, r.events[0].rsvpPrefillAnak, r.events[0].rsvpHasResponded], [2, 1, true])
  assert.deepStrictEqual([r.events[1].rsvpPrefillDewasa, r.events[1].rsvpHasResponded], [0, true])
  assert.strictEqual(r.events[2].rsvpHasResponded, false)
  // no events list at all is passed through, not invented
  assert.strictEqual(core.guestEvents({}).events, null)
  // the guest page uses it: a guest invited to one event gets only that event on the page
  const evDoc = docOf([{ ...rep, listKey: 'events', opacity: 1, children: [T('q', 'Q', { binding: { key: 'nama_acara' } })] }])
  const page = engine.render(evDoc, { events: evs, guestId: 'g1', guestEventQuota: {}, guestInvitedEvents: ['Gala'] })
  assert.ok(page.includes('Gala') && !page.includes('Akad') && !page.includes('Resepsi'))
  assert.ok(!page.includes(' data-zd2-can-rsvp="0"'))
  // RSVP is refused (body flag) for a real guest with no quota data, never for a preview
  assert.ok(engine.render(evDoc, { events: evs, guestId: 'g1' }).includes(' data-zd2-can-rsvp="0"'))
  assert.ok(!engine.render(evDoc, { events: evs }).includes(' data-zd2-can-rsvp="0"'))
}

// --- #rsvp deep link + skipOpeningOverlay ---------------------------------------------------
{
  const vm = require('node:vm')
  const doc = docOf([], [box('g1')])
  doc.artboards.splice(0, 1, part('cover', 100), part('rsvp', 100))
  let page = engine.render(doc, {})
  assert.ok(page.includes(' data-zd-section="rsvp"') && page.includes(' data-zd-section="cover"')) // sections say which they are
  assert.ok(page.includes('id="zd-gate"'))
  assert.ok(page.includes("this.style.pointerEvents='none';window.scrollTo(0,0)")) // opening the gate starts the page from the top
  // skipOpeningOverlay (data or opts) = the gate is not there at all, and nothing is held behind it
  for (const html of [engine.render(doc, { skipOpeningOverlay: true }), engine.render(doc, {}, { skipOpeningOverlay: true })]) assert.ok(!html.includes('id="zd-gate"') && !html.includes('data-zd-gated'))
  // run the emitted deep-link script against a stub page: it taps the gate and scrolls to the RSVP section, and only for #rsvp
  const run = (hash, hasRsvp) => {
    const calls = { click: 0, scroll: 0 }
    const timers = []
    const stubEl = { click: () => calls.click++, scrollIntoView: () => calls.scroll++ }
    const document = { getElementById: (id) => (id === 'zd-gate' ? stubEl : null), querySelector: (sel) => (hasRsvp && sel === '[data-zd-section=rsvp]' ? stubEl : null) }
    const src = page.match(/<script>(\(function\(\)\{if\(location\.hash!=="#rsvp"\)return;.*?)<\/script>/)[1]
    vm.runInNewContext(src, { location: { hash }, document, setTimeout: (fn) => timers.push(fn) })
    for (let i = 0; i < 10 && timers.length; i++) timers.shift()() // the retries re-arm themselves, 5 in all
    return calls
  }
  assert.deepStrictEqual(run('#rsvp', true), { click: 1, scroll: 5 })
  assert.deepStrictEqual(run('#rsvp', false), { click: 1, scroll: 0 }) // no RSVP section: still opens the gate
  assert.deepStrictEqual(run('', true), { click: 0, scroll: 0 })
  assert.deepStrictEqual(run('#wishes', true), { click: 0, scroll: 0 })
}

// --- guest counts (dewasa/anak) in the RSVP cards ---------------------------------------------
{
  const shape = (id, name, x, y, w, h) => ({ ...box(id, { name }), frame: { x, y, w, h, rotate: 0, flipX: false, flipY: false } })
  const attend = { id: 'ab', name: 'Attendance buttons', type: 'group', frame: frame(16, 98, 334, 34), opacity: 1, visible: true, locked: false, children: [shape('y', 'Yes button', 0, 0, 163, 34), shape('n', 'No button', 171, 0, 163, 34)] }
  const card = (over) => ({
    id: 'r', name: 'RSVP event cards', type: 'repeat', listKey: 'events', visible: true, opacity: 1, frame: frame(32, 106, 366, 158),
    children: [shape('bg', 'RSVP card bg', 0, 0, 366, 148), T('nm', 'Event name', { binding: { key: 'nama_acara' } }), attend], ...over,
  })
  const below = shape('sub', 'Submit', 32, 276, 366, 44)
  const nodes = [T('h', 'Head'), card(), below]
  const before = JSON.stringify(nodes)
  let r = core.withGuestCounts(nodes)
  const rep2 = r.nodes[1]
  assert.strictEqual(r.extra, 64)
  assert.strictEqual(JSON.stringify(nodes), before) // the caller's nodes are not touched
  assert.strictEqual(rep2.frame.h, 158 + 64) // one item's pitch grows
  assert.deepStrictEqual([rep2.children[0].name, rep2.children[0].frame.h], ['Card background', 148 + 64]) // and its background, renamed so it stretches
  assert.ok(core.isStretchShape(rep2.children[0]))
  const [group, note] = rep2.children.slice(-2)
  assert.deepStrictEqual([core.guestRole(group).role, group.frame.y, group.frame.h, group.frame.x, group.frame.w], ['guest-count', 98 + 34 + 12, 34, 16, 334]) // under the buttons, same width
  assert.deepStrictEqual([note.binding.key, note.frame.y], ['quotaNote', 144 + 34 + 4])
  assert.strictEqual(r.nodes[2].frame.y, 276 + 64) // whatever sat below moves down
  assert.strictEqual(r.nodes[0], nodes[0]) // and what is above is the same object
  // a card that already has its own counters, a baseline of 2 cards, a section with no RSVP cards
  assert.strictEqual(core.withGuestCounts(r.nodes).extra, 0)
  assert.strictEqual(core.withGuestCounts([card({ verifiedCount: 2 }), below]).extra, 128)
  assert.strictEqual(core.withGuestCounts([card({ verifiedCount: 2 }), below]).nodes[1].frame.y, 276 + 128)
  assert.deepStrictEqual(core.withGuestCounts([T('h', 'Head'), card({ listKey: 'quotes' })]), { nodes: [T('h', 'Head'), card({ listKey: 'quotes' })], extra: 0 })

  // on the guest page: taller section, counters per event, defaults and caps as data attributes
  const rsvpDoc = docOf([])
  rsvpDoc.artboards = [{ ...part('rsvp', 420), nodes: [T('h', 'Head'), card(), below] }]
  const evs2 = [{ nama_acara: 'Akad' }, { nama_acara: 'Resepsi' }]
  const baseH = (h) => +h.match(/data-zd-base-height="(\d+)px"/)[1]
  const withCounts = engine.render(rsvpDoc, { events: evs2, guestId: 'g1', guestEventQuota: {} })
  const without = engine.render(rsvpDoc, { events: evs2, guestId: 'g1' }) // no quota data: canRsvp false
  assert.strictEqual(baseH(withCounts) - baseH(without), 64 + 64) // 2 cards, but only the baseline one is pre-grown: 64 + the 2nd card's pitch
  assert.ok(!without.includes('data-zd2-counts-event="'))
  const tracked = engine.render(rsvpDoc, { events: evs2, guestId: 'g1', guestEventQuota: { Akad: { mode: 'category', dewasa: 2, anak: 1 } }, guestEventRsvp: {} })
  assert.strictEqual([...tracked.matchAll(/data-zd2-counts-event="/g)].length, 1) // Resepsi: no quota, no counters
  assert.ok(tracked.includes('data-zd2-counts-event="Akad" data-zd2-def-dewasa="1" data-zd2-def-anak="0" data-zd2-max-dewasa="2" data-zd2-max-anak="1"'))
  assert.ok(!tracked.includes('data-zd2-max-total') && !/data-zd2-(max|def|counts)-[a-z-]*=""/.test(tracked)) // no cap, no attribute (an empty one would read as 0)
  assert.strictEqual([...tracked.matchAll(/data-zd2-untracked="1"/g)].length, 2) // Resepsi's Yes button (its label is not in this test doc)
  // an earlier answer prefills; a decline hides the box and starts it at 0
  let answered = engine.render(rsvpDoc, { events: [evs2[0]], guestId: 'g1', guestEventQuota: { Akad: { mode: 'unlimited' } }, guestEventRsvp: { Akad: { dewasa: 3, anak: 2 } } })
  assert.ok(answered.includes('data-zd2-def-dewasa="3" data-zd2-def-anak="2"') && answered.includes('value="3"') && answered.includes('value="2"'))
  answered = engine.render(rsvpDoc, { events: [evs2[0]], guestId: 'g1', guestEventQuota: { Akad: { mode: 'unlimited' } }, guestEventRsvp: { Akad: { dewasa: 0, anak: 0 } } })
  assert.ok(answered.includes('display:none') && answered.includes('data-zd2-def-dewasa="1"'))
  // a total cap of 1 (or dewasa capped at 0) keeps the default inside the caps
  assert.ok(engine.render(rsvpDoc, { events: [evs2[0]], guestId: 'g1', guestEventQuota: { Akad: { mode: 'category', dewasa: 0, anak: 2 } } }).includes('data-zd2-def-dewasa="0" data-zd2-def-anak="1"'))
  // the client script and the submit that reads it ship with the page
  assert.ok(tracked.includes('window.zd2Counts=') && tracked.includes('window.zd2Counts(ev)') && tracked.includes('Isi jumlah tamu yang akan hadir'))
  assert.ok(!without.includes('window.zd2Counts='))

  // a repeat visit opens locked: every event that asks for a headcount has an answer
  const quotaBoth = { Akad: { mode: 'category', dewasa: 2, anak: 1 }, Resepsi: { mode: 'total', total: 4 } }
  const ev2 = [{ nama_acara: 'Akad' }, { nama_acara: 'Resepsi' }]
  assert.strictEqual(core.guestEvents({ events: ev2, guestId: 'g', guestEventQuota: quotaBoth, guestEventRsvp: { Akad: { dewasa: 2, anak: 1 }, Resepsi: { dewasa: 0, anak: 0 } } }).responded, true) // a decline is an answer
  assert.strictEqual(core.guestEvents({ events: ev2, guestId: 'g', guestEventQuota: quotaBoth, guestEventRsvp: { Akad: { dewasa: 2, anak: 1 } } }).responded, false) // one still open
  assert.strictEqual(core.guestEvents({ events: ev2, guestId: 'g', guestEventQuota: { Akad: quotaBoth.Akad }, guestEventRsvp: { Akad: { dewasa: 1, anak: 0 } } }).responded, true) // an event with no quota does not count
  assert.strictEqual(core.guestEvents({ events: ev2, guestEventRsvp: { Akad: { dewasa: 1 }, Resepsi: { dewasa: 1 } } }).responded, false) // a preview never
  assert.strictEqual(core.guestEvents({ events: [], guestId: 'g', guestEventQuota: {} }).responded, false)
  const locked = engine.render(rsvpDoc, { events: ev2, guestId: 'g1', guestEventQuota: quotaBoth, guestEventRsvp: { Akad: { dewasa: 2, anak: 1 }, Resepsi: { dewasa: 0, anak: 0 } } })
  assert.ok(locked.includes(' data-zd2-locked="1"'))
  assert.ok(locked.includes('>Hadir · 2 Dewasa · 1 Anak</div>') && locked.includes('>Mohon maaf tidak dapat hadir.</div>')) // each event's own summary
  assert.ok(locked.includes('body[data-zd2-locked] .zd2-cnt{display:none!important}') && locked.includes('body[data-zd2-locked] [data-zd2-attend]{pointer-events:none}'))
  assert.ok(!tracked.includes(' data-zd2-locked="1"')) // a first visit is an open form
  assert.ok(locked.includes('window.zd2Unlock()') && locked.includes('window.zd2Lock(payload)') && locked.includes('Ubah Jawaban'))
  // an answer the summary must not let inject markup
  assert.ok(!engine.render(rsvpDoc, { events: [{ nama_acara: 'A<b>' }], guestId: 'g1', guestEventQuota: { 'A<b>': { mode: 'unlimited' } }, guestEventRsvp: { 'A<b>': { dewasa: 1, anak: 0 } } }).includes('A<b>'))
}

// --- RSVP follow-up: the organizer's questions, "RSVP Tercatat", a known guest's wish name -------
{
  const vm = require('node:vm')
  const wishName = { id: 'wn', name: 'Wish name input', type: 'group', frame: frame(0, 0, 300, 44), opacity: 1, visible: true, locked: false, children: [T('ph', 'Nama Anda')] }
  const wishDoc = docOf([wishName, T('other', 'Other')]) // a lone group at (0,0) would be unwrapped as a section block
  const questions = [
    { id: 'q1', label: 'Kursi roda?', type: 'yesno' }, { id: 'q2', label: 'Alergi </script><b>?', type: 'text' },
    { id: 'q3', label: 'Ketiga', type: 'text' }, { id: 'q4', label: 'Keempat (di luar batas)', type: 'text' }, { label: 'tanpa id' },
  ]
  const page = engine.render(wishDoc, { events: [{ nama_acara: 'Akad', keterangan: 'Sabtu', venue: 'Aula' }], guestId: 'g1', guestName: 'Dimas "D"', guestEventQuota: {}, customRsvpQuestions: questions, guestRsvpAnswers: { q1: true } })
  // the follow-up script is valid JS, gets the theme/questions/answers/events, and cannot be broken out of
  const script = page.match(/<script>(\(function rsvpFollowUp[\s\S]*?\}\)\((\{"t".*?\})\);)<\/script>/)
  assert.ok(script, 'follow-up script is emitted')
  new vm.Script(script[1]) // parses
  const cfg = JSON.parse(script[2].replace(/\\u003c/g, '<'))
  assert.deepStrictEqual(cfg.questions.map((q) => q.id), ['q1', 'q2', 'q3']) // at most 3, none without an id
  assert.strictEqual(cfg.questions[1].label, 'Alergi </script><b>?')
  assert.ok(!script[2].includes('</script>') && script[2].includes('\\u003c/script>'))
  assert.deepStrictEqual(cfg.answers, { q1: true })
  assert.deepStrictEqual(cfg.events, { Akad: { keterangan: 'Sabtu', venue: 'Aula' } })
  assert.deepStrictEqual(Object.keys(cfg.theme), ['bg', 'ink', 'accent', 'accentInk', 'font'])
  // it is only there for a guest who may RSVP, and the send goes through it
  assert.ok(!engine.render(wishDoc, { guestId: 'g1' }).includes('function rsvpFollowUp'))
  assert.ok(page.includes('window.zd2Questions(send)') && page.includes('body.rsvp_answers=answers') && page.includes('window.zd2Recorded(payload)'))
  // running it with no questions defines the notice but not the modal
  const win = { zd2Plural: core.pluralize }
  const stubEl = () => ({ style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {} }, appendChild() {}, addEventListener() {}, setAttribute() {}, remove() {}, set className(v) {}, set textContent(v) {} })
  const run = (c) => vm.runInNewContext('(' + engine.render.toString().length + ',0);' + script[1].replace(/\)\(\{"t".*$/, ')(' + JSON.stringify(c) + ');'), { window: win, document: { createElement: stubEl, head: stubEl(), body: stubEl(), querySelector: () => null }, requestAnimationFrame: (f) => f(), setTimeout: () => 0, clearTimeout() {} })
  run({ ...cfg, questions: [] })
  assert.ok(typeof win.zd2Recorded === 'function' && win.zd2Questions === undefined)
  run(cfg)
  assert.strictEqual(typeof win.zd2Questions, 'function')
  win.zd2Recorded({ Akad: { dewasa: 2, anak: 1 }, Resepsi: { dewasa: 0, anak: 0 } }) // draws without throwing
  win.zd2Recorded({})

  // a known guest signs the wish as themselves: filled in, read-only, escaped; an anonymous page is untouched
  assert.ok(page.includes('value="Dimas &quot;D&quot;" readonly'))
  const anon = engine.render(wishDoc, { guestId: 'g1', guestEventQuota: {} })
  assert.ok(anon.includes('id="zd2-wish-name"') && !anon.includes(' readonly'))
}

// --- language presets ------------------------------------------------------------------------------
{
  const labels = {
    en: {
      fields: { teks_tombol_konfirmasi: 'Send Confirmation', judul_acara: 'The Wedding Of' },
      textReplacements: { 'Kepada Bapak/Ibu/Saudara/i': 'Dear', 'Nama Anda': 'Your Name' },
      script: { textGuestFallback: 'Guest', textWishLimitReached: 'Max 3 wishes.', textNoGiftMessage: 'Your presence is the gift.' },
    },
    zh: { fields: {}, textReplacements: {}, script: {} },
  }
  // merging: the couple's own fields win, preset scripts only fill what is missing, the input is not mutated
  const src = { language: 'en', fields: { judul_acara: 'Our Day' }, textGuestFallback: 'Tamu' }
  const merged = core.applyLanguage(src, labels.en)
  assert.deepStrictEqual(merged.fields, { teks_tombol_konfirmasi: 'Send Confirmation', judul_acara: 'Our Day' })
  assert.strictEqual(merged.textGuestFallback, 'Tamu')
  assert.strictEqual(merged.textWishLimitReached, 'Max 3 wishes.')
  assert.deepStrictEqual(src.fields, { judul_acara: 'Our Day' })
  assert.strictEqual(core.applyLanguage(src, undefined), src) // no preset: data as is

  // hardcoded texts are replaced by exact (trimmed) match, only when the page gives replacements
  const lit = (text, extra) => core.resolveText(textNode({ text }), ctx({ replacements: { 'Kepada Bapak/Ibu/Saudara/i': 'Dear' }, ...extra }))
  assert.strictEqual(lit('Kepada Bapak/Ibu/Saudara/i'), 'Dear')
  assert.strictEqual(lit('  Kepada Bapak/Ibu/Saudara/i\n'), '  Dear\n') // its own whitespace stays
  assert.strictEqual(lit('Kepada Bapak/Ibu'), 'Kepada Bapak/Ibu') // not a substring match
  assert.strictEqual(core.resolveText(textNode({ text: 'Kepada Bapak/Ibu/Saudara/i' }), ctx()), 'Kepada Bapak/Ibu/Saudara/i') // the designer: untouched
  assert.strictEqual(lit('x', { replacements: { x: '$& $1' } }), '$& $1') // the replacement is literal
  assert.strictEqual(lit('Constructor', { replacements: {} }), 'Constructor')

  // the quota note in the page's language (Indonesian is what the tests above pin)
  const ev = [{ nama_acara: 'A' }]
  const note = (language, quota) => core.guestEvents({ language, events: ev, guestId: 'g', guestEventQuota: { A: quota } }).events[0].quotaNote
  assert.strictEqual(note('en', { mode: 'category', dewasa: 2, anak: 1 }), 'With all due respect, we invite you to attend with your family (guests invited: 2 adults and 1 child).')
  assert.strictEqual(note('en', { mode: 'total', total: 4 }), 'With all due respect, we invite you to attend with your family (guests invited: 4 people).')
  assert.strictEqual(note('zh', { mode: 'category', dewasa: 2, anak: 1 }), '恭请您与家人一同出席（受邀人数：2 位成人，1 位儿童）。')
  assert.ok(note('fr', { mode: 'total', total: 4 }).endsWith('(jumlah undangan: 4 orang).')) // an unknown language reads as Indonesian

  // the guest page: preset fields + replacements drawn, the engine's own words follow the language
  const doc = docOf([
    T('a', 'a', { binding: { key: 'teks_tombol_konfirmasi' }, text: 'Kirim Konfirmasi' }),
    T('b', 'b', { text: 'Kepada Bapak/Ibu/Saudara/i' }),
    T('c', 'c', { binding: { key: 'judul_acara' }, text: 'Kami Menikah' }),
  ])
  const enPage = engine.render(doc, { language: 'en', fields: { judul_acara: 'Our Day' } }, { labels })
  assert.ok(enPage.includes('>Send Confirmation</div>') && enPage.includes('>Dear</div>') && enPage.includes('>Our Day</div>'))
  assert.ok(!enPage.includes('Kirim Konfirmasi') && !enPage.includes('Kepada Bapak'))
  assert.ok(enPage.includes('window.zd2T={') && enPage.includes('"sending":"Sending..."') && enPage.includes('"wishLimit":"Max 3 wishes."') && enPage.includes('"guestFallback":"Guest"'))
  const zhPage = engine.render(doc, { language: 'zh' }, { labels })
  assert.ok(zhPage.includes('"sending":"发送中…"') && zhPage.includes('>Kirim Konfirmasi</div>')) // zh preset has no field for it: the couple's default text stays
  const idPage = engine.render(doc, { language: 'id' }, { labels })
  assert.ok(idPage.includes('"sending":"Mengirim..."') && idPage.includes('>Kepada Bapak/Ibu/Saudara/i</div>'))
  assert.ok(!engine.render(doc, { language: 'fr' }, { labels }).includes('Dear')) // no preset for it
  // no labels at all (a host that does not load them): Indonesian, nothing thrown
  assert.ok(engine.render(doc, { language: 'en' }).includes('"sending":"Sending..."')) // the engine's own words still follow data.language

  // counters and summary speak the language too (a card as the catalog draws it: latar, nama, tombol Ya/Tidak)
  const cardShape = (id, name, x, y, w, h) => ({ ...box(id, { name }), frame: { x, y, w, h, rotate: 0, flipX: false, flipY: false } })
  const attendGroup = { id: 'ab', name: 'Attendance buttons', type: 'group', frame: frame(16, 98, 334, 34), opacity: 1, visible: true, locked: false, children: [cardShape('y', 'Yes button', 0, 0, 163, 34), cardShape('n', 'No button', 171, 0, 163, 34)] }
  const rsvpDoc = docOf([{ id: 'r', name: 'RSVP event cards', type: 'repeat', listKey: 'events', visible: true, opacity: 1, frame: frame(32, 106, 366, 158), children: [cardShape('bg', 'RSVP card bg', 0, 0, 366, 148), attendGroup] }, T('h', 'Head')])
  const rsvpEn = engine.render(rsvpDoc, { language: 'en', events: [{ nama_acara: 'Akad', tanggal: '2027-06-12', jam: '08:00' }], guestId: 'g1', guestEventQuota: { Akad: { mode: 'category', dewasa: 2, anak: 1 } }, guestEventRsvp: { Akad: { dewasa: 2, anak: 1 } } }, { labels })
  assert.ok(rsvpEn.includes('<span>Adults</span>') && rsvpEn.includes('<span>Children</span>') && rsvpEn.includes('aria-label="Decrease adults"'))
  assert.ok(rsvpEn.includes('>Attending · 2 adults · 1 child</div>'))
  assert.ok(rsvpEn.includes('window.zd2Plural=function pluralize(')) // the browser has the same helper for the counts it redraws
  assert.deepStrictEqual(['0 adult(s)', '1 adult(s)', '2 adult(s)', '10 adult(s)', '1 child(ren)', '2 child(ren)', '1 adult(s) and 3 child(ren)', 'Hadir · 1 Dewasa'].map(core.pluralize),
    ['0 adults', '1 adult', '2 adults', '10 adults', '1 child', '2 children', '1 adult and 3 children', 'Hadir · 1 Dewasa'])
  assert.ok(rsvpEn.includes('guests invited: 2 adults and 1 child')) // the quota note, drawn by the card's note text
  // a no-gift message can come from the preset's script texts, after the couple's own field
  const gift = (data) => engine.render((() => { const d = docOf([]); d.artboards = [part('send-gift', 300)]; return d })(), data, { labels })
  assert.ok(gift({ language: 'en', sections: { 'send-gift': false, envelope: false } }).includes('Your presence is the gift.'))
  assert.ok(gift({ language: 'en', sections: { 'send-gift': false, envelope: false }, fields: { teks_pesan_tanpa_kado: 'Just pray' } }).includes('Just pray'))
}

// --- typography (the couple's own font sizes) ----------------------------------------------------
{
  const bound = T('t1', 'Judul', { binding: { key: 'judul_acara' } })
  const base = bound.style.size
  const sizeOf = (node, typography, extra) => core.resolveTextStyle(node, { data: { typography }, ...extra }).size
  assert.strictEqual(sizeOf(bound, { judul_acara: 30 }), 30)
  assert.strictEqual(sizeOf(bound, { judul_acara: '40' }), 40)
  assert.strictEqual(sizeOf(bound, { judul_acara: ' 40px ' }), 40)
  assert.strictEqual(sizeOf(bound, { judul_acara: 22.5 }), 22.5)
  for (const junk of [0, -4, '', null, undefined, '2rem', '50%', 'big', 1000, NaN, {}, []]) assert.strictEqual(sizeOf(bound, { judul_acara: junk }), base, String(junk)) // not a px size: the template's own
  assert.strictEqual(sizeOf(bound, { tanggal_acara_cover: 30 }), base) // another field's size
  assert.strictEqual(sizeOf(bound, { constructor: 30 }), base)
  assert.strictEqual(core.resolveTextStyle(bound, { data: {} }).size, base) // no typography at all
  // it beats a group's font-style override (the .dc.html engine used !important) but leaves weight/italic to it
  const tokenNode = { ...bound, style: { ...bound.style, font: { kind: 'token', token: 'display' } } }
  const withOverride = { fontStyleOverride: { display: { size: 99, weight: 700 } } }
  assert.deepStrictEqual([sizeOf(tokenNode, { judul_acara: 30 }, withOverride), core.resolveTextStyle(tokenNode, { data: { typography: { judul_acara: 30 } }, ...withOverride }).weight], [30, 700])
  // an unbound text is not resized, except the combined couple-names line: the groom's size, else the bride's
  const plain = T('t2', 'Kata', { binding: null })
  const names = T('t3', 'Cover names', { binding: null })
  assert.strictEqual(sizeOf(plain, { nama_panggilan_mempelai_1: 40 }), plain.style.size)
  assert.strictEqual(sizeOf(names, { nama_panggilan_mempelai_1: 40, nama_panggilan_mempelai_2: 50 }), 40)
  assert.strictEqual(sizeOf(names, { nama_panggilan_mempelai_2: 50 }), 50)
  assert.strictEqual(sizeOf(names, { nama_panggilan_mempelai_1: 'x', nama_panggilan_mempelai_2: 50 }), 50) // an unusable groom size falls to the bride's
  assert.strictEqual(sizeOf(names, {}), names.style.size)
  // the couple card's full name (item key `nama`, inside the couple repeat) takes the wizard's "Nama lengkap mempelai" size
  const fullName = T('t4', 'Profile name', { binding: { key: 'nama' } })
  assert.strictEqual(sizeOf(fullName, { nama_lengkap_mempelai: 31 }, { repeatListKey: 'couple' }), 31)
  assert.strictEqual(sizeOf(fullName, { nama_lengkap_mempelai: 31 }, { repeatListKey: 'wishes' }), fullName.style.size) // the same key in another list is not the couple's name
  assert.strictEqual(sizeOf(fullName, { nama_lengkap_mempelai: 31 }), fullName.style.size) // outside a repeat: nothing
  assert.strictEqual(sizeOf(fullName, { nama: 44 }, { repeatListKey: 'couple' }), fullName.style.size) // `nama` itself is not a wizard key
  // the guest page draws it: font-size on the text, and the box grows by the flow as for any long text
  const typoDoc = docOf([T('a', 'a', { binding: { key: 'judul_acara' }, text: 'Judul' }), T('b', 'Cover names', { binding: null, text: 'A & B' }), T('c', 'c', { text: 'Tetap' })])
  const typoPage = engine.render(typoDoc, { typography: { judul_acara: 31, nama_panggilan_mempelai_1: 47 } })
  const sizes = [...typoPage.matchAll(/font-size:([\d.]+)px;[^"]*">(Judul|Bagas &amp; Larasati|Tetap)</g)].map((m) => [m[2], +m[1]])
  assert.deepStrictEqual(sizes, [['Judul', 31], ['Bagas &amp; Larasati', 47], ['Tetap', 20]])
  // the opening gate flows like a section: it carries its authored height and can be refitted when a text grows
  const gatePage = engine.render(docOf([box('r1')], [T('g', 'Guest', { binding: { key: 'guest_name' }, text: 'Nama' })]), { typography: { guest_name: 34 } })
  assert.ok(/id="zd-gate-stage" data-zd-base-height="200px"/.test(gatePage) && gatePage.includes('window.zdGateHeight=function(h){GH=h;fitGate();}'))
  assert.ok(gatePage.includes('document.getElementById("zd-gate-stage")') && gatePage.includes('gflow.shift')) // grows by the shift, not to a decoration hanging past the edge
  assert.ok(/font-size:34px;[^"]*">Nama</.test(gatePage)) // and the size reaches the gate's text too
}

// --- a couple's Instagram/Facebook links -------------------------------------------------------
{
  const ring = { ...box('ring', { name: 'Social icon', stroke: { color: { kind: 'token', token: 'accent' }, width: 1, style: 'solid' } }), frame: frame(172, 360, 34, 34) }
  const igText = T('ig', 'Profile social', { text: 'IG', frame: frame(160, 300, 60, 16) })
  const coupleRepeat = (children) => ({ id: 'c', name: 'Couple', type: 'repeat', listKey: 'couple', visible: true, opacity: 1, frame: frame(0, 100, 400, 400), children })
  const couple = [
    { nama: 'Ada', ig: 'https://instagram.com/ada', fb: 'https://facebook.com/ada' },
    { nama: 'Budi', ig: '', fb: 'javascript:alert(1)' },
    { nama: 'Cici', ig: ' instagram.com/cici ', fb: '' },
    { nama: 'Dodi', ig: '@dodi', fb: 'data:text/html,<b>x</b>' },
    { nama: 'Eka', ig: '', fb: 'facebook.com/eka' },
  ]
  const socialDoc = (children) => docOf([coupleRepeat(children), T('h', 'Head')])
  const page = engine.render(socialDoc([T('n', 'Nama', { binding: { key: 'nama' } }), ring]), { couple })
  const links = [...page.matchAll(/<a [^>]*?href="([^"]+)"[^>]*?aria-label="(Instagram|Facebook)"/g)].map((m) => [m[2], m[1]])
  assert.deepStrictEqual(links, [
    ['Instagram', 'https://instagram.com/ada'], ['Facebook', 'https://facebook.com/ada'], // both: two icons
    ['Instagram', 'https://instagram.com/cici'], // a bare domain gets https://, spaces trimmed
    ['Facebook', 'https://facebook.com/eka'], // only Facebook: only that one
  ])
  assert.ok(!page.includes('javascript:') && !page.includes('data:text/html') && !page.includes('@dodi')) // other schemes / a bare handle: no link, never in the page
  // Budi and Dodi have no usable link: their ring is hidden. Ada's two rings sit side by side around the slot's centre
  assert.strictEqual([...page.slice(0, page.indexOf('id="zd-lightbox"')).matchAll(/display:none;/g)].length, 2)
  const lefts = [...page.matchAll(/<a [^>]*?aria-label="[A-Za-z]+"[^>]*?style="[^"]*?left:([\d.-]+)px/g)].map((m) => +m[1])
  assert.deepStrictEqual(lefts.slice(0, 2), [172 - 22, 172 + 22]) // 34 wide + a 10 gap, centred on the authored x
  assert.strictEqual(lefts[2], 172) // one link: the authored spot
  assert.ok(page.includes('<svg viewBox="0 0 24 24" width="16" height="16"') && page.includes('rx="5"') && page.includes('M13.5 21v-8')) // the network's glyph on a bare ring
  // a document that draws its own "IG" text gets no glyph on top, and its label says FB for the Facebook copy
  const labelled = engine.render(socialDoc([T('n', 'Nama', { binding: { key: 'nama' } }), ring, T('lb', 'Social icon label', { text: 'IG', frame: frame(172, 370, 34, 14) })]), { couple: [couple[0], couple[4]] })
  assert.ok(!labelled.includes('<svg viewBox="0 0 24 24"'))
  assert.deepStrictEqual([...labelled.matchAll(/aria-label="(Instagram|Facebook)"[^>]*><div [^>]*>(IG|FB)</g)].map((m) => [m[1], m[2]]), [['Instagram', 'IG'], ['Facebook', 'FB'], ['Facebook', 'FB']])
  // the text form ("IG" on its own) links too, with the same rules; without a couple item (outside a repeat) nothing changes
  const textOnly = engine.render(socialDoc([igText]), { couple: [couple[0]] })
  assert.strictEqual([...textOnly.matchAll(/<a /g)].length, 2)
  // a wide text is NOT split into frame-sized copies (they would land at the card's edges): one box, the words inline
  assert.strictEqual([...textOnly.matchAll(/data-zd-text-node="ig"/g)].length, 1)
  assert.ok(/<a [^>]*aria-label="Instagram"[^>]*>IG<\/a>\s{3}<a [^>]*aria-label="Facebook"[^>]*>FB<\/a>/.test(textOnly))
  assert.ok(!/<a [^>]*style="[^"]*left:/.test(textOnly)) // no offset copy
  // one link: the word alone is the link, and its box keeps the authored place
  const oneLink = engine.render(socialDoc([igText]), { couple: [{ nama: 'X', ig: 'https://instagram.com/x' }] })
  assert.strictEqual([...oneLink.matchAll(/<a /g)].length, 1)
  assert.ok(oneLink.includes('left:160px'))
  assert.ok(!engine.render(docOf([igText, T('h', 'Head')]), {}).includes('<a '))
  // the names are roles the validator knows, none of them required
  for (const name of ['Social icon', 'Social icon label', 'Profile social', 'Social link']) assert.ok(core.GUEST_ROLES.some((r) => r.name === name && r.role === 'social-link' && r.optional))
}

// --- the map pin, WhatsApp and live-streaming links only let web addresses through ------------------
{
  const shapeAt = (id, name, x, y, w, h) => ({ ...box(id, { name }), frame: { x, y, w, h, rotate: 0, flipX: false, flipY: false } })
  const mapButtons = { id: 'eb', name: 'Event buttons', type: 'group', frame: frame(16, 100, 300, 34), opacity: 1, visible: true, locked: false, children: [shapeAt('m', 'Map button', 0, 0, 140, 34)] }
  const eventsDoc = docOf([{ id: 'r', name: 'Cards', type: 'repeat', listKey: 'events', visible: true, opacity: 1, frame: frame(0, 50, 400, 150), children: [T('n', 'Nama', { binding: { key: 'nama_acara' } }), mapButtons] }, T('h', 'Head')])
  const mapLinks = (map_href) => [...engine.render(eventsDoc, { events: [{ nama_acara: 'A', map_href }] }).matchAll(/<a href="([^"]*)" target="_blank"/g)].map((m) => m[1])
  assert.deepStrictEqual(mapLinks('https://maps.google.com/?q=1,2'), ['https://maps.google.com/?q=1,2'])
  assert.deepStrictEqual(mapLinks(' maps.app.goo.gl/abc '), ['https://maps.app.goo.gl/abc']) // a pasted short link without the scheme now works
  for (const bad of ['', '#', 'javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<b>x</b>', 'vbscript:x', '//evil.example/x', 'just words', undefined]) assert.deepStrictEqual(mapLinks(bad), [], String(bad)) // no button link, and nothing of it in the page
  assert.ok(!engine.render(eventsDoc, { events: [{ nama_acara: 'A', map_href: 'javascript:alert(1)' }] }).includes('javascript:'))
  // the address is escaped into its attribute
  assert.deepStrictEqual(mapLinks('https://x.example/"><script>'), ['https://x.example/&quot;&gt;&lt;script&gt;'])

  const groupOf = (name, text) => ({ id: name, name, type: 'group', frame: frame(10, 60, 300, 40), opacity: 1, visible: true, locked: false, children: [T('l', text)] })
  const waDoc = docOf([groupOf('WhatsApp button', 'Konfirmasi WA'), groupOf('Join button', 'Gabung'), T('h', 'Head')])
  const anchorsOf = (links) => [...engine.render(waDoc, { links }).matchAll(/<a href="([^"]*)" target="_blank"/g)].map((m) => m[1])
  assert.deepStrictEqual(anchorsOf({ link_konfirmasi_wa: 'https://wa.me/6281?text=Halo%20Bagas', link_live_streaming: 'youtube.com/live/x' }), ['https://wa.me/6281?text=Halo%20Bagas', 'https://youtube.com/live/x'])
  assert.deepStrictEqual(anchorsOf({ link_konfirmasi_wa: 'javascript:alert(document.cookie)', link_live_streaming: 'data:text/html,x' }), []) // the buttons stay plain drawings
  const unsafePage = engine.render(waDoc, { links: { link_konfirmasi_wa: 'javascript:alert(1)' } })
  assert.ok(!unsafePage.includes('javascript:') && unsafePage.includes('Konfirmasi WA')) // the button's own drawing is still there
}

// --- markup from a document is never injected as is --------------------------------------------------
{
  const clean = core.sanitizeSvg
  // what the catalog draws comes out exactly as written (the ten elements, url(#id) fills, a transform style)
  const drawing = '<svg width="92" height="320" viewBox="0 0 120 320" opacity="0.9"><defs><pattern id="kw" patternUnits="userSpaceOnUse" width="8" height="8"><circle cx="4" cy="4" r="1" fill="#14655F"/></pattern></defs><g transform="translate(120,0) scale(-1,1)" style="transform:scaleY(-1)"><path d="M120 320V10H96v24Z" fill="url(#kw)" stroke="#14655F" stroke-width="1" stroke-linecap="round"/><rect x="1" y="2" width="3" height="4" rx="1"/><ellipse cx="1" cy="2" rx="3" ry="4"/><line x1="0" y1="0" x2="5" y2="5"/><polygon points="0,0 4,4 0,4"/></g></svg>'
  assert.strictEqual(clean(drawing), drawing)
  assert.strictEqual(clean('<svg xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet" viewBox="0 0 1 1"><path d="M0 0"/></svg>'), '<svg xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet" viewBox="0 0 1 1"><path d="M0 0"/></svg>')
  assert.strictEqual(clean("<svg><g fill='#fff'><path d='M1 2'/></g></svg>"), '<svg><g fill="#fff"><path d="M1 2"/></g></svg>') // quotes normalised
  assert.strictEqual(clean('<svg><text x="1">A &amp; B <tspan>c</tspan></text></svg>'), '<svg><text x="1">A &amp; B <tspan>c</tspan></text></svg>') // text and entities kept where text belongs
  assert.strictEqual(clean(''), '')
  assert.strictEqual(clean(null), '')
  assert.strictEqual(clean(undefined), '')

  // the attacks: each comes out without the dangerous part and with the drawing around it intact
  const cases = [
    ['<svg onload="alert(1)"><path d="M0 0"/></svg>', '<svg><path d="M0 0"/></svg>'],
    ['<svg><script>alert(1)</script><path d="M0 0"/></svg>', '<svg><path d="M0 0"/></svg>'],
    ['<svg><ScRiPt>alert(1)</sCrIpT><path d="M0 0"/></svg>', '<svg><path d="M0 0"/></svg>'],
    ['<svg><script>if(a<b){x="</svg>"}</script><path d="M0 0"/></svg>', '<svg><path d="M0 0"/></svg>'], // a < inside the script is not a tag
    ['<svg><path d="M0 0" onclick=alert(1) onmouseover=\'x\' ONERROR="y"/></svg>', '<svg><path d="M0 0"/></svg>'],
    ['<svg><a href="javascript:alert(1)"><path d="M0 0"/></a></svg>', '<svg></svg>'],
    ['<svg><use href="javascript:alert(1)"/><use xlink:href="http://evil.example/x.svg#a"/><use href="#ok"/></svg>', '<svg><use/><use/><use href="#ok"/></svg>'],
    ['<svg><use href="jav&#x61;script:alert(1)"/></svg>', '<svg><use/></svg>'], // an entity cannot smuggle the scheme
    ['<svg><foreignObject><body onload=alert(1)></body></foreignObject><path d="M0 0"/></svg>', '<svg><path d="M0 0"/></svg>'],
    ['<svg><iframe src="javascript:alert(1)"></iframe><object data="x"></object><embed src="x"><path d="M0 0"/></svg>', '<svg></svg>'], // <embed> never closes, so the rest of the line is its "content"
    ['<svg><image href="http://evil.example/p.png"/><path d="M0 0"/></svg>', '<svg><path d="M0 0"/></svg>'],
    ['<svg><animate attributeName="href" to="javascript:alert(1)"/><set attributeName="onload" to="alert(1)"/><path d="M0 0"/></svg>', '<svg><path d="M0 0"/></svg>'],
    ['<svg><style>@import url(http://evil.example/a.css);</style><path d="M0 0"/></svg>', '<svg><path d="M0 0"/></svg>'],
    ['<svg><path d="M0 0" fill="url(http://evil.example/a.svg#x)"/><path d="M1 1" fill="url( \'https://evil.example\')"/></svg>', '<svg><path d="M0 0"/><path d="M1 1"/></svg>'],
    ['<svg><path style="fill:red;background:url(javascript:alert(1))" d="M0 0"/></svg>', '<svg><path d="M0 0"/></svg>'],
    ['<svg><path style="width:expression(alert(1))" d="M0 0"/><path style="fill:&#x72;ed" d="M1 1"/><path style="fill:\\72 ed" d="M2 2"/></svg>', '<svg><path d="M0 0"/><path d="M1 1"/><path d="M2 2"/></svg>'],
    ['<svg><path d="M0 0"/><!--><script>alert(1)</script>--><path d="M1 1"/></svg>', '<svg><path d="M0 0"/><path d="M1 1"/></svg>'],
    ['<svg><![CDATA[<script>alert(1)</script>]]><path d="M0 0"/></svg>', '<svg><path d="M0 0"/></svg>'],
    ['<svg><text><![CDATA[<b onclick=x>hi</b>]]></text></svg>', '<svg><text>&lt;b onclick=x&gt;hi&lt;/b&gt;</text></svg>'], // CDATA text is data, escaped
    ['<svg><path d="a>b" onload=x d2="c"/></svg>', '<svg><path d="a&gt;b" d2="c"/></svg>'], // a > inside a value does not end the tag
    ['</svg><script>alert(1)</script><svg><path d="M0 0"/></svg>', '<svg><path d="M0 0"/></svg>'], // closing a tag we never opened
    ['<svg><path d="M0 0"', '<svg></svg>'], // an unterminated tag: nothing after it is trusted, what was open is closed
    ['<svg><path d="M0 0" fill="red', '<svg></svg>'],
    ['<svg><g><path d="M0 0"></svg>', '<svg><g><path d="M0 0"></path></g></svg>'], // unclosed tags are closed
    ['<svg><path d="M0 0" xmlns="http://evil.example/ns" xmlns:xlink="http://www.w3.org/1999/xlink"/></svg>', '<svg><path d="M0 0" xmlns:xlink="http://www.w3.org/1999/xlink"/></svg>'],
    ['plain text <b>bold</b><svg><path d="M0 0"/></svg>', '<svg><path d="M0 0"/></svg>'], // text and non-drawing tags outside are dropped
    ['<svg><path d=\'"><script>alert(1)</script>\'/></svg>', '<svg><path d="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"/></svg>'],
  ]
  cases.forEach(([input, expected], i) => assert.strictEqual(clean(input), expected, 'case ' + i + ': ' + input))

  // property: whatever it is fed, the output only holds allowed tags, quoted attributes, no handler / script scheme
  const allowed = ['svg', 'g', 'defs', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'text', 'tspan', 'title', 'desc', 'lineargradient', 'radialgradient', 'stop', 'clippath', 'mask', 'pattern', 'symbol', 'marker', 'use', 'filter', 'fegaussianblur', 'feoffset', 'feblend', 'fecolormatrix', 'fecomposite', 'feflood', 'femerge', 'femergenode', 'femorphology', 'fedropshadow']
  const pieces = ['<svg>', '</svg>', '<g>', '</g>', '<path d="M0 0"/>', '<script>', '</script>', '<style>', '</style>', '<a href="javascript:x">', '</a>', '<img src=x onerror=alert(1)>', 'onload=alert(1)', ' onclick="x" ', '<', '>', '"', "'", '=', '/', '<!--', '-->', '<![CDATA[', ']]>', '<use href="#a"/>', '<use href="data:image/svg+xml,x"/>', '<foreignObject>', '</foreignObject>', '&#x6a;avascript:', 'javascript:', '<text>', '</text>', 'hello', '\n', ' ', '<svg onload=', '<path d=', 'fill="url(http://x)"', '<ANIMATE ', '<iframe>', '<math>', '<p>', '\\', String.fromCharCode(0)]
  let seed = 12345
  const rand = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n }
  for (let round = 0; round < 3000; round++) {
    let input = ''
    for (let k = rand(14) + 1; k > 0; k--) input += pieces[rand(pieces.length)]
    const out = clean(input)
    const tags = [...out.matchAll(/<\/?([A-Za-z0-9]+)/g)].map((m) => m[1].toLowerCase())
    assert.ok(tags.every((t) => allowed.includes(t)), 'tag in: ' + JSON.stringify(input) + ' -> ' + JSON.stringify(out))
    assert.ok(!/<(?![A-Za-z\/])/.test(out), 'stray < in: ' + JSON.stringify(out))
    assert.ok(!/\son[a-z]+\s*=/i.test(out) && !/javascript\s*:/i.test(out) && !/<\s*(script|style|a|iframe|image|foreignobject)/i.test(out), 'unsafe in: ' + JSON.stringify(input) + ' -> ' + JSON.stringify(out))
    // every attribute value is quoted and holds no quote or angle bracket
    for (const tag of out.matchAll(/<[A-Za-z][^>]*>/g)) assert.ok(/^<[A-Za-z0-9]+(\s+[A-Za-z_:][\w:.\-]*="[^"<>]*")*\s*\/?>$/.test(tag[0]), 'tag shape: ' + tag[0] + ' from ' + JSON.stringify(input))
    // balanced: every opened element is closed
    const depth = [...out.matchAll(/<(\/?)([A-Za-z0-9]+)[^>]*?(\/?)>/g)].reduce((d, m) => (m[3] ? d : d + (m[1] ? -1 : 1)), 0)
    assert.strictEqual(depth, 0, 'unbalanced: ' + out)
  }

  // the guest page: an svg node cannot run anything, and a style value cannot break out of its attribute
  const svgNode = (markup) => ({ id: 's', name: 's', type: 'svg', frame: { x: 0, y: 0, w: 50, h: 50, rotate: 0, flipX: false, flipY: false }, opacity: 1, visible: true, locked: false, markup })
  const evilPage = engine.render(docOf([svgNode('<svg onload="window.p=1"><script>window.p=2</script><path d="M0 0" fill="#123"/></svg>'), T('t', 'T')]), {})
  assert.ok(evilPage.includes('<svg><path d="M0 0" fill="#123"/></svg>') && !evilPage.includes('window.p=') && !evilPage.includes('onload='))
  const quote = '#fff" onmouseover="window.p=3" x="'
  // an injected ATTRIBUTE, not the words: cut every quoted value out of every tag, then look for the name
  const hasInjectedAttr = (html) => [...html.matchAll(/<[A-Za-z][^>]*>/g)].some((tag) => /\sonmouseover\s*=/i.test(tag[0].replace(/"[^"]*"/g, '""')))
  assert.ok(hasInjectedAttr('<div style="a" onmouseover="x">') && !hasInjectedAttr('<div style="a&quot; onmouseover=&quot;x">')) // the check itself
  const withColor = (over) => { const d = docOf([T('a', 'A', { style: { ...T('x').style, color: { kind: 'custom', value: quote } } }), T('b', 'B')]); Object.assign(d.theme.palette, over || {}); return d }
  let styledPage = engine.render(withColor(), {})
  assert.ok(!hasInjectedAttr(styledPage) && styledPage.includes('color:#fff&quot; onmouseover=&quot;window.p=3&quot; x=&quot;;')) // one attribute, the quote is data
  styledPage = engine.render(withColor({ ink: quote, accent: quote, bg: quote, surface: quote }), {})
  assert.ok(!hasInjectedAttr(styledPage))
  // ...also in the markup the engine writes itself: a section/gate background, the counters and the music button
  const bgDoc = docOf([T('a', 'A'), T('b', 'B')], [T('g', 'G')])
  bgDoc.artboards[0].background = { kind: 'solid', color: { kind: 'custom', value: quote } }
  bgDoc.artboards[1].background = { kind: 'solid', color: { kind: 'custom', value: quote } }
  bgDoc.theme.palette.accent = quote
  assert.ok(!hasInjectedAttr(engine.render(bgDoc, { audio: { background_music: 'https://x.example/a.mp3' } })))
  // a font stack that legitimately holds double quotes keeps working
  const fontDoc = docOf([T('a', 'A'), T('b', 'B')]); fontDoc.theme.fonts.display = fontDoc.theme.fonts.body = '"Cormorant Garamond", Georgia, serif'
  assert.ok(engine.render(fontDoc, {}).includes('font-family:&quot;Cormorant Garamond&quot;, Georgia, serif'))

  // a guest's stored RSVP answer is a head count, never markup
  const hostile = core.guestEvents({ events: [{ nama_acara: 'A' }], guestId: 'g', guestEventQuota: { A: { mode: 'unlimited' } }, guestEventRsvp: { A: { dewasa: '2"><script>x</script>', anak: -3 } } }).events[0]
  assert.deepStrictEqual([hostile.rsvpPrefillDewasa, hostile.rsvpPrefillAnak], [2, 0])
  assert.strictEqual(core.guestEvents({ events: [{ nama_acara: 'A' }], guestId: 'g', guestEventQuota: { A: { mode: 'unlimited' } }, guestEventRsvp: { A: { dewasa: '7', anak: 1.9 } } }).events[0].rsvpPrefillDewasa, 7)
}

// --- wishes paging ------------------------------------------------------------------------------------------------
{
  const rect = (x, y, w, h) => ({ x, y, w, h, rotate: 0, flipX: false, flipY: false })
  const wishRepeat = (over) => ({
    id: 'wr', name: 'Wishes list', type: 'repeat', listKey: 'wishes', visible: true, opacity: 1, frame: rect(32, 100, 366, 116),
    children: [
      { ...box('wbg', { name: 'Wish card bg' }), frame: rect(0, 0, 366, 105) },
      T('wn', 'Wish name', { binding: { key: 'name' }, frame: rect(0, 10, 200, 14) }),
      T('wt', 'Wish time', { binding: { key: 'time' }, frame: rect(204, 10, 162, 14) }),
      T('wm', 'Wish message', { binding: { key: 'message' }, frame: rect(0, 32, 366, 54) }),
    ],
    ...over,
  })
  const foot = T('foot', 'Footer text', { frame: rect(32, 230, 100, 20) })
  const wishes = (n) => Array.from({ length: n }, (_, i) => ({ name: 'Tamu ' + (i + 1), time: i + 1 + ' hari lalu', message: 'Ucapan ke-' + (i + 1) }))

  // core: a list that fits one page still gets the pager, hidden and with no room, so a new wish can turn it on;
  // over one page the section grows by the pager's room
  const plain = [T('h', 'Head'), wishRepeat(), foot]
  for (const total of [0, 1, core.WISHES_PER_PAGE]) {
    const fits = core.withWishPager(plain, total)
    assert.ok(fits.added && fits.extra === 0 && fits.nodes.find((n) => n.id === 'foot').frame.y === 230) // nothing below moves
    assert.deepStrictEqual(fits.nodes.find((n) => n.id === 'zd-wish-pager').wish, { stride: 116, baseline: 1 }) // what the page script needs
  }
  assert.strictEqual(core.WISH_PAGER_ROOM, 44)
  assert.strictEqual(core.WISHES_PER_PAGE, 5)
  assert.deepStrictEqual(core.withWishPager([T('h', 'Head'), foot], 20), { nodes: [T('h', 'Head'), foot], extra: 0, added: false }) // no wishes list in this section
  const paged = core.withWishPager(plain, 12)
  assert.ok(paged.added && paged.extra === 44)
  const pager = paged.nodes.find((n) => core.guestRole(n) && core.guestRole(n).role === 'wish-pager')
  assert.deepStrictEqual([pager.frame.x, pager.frame.y, pager.frame.w, pager.frame.h], [32, 216, 366, 32]) // right after the list's baseline box, same column
  assert.strictEqual(paged.nodes.find((n) => n.id === 'foot').frame.y, 230 + 44) // what sat below moves down by the pager's room
  assert.strictEqual(plain[2].frame.y, 230) // the caller's nodes are not touched
  assert.strictEqual(core.withWishPager(paged.nodes, 12).added, false) // idempotent
  // the list inside a group (the section body wrapped by the designer): the pager joins that group, the group grows, what is below it moves
  const grouped = [T('h', 'Head'), { id: 'g', name: '', type: 'group', visible: true, opacity: 1, frame: rect(28, 16, 374, 200), children: [wishRepeat({ frame: rect(0, 50, 366, 116) }), T('in', 'Inner foot', { frame: rect(0, 180, 100, 20) })] }, foot]
  const nested = core.withWishPager(grouped, 12)
  assert.ok(nested.added && nested.extra === 44)
  const ng = nested.nodes.find((n) => n.id === 'g')
  assert.strictEqual(ng.frame.h, 244)
  assert.strictEqual(ng.children.find((n) => n.id === 'zd-wish-pager').frame.y, 166)
  assert.strictEqual(ng.children.find((n) => n.id === 'in').frame.y, 224)
  assert.strictEqual(nested.nodes.find((n) => n.id === 'foot').frame.y, 230 + 44)
  assert.strictEqual(core.withWishPager([wishRepeat({ verifiedCount: 3 })], 12).nodes.find((n) => n.id === 'zd-wish-pager').frame.y, 100 + 116 * 3) // after all the baseline items

  // the guest page: only the first page is drawn, all of it travels as JSON, the pager row is there
  const wishDoc = docOf([]); wishDoc.artboards = [{ ...part('wishes', 300), nodes: [T('h', 'Head'), wishRepeat(), foot] }]
  const baseH = (h) => +h.match(/data-zd-base-height="(\d+)px"/)[1]
  const one = engine.render(wishDoc, { wishes: wishes(5) })
  const many = engine.render(wishDoc, { wishes: wishes(12) })
  // one page: the pager and the slot marks are there for a new wish, but the pager is hidden and takes no height
  assert.ok(one.includes('window.zd2Wishes=') && one.includes('data-zd2-wish-pager') && one.includes('data-zd2-wish-paged="0"') && one.includes('data-zd-hidden="1"') && one.includes('data-zd2-wish-shown="5"'))
  assert.ok(many.includes('data-zd2-wish-paged="1"') && many.includes('data-zd2-wish-stride="116"') && many.includes('data-zd2-wish-baseline="1"'))
  assert.strictEqual([...one.matchAll(/data-zd2-wish-i="\d" data-zd2-wish-key=/g)].length, 15)
  // no wishes yet: one placeholder card (the copy a first wish is made from), the section as tall as with one wish
  const none = engine.render(wishDoc, { wishes: [] })
  assert.ok(none.includes('window.zd2Wishes=[]') && none.includes('data-zd2-wish-shown="0"') && [...none.matchAll(/data-zd2-wish-i="0" data-zd2-wish-key=/g)].length === 3)
  assert.strictEqual(baseH(none), baseH(engine.render(wishDoc, { wishes: wishes(1) })))
  assert.ok(!engine.render(wishDoc, {}).includes('zd2Wishes')) // no wishes list in the data at all: nothing added
  const body = many.replace(/<script[\s\S]*?<\/script>/g, '')
  assert.ok(body.includes('>Ucapan ke-1<') && body.includes('>Ucapan ke-5<') && !body.includes('Ucapan ke-6')) // page 1 only
  assert.strictEqual([...many.matchAll(/data-zd2-wish-i="(\d)" data-zd2-wish-key="(name|time|message)"/g)].length, 15) // 5 slots x 3 texts
  assert.ok(many.includes('data-zd2-wish-i="4"') && !many.includes('data-zd2-wish-i="5"'))
  assert.strictEqual(baseH(many), baseH(one) + 44) // the pager row is the only height added on top of a full page
  const json = many.match(/window\.zd2Wishes=(\[.*?\]);<\/script>/)[1]
  assert.deepStrictEqual(JSON.parse(json), wishes(12)) // every wish, in order, all three fields
  assert.ok(many.includes('data-zd2-wish-pager') && many.includes('data-zd2-wish-prev disabled') && many.includes('>Halaman 1 dari 3<') && many.includes('‹ Sebelumnya') && many.includes('Selanjutnya ›'))
  assert.ok(many.includes('[data-zd2-wish-pager] button:disabled{'))
  assert.ok(one.includes('[data-zd2-wish-pager] button:disabled{'))
  assert.ok(many.includes('window.zdReflow=run;') && many.includes('data-zd-hidden')) // the flow can be re-run and skips hidden slots
  // the pager follows the language
  assert.ok(engine.render(wishDoc, { language: 'en', wishes: wishes(12) }).includes('>Page 1 of 3<'))
  assert.ok(engine.render(wishDoc, { language: 'zh', wishes: wishes(12) }).includes('>第 1 / 3 页<'))
  assert.ok(engine.render(wishDoc, { wishes: wishes(11) }).includes('>Halaman 1 dari 3<') && engine.render(wishDoc, { wishes: wishes(10) }).includes('>Halaman 1 dari 2<'))
  // hostile wish text cannot break the page or the JSON block
  const hostile = [...wishes(6)]; hostile[5] = { name: '</script><img src=x onerror=alert(1)>', time: 't', message: '"><script>alert(2)</script>' }
  const hostilePage = engine.render(wishDoc, { wishes: hostile })
  assert.ok(!/<img src=x onerror/.test(hostilePage) && !hostilePage.includes('<script>alert(2)'))
  assert.deepStrictEqual(JSON.parse(hostilePage.match(/window\.zd2Wishes=(\[.*?\]);<\/script>/)[1])[5], hostile[5]) // still exact data
  // odd rows (a null wish, numbers) become strings, never throw
  assert.doesNotThrow(() => engine.render(wishDoc, { wishes: [null, { name: 5, message: undefined }, {}, {}, {}, {}, {}] }))
  // a wishes section the couple switched off draws nothing, so nothing is added
  const off = engine.render(wishDoc, { wishes: wishes(12), sections: { wishes: false } })
  assert.ok(!off.includes('zd2Wishes') && !off.includes('data-zd2-wish-pager'))
  // a wish sent from the page appears without a reload: the handler adds it, and takes it back if the server refuses
  assert.ok(many.includes('window.zd2AddWish=function(w)') && many.includes('var undo=window.zd2AddWish?window.zd2AddWish({name:name,time:T.justNow,message:message}):null;'))
  assert.ok(!many.includes('location.reload'))
  assert.ok(many.includes('"justNow":"Baru saja"') && engine.render(wishDoc, { language: 'en', wishes: [] }).includes('"justNow":"Just now"'))
  // the count of wishes is the only thing that turns paging on: the same doc with other lists is untouched
  assert.ok(!engine.render(docOf([T('a', 'A'), T('b', 'B')]), { wishes: wishes(12) }).includes('zd2Wishes'))
}

console.log('zedoc-core: ok')
