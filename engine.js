/*
 * ZeDocEngine — renders a ZeDocument (the same JSON format ze-designer edits,
 * see ze-designer/src/doc/schema.ts) straight to a guest-facing HTML page, no
 * compile-to-.dc.html step in between. This is what makes an invitation
 * edited in ze-designer show up identically here: both sides read the exact
 * same document, and this file's node math is a direct port of
 * ze-designer/src/render/{resolve.ts,animation.ts,NodeContent.tsx,nodes/*}.
 *
 * v1 scope, deliberately narrow (see the ZeDocument-native template plan):
 *   - Node types: text, image, shape, svg, icon, group, repeat - all drawn by
 *     ZeDocCore's shared node views (icons from its lucide catalogue, so a
 *     placed icon shows up for a guest exactly as on the canvas). `block`
 *     nodes (ze-designer's higher-level, drag-from-the-Blocks-panel
 *     components) are all supported, one hand-ported function per entry in
 *     BLOCK_RENDERERS below (see render/blocks/*.tsx there for the React
 *     source of truth). Media fidelity is approximate (small hand-drawn
 *     stand-ins for the media blocks' icons), everything else matches the
 *     React version's layout and field bindings.
 *   - Mostly static visual fidelity. The countdown ticks live (see
 *     countdownScript below) and the Rangkaian Acara "Buka Peta"/"+
 *     Kalender" buttons are real links (see eventButtonLinkOverlaysHtml),
 *     but RSVP submission and WA integrations still don't exist here —
 *     those live in assets/engine.js for .dc.html templates today and are
 *     follow-up work for this pipeline, not built here.
 *   - The opening-overlay tap-to-open gate IS supported: an `envelope`-role
 *     artboard with nodes renders as a fixed full-viewport overlay on top of
 *     the invitation stage; tapping it anywhere fades it out. No
 *     `#rsvp`-deep-link/`skipOpeningOverlay` bypass like assets/engine.js
 *     has — ponytail: add one if a broadcast flow needs it.
 *   - Repeat nodes (events/gallery/quotes/loveStory/envelope/couple) DO loop
 *     over every real item (unlike ze-designer's own canvas preview, which
 *     only ever shows item 0 — see NodeContent.tsx's comment on why that's
 *     fine for editing but wouldn't be for a guest). Extra items push
 *     whatever comes after them down the page; see reflow() below.
 */
(function (root, factory) {
  // Browser: load index.js (ZeDocCore) before this file; exposes window.ZeDocEngine.
  // CommonJS/bundlers: requires ./index.js itself.
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./index.js'));
  else root.ZeDocEngine = factory(root.ZeDocCore);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (ZeDocCore) {
  'use strict';

  if (!ZeDocCore) throw new Error('ZeDocCore must be loaded before ZeDocEngine');
  var repeatGridPlacements = ZeDocCore.repeatGridPlacements;
  var reflowNodes = ZeDocCore.reflowNodes;

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function px(n) { return n + 'px'; }

  function styleStr(obj) {
    var out = '';
    for (var key in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
      var value = obj[key];
      if (value === undefined || value === null || value === '') continue;
      var cssKey = key.replace(/[A-Z]/g, function (m) { return '-' + m.toLowerCase(); });
      out += cssKey + ':' + value + ';';
    }
    return out;
  }

  // A venue pin the couple never set stays the "#" placeholder wizard.js
  // writes by convention (see src/worker.js's own hasRealMapHref) - ported
  // here so the Map button link only appears once there's somewhere real to
  // send a guest.
  function hasRealMapHref(event) {
    return !!(event && event.map_href && event.map_href !== '#');
  }

  function icsEscape(s) {
    return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  }

  function toIcsUtc(date) {
    return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  }

  // Builds a downloadable .ics (iCalendar) data URI from an event's
  // structured tanggal/jam/zona - ported verbatim from assets/engine.js
  // (the .dc.html renderer already has this working; kalender_href itself is
  // always the unset placeholder "#" by wizard.js convention, so this is
  // generated fresh here rather than read off the event). Returns null when
  // the event has no structured date.
  function buildIcsDataUri(ev) {
    if (!ev || !ev.tanggal || !ev.jam) return null;
    var zona = ev.zona || '+07:00';
    var start = new Date(ev.tanggal + 'T' + ev.jam + ':00' + zona);
    if (isNaN(start.getTime())) return null;
    var end = null;
    if (ev.waktu_selesai_mode === 'pilih' && ev.jam_selesai) {
      end = new Date(ev.tanggal + 'T' + ev.jam_selesai + ':00' + zona);
      if (isNaN(end.getTime()) || end.getTime() <= start.getTime()) end = null;
    }
    if (!end) end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
    var lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Undangan Digital//ID',
      'BEGIN:VEVENT',
      'UID:' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2) + '@undangan-digital',
      'DTSTAMP:' + toIcsUtc(new Date()),
      'DTSTART:' + toIcsUtc(start),
      'DTEND:' + toIcsUtc(end),
      'SUMMARY:' + icsEscape(ev.nama_acara || 'Wedding Event'),
      ev.venue ? 'LOCATION:' + icsEscape(ev.venue) : null,
      'END:VEVENT',
      'END:VCALENDAR'
    ].filter(Boolean).join('\r\n');
    return 'data:text/calendar;charset=utf8,' + encodeURIComponent(lines);
  }

  // Same structured tanggal/jam/zona -> start/end math as buildIcsDataUri,
  // pointed at Google Calendar's "render" quick-add URL instead of a data
  // URI - the second option in the "+ Kalender" dropdown (calendarDropdownHtml).
  function buildGoogleCalendarUrl(ev) {
    if (!ev || !ev.tanggal || !ev.jam) return null;
    var zona = ev.zona || '+07:00';
    var start = new Date(ev.tanggal + 'T' + ev.jam + ':00' + zona);
    if (isNaN(start.getTime())) return null;
    var end = null;
    if (ev.waktu_selesai_mode === 'pilih' && ev.jam_selesai) {
      end = new Date(ev.tanggal + 'T' + ev.jam_selesai + ':00' + zona);
      if (isNaN(end.getTime()) || end.getTime() <= start.getTime()) end = null;
    }
    if (!end) end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
    var params = [
      'action=TEMPLATE',
      'text=' + encodeURIComponent(ev.nama_acara || 'Wedding Event'),
      'dates=' + toIcsUtc(start) + '/' + toIcsUtc(end),
      ev.venue ? 'location=' + encodeURIComponent(ev.venue) : ''
    ].filter(Boolean).join('&');
    return 'https://calendar.google.com/calendar/render?' + params;
  }

  // --- resolve layer: shared with the designer canvas, lives in ZeDocCore ---
  var resolveColor = ZeDocCore.resolveColor;
  var resolveFont = ZeDocCore.resolveFont;
  var resolveTextStyle = ZeDocCore.resolveTextStyle;
  var resolveFill = ZeDocCore.resolveFill;
  var resolveText = ZeDocCore.resolveText;
  var resolveImageSrc = ZeDocCore.resolveImageSrc;
  var findAsset = ZeDocCore.findAsset;
  var frameStyle = ZeDocCore.frameStyle;
  var clipStyleFor = ZeDocCore.clipStyleFor;
  var mergeTheme = ZeDocCore.mergeTheme;
  var mergeFontStyleOverride = ZeDocCore.mergeFontStyleOverride;

  // Shared by countdownBlockHtml (the drag-in "Components" widget) and
  // decorateText's 'Countdown number N' override below (the catalog
  // artboards' own hand-authored countdown, see build-*.mjs - those bake
  // '12'/'08'/'45'/'30' in as literal, unbound text, so it needs this same
  // computation applied by node name rather than by binding).
  function countdownRemaining(datetimeStr) {
    var target = new Date(datetimeStr).getTime();
    var remaining = Math.max(0, target - Date.now());
    return {
      d: Math.floor(remaining / 86400000),
      h: Math.floor(remaining / 3600000) % 24,
      m: Math.floor(remaining / 60000) % 60,
      s: Math.floor(remaining / 1000) % 60
    };
  }

  // Two naming conventions across the 25 catalog templates: the 24
  // scripts/zedoc-builder/build-*.mjs-generated ones all use "Countdown
  // number 1..4" (see build-whimsical-love.mjs), but evergreen-zedoc.json
  // (hand-authored, no builder script) names them "Countdown days/hours/
  // minutes/seconds number" instead - both need to resolve to the same
  // d/h/m/s unit key.

  // Which hand-drawn nodes are made live (RSVP, wishes, copy, links, countdown
  // digits...) is decided by ZeDocCore.guestRole - the one table of node names
  // the template validator checks too.

  // Turns a pasted YouTube URL (watch/share/shorts/already-an-embed link)
  // into a proper embed src. Unlike the WA/live-streaming buttons above,
  // which are plain organizer-set links even in the old .dc.html pipeline
  // (assets/engine.js has no such conversion either - its video section is
  // the same permanently-visible placeholder pill over a 1x1 hidden iframe),
  // an actual video EMBED needs the real numeric/alphanumeric video id, not
  // just any URL passed straight through.
  var YOUTUBE_ID_RE = /(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/))([A-Za-z0-9_-]{6,})/;
  function youTubeEmbedUrl(url) {
    var m = url ? YOUTUBE_ID_RE.exec(url) : null;
    return m ? 'https://www.youtube.com/embed/' + m[1] : null;
  }

  // Whether an event reads as "attending" by default: an explicit prior
  // response (guestEventRsvp, threaded in from viewer.html the same way as
  // the Block-based rsvpBlockHtml above) wins, otherwise default to Ya -
  // same rule assets/engine.js's own attendingFor() uses.
  function attendingDefaultFor(ctx, eventName) {
    var prev = (ctx.data.guestEventRsvp || {})[eventName];
    if (!prev) return true;
    return (prev.dewasa || 0) + (prev.anak || 0) > 0;
  }

  // --- guest-only behaviour, layered on ZeDocCore's node views ---------------
  //
  // ZeDocCore.nodeView draws every node the same way the designer canvas does;
  // decorateNode (passed as ctx.decorate) is where this page adds what only a
  // guest gets: live countdown digits, the real guest's name, the attendance
  // toggle, real links/inputs on the hand-drawn RSVP/wish/gift elements.

  // The text view is the wrapper's first child.
  function decorateText(node, view, ctx) {
    var textView = view.children[0];
    var style = textView.style;
    var text = textView.children[0];
    var attrs = {};

    var textRole = ZeDocCore.guestRole(node);
    var cdKey = textRole && textRole.role === 'countdown' ? textRole.arg : null;
    if (cdKey && ctx.data.countdownDatetime) {
      var key = cdKey;
      text = String(countdownRemaining(ctx.data.countdownDatetime)[key]).padStart(2, '0');
      attrs['data-zd-cd-unit'] = key;
      attrs['data-zd-cd-target'] = String(ctx.data.countdownDatetime);
    }
    // The static "Nama Tamu" placeholder becomes the real guest's name once
    // known - same idea as the combined-couple-name fix above.
    if (!node.binding && textRole && textRole.role === 'guest-name' && ctx.data.guestName) {
      text = ctx.data.guestName;
    }
    // "Yes label"/"No label" (inside the RSVP event-cards repeat) pair with
    // their own "Yes button"/"No button" shape siblings (renderNode's
    // 'shape' case below) to form one clickable attendance toggle -
    // handDrawnRsvpWishScript (render(), near the end of this file) restyles
    // both on click, keyed by data-zd2-event so it can find the sibling to
    // turn back off. attendingDefaultFor mirrors assets/engine.js's own
    // attendingFor() default.
    var attendRole = textRole && textRole.role === 'attend-label' ? textRole.arg : null;
    if (attendRole && ctx.repeatItem) {
      var evName = ctx.repeatItem.nama_acara || '';
      var selected = attendingDefaultFor(ctx, evName) === (attendRole === 'yes');
      var colorOff = style.color;
      var colorOn = ctx.theme.palette.accentInk;
      if (selected) style.color = colorOn;
      style.cursor = 'pointer';
      attrs['data-zd2-attend'] = attendRole;
      attrs['data-zd2-event'] = evName;
      attrs['data-zd2-color-on'] = colorOn;
      attrs['data-zd2-color-off'] = colorOff;
      attrs['data-zd2-selected'] = selected ? '1' : '0';
    }
    textView.attrs = attrs;
    textView.children = [text];
  }

  // --- block nodes (ze-designer's src/render/blocks/*.tsx port) ------------
  //
  // A `block` node is ze-designer's higher-level, drag-from-the-Blocks-panel
  // component - opaque here until someone ports its renderer, unlike text/
  // image/shape/repeat which this file already understands structurally.
  // BLOCK_RENDERERS is the registry of ports finished so far, keyed by
  // BlockId (see blockRegistry.ts there); an unlisted block.id still renders
  // as nothing, same as before any of this existed.

  /** Reads a per-block layout knob out of `node.options`, same helper as
   *  ze-designer's own `option()` (render/blocks/shared.tsx). */
  function blockOption(node, key, fallback) {
    var value = node.options ? node.options[key] : undefined;
    return value === undefined ? fallback : value;
  }

  /** Same helper as ze-designer's own `field()` (render/blocks/shared.tsx). */
  function fieldVal(ctx, key, fallback) {
    return (ctx.data.fields && ctx.data.fields[key]) || fallback || '';
  }

  /** A link-bucket counterpart to fieldVal - link_konfirmasi_wa and friends
   *  live in ctx.data.links, not ctx.data.fields (see bucketFor above). */
  function linkVal(ctx, key) {
    return (ctx.data.links && ctx.data.links[key]) || '';
  }

  /** Port of shared.tsx's blockShell(). */
  function blockShellStyle(theme) {
    return {
      width: '100%', height: '100%', overflow: 'hidden',
      color: theme.palette.ink, fontFamily: theme.fonts.body,
      display: 'flex', flexDirection: 'column', gap: px(10)
    };
  }

  /** Port of shared.tsx's Heading. */
  function headingHtml(ctx, text) {
    return '<div style="' + styleStr({
      fontFamily: ctx.theme.fonts.display, fontSize: px(20), lineHeight: 1.2,
      textAlign: 'center', color: ctx.theme.palette.ink
    }) + '">' + escapeHtml(text) + '</div>';
  }

  /** Port of shared.tsx's Caption. Renders nothing for an empty value, same
   *  as the React version implicitly does by putting empty text in a div. */
  function captionHtml(ctx, text) {
    return '<div style="' + styleStr({ fontSize: px(11), lineHeight: 1.5, color: ctx.theme.palette.inkSoft }) + '">' + escapeHtml(text || '') + '</div>';
  }

  /** Port of shared.tsx's Card. */
  function cardStyle(ctx, extra) {
    return Object.assign({
      background: ctx.theme.palette.surface, border: '1px solid ' + ctx.theme.palette.line,
      borderRadius: px(ctx.theme.radius), padding: px(10)
    }, extra || {});
  }

  /** Port of shared.tsx's Pill. */
  function pillHtml(ctx, text) {
    return '<span style="' + styleStr({
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      background: ctx.theme.palette.accent, color: ctx.theme.palette.accentInk,
      borderRadius: px(999), padding: '6px 14px', fontSize: px(11), fontWeight: 600
    }) + '">' + escapeHtml(text) + '</span>';
  }

  /** Port of shared.tsx's ScrollArea. */
  function scrollAreaStyle() {
    return { flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: px(8) };
  }

  /** Port of shared.tsx's EmptyHint. */
  function emptyHintHtml(ctx, label) {
    return '<div style="' + styleStr({
      flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
      border: '1px dashed ' + ctx.theme.palette.line, borderRadius: px(ctx.theme.radius),
      color: ctx.theme.palette.inkSoft, fontSize: px(11)
    }) + '">' + escapeHtml(label) + '</div>';
  }

  // Faithful placeholder icons for the media blocks below (MediaBlocks.tsx
  // uses lucide-react; these are small hand-drawn equivalents, not pixel-exact
  // copies - the shared lucide catalogue in ZeDocCore only covers `icon` nodes).
  function iconPlaySvg(color) {
    return '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="' + color + '" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><path d="M10 8.5l6 3.5-6 3.5v-7z" fill="' + color + '" stroke="none"/></svg>';
  }
  function iconRadioSvg(color) {
    return '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="' + color + '" stroke-width="1.8"><path d="M5 12a7 7 0 0 1 14 0"/><path d="M7.5 12a4.5 4.5 0 0 1 9 0"/><circle cx="12" cy="17" r="1.6" fill="' + color + '" stroke="none"/></svg>';
  }
  function iconMapPinSvg(color) {
    return '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="' + color + '" stroke-width="1.8"><path d="M12 21s7-7.4 7-12a7 7 0 1 0-14 0c0 4.6 7 12 7 12z"/><circle cx="12" cy="9" r="2.3"/></svg>';
  }
  function iconMusicSvg(color) {
    return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="' + color + '" stroke-width="1.8"><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/><path d="M9 18V6l12-2v12"/></svg>';
  }

  /** Port of MediaBlocks.tsx's Placeholder. */
  function placeholderHtml(ctx, iconSvg, label) {
    return '<div style="' + styleStr({
      flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: px(6), borderRadius: px(ctx.theme.radius), background: ctx.theme.palette.surface,
      border: '1px solid ' + ctx.theme.palette.line, color: ctx.theme.palette.inkSoft, fontSize: px(11)
    }) + '">' + iconSvg + '<span>' + escapeHtml(label) + '</span></div>';
  }

  function galleryBlockHtml(node, ctx) {
    var layout = blockOption(node, 'layout', 'grid');
    var columns = blockOption(node, 'columns', 3);
    var gap = blockOption(node, 'gap', 6);
    var gallery = ctx.data.gallery || [];

    var shellStyle = styleStr({
      width: '100%', height: '100%', overflow: 'hidden',
      color: ctx.theme.palette.ink, fontFamily: ctx.theme.fonts.body,
      display: 'flex', flexDirection: 'column', gap: px(10)
    });

    if (gallery.length === 0) {
      var emptyStyle = styleStr({
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: '1px dashed ' + ctx.theme.palette.line, borderRadius: px(ctx.theme.radius),
        color: ctx.theme.palette.inkSoft, fontSize: px(11)
      });
      return '<div style="' + shellStyle + '"><div style="' + emptyStyle + '">Galeri kosong</div></div>';
    }

    // Every catalog template (Evergreen/Whimsical Love/Plum Elegance) pairs
    // these same two fields the same way - a small eyebrow label above a
    // big title - matched here (and in GalleryBlock.tsx) so this block reads
    // the same regardless of which template the couple is actually using.
    var eyebrowStyle = styleStr({
      fontFamily: ctx.theme.fonts.body, fontSize: px(11), letterSpacing: px(2),
      textTransform: 'uppercase', textAlign: 'center', color: ctx.theme.palette.inkSoft
    });
    var headingStyle = styleStr({
      fontFamily: ctx.theme.fonts.display, fontSize: px(20), lineHeight: 1.2,
      textAlign: 'center', color: ctx.theme.palette.ink
    });
    var fields = ctx.data.fields || {};
    var heading = '<div style="' + eyebrowStyle + '">' + escapeHtml(fields.teks_judul_galeri_1 || 'Kenangan') + '</div>' +
      '<div style="' + headingStyle + '">' + escapeHtml(fields.teks_judul_galeri_2 || 'Galeri') + '</div>';

    var trackStyle = layout === 'grid'
      ? { flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: 'repeat(' + columns + ', 1fr)', gap: px(gap), overflowY: 'auto', alignContent: 'start' }
      : { flex: 1, minHeight: 0, display: 'flex', gap: px(gap), overflowX: 'auto' };

    var items = gallery.map(function (photo) {
      // A carousel item keeps a fixed width so it reads as a filmstrip; a
      // grid cell takes its width from the track and only needs a square
      // aspect - same reasoning as GalleryBlock.tsx.
      var itemStyle = styleStr({
        flex: layout === 'carousel' ? '0 0 96px' : undefined,
        aspectRatio: '1 / 1', borderRadius: px(ctx.theme.radius),
        overflow: 'hidden', background: ctx.theme.palette.surface
      });
      var imgStyle = styleStr({ width: '100%', height: '100%', objectFit: 'cover', display: 'block', cursor: 'pointer' });
      return '<div style="' + itemStyle + '"><img src="' + escapeHtml(photo.foto) + '" alt="" draggable="false" data-zd-gallery-src="' + escapeHtml(photo.foto) + '" style="' + imgStyle + '"></div>';
    }).join('');

    return '<div style="' + shellStyle + '">' + heading + '<div style="' + styleStr(trackStyle) + '">' + items + '</div></div>';
  }

  function openingBlockHtml(node, ctx) {
    var layout = blockOption(node, 'layout', 'overlay');
    var bg = fieldVal(ctx, 'foto_background_halaman_awal', '');
    var light = layout === 'overlay' && bg;
    var shell = Object.assign(blockShellStyle(ctx.theme), {
      position: 'relative', alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: px(14),
      backgroundImage: bg ? 'url(' + bg + ')' : undefined, backgroundSize: 'cover', backgroundPosition: 'center', padding: px(20)
    });
    var overlay = light ? '<div style="' + styleStr({ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)' }) + '"></div>' : '';
    var inner = '<div style="' + styleStr({ position: 'relative', display: 'flex', flexDirection: 'column', gap: px(10) }) + '">' +
      '<div style="' + styleStr({ fontSize: px(12), color: light ? '#fff' : ctx.theme.palette.inkSoft }) + '">' + escapeHtml(fieldVal(ctx, 'judul_acara', 'The Wedding Of')) + '</div>' +
      '<div style="' + styleStr({ fontFamily: ctx.theme.fonts.display, fontSize: px(26), lineHeight: 1.15, color: light ? '#fff' : ctx.theme.palette.ink }) + '">' +
        escapeHtml(fieldVal(ctx, 'nama_panggilan_mempelai_1', 'Bagas')) + ' &amp; ' + escapeHtml(fieldVal(ctx, 'nama_panggilan_mempelai_2', 'Larasati')) + '</div>' +
      '<div style="' + styleStr({ fontSize: px(13), color: light ? '#fff' : ctx.theme.palette.inkSoft }) + '">' + escapeHtml(fieldVal(ctx, 'guest_name', 'Bapak/Ibu/Saudara/i Tamu Undangan')) + '</div>' +
      pillHtml(ctx, fieldVal(ctx, 'teks_tombol_buka', 'Buka Undangan')) +
      '</div>';
    return '<div style="' + styleStr(shell) + '">' + overlay + inner + '</div>';
  }

  function heroBlockHtml(node, ctx) {
    var layout = blockOption(node, 'layout', 'overlay');
    var bg = fieldVal(ctx, 'foto_background_halaman_awal', '');
    var light = layout === 'overlay' && bg;
    var shell = Object.assign(blockShellStyle(ctx.theme), {
      position: 'relative', alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: px(6),
      backgroundImage: bg ? 'url(' + bg + ')' : undefined, backgroundSize: 'cover', backgroundPosition: 'center', padding: px(16)
    });
    var overlay = light ? '<div style="' + styleStr({ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)' }) + '"></div>' : '';
    var inner = '<div style="' + styleStr({ position: 'relative', display: 'flex', flexDirection: 'column', gap: px(6) }) + '">' +
      '<div style="' + styleStr({ fontSize: px(12), letterSpacing: px(1), color: light ? '#fff' : ctx.theme.palette.inkSoft }) + '">' + escapeHtml(fieldVal(ctx, 'judul_acara', 'The Wedding Of')) + '</div>' +
      '<div style="' + styleStr({ fontFamily: ctx.theme.fonts.display, fontSize: px(30), lineHeight: 1.15, color: light ? '#fff' : ctx.theme.palette.ink }) + '">' +
        escapeHtml(fieldVal(ctx, 'nama_panggilan_mempelai_1', 'Bagas')) + ' &amp; ' + escapeHtml(fieldVal(ctx, 'nama_panggilan_mempelai_2', 'Larasati')) + '</div>' +
      '<div style="' + styleStr({ fontSize: px(13), color: light ? '#fff' : ctx.theme.palette.inkSoft }) + '">' + escapeHtml(fieldVal(ctx, 'tanggal_acara_cover', '12 . 06 . 2027')) + '</div>' +
      '</div>';
    return '<div style="' + styleStr(shell) + '">' + overlay + inner + '</div>';
  }

  // Static visual fidelity only (see the file header) - the numbers are
  // computed once at render time, same as ze-designer's own canvas preview
  // (also render-time only, no ticking); a real guest page's live countdown
  // is assets/engine.js's job for .dc.html templates today.
  // The numbers below are the first-paint value only (computed once, same
  // as before) - render() appends a small ticking script (countdownScript)
  // that reads data-zd-cd-target off the shell and rewrites each
  // data-zd-cd-unit digit every second. ze-designer's own canvas preview
  // stays render-time-only on purpose (see NodeContent.tsx) - only a guest
  // page needs to actually tick.
  function countdownBlockHtml(node, ctx) {
    var layout = blockOption(node, 'layout', 'digits');
    var remaining = countdownRemaining(ctx.data.countdownDatetime);
    var units = [
      { key: 'd', value: remaining.d, label: fieldVal(ctx, 'teks_countdown_hari', 'Hari') },
      { key: 'h', value: remaining.h, label: fieldVal(ctx, 'teks_countdown_jam', 'Jam') },
      { key: 'm', value: remaining.m, label: fieldVal(ctx, 'teks_countdown_menit', 'Menit') },
      { key: 's', value: remaining.s, label: fieldVal(ctx, 'teks_countdown_detik', 'Detik') }
    ];
    var cellsHtml = units.map(function (unit) {
      var cellStyle = {
        flex: 1, maxWidth: px(78), textAlign: 'center', padding: '10px 4px', borderRadius: px(ctx.theme.radius),
        background: layout === 'digits' ? ctx.theme.palette.surface : 'transparent',
        border: layout === 'digits' ? '1px solid ' + ctx.theme.palette.line : '1px solid transparent'
      };
      var numStyle = { fontFamily: ctx.theme.fonts.display, fontSize: px(26), lineHeight: 1.1, color: ctx.theme.palette.accent, fontVariantNumeric: 'tabular-nums' };
      var labelStyle = { fontSize: px(10), color: ctx.theme.palette.inkSoft };
      var cdTarget = escapeHtml(String(ctx.data.countdownDatetime || ''));
      return '<div style="' + styleStr(cellStyle) + '"><div data-zd-cd-unit="' + unit.key + '" data-zd-cd-target="' + cdTarget + '" style="' + styleStr(numStyle) + '">' + String(unit.value).padStart(2, '0') + '</div><div style="' + styleStr(labelStyle) + '">' + escapeHtml(unit.label) + '</div></div>';
    }).join('');
    var shell = Object.assign(blockShellStyle(ctx.theme), { justifyContent: 'center' });
    return '<div style="' + styleStr(shell) + '">' + headingHtml(ctx, fieldVal(ctx, 'teks_judul_countdown_1', 'Menuju Hari Bahagia')) +
      '<div style="' + styleStr({ display: 'flex', gap: px(8), justifyContent: 'center' }) + '">' + cellsHtml + '</div></div>';
  }

  function coupleBlockHtml(node, ctx) {
    var layout = blockOption(node, 'layout', 'split');
    var couple = ctx.data.couple || [];
    if (couple.length === 0) return '<div style="' + styleStr(blockShellStyle(ctx.theme)) + '">' + emptyHintHtml(ctx, 'Data mempelai kosong') + '</div>';
    var isSplit = layout === 'split';
    var peopleHtml = couple.map(function (person) {
      var wrapStyle = { flex: 1, minWidth: 0, display: 'flex', flexDirection: isSplit ? 'column' : 'row', alignItems: 'center', gap: px(8), textAlign: isSplit ? 'center' : 'left' };
      var photoSize = isSplit ? 74 : 56;
      var photoStyle = { width: px(photoSize), height: px(photoSize), flexShrink: 0, borderRadius: '50%', overflow: 'hidden', border: '2px solid ' + ctx.theme.palette.accent, background: ctx.theme.palette.surface };
      var img = person.foto
        ? '<img src="' + escapeHtml(person.foto) + '" alt="' + escapeHtml(person.nama || '') + '" draggable="false" style="' + styleStr({ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }) + '">'
        : '';
      var nameStyle = { fontFamily: ctx.theme.fonts.display, fontSize: px(15), lineHeight: 1.25, color: ctx.theme.palette.ink };
      return '<div style="' + styleStr(wrapStyle) + '"><div style="' + styleStr(photoStyle) + '">' + img + '</div>' +
        '<div style="' + styleStr({ minWidth: 0 }) + '"><div style="' + styleStr(nameStyle) + '">' + escapeHtml(person.nama || '') + '</div>' + captionHtml(ctx, person.ortu) + '</div></div>';
    }).join('');
    var rowStyle = { flex: 1, minHeight: 0, display: 'flex', flexDirection: isSplit ? 'row' : 'column', gap: px(12) };
    return '<div style="' + styleStr(blockShellStyle(ctx.theme)) + '">' + headingHtml(ctx, fieldVal(ctx, 'teks_judul_profil_1', 'Mempelai')) +
      '<div style="' + styleStr(rowStyle) + '">' + peopleHtml + '</div></div>';
  }

  function eventsBlockHtml(node, ctx) {
    var layout = blockOption(node, 'layout', 'cards');
    var events = ctx.data.events || [];
    if (events.length === 0) return '<div style="' + styleStr(blockShellStyle(ctx.theme)) + '">' + emptyHintHtml(ctx, 'Belum ada acara') + '</div>';
    var isTimeline = layout === 'timeline';
    var itemsHtml = events.map(function (event) {
      var railHtml = isTimeline
        ? '<div style="' + styleStr({ display: 'flex', flexDirection: 'column', alignItems: 'center' }) + '">' +
          '<span style="' + styleStr({ width: px(8), height: px(8), borderRadius: '50%', background: ctx.theme.palette.accent, marginTop: px(5) }) + '"></span>' +
          '<span style="' + styleStr({ flex: 1, width: px(1), background: ctx.theme.palette.line }) + '"></span></div>'
        : '';
      var cardStyleObj = cardStyle(ctx, Object.assign({ flex: 1 }, isTimeline ? { border: 'none', padding: '2px 0' } : {}));
      // A real href turns the badge into a link (map/.ics), same guard as
      // eventButtonLinkOverlaysHtml above - an event with no real venue pin
      // stays a plain, inert badge rather than a dead link.
      var mapHref = hasRealMapHref(event) ? event.map_href : null;
      var calHref = buildIcsDataUri(event);
      var mapTag = mapHref ? 'a' : 'span';
      var calTag = calHref ? 'a' : 'span';
      var badgeBaseStyle = { fontSize: px(10), padding: '3px 8px', borderRadius: px(999), textDecoration: 'none', display: 'inline-block' };
      var badgesHtml = '<div style="' + styleStr({ display: 'flex', gap: px(6), marginTop: px(6) }) + '">' +
        '<' + mapTag + (mapHref ? ' href="' + escapeHtml(mapHref) + '" target="_blank" rel="noopener"' : '') +
          ' style="' + styleStr(Object.assign({}, badgeBaseStyle, { border: '1px solid ' + ctx.theme.palette.accent, color: ctx.theme.palette.accent })) + '">' +
          escapeHtml(fieldVal(ctx, 'teks_buka_peta', 'Buka Peta')) + '</' + mapTag + '>' +
        '<' + calTag + (calHref ? ' href="' + escapeHtml(calHref) + '"' : '') +
          ' style="' + styleStr(Object.assign({}, badgeBaseStyle, { border: '1px solid ' + ctx.theme.palette.line, color: ctx.theme.palette.inkSoft })) + '">' +
          escapeHtml(fieldVal(ctx, 'teks_tambah_ke_kalender', '+ Kalender')) + '</' + calTag + '></div>';
      var cardInner = '<div style="' + styleStr({ fontWeight: 600, fontSize: px(12), color: ctx.theme.palette.ink }) + '">' + escapeHtml(event.nama_acara || '') + '</div>' +
        captionHtml(ctx, event.keterangan) + captionHtml(ctx, event.venue) + badgesHtml;
      return '<div style="' + styleStr({ display: 'flex', gap: px(8) }) + '">' + railHtml + '<div style="' + styleStr(cardStyleObj) + '">' + cardInner + '</div></div>';
    }).join('');
    return '<div style="' + styleStr(blockShellStyle(ctx.theme)) + '">' + headingHtml(ctx, fieldVal(ctx, 'teks_judul_jadwal_1', 'Jadwal')) +
      '<div style="' + styleStr(scrollAreaStyle()) + '">' + itemsHtml + '</div></div>';
  }

  function quotesBlockHtml(node, ctx) {
    var layout = blockOption(node, 'layout', 'plain');
    var quotes = ctx.data.quotes || [];
    if (quotes.length === 0) return '<div style="' + styleStr(blockShellStyle(ctx.theme)) + '">' + emptyHintHtml(ctx, 'Belum ada kutipan') + '</div>';
    var itemsHtml = quotes.map(function (quote) {
      var body = '<div style="' + styleStr({ textAlign: 'center' }) + '">' +
        '<div style="' + styleStr({ fontFamily: ctx.theme.fonts.display, fontSize: px(13), lineHeight: 1.6, fontStyle: 'italic', color: ctx.theme.palette.ink }) + '">“' + escapeHtml(quote.isi_quote || '') + '”</div>' +
        '<div style="' + styleStr({ marginTop: px(6), fontSize: px(11), fontWeight: 600, color: ctx.theme.palette.accent }) + '">' + escapeHtml(quote.sumber_quote || '') + '</div></div>';
      return layout === 'card' ? '<div style="' + styleStr(cardStyle(ctx)) + '">' + body + '</div>' : '<div>' + body + '</div>';
    }).join('');
    var shell = Object.assign(blockShellStyle(ctx.theme), { justifyContent: 'center' });
    return '<div style="' + styleStr(shell) + '">' + '<div style="' + styleStr(scrollAreaStyle()) + '">' + itemsHtml + '</div></div>';
  }

  function loveStoryBlockHtml(node, ctx) {
    var layout = blockOption(node, 'layout', 'timeline');
    var loveStory = ctx.data.loveStory || [];
    if (loveStory.length === 0) return '<div style="' + styleStr(blockShellStyle(ctx.theme)) + '">' + emptyHintHtml(ctx, 'Belum ada kisah') + '</div>';
    var isTimeline = layout === 'timeline';
    var itemsHtml = loveStory.map(function (story) {
      var railHtml = isTimeline
        ? '<div style="' + styleStr({ display: 'flex', flexDirection: 'column', alignItems: 'center' }) + '">' +
          '<span style="' + styleStr({ width: px(7), height: px(7), borderRadius: '50%', background: ctx.theme.palette.accent, marginTop: px(5) }) + '"></span>' +
          '<span style="' + styleStr({ flex: 1, width: px(1), background: ctx.theme.palette.line }) + '"></span></div>'
        : '';
      var body = '<div style="' + styleStr({ flex: 1, minWidth: 0 }) + '">' +
        '<div style="' + styleStr({ fontWeight: 600, fontSize: px(12), color: ctx.theme.palette.ink }) + '">' + escapeHtml(story.judul_cerita || '') + '</div>' +
        captionHtml(ctx, story.isi_cerita) + '</div>';
      return '<div style="' + styleStr({ display: 'flex', gap: px(8) }) + '">' + railHtml + body + '</div>';
    }).join('');
    return '<div style="' + styleStr(blockShellStyle(ctx.theme)) + '">' + headingHtml(ctx, fieldVal(ctx, 'teks_judul_love_story_1', 'Kisah')) +
      '<div style="' + styleStr(scrollAreaStyle()) + '">' + itemsHtml + '</div></div>';
  }

  // Unlike quotes/gallery/love-story, this isn't a repeating list the
  // organiser grows - the six points are always-present field keys, not
  // mapped from ctx.data (see HealthProtocolBlock.tsx's own comment).
  function healthProtocolBlockHtml(node, ctx) {
    var layout = blockOption(node, 'layout', 'grid');
    var points = [
      fieldVal(ctx, 'teks_pakai_masker', 'Mengenakan masker'),
      fieldVal(ctx, 'teks_cuci_tangan', 'Mencuci tangan'),
      fieldVal(ctx, 'teks_pakai_sabun', 'Menggunakan sabun'),
      fieldVal(ctx, 'teks_pakai_sanitizer', 'Menggunakan hand sanitizer'),
      fieldVal(ctx, 'teks_hindari_kerumunan', 'Menghindari kerumunan'),
      fieldVal(ctx, 'teks_tidak_jabat_tangan', 'Tidak berjabat tangan')
    ];
    var isGrid = layout === 'grid';
    var listStyle = { display: isGrid ? 'grid' : 'flex', flexDirection: layout === 'list' ? 'column' : undefined, gridTemplateColumns: isGrid ? 'repeat(2, 1fr)' : undefined, gap: px(6) };
    var itemsHtml = points.map(function (point) {
      return '<div style="' + styleStr({ display: 'flex', alignItems: 'center', gap: px(6) }) + '">' +
        '<span style="' + styleStr({ width: px(5), height: px(5), flexShrink: 0, borderRadius: '50%', background: ctx.theme.palette.accent }) + '"></span>' +
        '<span style="' + styleStr({ fontSize: px(11), color: ctx.theme.palette.ink }) + '">' + escapeHtml(point) + '</span></div>';
    }).join('');
    return '<div style="' + styleStr(blockShellStyle(ctx.theme)) + '">' + headingHtml(ctx, fieldVal(ctx, 'teks_judul_protokol_1', 'Protokol Kesehatan')) +
      '<div style="' + styleStr(listStyle) + '">' + itemsHtml + '</div></div>';
  }

  function envelopeBlockHtml(node, ctx) {
    var layout = blockOption(node, 'layout', 'list');
    var envelope = ctx.data.envelope || [];
    if (envelope.length === 0) return '<div style="' + styleStr(blockShellStyle(ctx.theme)) + '">' + emptyHintHtml(ctx, 'Belum ada rekening') + '</div>';
    var isGrid = layout === 'grid';
    var listStyle = { flex: 1, minHeight: 0, overflowY: 'auto', display: isGrid ? 'grid' : 'flex', flexDirection: isGrid ? undefined : 'column', gridTemplateColumns: isGrid ? 'repeat(2, 1fr)' : undefined, gap: px(6), alignContent: 'start' };
    var itemsHtml = envelope.map(function (account) {
      return '<div style="' + styleStr(cardStyle(ctx, { padding: px(8) })) + '">' +
        '<div style="' + styleStr({ fontSize: px(11), fontWeight: 700, color: ctx.theme.palette.accent }) + '">' + escapeHtml(account.nama_bank || '') + '</div>' +
        '<div style="' + styleStr({ fontSize: px(13), letterSpacing: px(1), fontVariantNumeric: 'tabular-nums', color: ctx.theme.palette.ink }) + '">' + escapeHtml(account.no_rekening || '') + '</div>' +
        captionHtml(ctx, account.nama_pemilik_rekening) + '</div>';
    }).join('');
    return '<div style="' + styleStr(blockShellStyle(ctx.theme)) + '">' + headingHtml(ctx, fieldVal(ctx, 'teks_judul_hadiah', 'Amplop Digital')) + captionHtml(ctx, fieldVal(ctx, 'teks_keterangan_hadiah', '')) +
      '<div style="' + styleStr(listStyle) + '">' + itemsHtml + '</div></div>';
  }

  /** One Hadir/Tidak Hadir toggle button. The on/off colors are baked into
   *  data attributes (not a stylesheet class) so rsvpScript below can swap
   *  them on click without needing to know this theme's palette itself -
   *  same "server computes styles, client just toggles them" split as the
   *  rest of this file's inline-style approach. */
  function attendButtonHtml(ctx, eventName, attend, selected, label) {
    var onStyle = { background: ctx.theme.palette.accent, color: ctx.theme.palette.accentInk, borderColor: ctx.theme.palette.accent };
    var offStyle = { background: 'transparent', color: ctx.theme.palette.inkSoft, borderColor: ctx.theme.palette.line };
    var base = { flex: 1, textAlign: 'center', fontSize: px(11), padding: '8px 6px', borderRadius: px(ctx.theme.radius), border: '1px solid', cursor: 'pointer', fontFamily: 'inherit' };
    var current = Object.assign({}, base, selected ? onStyle : offStyle);
    return '<button type="button" data-zd-attend-btn data-zd-attend="' + attend + '" data-zd-selected="' + (selected ? '1' : '0') + '"' +
      ' data-zd-bg-on="' + escapeHtml(onStyle.background) + '" data-zd-color-on="' + escapeHtml(onStyle.color) + '" data-zd-border-on="' + escapeHtml(onStyle.borderColor) + '"' +
      ' data-zd-bg-off="' + escapeHtml(offStyle.background) + '" data-zd-color-off="' + escapeHtml(offStyle.color) + '" data-zd-border-off="' + escapeHtml(offStyle.borderColor) + '"' +
      ' style="' + styleStr(current) + '">' + escapeHtml(label) + '</button>';
  }

  /** One Dewasa/Anak number stepper - a native <input type=number>, not the
   *  .dc.html version's custom +/- buttons (the browser's own stepper does
   *  the same job for free). `max` is a cosmetic hint only: the server
   *  (clampEventRsvp, src/worker.js) is the real authority and re-clamps
   *  every submission regardless of what the client sends. */
  function rsvpCountFieldHtml(ctx, attr, label, value, max) {
    var labelStyle = { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: px(4), fontSize: px(10), letterSpacing: px(1), textTransform: 'uppercase', color: ctx.theme.palette.inkSoft };
    var inputStyle = { width: '100%', boxSizing: 'border-box', padding: '8px', background: ctx.theme.palette.surface, border: '1px solid ' + ctx.theme.palette.line, borderRadius: px(ctx.theme.radius), color: ctx.theme.palette.ink, fontSize: px(13), textAlign: 'center' };
    return '<label style="' + styleStr(labelStyle) + '">' + escapeHtml(label) +
      '<input type="number" inputmode="numeric" min="0"' + (max != null ? ' max="' + Number(max) + '"' : '') +
      ' value="' + Number(value || 0) + '" ' + attr + ' style="' + styleStr(inputStyle) + '"></label>';
  }

  // Real per-event attendance form, submitting to the same
  // PUT /api/invitations/:slug/guests/:guestId/rsvp endpoint the .dc.html
  // pipeline's own React components use (assets/engine.js's RSVP submission
  // is otherwise untouched). Deliberately simplified vs. that pipeline: no
  // "Ubah Konfirmasi" read-only-summary/edit-toggle state (this always shows
  // the editable form, pre-filled from any existing response, so resubmitting
  // just updates it) and no custom RSVP questions (rsvp_answers) - neither
  // has a zedoc block yet. ponytail: add those if a template actually needs
  // them; the endpoint already accepts rsvp_answers today.
  function rsvpBlockHtml(node, ctx) {
    var layout = blockOption(node, 'layout', 'card');
    var slug = ctx.data.slug || '';
    var guestId = ctx.data.guestId || '';
    var guestName = ctx.data.guestName || '';
    var quotaMap = ctx.data.guestEventQuota || {};
    var rsvpMap = ctx.data.guestEventRsvp || {};
    var invited = ctx.data.guestInvitedEvents;
    var events = (ctx.data.events || []).filter(function (ev) {
      return !Array.isArray(invited) || !invited.length || invited.indexOf(ev.nama_acara) !== -1;
    });

    var nameLine = guestName
      ? '<div style="' + styleStr({ fontSize: px(15), fontWeight: 600, color: ctx.theme.palette.ink }) + '">' + escapeHtml(guestName) + '</div>'
      : captionHtml(ctx, 'Buka undangan lewat tautan pribadi Anda untuk mengonfirmasi kehadiran.');

    var cardsHtml = events.map(function (ev) {
      var name = ev.nama_acara || '';
      // Only an event the organizer actually set a quota for gets counted -
      // same rsvpShowInputs/rsvpUntracked split as assets/engine.js, without
      // porting its full isDemoRsvp/quota-mode branching (server clamps the
      // real numbers regardless of what this form shows).
      var quota = quotaMap[name];
      var showInputs = !!quota;
      var prevR = rsvpMap[name];
      var hasResponded = !!prevR;
      var attending = !hasResponded || (prevR.dewasa || 0) > 0 || (prevR.anak || 0) > 0;
      var prefillDewasa = (prevR && prevR.dewasa) || 0;
      var prefillAnak = (prevR && prevR.anak) || 0;
      var maxDewasa = quota && quota.dewasa != null ? quota.dewasa : null;
      var maxAnak = quota && quota.anak != null ? quota.anak : null;

      var info = captionHtml(ctx, [ev.keterangan, ev.venue].filter(Boolean).join(' · '));
      var inner;
      if (showInputs) {
        var toggle = '<div style="' + styleStr({ display: 'flex', gap: px(6) }) + '">' +
          attendButtonHtml(ctx, name, 'yes', attending, fieldVal(ctx, 'teks_pilihan_hadir', 'Hadir')) +
          attendButtonHtml(ctx, name, 'no', !attending, fieldVal(ctx, 'teks_pilihan_tidak_hadir', 'Tidak Hadir')) + '</div>';
        var counts = '<div data-zd-counts style="' + styleStr({ display: attending ? 'flex' : 'none', gap: px(10) }) + '">' +
          rsvpCountFieldHtml(ctx, 'data-zd-rsvp-dewasa', 'Dewasa', prefillDewasa, maxDewasa) +
          rsvpCountFieldHtml(ctx, 'data-zd-rsvp-anak', 'Anak', prefillAnak, maxAnak) + '</div>';
        inner = toggle + counts;
      } else {
        inner = captionHtml(ctx, 'Kehadiran Anda di acara ini sudah kami catat, tidak perlu konfirmasi jumlah tamu.');
      }
      return '<div data-zd-rsvp-card="' + escapeHtml(name) + '" data-zd-show-inputs="' + (showInputs ? '1' : '0') + '" style="' +
        styleStr(cardStyle(ctx, { display: 'flex', flexDirection: 'column', gap: px(8) })) + '">' +
        '<div style="' + styleStr({ fontWeight: 600, fontSize: px(13), color: ctx.theme.palette.ink }) + '">' + escapeHtml(name) + '</div>' +
        info + inner + '</div>';
    }).join('');

    var submitBtn = '<button type="button" id="zd-rsvp-submit" style="' + styleStr({
      marginTop: px(4), padding: '10px', border: 'none', borderRadius: px(999), cursor: 'pointer',
      background: ctx.theme.palette.accent, color: ctx.theme.palette.accentInk, fontSize: px(11), fontWeight: 600
    }) + '">' + escapeHtml(fieldVal(ctx, 'teks_tombol_konfirmasi', 'Kirim Konfirmasi')) + '</button>';
    var statusLine = '<div id="zd-rsvp-status" style="' + styleStr({ fontSize: px(11), color: ctx.theme.palette.inkSoft, minHeight: px(14) }) + '"></div>';

    var body = '<div data-zd-rsvp-slug="' + escapeHtml(slug) + '" data-zd-rsvp-guest="' + escapeHtml(guestId) + '" style="' +
      styleStr({ display: 'flex', flexDirection: 'column', gap: px(10) }) + '">' + nameLine +
      (events.length ? cardsHtml + submitBtn + statusLine : captionHtml(ctx, 'Belum ada acara')) + '</div>';
    var shell = Object.assign(blockShellStyle(ctx.theme), { justifyContent: 'center' });
    return '<div style="' + styleStr(shell) + '">' + headingHtml(ctx, fieldVal(ctx, 'teks_judul_rsvp', 'Konfirmasi Kehadiran')) +
      (layout === 'card' ? '<div style="' + styleStr(cardStyle(ctx)) + '">' + body + '</div>' : body) + '</div>';
  }

  // Real wish/guestbook submission, POSTing to the same
  // /api/invitations/:slug/wishes endpoint assets/engine.js's own wish-form
  // uses. No pagination (wishesBlockHtml never had it, keeping parity).
  function wishesBlockHtml(node, ctx) {
    var showForm = blockOption(node, 'showForm', true);
    var wishes = ctx.data.wishes || [];
    var slug = ctx.data.slug || '';
    var guestName = ctx.data.guestName || '';

    var itemStyle = styleStr(cardStyle(ctx, { padding: px(8) }));
    var headStyle = styleStr({ display: 'flex', justifyContent: 'space-between', gap: px(6), fontSize: px(11), fontWeight: 600 });
    var nameStyle = styleStr({ color: ctx.theme.palette.ink });
    var timeStyle = styleStr({ color: ctx.theme.palette.inkSoft, fontWeight: 400 });
    var captionStyle = styleStr({ fontSize: px(11), lineHeight: 1.5, color: ctx.theme.palette.inkSoft });

    var nameFieldHtml = guestName
      ? '<input type="hidden" id="zd-wish-name" value="' + escapeHtml(guestName) + '">' +
        '<div style="' + styleStr({ fontSize: px(11), color: ctx.theme.palette.inkSoft }) + '">' + escapeHtml(guestName) + '</div>'
      : '<input type="text" id="zd-wish-name" placeholder="Nama Anda" style="' +
        styleStr({ padding: px(8), background: ctx.theme.palette.surface, border: '1px solid ' + ctx.theme.palette.line, borderRadius: px(ctx.theme.radius), color: ctx.theme.palette.ink, fontSize: px(11) }) + '">';
    var formHtml = showForm
      ? '<div data-zd-wish-slug="' + escapeHtml(slug) + '" style="' + styleStr({ display: 'flex', flexDirection: 'column', gap: px(6) }) + '">' +
        nameFieldHtml +
        '<textarea id="zd-wish-message" rows="2" placeholder="' + escapeHtml(fieldVal(ctx, 'teks_placeholder_ucapan', 'Tulis ucapan Anda…')) + '" style="' +
          styleStr({ padding: px(8), background: ctx.theme.palette.surface, border: '1px solid ' + ctx.theme.palette.line, borderRadius: px(ctx.theme.radius), color: ctx.theme.palette.ink, fontSize: px(11), resize: 'vertical' }) + '"></textarea>' +
        '<button type="button" id="zd-wish-submit" style="' + styleStr({
          alignSelf: 'flex-start', padding: '7px 16px', border: 'none', borderRadius: px(999), cursor: 'pointer',
          background: ctx.theme.palette.accent, color: ctx.theme.palette.accentInk, fontSize: px(11), fontWeight: 600
        }) + '">' + escapeHtml(fieldVal(ctx, 'teks_tombol_kirim_ucapan', 'Kirim Ucapan')) + '</button>' +
        '<div id="zd-wish-status" style="' + styleStr({ fontSize: px(11), color: ctx.theme.palette.inkSoft, minHeight: px(14) }) + '"></div></div>'
      : '';
    var itemsHtml = wishes.map(function (wish) {
      var head = '<div style="' + headStyle + '">' +
        '<span style="' + nameStyle + '">' + escapeHtml(wish.name || '') + '</span>' +
        '<span style="' + timeStyle + '">' + escapeHtml(wish.time || '') + '</span></div>';
      return '<div style="' + itemStyle + '">' + head + captionHtml(ctx, wish.message) + '</div>';
    }).join('');
    var listHtml = '<div id="zd-wishes-list" data-zd-item-style="' + escapeHtml(itemStyle) + '" data-zd-head-style="' + escapeHtml(headStyle) +
      '" data-zd-name-style="' + escapeHtml(nameStyle) + '" data-zd-time-style="' + escapeHtml(timeStyle) + '" data-zd-caption-style="' + escapeHtml(captionStyle) +
      '" style="' + styleStr(scrollAreaStyle()) + '">' + itemsHtml + '</div>';
    return '<div style="' + styleStr(blockShellStyle(ctx.theme)) + '">' + headingHtml(ctx, fieldVal(ctx, 'teks_judul_wish', 'Ucapan & Doa')) + formHtml + listHtml + '</div>';
  }

  function videoBlockHtml(node, ctx) {
    return '<div style="' + styleStr(blockShellStyle(ctx.theme)) + '">' + placeholderHtml(ctx, iconPlaySvg(ctx.theme.palette.accent), 'Video YouTube') + '</div>';
  }

  function liveStreamBlockHtml(node, ctx) {
    var shell = Object.assign(blockShellStyle(ctx.theme), { justifyContent: 'center' });
    return '<div style="' + styleStr(shell) + '">' + headingHtml(ctx, fieldVal(ctx, 'teks_judul_live_streaming', 'Live Streaming')) + captionHtml(ctx, fieldVal(ctx, 'teks_keterangan_live_streaming', '')) +
      '<div style="' + styleStr({ textAlign: 'center' }) + '">' + pillHtml(ctx, fieldVal(ctx, 'teks_tombol_bergabung', 'Bergabung Sekarang')) + '</div>' +
      placeholderHtml(ctx, iconRadioSvg(ctx.theme.palette.accent), 'Pratinjau siaran') + '</div>';
  }

  function mapBlockHtml(node, ctx) {
    var venue = ((ctx.data.events || [])[0] || {}).venue || '';
    return '<div style="' + styleStr(blockShellStyle(ctx.theme)) + '">' + placeholderHtml(ctx, iconMapPinSvg(ctx.theme.palette.accent), 'Peta lokasi') + (venue ? captionHtml(ctx, venue) : '') + '</div>';
  }

  function musicBlockHtml(node, ctx) {
    var shell = Object.assign(blockShellStyle(ctx.theme), { alignItems: 'center', justifyContent: 'center', gap: px(6) });
    var circle = '<div style="' + styleStr({ width: px(40), height: px(40), borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: ctx.theme.palette.accent, color: ctx.theme.palette.accentInk }) + '">' + iconMusicSvg(ctx.theme.palette.accentInk) + '</div>';
    return '<div style="' + styleStr(shell) + '">' + circle + captionHtml(ctx, 'Musik latar') + '</div>';
  }

  function sendGiftBlockHtml(node, ctx) {
    var shell = Object.assign(blockShellStyle(ctx.theme), { justifyContent: 'center' });
    var cardInner = '<div style="' + styleStr({ fontSize: px(12), fontWeight: 600 }) + '">' + escapeHtml(fieldVal(ctx, 'nama_penerima_kado', '')) + '</div>' + captionHtml(ctx, fieldVal(ctx, 'alamat_pengiriman_kado', ''));
    // A real wa.me (or any) link the organizer set turns the pill into an
    // actual link, same "real link vs inert placeholder" pattern as the map/
    // calendar badges in eventsBlockHtml - matches templates/*.dc.html's own
    // <a data-field-href="link_konfirmasi_wa"> for this exact button.
    var waHref = linkVal(ctx, 'link_konfirmasi_wa');
    var waTag = waHref ? 'a' : 'span';
    var waBtn = '<' + waTag + (waHref ? ' href="' + escapeHtml(waHref) + '" target="_blank" rel="noopener"' : '') + ' style="' + styleStr({
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none',
      background: ctx.theme.palette.accent, color: ctx.theme.palette.accentInk,
      borderRadius: px(999), padding: '6px 14px', fontSize: px(11), fontWeight: 600
    }) + '">' + escapeHtml(fieldVal(ctx, 'teks_tombol_konfirmasi_wa', 'Konfirmasi via WhatsApp')) + '</' + waTag + '>';
    return '<div style="' + styleStr(shell) + '">' + headingHtml(ctx, fieldVal(ctx, 'teks_judul_pengiriman_kado', 'Kirim Kado')) +
      '<div style="' + styleStr(cardStyle(ctx)) + '">' + cardInner + '</div>' +
      '<div style="' + styleStr({ textAlign: 'center' }) + '">' + waBtn + '</div></div>';
  }

  function closingBlockHtml(node, ctx) {
    var layout = blockOption(node, 'layout', 'overlay');
    var bg = fieldVal(ctx, 'foto_background_thankyou', '');
    var light = layout === 'overlay' && bg;
    var extra = fieldVal(ctx, 'tambahan_thank_you_section', '');
    var shell = Object.assign(blockShellStyle(ctx.theme), {
      position: 'relative', alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: px(8),
      backgroundImage: bg ? 'url(' + bg + ')' : undefined, backgroundSize: 'cover', backgroundPosition: 'center', padding: px(16)
    });
    var overlay = light ? '<div style="' + styleStr({ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)' }) + '"></div>' : '';
    var inner = '<div style="' + styleStr({ position: 'relative', display: 'flex', flexDirection: 'column', gap: px(6) }) + '">' +
      '<div style="' + styleStr({ fontFamily: ctx.theme.fonts.display, fontSize: px(22), lineHeight: 1.2, color: light ? '#fff' : ctx.theme.palette.ink }) + '">' + escapeHtml(fieldVal(ctx, 'teks_terima_kasih', 'Terima Kasih')) + '</div>' +
      (extra ? '<div style="' + styleStr({ fontSize: px(12), color: light ? '#fff' : ctx.theme.palette.inkSoft }) + '">' + escapeHtml(extra) + '</div>' : '') +
      '<div style="' + styleStr({ fontFamily: ctx.theme.fonts.display, fontSize: px(16), color: light ? '#fff' : ctx.theme.palette.accent }) + '">' +
        escapeHtml(fieldVal(ctx, 'nama_panggilan_mempelai_1', 'Bagas')) + ' &amp; ' + escapeHtml(fieldVal(ctx, 'nama_panggilan_mempelai_2', 'Larasati')) + '</div>' +
      '<div style="' + styleStr({ fontSize: px(11), color: light ? '#fff' : ctx.theme.palette.inkSoft }) + '">' + escapeHtml(fieldVal(ctx, 'teks_keluarga_besar', 'Kami yang berbahagia')) + '</div>' +
      '<div style="' + styleStr({ fontSize: px(11), color: light ? '#fff' : ctx.theme.palette.inkSoft }) + '">' + escapeHtml(fieldVal(ctx, 'ortu_kedua_mempelai', '')) + '</div>' +
      '</div>';
    return '<div style="' + styleStr(shell) + '">' + overlay + inner + '</div>';
  }

  var BLOCK_RENDERERS = {
    opening: openingBlockHtml,
    hero: heroBlockHtml,
    countdown: countdownBlockHtml,
    couple: coupleBlockHtml,
    events: eventsBlockHtml,
    gallery: galleryBlockHtml,
    quotes: quotesBlockHtml,
    'love-story': loveStoryBlockHtml,
    envelope: envelopeBlockHtml,
    'send-gift': sendGiftBlockHtml,
    'health-protocol': healthProtocolBlockHtml,
    rsvp: rsvpBlockHtml,
    wishes: wishesBlockHtml,
    video: videoBlockHtml,
    'live-streaming': liveStreamBlockHtml,
    map: mapBlockHtml,
    music: musicBlockHtml,
    closing: closingBlockHtml
  };

  // Every zedoc-builder catalog template (scripts/zedoc-builder/build-*.mjs)
  // hand-authors a Rangkaian Acara card's button row as an 'Event buttons'
  // group with sibling 'Map button'/'Calendar button' shape+label pairs -
  // there's no generic link/action field on a node (see ze-designer's
  // doc/schema.ts), so a real click target is layered on top as an
  // invisible anchor matching that shape's own authored frame, keyed by
  // name (consistent across all 24 templates) rather than by node id.
  // "+ Kalender" - a small dropdown (data-zd2-cal-toggle/-menu, wired in
  // handDrawnRsvpWishScript) instead of a single link, since there are two
  // useful destinations for an event's date/time: a downloadable .ics
  // (works with Apple/Outlook/etc.) or a Google Calendar quick-add link.
  // Positioned absolutely inside its own position:absolute wrap (same frame
  // as the authored "Calendar button" shape), so it drops directly below
  // the button regardless of which template/theme is rendering it.
  function calendarDropdownHtml(frame, icsHref, gcalHref, ctx) {
    var wrapStyle = styleStr(frameStyle(frame));
    var itemStyle = { display: 'block', padding: '10px 14px', fontSize: px(12), fontFamily: ctx.theme.fonts.body, color: ctx.theme.palette.ink, textDecoration: 'none', whiteSpace: 'nowrap' };
    var menuStyle = {
      display: 'none', position: 'absolute', top: 'calc(100% + 6px)', left: 0, minWidth: px(190),
      background: ctx.theme.palette.surface, border: '1px solid ' + ctx.theme.palette.line,
      borderRadius: px(ctx.theme.radius), boxShadow: '0 8px 24px rgba(0,0,0,.18)', overflow: 'hidden', zIndex: 20
    };
    var itemsHtml = '';
    if (icsHref) {
      itemsHtml += '<a href="' + escapeHtml(icsHref) + '" download="acara.ics" style="' + styleStr(itemStyle) + '">Download .ics</a>';
    }
    if (gcalHref) {
      var gcalStyle = Object.assign({}, itemStyle, icsHref ? { borderTop: '1px solid ' + ctx.theme.palette.line } : {});
      itemsHtml += '<a href="' + escapeHtml(gcalHref) + '" target="_blank" rel="noopener" style="' + styleStr(gcalStyle) + '">Tambah ke Google Calendar</a>';
    }
    return '<div data-zd2-cal-wrap style="' + wrapStyle + '">' +
      '<div data-zd2-cal-toggle style="width:100%;height:100%;cursor:pointer"></div>' +
      '<div data-zd2-cal-menu style="' + styleStr(menuStyle) + '">' + itemsHtml + '</div></div>';
  }

  function eventButtonLinkOverlaysHtml(node, ctx) {
    var buttonsRole = ZeDocCore.guestRole(node);
    if (!buttonsRole || buttonsRole.role !== 'event-buttons' || !ctx.repeatItem) return '';
    var event = ctx.repeatItem;
    var html = '';
    node.children.forEach(function (child) {
      var childRole = ZeDocCore.guestRole(child);
      if (childRole && childRole.role === 'map-button') {
        if (!hasRealMapHref(event)) return;
        var linkStyle = styleStr(Object.assign(frameStyle(child.frame), { display: 'block' }));
        html += '<a href="' + escapeHtml(event.map_href) + '" target="_blank" rel="noopener" style="' + linkStyle + '"></a>';
        return;
      }
      if (childRole && childRole.role === 'calendar-button') {
        var icsHref = buildIcsDataUri(event);
        var gcalHref = buildGoogleCalendarUrl(event);
        if (!icsHref && !gcalHref) return;
        html += calendarDropdownHtml(child.frame, icsHref, gcalHref, ctx);
      }
    });
    return html;
  }

  // --- node dispatch (NodeContent.tsx port) ---------------------------------

  // What this render has animated so far (reset at the top of render(); a
  // render is synchronous, so one module-level tally is enough). Tells render()
  // which @keyframes, gate hook and reveal observer the page needs - a doc with
  // no `animations` anywhere emits none of them.
  var motionUsed = { any: false, reveal: false, presets: {} };

  // Puts a node's `animations` on its positioned wrapper (a repeat's items
  // each get it). Mutates in place: decorateNode reads view.style right after.
  function applyMotion(node, view) {
    var motion = ZeDocCore.motionStyle(node);
    if (!motion) return;
    motionUsed.any = true;
    if (motion.reveal) motionUsed.reveal = true;
    motion.presets.forEach(function (preset) { motionUsed.presets[preset] = true; });
    (view.fragment || [view]).forEach(function (target) {
      target.style = Object.assign(target.style || {}, motion.style);
      target.attrs = Object.assign(target.attrs || {}, { 'data-zd-motion': motion.reveal ? 'reveal' : '1' });
    });
  }

  function decorateNode(node, view, ctx, o) {
    applyMotion(node, view);
    var wrapStyle = view.style;
    var gctx = ZeDocCore.groupCtx(node, ctx);

    switch (node.type) {
      case 'text':
        decorateText(node, view, ctx);
        return;
      case 'shape': {
        // "Yes button"/"No button" (see ZeDocCore.GUEST_ROLES) pair
        // with their own text label siblings (decorateText's matching
        // 'attend-label' role) to form one attendance toggle -
        // both the "off" (normal) and "on" look are pre-computed into data
        // attributes so handDrawnRsvpWishScript can swap the inner div's
        // style on click without knowing this theme.
        var shapeRole = ZeDocCore.guestRole(node);
        var attendShapeRole = shapeRole && shapeRole.role === 'attend-shape' ? shapeRole.arg : null;
        if (!attendShapeRole || !ctx.repeatItem) return;
        var attendEvent = ctx.repeatItem.nama_acara || '';
        var attendSelected = attendingDefaultFor(ctx, attendEvent) === (attendShapeRole === 'yes');
        var offStyle = Object.assign(
          { width: '100%', height: '100%', boxSizing: 'border-box', borderRadius: px(node.radius) },
          resolveFill(node.fill, ctx),
          node.stroke.width > 0 ? { borderWidth: px(node.stroke.width), borderStyle: node.stroke.style, borderColor: resolveColor(node.stroke.color, ctx.theme) } : {}
        );
        var onStyle = {
          width: '100%', height: '100%', boxSizing: 'border-box', borderRadius: px(node.radius),
          background: ctx.theme.palette.accent, borderWidth: px(node.stroke.width || 1), borderStyle: 'solid', borderColor: ctx.theme.palette.accent
        };
        return {
          tag: 'div',
          attrs: {
            'data-zd2-attend': attendShapeRole,
            'data-zd2-event': attendEvent,
            'data-zd2-style-on': ZeDocCore.styleText(onStyle),
            'data-zd2-style-off': ZeDocCore.styleText(offStyle),
            'data-zd2-selected': attendSelected ? '1' : '0'
          },
          style: Object.assign({}, wrapStyle, { cursor: 'pointer' }),
          children: [{ tag: 'div', style: attendSelected ? onStyle : offStyle }]
        };
      }
      case 'block': {
        var renderer = BLOCK_RENDERERS[node.block];
        if (!renderer) return { raw: '' };
        view.children = [{ raw: renderer(node, ctx) }];
        return;
      }
      case 'group': {
        // "Wish name input"/"Wish message input" are a decorative background
        // shape + a static placeholder text, same hand-drawn convention as
        // the RSVP buttons above - overlay a real transparent input/textarea
        // (borrowing the placeholder text's own words) instead of touching
        // the decorative children.
        var groupRole = ZeDocCore.guestRole(node);
        var wishInputRole = groupRole && groupRole.role === 'wish-input' ? groupRole.arg : null;
        if (wishInputRole) {
          var isTextarea = wishInputRole === 'wish-message';
          var placeholderNode = node.children.filter(function (c) { return c.type === 'text'; })[0];
          var placeholderText = placeholderNode ? resolveText(placeholderNode, ctx) : '';
          var inputTag = isTextarea ? 'textarea' : 'input';
          // the input types in the placeholder text's own font/size, not the
          // browser default (a bare <input> would fall back to Times 16px)
          var inputType = placeholderNode ? {
            fontFamily: resolveFont(placeholderNode.style.font, ctx.theme),
            fontSize: px(resolveTextStyle(placeholderNode, ctx).size),
            fontWeight: resolveTextStyle(placeholderNode, ctx).weight
          } : { font: 'inherit' };
          // wrapStyle already provides position:absolute. It is also the
          // containing block for the transparent input overlay; overriding it
          // with position:relative makes this group participate in flow and
          // overlap the submit button below it.
          view.children = ZeDocCore.childViews(node.children.filter(function (c) { return c.type !== 'text'; }), gctx, o.path).concat([{
            raw: '<' + inputTag + (isTextarea ? '' : ' type="text"') + ' id="zd2-' + wishInputRole + '"' +
              ' placeholder="' + escapeHtml(placeholderText) + '" style="' + styleStr(Object.assign({
                position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none', background: 'transparent',
                outline: 'none', color: ctx.theme.palette.ink, padding: px(14), resize: 'none', boxSizing: 'border-box'
              }, inputType)) + '"></' + inputTag + '>'
          }]);
          return;
        }

        var role = groupRole ? groupRole.role : undefined;

        // "Video placeholder" - a permanently-visible "YouTube video embed"
        // pill - a real <iframe> replaces the decorative placeholder once
        // link_video_youtube parses to an actual video id, otherwise it falls
        // through to the normal (placeholder) rendering.
        if (role === 'video-embed') {
          var ytEmbed = youTubeEmbedUrl(linkVal(ctx, 'link_video_youtube'));
          if (ytEmbed) {
            view.children = [{
              raw: '<iframe src="' + escapeHtml(ytEmbed) + '" title="Video" style="width:100%;height:100%;border:0"' +
                ' allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>'
            }];
            return;
          }
        }

        // "Copy button" (inside the Envelope repeat, one per bank account) -
        // copies this item's own account number to the clipboard and shows
        // a zd2Toast() confirmation (handDrawnRsvpWishScript below).
        if (role === 'copy-button' && ctx.repeatItem) {
          view.attrs = { 'data-zd2-copy-btn': true, 'data-zd2-copy-value': ctx.repeatItem.no_rekening || '' };
          view.style = Object.assign({}, wrapStyle, { cursor: 'pointer' });
          view.children = ZeDocCore.childViews(node.children, gctx, o.path);
          return;
        }

        var overlays = eventButtonLinkOverlaysHtml(node, ctx);

        // "RSVP submit button"/"Wish submit button"/"WhatsApp button"/"Join
        // button" - the same hand-drawn convention, matched purely by name
        // (ZeDocCore.GUEST_ROLES) since none of the catalog
        // templates use the drag-in `rsvp`/`wishes`/`sendGift` Block components
        // these buttons would otherwise come from (see BLOCK_RENDERERS below).
        function plainChildren() {
          var kids = ZeDocCore.childViews(node.children, gctx, o.path);
          if (overlays) kids.push({ raw: overlays });
          return kids;
        }
        if (role === 'rsvp-submit' || role === 'wish-submit') {
          view.attrs = { id: 'zd2-' + role };
          view.style = Object.assign({}, wrapStyle, { cursor: 'pointer' });
          view.children = plainChildren();
          return;
        }
        if (role === 'wa-button' || role === 'live-stream-join') {
          var groupHref = linkVal(ctx, role === 'wa-button' ? 'link_konfirmasi_wa' : 'link_live_streaming');
          if (groupHref) {
            return {
              tag: 'a',
              attrs: { href: groupHref, target: '_blank', rel: 'noopener' },
              style: Object.assign({}, wrapStyle, { display: 'block', textDecoration: 'none' }),
              children: plainChildren()
            };
          }
        }

        // anything else: any event link overlays go inside the (possibly
        // cropping) container the core already built
        if (overlays) {
          var host = node.clip ? view.children[0] : view;
          host.children.push({ raw: overlays });
        }
        return;
      }
    }
  }

  // The guest page draws through ZeDocCore.nodeView with decorateNode layered on.
  function renderNode(node, ctx, yOverride, heightGrow) {
    var view = ZeDocCore.nodeView(node, ctx, { y: yOverride, heightGrow: heightGrow });
    if (view && view.fragment) applyMotion(node, view); // a repeat is not decorated
    return view ? ZeDocCore.toHtml(view) : '';
  }

  // ponytail: a repeat node's declared frame.h is one item's height; extra
  // items (a couple with 3 events instead of the 2 the design assumed) push
  // every later top-level sibling down by (count-1)*itemHeight. This only
  // walks the artboard's own top-level node list, not nodes nested inside a
  // group — good enough while repeats stay top-level in hand-authored docs;
  // upgrade path is a real flow-layout pass if that stops being true.
  // ponytail: a top-level shape node named "<Something> background" (the
  // convention every generator script in scripts/zedoc-builder/ follows for
  // a section's full-bleed color fill) auto-grows to absorb whatever shift
  // accumulates from repeats that fall WITHIN its own authored (baseline,
  // pre-shift) y-span — otherwise a background sized for the 1-item
  // baseline falls short the moment a section's repeat has 2+ real items,
  // and whatever comes after it in that same section renders on the wrong
  // color. Deliberately scoped to the shape's own baseline [y, y+h) rather
  // than "grow until the next background shape (or end of document)": most
  // sections share the artboard's default background and never get an
  // explicit shape at all, so the naive version let one early background
  // silently swallow every later section's repeats too, all the way to
  // whichever explicit background (if any) happened to come next — see the
  // ZeDocument-native template plan's session log for how that surfaced
  // (Evergreen/Whimsical Love's dark countdown block over-growing across
  // everything after it). Matched by name suffix, not node id, since id is
  // an opaque per-generation string; upgrade path if that ever collides
  // with a legitimately-named non-background shape is an explicit flag.
  // ponytail: shift and background-growth are both purely a function of a
  // node's own baseline Y, computed against the sorted list of repeats -
  // NOT a left-to-right pass over the `nodes` array in array order. A
  // single array pass silently assumed the array itself was authored in
  // increasing-Y order (true for every hand-written zedoc-builder script),
  // but Ze Designer's own "add object" always appends to the array's end
  // regardless of where the couple drops or repositions it on the canvas -
  // found live when an object added mid-document (Y well before the
  // array's later repeats) rendered thousands of pixels too low, shifted
  // by every repeat's contribution that happened to sit earlier in the
  // array even though it sits LATER on the page.
  // ze-designer wraps a locked catalog section's whole node list into one
  // top-level group (frame at the artboard's own origin) so the section
  // selects/resizes as a single block on canvas while its pieces stay
  // unreachable to per-node clicks - see NodeContent.tsx's group case there.
  // Unwrapping it here before reflow/render keeps this output byte-identical
  // to the pre-group flat-node-list days: reflow needs the real top-level
  // repeat/background nodes to compute section height, and a group's frame
  // sitting at (0,0) means its children's coordinates are already in
  // artboard space, so unwrapping loses no information.
  function wrappingBlock(nodes) {
    if (nodes.length === 1 && nodes[0].type === 'group' && nodes[0].frame.x === 0 && nodes[0].frame.y === 0) {
      return nodes[0];
    }
    return null;
  }

  function unwrapBlock(nodes) {
    var block = wrappingBlock(nodes);
    return block ? block.children : nodes;
  }

  // theme.fonts.display/body (and a style override copied from one of them)
  // are full CSS font-family stacks - '"Cormorant Garamond", Georgia, serif' -
  // not bare names, since they're used directly as a CSS `font-family` value
  // elsewhere (resolveFont). Only the first, primary entry is ever a real
  // Google Font; the rest are generic/system fallbacks that would 404 a
  // Google Fonts request. A bare name (every per-node custom font, and any
  // family picked from GroupStyle.tsx's dropdown) passes through unchanged.
  function primaryFamily(value) {
    if (!value) return null;
    var first = value.split(',')[0].trim();
    return first.replace(/^['"]|['"]$/g, '');
  }

  // Port of collectStyleOverrideFamilies + the custom-font half of
  // collectCustomFontSpecs (ze-designer's src/doc/fonts.ts): every family
  // named anywhere in the document, deduped. Walks group/repeat children too
  // since a section's real content sits one level below the wrapping group
  // (see unwrapBlock) or inside a repeat's item template.
  function collectFontFamilies(doc) {
    var seen = {};
    var families = [];
    function add(name) {
      name = primaryFamily(name);
      if (name && !seen[name]) { seen[name] = true; families.push(name); }
    }
    function walkNodes(nodes) {
      nodes.forEach(function (node) {
        if (node.type === 'text' && node.style.font.kind === 'custom') add(node.style.font.family);
        if (node.type === 'group' || node.type === 'repeat') {
          if (node.style && node.style.fonts) { add(node.style.fonts.display); add(node.style.fonts.body); }
          walkNodes(node.children);
        }
      });
    }
    add(doc.theme.fonts.display);
    add(doc.theme.fonts.body);
    doc.artboards.forEach(function (a) {
      if (a.style && a.style.fonts) { add(a.style.fonts.display); add(a.style.fonts.body); }
      walkNodes(a.nodes);
    });
    return families;
  }

  // Port of googleFontsHref (ze-designer's src/doc/fonts.ts): one Google
  // Fonts CSS2 stylesheet URL requesting every family found, generically -
  // not just a fixed handful of hand-picked ones - across a broad weight and
  // italic range so GroupStyle.tsx's bold/italic toggles and a group's own
  // `fontStyle` size/weight override always have something real to render
  // with. A family that isn't a real Google Font just 404s here harmlessly.
  function buildFontLinks(families) {
    if (families.length === 0) return '';
    var parts = families.map(function (family) {
      return 'family=' + encodeURIComponent(family).replace(/%20/g, '+') + ':ital,wght@0,300;0,400;0,500;0,600;0,700;1,400;1,700';
    });
    return '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?' + parts.join('&') + '&display=swap">';
  }

  /**
   * render(doc, data, opts) -> full HTML document string.
   *   opts.artboardRole : which artboard to render (default "invitation").
   *
   * A role can be spread across several artboards - each section its own
   * canvas in ze-designer (see docs/zedocument-architecture.md). They stack
   * flush in document order, same convention as ze-designer's own
   * `layoutArtboards()` (src/canvas/viewportMath.ts): each artboard's
   * reflow() runs independently against its own nodes, then the section is
   * offset down by every earlier section's height (including its own
   * reflow growth) - so one section's repeat never shifts another
   * section's layout, unlike a single-artboard doc's shared reflow pass.
   */
  // The wizard's on/off switches (`data.sections`, keyed like core.SECTIONS): a
  // section switched off (=== false; absent or true = shown) is not drawn, and the
  // opening gate goes with 'opening-overlay'. The exception is 'send-gift': turning
  // gifts down is a message to the guests, not an omission, so that section is
  // replaced by the couple's decline text (the same two fields and fallback wording
  // the .dc.html engine used - one text when the envelope is off too, another when
  // only physical gifts are declined).
  var NO_GIFT_MESSAGE = 'Kehadiran dan doa restu Bapak/Ibu/Saudara/i adalah hadiah yang paling berarti bagi kami.';
  var NO_PHYSICAL_GIFT_MESSAGE = 'Kehadiran dan doa restu Bapak/Ibu/Saudara/i merupakan kebahagiaan yang sangat berarti bagi kami. ' +
    'Dengan segala hormat, kami mohon untuk tidak memberikan bingkisan, kado, ataupun karangan bunga.';

  function giftDeclinedArtboard(artboard, data) {
    var fields = data.fields || {};
    var envelopeOff = (data.sections || {}).envelope === false;
    var message = envelopeOff ? (fields.teks_pesan_tanpa_kado || NO_GIFT_MESSAGE) : (fields.teks_pesan_tanpa_kado_fisik || NO_PHYSICAL_GIFT_MESSAGE);
    var width = 320;
    var node = {
      id: 'zd-gift-declined', name: 'Gift declined message', type: 'text',
      frame: { x: Math.round((artboard.size.w - width) / 2), y: 64, w: width, h: 96, rotate: 0, flipX: false, flipY: false },
      opacity: 0.9, visible: true, locked: false, text: message,
      style: { font: { kind: 'token', token: 'body' }, size: 15, weight: 400, lineHeight: 1.7, letterSpacing: 0, align: 'center', color: { kind: 'token', token: 'ink' }, italic: false, underline: false, transform: 'none' }
    };
    // the text flow grows the box if the couple's message runs longer
    return Object.assign({}, artboard, { nodes: [node], size: { w: artboard.size.w, h: 224 } });
  }

  function render(doc, data, opts) {
    opts = opts || {};
    motionUsed = { any: false, reveal: false, presets: {} };
    data = data || {};
    data.fields = data.fields || {};
    data.images = data.images || {};
    data.links = data.links || {};
    data.audio = data.audio || {};
    // Guest name arrives as a top-level `data.guestName` (viewer.html reads
    // it from the RSVP link/`?to=` param) - fold it into the fields bucket
    // so a plain {binding:{key:'guest_name'}} text node resolves through
    // the same resolveText()/bucketFor() path as any other field, no
    // special-cased resolution needed.
    data.fields.guest_name = data.fields.guest_name || data.guestName || undefined;

    // Display order only - couple[0]/[1] are always stored as groom/bride
    // (the wizard's Data Mempelai step edits them by that fixed position),
    // "wanita-dulu" just swaps which one the couple repeat node sees first.
    // Reassigns the local `data` var to a fresh shallow copy rather than
    // mutating data.couple in place, since data here is the caller's own
    // object (e.g. the wizard's live `inv`) and must come back unchanged.
    if (Array.isArray(data.couple) && data.couple.length === 2 && data.fields.urutan_mempelai === 'wanita-dulu') {
      data = Object.assign({}, data, { couple: [data.couple[1], data.couple[0]] });
    }

    var role = opts.artboardRole || 'invitation';
    var artboards = doc.artboards.filter(function (a) { return a.role === role; });
    if (artboards.length === 0) artboards = doc.artboards.slice(0, 1);
    var ctx = { theme: doc.theme, data: data, assets: doc.assets || [], mode: 'guest', decorate: decorateNode };

    // A section's ctx swaps in its own merged theme (mergeTheme) so its
    // colours/fonts pick up ArtboardStyle.tsx's override (section.style) and,
    // for a catalog section whose nodes were wrapped into one block-group on
    // import (see unwrapBlock above), GroupStyle.tsx's override on that group
    // too - reflow/render only ever see the group's unwrapped children (never
    // the group node itself), so this is the one place that style is read.
    // Every other section keeps sharing the plain document-theme `ctx` above.
    function ctxFor(section) {
      var block = wrappingBlock(section.nodes);
      var theme = doc.theme;
      var fontStyleOverride = null;
      if (section.style) {
        theme = mergeTheme(theme, section.style);
        fontStyleOverride = mergeFontStyleOverride(fontStyleOverride, section.style.fontStyle);
      }
      if (block && block.style) {
        theme = mergeTheme(theme, block.style);
        fontStyleOverride = mergeFontStyleOverride(fontStyleOverride, block.style.fontStyle);
      }
      if (theme === doc.theme && !fontStyleOverride) return ctx;
      return { theme: theme, data: data, assets: ctx.assets, mode: 'guest', decorate: decorateNode, fontStyleOverride: fontStyleOverride };
    }

    var stageWidth = artboards[0].size.w;
    var switches = data.sections || {};
    var shown = [];
    artboards.forEach(function (artboard) {
      var key = ZeDocCore.sectionOf(artboard);
      if (key === 'send-gift' && switches[key] === false) shown.push(giftDeclinedArtboard(artboard, data));
      else if (!(key && switches[key] === false)) shown.push(artboard);
    });
    var bodyHtml = '';
    var cursorY = 0;
    for (var s = 0; s < shown.length; s++) {
      var section = shown[s];
      var sectionCtx = ctxFor(section);
      var sectionLaid = reflowNodes(unwrapBlock(section.nodes), data);
      var sectionHeight = section.size.h + sectionLaid.extra;
      var sectionBodyHtml = sectionLaid.items.map(function (entry, i) { return renderNode(entry.node, sectionCtx, entry.y, sectionLaid.bgHeightGrow[i]); }).join('');
      var sectionBgStyle = styleStr(resolveFill(section.background, sectionCtx));
      bodyHtml += '<div data-zd-section-index="' + s + '" data-zd-base-height="' + px(sectionHeight) + '" style="' + styleStr({ position: 'absolute', top: px(cursorY), left: 0, width: px(section.size.w), height: px(sectionHeight) }) + sectionBgStyle + '">' + sectionBodyHtml + '</div>';
      cursorY += sectionHeight;
    }
    var totalHeight = cursorY;

    // The opening-overlay tap-to-open gate: an `envelope`-role artboard with
    // content renders as a second, fixed full-viewport stage on top of the
    // invitation stage above. Absent/empty envelope artboard (every
    // template/document that hasn't authored one) -> gateHtml/gateScript
    // are both '', output is byte-identical to before this existed.
    var envelope = doc.artboards.filter(function (a) { return a.role === 'envelope'; })[0];
    var gateHtml = '', gateScript = '';
    if (envelope && envelope.nodes.length > 0 && switches['opening-overlay'] !== false) {
      var envelopeCtx = ctxFor(envelope);
      var gateLaid = reflowNodes(unwrapBlock(envelope.nodes), data);
      var gateBodyHtml = gateLaid.items.map(function (entry, i) { return renderNode(entry.node, envelopeCtx, entry.y, gateLaid.bgHeightGrow[i]); }).join('');
      var gateTotalHeight = envelope.size.h + gateLaid.extra;
      var gateBgStyle = styleStr(resolveFill(envelope.background, envelopeCtx));
      gateHtml = '<div id="zd-gate" style="' + styleStr({ position: 'fixed', inset: 0, zIndex: 1000, overflow: 'hidden', cursor: 'pointer' }) + gateBgStyle +
        'transition:opacity 1.1s ease, visibility 1.1s ease" onclick="' +
        'this.style.opacity=0;this.style.visibility=\'hidden\';this.style.pointerEvents=\'none\'' +
        // animations behind the gate wait for it to open (zdMotionStart below)
        (motionUsed.any ? ';window.zdMotionStart&&window.zdMotionStart()' : '') + '">' +
        '<div id="zd-gate-stage" style="' + styleStr({ position: 'absolute', top: 0, left: 0, width: px(envelope.size.w), height: px(gateTotalHeight) }) + gateBgStyle + '">' +
        gateBodyHtml +
        '</div></div>';
      gateScript = 'var GW=' + envelope.size.w + ',GH=' + gateTotalHeight + ',gateStage=document.getElementById("zd-gate-stage");' +
        // min(...,innerHeight/GH) too (not just width, unlike the invitation
        // stage's own fit()) - the gate is a fixed, non-scrolling overlay, so
        // content taller than the viewport must shrink to fit or it's simply
        // clipped with no way to scroll to the rest.
        'function fitGate(){var s=Math.min(1,window.innerWidth/GW,window.innerHeight/GH);gateStage.style.transform="scale("+s+")";gateStage.style.transformOrigin="top left";gateStage.style.left=Math.max(0,(window.innerWidth-GW*s)/2)+"px";gateStage.style.top=Math.max(0,(window.innerHeight-GH*s)/2)+"px";}' +
        'window.addEventListener("resize",fitGate);fitGate();';
    }

    // Every font family actually used anywhere in the doc - the theme's own
    // two, any section's own style.fonts override (Artboard.style/a group's
    // style - ArtboardStyle.tsx/GroupStyle.tsx), and every per-node `custom`
    // font - requested generically from Google Fonts, not just the fixed
    // handful this used to hardcode (ported from ze-designer's own
    // googleFontsHref, src/doc/fonts.ts). A family that isn't a real Google
    // Font just 404s here harmlessly, same risk profile as before.
    var fontFamilies = collectFontFamilies(doc);

    // Ticks every data-zd-cd-unit digit (countdownBlockHtml and
    // decorateText's 'Countdown number N' override both stamp these,
    // reading target/unit straight off the element so no shell/grouping is
    // needed here - a no-op querySelectorAll when a doc has no countdown).
    var countdownScript = 'var cdEls=document.querySelectorAll("[data-zd-cd-unit]");' +
      'if(cdEls.length){var cdTick=function(){cdEls.forEach(function(el){' +
      'var t=new Date(el.getAttribute("data-zd-cd-target")).getTime();if(isNaN(t))return;' +
      'var r=Math.max(0,t-Date.now());var u=el.getAttribute("data-zd-cd-unit");' +
      'var v=u==="d"?Math.floor(r/86400000):u==="h"?Math.floor(r/3600000)%24:u==="m"?Math.floor(r/60000)%60:Math.floor(r/1000)%60;' +
      'el.textContent=String(v).padStart(2,"0");});};cdTick();setInterval(cdTick,1000);}';

    // Text nodes are authored with fixed pixel frames, but invitation data can
    // contain much longer copy than the catalog sample. Repeat reflow alone
    // cannot see that, so once the real fonts have loaded this measures every
    // text node and lets ZeDocCore.flowBoxes (the same function the designer
    // canvas uses - its source is inlined below) decide what grows and what
    // shifts. This script is only the DOM adapter: it turns the section's
    // elements into boxes, and writes the resulting tops/heights back.
    var textReflowScript = '(function(){' +
      ZeDocCore.flowBoxes.toString() + ';' +
      // boxesOf reads the authored (pre-flow) geometry off the elements once,
      // into data-zd-flow-* attributes, so every later run starts from the
      // same baseline instead of compounding its own previous result.
      'function baseAttr(el,name,read){var v=el.getAttribute(name);if(v===null){v=String(read());el.setAttribute(name,v);}return parseFloat(v)||0;}' +
      'function boxesOf(container){' +
      'return Array.prototype.map.call(container.children,function(el){' +
      'var box={el:el,top:baseAttr(el,"data-zd-flow-base-top",function(){return parseFloat(el.style.top)||0;}),left:parseFloat(el.style.left)||0,width:parseFloat(el.style.width)||0};' +
      'if(el.hasAttribute("data-zd-text-node")){' +
      'box.height=parseFloat(el.getAttribute("data-zd-base-height"))||0;' +
      // Measure the text's layout height: its own box with the height released
      // (offsetHeight = the wrapped lines at their line-height). Not scrollHeight -
      // that also counts a font's tall glyph metrics overflowing the line box, so
      // a one-line script-font digit read as 19px "taller" than it really is. The
      // wrapper goes back to its authored height first so an earlier run (before
      // the fonts loaded) cannot stick as this text's height.
      'el.style.height=box.height+"px";' +
      'var inner=el.firstElementChild;' +
      'if(inner){var prevH=inner.style.height;inner.style.height="auto";box.textHeight=inner.offsetHeight;inner.style.height=prevH;}else box.textHeight=box.height;' +
      '}else{' +
      'box.height=baseAttr(el,"data-zd-flow-base-h",function(){return parseFloat(el.style.height)||0;});' +
      'box.stretch=el.hasAttribute("data-zd-flow-bg");' +
      'if(el.querySelector("[data-zd-text-node]"))box.children=boxesOf(el);' +
      '}' +
      'return box;});' +
      '}' +
      'function apply(boxes){' +
      'boxes.forEach(function(box){' +
      'box.el.style.top=box.y+"px";' +
      // an inset:0 clip wrapper has no authored height to grow
      'if(box.height>0)box.el.style.height=box.h+"px";' +
      'if(box.children)apply(box.children);' +
      '});' +
      '}' +
      'function run(){' +
      'var sections=Array.prototype.slice.call(document.querySelectorAll("[data-zd-section-index]"));' +
      'if(!sections.length)return;' +
      'var cursor=0;' +
      'sections.forEach(function(section){' +
      'var boxes=boxesOf(section);' +
      'var flowed=flowBoxes(boxes);' +
      'apply(boxes);' +
      'var height=Math.max(parseFloat(section.getAttribute("data-zd-base-height"))||0,flowed.bottom);' +
      'section.style.height=height+"px";' +
      'section.style.top=cursor+"px";' +
      'cursor+=height;' +
      '});' +
      'var stage=document.getElementById("zd-stage"),wrap=document.getElementById("zd-wrap");' +
      'if(stage)stage.style.height=cursor+"px";' +
      'if(wrap&&stage){var scale=Math.min(1,window.innerWidth/stage.offsetWidth);wrap.style.height=(cursor*scale)+"px";}' +
      '}' +
      'if(document.fonts&&document.fonts.ready)document.fonts.ready.then(run);' +
      'window.addEventListener("load",run);' +
      'window.addEventListener("resize",run);' +
      'setTimeout(run,0);setTimeout(run,500);' +
      '})();';

    // Fullscreen photo viewer for every [data-zd-gallery-src] image
    // (ZeDocCore.imageView's gallery-repeat case and galleryBlockHtml both stamp
    // that attribute) - one delegated click listener rather than a
    // per-photo inline handler, same "no per-item JS" spirit as the rest of
    // this file's vanilla-JS conventions.
    var lightboxBtnStyle = styleStr({ position: 'fixed', top: '50%', transform: 'translateY(-50%)', background: 'rgba(255,255,255,.15)', color: '#fff', border: 'none', borderRadius: '999px', width: px(40), height: px(40), fontSize: px(22), lineHeight: px(40), textAlign: 'center', cursor: 'pointer' });
    var lightboxHtml = '<div id="zd-lightbox" style="' + styleStr({ position: 'fixed', inset: 0, zIndex: 1500, display: 'none', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.92)' }) + '">' +
      '<img id="zd-lightbox-img" style="' + styleStr({ maxWidth: '92vw', maxHeight: '92vh', objectFit: 'contain', display: 'block' }) + '" draggable="false">' +
      '<button id="zd-lightbox-prev" style="' + lightboxBtnStyle + 'left:12px">&#8249;</button>' +
      '<button id="zd-lightbox-next" style="' + lightboxBtnStyle + 'right:12px">&#8250;</button>' +
      '<button id="zd-lightbox-close" style="' + styleStr({ position: 'fixed', top: '12px', right: '12px', background: 'rgba(255,255,255,.15)', color: '#fff', border: 'none', borderRadius: '999px', width: px(34), height: px(34), fontSize: px(18), lineHeight: px(34), textAlign: 'center', cursor: 'pointer' }) + '">&times;</button>' +
      '</div>';
    var lightboxScript = '(function(){' +
      'var srcs=[],lb=document.getElementById("zd-lightbox"),img=document.getElementById("zd-lightbox-img"),idx=0;' +
      'function collect(){srcs=Array.prototype.map.call(document.querySelectorAll("[data-zd-gallery-src]"),function(el){return el.getAttribute("data-zd-gallery-src");});}' +
      'function openAt(i){if(!srcs.length)return;idx=(i+srcs.length)%srcs.length;img.src=srcs[idx];lb.style.display="flex";}' +
      'function close(){lb.style.display="none";}' +
      'document.addEventListener("click",function(e){' +
      'var t=e.target.closest&&e.target.closest("[data-zd-gallery-src]");' +
      'if(t){collect();openAt(srcs.indexOf(t.getAttribute("data-zd-gallery-src")));return;}' +
      'if(e.target.id==="zd-lightbox-close"||e.target===lb){close();return;}' +
      'if(e.target.id==="zd-lightbox-prev"){openAt(idx-1);return;}' +
      'if(e.target.id==="zd-lightbox-next"){openAt(idx+1);}' +
      '});' +
      'document.addEventListener("keydown",function(e){if(lb.style.display!=="flex")return;if(e.key==="Escape")close();if(e.key==="ArrowLeft")openAt(idx-1);if(e.key==="ArrowRight")openAt(idx+1);});' +
      '})();';

    // RSVP attendance toggle/submit + wish submit, both against the same
    // backend endpoints assets/engine.js's own .dc.html components use
    // (PUT .../guests/:id/rsvp, POST .../wishes) - a no-op querySelector
    // wiring when a doc has neither block, same convention as the scripts
    // above. zdEsc() escapes text before it's stitched into innerHTML for a
    // freshly-submitted wish, since that text just came from a guest.
    var rsvpWishScript = '(function(){' +
      'function zdEsc(s){var d=document.createElement("div");d.textContent=s==null?"":String(s);return d.innerHTML;}' +
      'document.addEventListener("click",function(e){' +
      'var attendBtn=e.target.closest&&e.target.closest("[data-zd-attend-btn]");' +
      'if(attendBtn){' +
      'var card=attendBtn.closest("[data-zd-rsvp-card]");if(!card)return;' +
      'Array.prototype.forEach.call(card.querySelectorAll("[data-zd-attend-btn]"),function(b){' +
      'var sel=b===attendBtn;b.setAttribute("data-zd-selected",sel?"1":"0");' +
      'b.style.background=b.getAttribute(sel?"data-zd-bg-on":"data-zd-bg-off");' +
      'b.style.color=b.getAttribute(sel?"data-zd-color-on":"data-zd-color-off");' +
      'b.style.borderColor=b.getAttribute(sel?"data-zd-border-on":"data-zd-border-off");});' +
      'var counts=card.querySelector("[data-zd-counts]");' +
      'if(counts)counts.style.display=attendBtn.getAttribute("data-zd-attend")==="yes"?"flex":"none";' +
      'return;}' +
      'if(e.target.closest&&e.target.closest("#zd-rsvp-submit")){' +
      'var root=document.querySelector("[data-zd-rsvp-slug]");' +
      'var slug=root?root.getAttribute("data-zd-rsvp-slug"):"",guestId=root?root.getAttribute("data-zd-rsvp-guest"):"";' +
      'var status=document.getElementById("zd-rsvp-status");' +
      'if(!slug||!guestId){if(status)status.textContent="Buka undangan lewat tautan pribadi Anda untuk mengonfirmasi kehadiran.";return;}' +
      'var payload={};' +
      'Array.prototype.forEach.call(document.querySelectorAll("[data-zd-rsvp-card]"),function(cd){' +
      'if(cd.getAttribute("data-zd-show-inputs")!=="1")return;' +
      'var name=cd.getAttribute("data-zd-rsvp-card");' +
      'var sel=cd.querySelector("[data-zd-attend-btn][data-zd-selected=\\"1\\"]");' +
      'var attending=!sel||sel.getAttribute("data-zd-attend")==="yes";' +
      'if(!attending){payload[name]={dewasa:0,anak:0};return;}' +
      'var dw=cd.querySelector("[data-zd-rsvp-dewasa]"),an=cd.querySelector("[data-zd-rsvp-anak]");' +
      'payload[name]={dewasa:Math.max(0,parseInt(dw&&dw.value,10)||0),anak:Math.max(0,parseInt(an&&an.value,10)||0)};});' +
      'if(status)status.textContent="Mengirim...";' +
      'fetch("/api/invitations/"+encodeURIComponent(slug)+"/guests/"+encodeURIComponent(guestId)+"/rsvp",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({event_rsvp:payload})})' +
      '.then(function(r){if(status)status.textContent=r.ok?"Terima kasih, konfirmasi Anda telah kami catat.":"Gagal mengirim konfirmasi, coba lagi.";})' +
      '.catch(function(){if(status)status.textContent="Gagal mengirim konfirmasi, periksa koneksi Anda.";});' +
      'return;}' +
      'if(e.target.closest&&e.target.closest("#zd-wish-submit")){' +
      'var wroot=document.querySelector("[data-zd-wish-slug]");' +
      'var wslug=wroot?wroot.getAttribute("data-zd-wish-slug"):"";' +
      'var wstatus=document.getElementById("zd-wish-status");' +
      'var msgEl=document.getElementById("zd-wish-message"),nameEl=document.getElementById("zd-wish-name");' +
      'var message=msgEl?msgEl.value.trim():"";' +
      'var name=(nameEl?nameEl.value.trim():"")||"Tamu Undangan";' +
      'if(!message){if(wstatus)wstatus.textContent="Tuliskan ucapan Anda terlebih dahulu.";return;}' +
      'if(!wslug){if(wstatus)wstatus.textContent="Ucapan tidak dapat dikirim dari pratinjau ini.";return;}' +
      'if(wstatus)wstatus.textContent="Mengirim...";' +
      'fetch("/api/invitations/"+encodeURIComponent(wslug)+"/wishes",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:name,message:message})})' +
      '.then(function(r){' +
      'if(!r.ok){if(wstatus)wstatus.textContent=r.status===429?"Anda sudah mencapai batas 3 ucapan & doa.":"Gagal mengirim ucapan, coba lagi.";return;}' +
      'var list=document.getElementById("zd-wishes-list");' +
      'if(list){var item=document.createElement("div");' +
      'item.setAttribute("style",list.getAttribute("data-zd-item-style")||"");' +
      'item.innerHTML="<div style=\\""+(list.getAttribute("data-zd-head-style")||"")+"\\"><span style=\\""+(list.getAttribute("data-zd-name-style")||"")+"\\">"+zdEsc(name)+"</span><span style=\\""+(list.getAttribute("data-zd-time-style")||"")+"\\">Baru saja</span></div><div style=\\""+(list.getAttribute("data-zd-caption-style")||"")+"\\">"+zdEsc(message)+"</div>";' +
      'list.insertBefore(item,list.firstChild);}' +
      'if(msgEl)msgEl.value="";' +
      'if(wstatus)wstatus.textContent="Terima kasih atas doa dan ucapannya!";})' +
      '.catch(function(){if(wstatus)wstatus.textContent="Gagal mengirim ucapan, periksa koneksi Anda.";});' +
      '}});' +
      '})();';

    // Same RSVP/wish submission as rsvpWishScript above, but for the
    // hand-drawn catalog templates' zd2-* hooks (decorateNode's 'shape'/
    // 'group' cases and decorateText's 'attend-label' role).
    // slug/guestId live on <body> (data-zd2-slug/-guest-id below) since,
    // unlike the Block-based form, there's no single hand-drawn node to
    // carry them. Status feedback is the zd2Toast() below, not an inline
    // message line - the hand-drawn templates have no spare decorative node
    // to repurpose as one; upgrade path is picking one more name to match on.
    var handDrawnRsvpWishScript = '(function(){' +
      'function fallbackCopy(text){var ta=document.createElement("textarea");ta.value=text;ta.style.position="fixed";ta.style.opacity="0";document.body.appendChild(ta);ta.select();try{document.execCommand("copy");}catch(e){}document.body.removeChild(ta);}' +
      // A real, in-page toast instead of alert() - many guests open this
      // link inside WhatsApp/Instagram's in-app browser, which routinely
      // suppresses window.alert() outright (a click that silently does
      // nothing is exactly what that looks like from the guest's side, even
      // though the fetch itself succeeded).
      'function zd2Toast(msg){var el=document.getElementById("zd2-toast");if(!el){el=document.createElement("div");el.id="zd2-toast";' +
      'el.style.cssText="position:fixed;left:50%;bottom:24px;transform:translateX(-50%);max-width:88vw;background:#2b2b28;color:#fff;padding:11px 18px;border-radius:8px;font:13px/1.4 -apple-system,BlinkMacSystemFont,sans-serif;z-index:2147483647;box-shadow:0 4px 18px rgba(0,0,0,.28);text-align:center;transition:opacity .25s ease";' +
      'document.body.appendChild(el);}el.textContent=msg;el.style.opacity="1";clearTimeout(el._zd2Timer);el._zd2Timer=setTimeout(function(){el.style.opacity="0";},3000);}' +
      'document.addEventListener("click",function(e){' +
      // "+ Kalender" dropdown: close every open menu that isn't the one
      // being clicked into/inside (so opening a second event's dropdown, or
      // clicking anywhere else on the page, closes the first), then toggle
      // the clicked wrap's own menu. A click on a menu item (the .ics/gcal
      // <a> itself) isn't the toggle div, so it falls through here with its
      // default navigation/download intact.
      'var calToggle=e.target.closest&&e.target.closest("[data-zd2-cal-toggle]");' +
      'var calWrap=e.target.closest&&e.target.closest("[data-zd2-cal-wrap]");' +
      'Array.prototype.forEach.call(document.querySelectorAll("[data-zd2-cal-menu]"),function(m){' +
      'if(!calWrap||m.parentElement!==calWrap)m.style.display="none";});' +
      'if(calToggle){var menu=calToggle.nextElementSibling;if(menu)menu.style.display=menu.style.display==="block"?"none":"block";return;}' +
      'var copyBtn=e.target.closest&&e.target.closest("[data-zd2-copy-btn]");' +
      'if(copyBtn){' +
      'var value=copyBtn.getAttribute("data-zd2-copy-value")||"";' +
      'if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(value).catch(function(){fallbackCopy(value);});}else{fallbackCopy(value);}' +
      'zd2Toast("Nomor rekening disalin!");' +
      'return;}' +
      'var t=e.target.closest&&e.target.closest("[data-zd2-attend]");' +
      'if(t){' +
      'var evName=t.getAttribute("data-zd2-event"),attend=t.getAttribute("data-zd2-attend");' +
      'Array.prototype.forEach.call(document.querySelectorAll("[data-zd2-event]"),function(el){' +
      'if(el.getAttribute("data-zd2-event")!==evName)return;' +
      'var sel=el.getAttribute("data-zd2-attend")===attend;' +
      'el.setAttribute("data-zd2-selected",sel?"1":"0");' +
      'if(el.hasAttribute("data-zd2-style-on")){el.firstElementChild.style.cssText=el.getAttribute(sel?"data-zd2-style-on":"data-zd2-style-off");}' +
      'else if(el.hasAttribute("data-zd2-color-on")){el.style.color=el.getAttribute(sel?"data-zd2-color-on":"data-zd2-color-off");}' +
      '});return;}' +
      'if(e.target.closest&&e.target.closest("#zd2-rsvp-submit")){' +
      'var slug=document.body.getAttribute("data-zd2-slug")||"",guestId=document.body.getAttribute("data-zd2-guest-id")||"";' +
      'if(!slug||!guestId){zd2Toast("Buka undangan lewat tautan pribadi Anda untuk mengonfirmasi kehadiran.");return;}' +
      'var payload={},seen={};' +
      'Array.prototype.forEach.call(document.querySelectorAll("[data-zd2-attend][data-zd2-selected=\\"1\\"]"),function(el){' +
      'var ev=el.getAttribute("data-zd2-event");if(!ev||seen[ev])return;seen[ev]=1;' +
      'var attending=el.getAttribute("data-zd2-attend")==="yes";' +
      'payload[ev]=attending?{dewasa:1,anak:0}:{dewasa:0,anak:0};});' +
      'zd2Toast("Mengirim...");' +
      'fetch("/api/invitations/"+encodeURIComponent(slug)+"/guests/"+encodeURIComponent(guestId)+"/rsvp",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({event_rsvp:payload})})' +
      '.then(function(r){zd2Toast(r.ok?"Terima kasih, konfirmasi Anda telah kami catat.":"Gagal mengirim konfirmasi, coba lagi.");})' +
      '.catch(function(){zd2Toast("Gagal mengirim konfirmasi, periksa koneksi Anda.");});' +
      'return;}' +
      'if(e.target.closest&&e.target.closest("#zd2-wish-submit")){' +
      'var wslug=document.body.getAttribute("data-zd2-slug")||"";' +
      'var nameEl=document.getElementById("zd2-wish-name"),msgEl=document.getElementById("zd2-wish-message");' +
      'var message=msgEl?msgEl.value.trim():"";' +
      'var name=(nameEl?nameEl.value.trim():"")||"Tamu Undangan";' +
      'if(!message){zd2Toast("Tuliskan ucapan Anda terlebih dahulu.");return;}' +
      'if(!wslug){zd2Toast("Ucapan tidak dapat dikirim dari pratinjau ini.");return;}' +
      'zd2Toast("Mengirim...");' +
      'fetch("/api/invitations/"+encodeURIComponent(wslug)+"/wishes",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:name,message:message})})' +
      '.then(function(r){' +
      'if(!r.ok){zd2Toast(r.status===429?"Anda sudah mencapai batas 3 ucapan & doa.":"Gagal mengirim ucapan, coba lagi.");return;}' +
      'zd2Toast("Terima kasih atas doa dan ucapannya!");setTimeout(function(){location.reload();},900);' +
      '})' +
      '.catch(function(){zd2Toast("Gagal mengirim ucapan, periksa koneksi Anda.");});' +
      '}});' +
      '})();';

    // Background music: the couple's uploaded MP3 (data.audio.background_music,
    // an R2 URL) loops behind the page, with the round play/pause button the
    // legacy templates had (bottom-right, a dashed ring spinning while it plays).
    // Nothing is emitted without a URL. It starts on the guest's first click/tap
    // - the envelope gate's click when there is one - never on load, since a
    // browser would block that and it must not sound before the invitation is
    // opened. A guest who paused it keeps it paused; a track that fails to load
    // hides the button.
    var musicUrl = data.audio && data.audio.background_music;
    var musicHtml = '', musicCss = '', musicScript = '';
    if (musicUrl) {
      var musicPalette = doc.theme.palette;
      var musicIcon = function (cls, path) {
        return '<svg class="' + cls + '" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style="position:relative">' + path + '</svg>';
      };
      musicHtml = '<audio id="zd-music" loop preload="none" src="' + escapeHtml(musicUrl) + '"></audio>' +
        '<button id="zd-music-btn" type="button" aria-label="Musik latar" style="' + styleStr({
          position: 'fixed', bottom: '24px', right: 'max(16px, calc(50% - ' + (stageWidth / 2) + 'px + 16px))', zIndex: 150,
          width: px(46), height: px(46), padding: 0, border: 'none', borderRadius: '50%', cursor: 'pointer',
          background: musicPalette.accent, color: musicPalette.accentInk, boxShadow: '0 4px 16px rgba(0,0,0,.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }) + '">' +
        '<svg class="zd-ring" width="56" height="56" viewBox="0 0 56 56" style="position:absolute;top:-5px;left:-5px;pointer-events:none"><circle cx="28" cy="28" r="26" fill="none" stroke="' + escapeHtml(musicPalette.accent) + '" stroke-width="1" stroke-dasharray="6 9" stroke-linecap="round"/></svg>' +
        musicIcon('zd-play', '<path d="M4 2.3v11.4c0 .8.88 1.28 1.55.85l9-5.7a1 1 0 0 0 0-1.7l-9-5.7C4.88 1.02 4 1.5 4 2.3z"/>') +
        musicIcon('zd-pause', '<rect x="3.5" y="2.3" width="3" height="11.4" rx="1"/><rect x="9.5" y="2.3" width="3" height="11.4" rx="1"/>') +
        '</button>';
      musicCss = '#zd-music-btn .zd-ring{opacity:0}#zd-music-btn[data-playing] .zd-ring{opacity:1;animation:zd-music-spin 2.4s linear infinite}' +
        '#zd-music-btn .zd-pause{display:none}#zd-music-btn[data-playing] .zd-play{display:none}#zd-music-btn[data-playing] .zd-pause{display:block}' +
        '@keyframes zd-music-spin{to{transform:rotate(360deg)}}@media (prefers-reduced-motion:reduce){#zd-music-btn .zd-ring{animation:none!important}}';
      musicScript = '(function(){var a=document.getElementById("zd-music"),b=document.getElementById("zd-music-btn");if(!a||!b)return;' +
        'var off=false;' +
        'function sync(){if(a.paused)b.removeAttribute("data-playing");else b.setAttribute("data-playing","1");}' +
        'function play(){var p=a.play();if(p&&p.catch)p.catch(function(){});}' +
        'a.addEventListener("play",sync);a.addEventListener("pause",sync);' +
        'a.addEventListener("error",function(){b.style.display="none";});' +
        'b.addEventListener("click",function(){if(a.paused){off=false;play();}else{off=true;a.pause();}});' +
        'function first(e){if(e.target.closest&&e.target.closest("#zd-music-btn"))return;' +
        'document.removeEventListener("click",first);document.removeEventListener("touchend",first);' +
        'if(!off&&a.paused)play();}' +
        'document.addEventListener("click",first);document.addEventListener("touchend",first);' +
        '})();';
    }

    // Node animations (ZeDocCore.motionStyle). The keyframes are only emitted
    // for presets the doc uses. While the gate is up the stage's animations are
    // held (body[data-zd-gated]); zdMotionStart releases them - on load with no
    // gate, on the gate's click otherwise - and only then starts watching the
    // `reveal` ones, so a section is not "revealed" behind the gate.
    var motionCss = '';
    var motionScript = '';
    if (motionUsed.any) {
      motionCss = Object.keys(motionUsed.presets).map(function (preset) { return ZeDocCore.MOTION_KEYFRAMES[preset]; }).join('') +
        'body[data-zd-gated] #zd-stage [data-zd-motion]{animation-play-state:paused!important}' +
        '@media (prefers-reduced-motion:reduce){[data-zd-motion]{animation:none!important}}';
      motionScript = '(function(){var started=false;' +
        'window.zdMotionStart=function(){if(started)return;started=true;' +
        'document.body.removeAttribute("data-zd-gated");' +
        'var els=Array.prototype.slice.call(document.querySelectorAll("[data-zd-motion=reveal]"));' +
        'function go(el){el.style.setProperty("--zd-rv","running");}' +
        'if(!("IntersectionObserver" in window)){els.forEach(go);return;}' +
        'var io=new IntersectionObserver(function(entries){entries.forEach(function(e){if(e.isIntersecting){go(e.target);io.unobserve(e.target);}});});' +
        'els.forEach(function(el){io.observe(el);});};' +
        'if(!document.body.hasAttribute("data-zd-gated"))window.zdMotionStart();' +
        '})();';
    }

    return '<!DOCTYPE html><html><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<link rel="preconnect" href="https://fonts.googleapis.com">' +
      '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
      buildFontLinks(fontFamilies) +
      '<style>*{box-sizing:border-box}body{margin:0;background:#e9e7d9}' + motionCss + musicCss + '</style>' +
      '</head><body' + (motionUsed.any && gateHtml ? ' data-zd-gated="1"' : '') + ' data-zd2-slug="' + escapeHtml(data.slug || '') + '" data-zd2-guest-id="' + escapeHtml(data.guestId || '') + '">' +
      '<div id="zd-wrap" style="position:relative;width:100%;overflow:hidden">' +
      '<div id="zd-stage" style="' + styleStr({ position: 'absolute', top: 0, left: 0, width: px(stageWidth), height: px(totalHeight) }) + '">' +
      bodyHtml +
      '</div></div>' +
      gateHtml +
      lightboxHtml +
      musicHtml +
      '<script>(function(){' +
      'var W=' + stageWidth + ',H=' + totalHeight + ';' +
      'var stage=document.getElementById("zd-stage"),wrap=document.getElementById("zd-wrap");' +
      'function fit(){var s=Math.min(1,window.innerWidth/W);stage.style.transform="scale("+s+")";stage.style.transformOrigin="top left";stage.style.left=Math.max(0,(window.innerWidth-W*s)/2)+"px";wrap.style.height=(H*s)+"px";}' +
      'window.addEventListener("resize",fit);fit();' +
      gateScript +
      countdownScript +
      '})();</script>' +
      '<script>' + textReflowScript + '</script>' +
      '<script>' + lightboxScript + '</script>' +
      '<script>' + rsvpWishScript + '</script>' +
      '<script>' + handDrawnRsvpWishScript + '</script>' +
      (motionUsed.any ? '<script>' + motionScript + '</script>' : '') +
      (musicUrl ? '<script>' + musicScript + '</script>' : '') +
      '</body></html>';
  }

  return { render: render };
});
