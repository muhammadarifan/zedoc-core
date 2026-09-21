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
  assert.ok(!without.includes('data-zd2-counts-event'))
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
}

console.log('zedoc-core: ok')
