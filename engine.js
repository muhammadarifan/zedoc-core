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
 *     placed icon shows up for a guest exactly as on the canvas). A
 *     retired `block` node type is skipped like any unknown type.
 *   - Mostly static visual fidelity. The countdown ticks live (see
 *     countdownScript below) and the Rangkaian Acara "Buka Peta"/"+
 *     Kalender" buttons are real links (see eventButtonLinkOverlaysHtml),
 *     but RSVP submission and WA integrations still don't exist here —
 *     those live in assets/engine.js for .dc.html templates today and are
 *     follow-up work for this pipeline, not built here.
 *   - The opening-overlay tap-to-open gate IS supported: an `envelope`-role
 *     artboard with nodes renders as a fixed full-viewport overlay on top of
 *     the invitation stage; tapping it anywhere fades it out. A `#rsvp` in
 *     the page address opens it and scrolls to the RSVP section, and
 *     `skipOpeningOverlay` (data or opts) leaves it out, as in assets/engine.js.
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

  // The guest page's own words (toasts, counters, the questions sheet...), by page language. The
  // couple's texts come from the data + language preset (ZeDocCore.applyLanguage); these are what
  // the engine itself says. Indonesian is the base: another language only overrides what it
  // translates, and a language with no entry here reads as Indonesian.
  var UI_TEXT = {
    id: {
      adult: 'Dewasa', child: 'Anak', decrease: 'Kurangi', increase: 'Tambah',
      summaryYes: 'Hadir · {d} Dewasa · {a} Anak', summaryNo: 'Mohon maaf tidak dapat hadir.', changeAnswer: 'Ubah Jawaban',
      copied: 'Nomor rekening disalin!', needPersonalLink: 'Buka undangan lewat tautan pribadi Anda untuk mengonfirmasi kehadiran.',
      sending: 'Mengirim...', rsvpThanks: 'Terima kasih, konfirmasi Anda telah kami catat.',
      rsvpFailed: 'Gagal mengirim konfirmasi, coba lagi.', rsvpOffline: 'Gagal mengirim konfirmasi, periksa koneksi Anda.',
      needGuests: 'Isi jumlah tamu yang akan hadir.',
      wishEmpty: 'Tuliskan ucapan Anda terlebih dahulu.', wishPreview: 'Ucapan tidak dapat dikirim dari pratinjau ini.',
      wishLimit: 'Anda sudah mencapai batas 3 ucapan & doa.', wishFailed: 'Gagal mengirim ucapan, coba lagi.',
      wishThanks: 'Terima kasih atas doa dan ucapannya!', wishOffline: 'Gagal mengirim ucapan, periksa koneksi Anda.',
      guestFallback: 'Tamu Undangan', downloadIcs: 'Download .ics', addGoogle: 'Tambah ke Google Calendar', musicLabel: 'Musik latar',
      sheetEyebrow: 'Sebelum Melanjutkan', sheetTitle: 'Ada beberapa hal yang ingin kami ketahui', yes: 'Ya', no: 'Tidak',
      sheetSend: 'Kirim Jawaban', sheetSkip: 'Lewati', optional: 'Opsional',
      noteTitle: 'RSVP Tercatat', close: 'Tutup', noteAdult: '{n} Dewasa', noteChild: '{n} Anak',
      noteYes: '{parts} akan hadir', noteNo: 'Tidak dapat hadir',
      pagePrev: '‹ Sebelumnya', pageNext: 'Selanjutnya ›', pageOf: 'Halaman {p} dari {n}'
    },
    en: {
      adult: 'Adults', child: 'Children', decrease: 'Decrease', increase: 'Increase',
      summaryYes: 'Attending · {d} adult(s) · {a} child(ren)', summaryNo: 'Sorry, we are unable to attend.', changeAnswer: 'Change Response',
      copied: 'Account number copied!', needPersonalLink: 'Open the invitation through your personal link to confirm your attendance.',
      sending: 'Sending...', rsvpThanks: 'Thank you, your response has been recorded.',
      rsvpFailed: 'Could not send your response, please try again.', rsvpOffline: 'Could not send your response, check your connection.',
      needGuests: 'Enter how many guests will attend.',
      wishEmpty: 'Please write your wishes first.', wishPreview: 'Wishes cannot be sent from this preview.',
      wishLimit: 'You have already sent the maximum of 3 wishes & prayers.', wishFailed: 'Could not send your wishes, please try again.',
      wishThanks: 'Thank you for your prayers and wishes!', wishOffline: 'Could not send your wishes, check your connection.',
      guestFallback: 'Guest', downloadIcs: 'Download .ics', addGoogle: 'Add to Google Calendar', musicLabel: 'Background music',
      sheetEyebrow: 'Before You Continue', sheetTitle: 'A few things we would like to know', yes: 'Yes', no: 'No',
      sheetSend: 'Send Answers', sheetSkip: 'Skip', optional: 'Optional',
      noteTitle: 'RSVP Recorded', close: 'Close', noteAdult: '{n} adult(s)', noteChild: '{n} child(ren)',
      noteYes: 'Attending: {parts}', noteNo: 'Unable to attend',
      pagePrev: '‹ Previous', pageNext: 'Next ›', pageOf: 'Page {p} of {n}'
    },
    zh: {
      adult: '成人', child: '儿童', decrease: '减少', increase: '增加',
      summaryYes: '出席 · {d} 位成人 · {a} 位儿童', summaryNo: '很抱歉，无法出席。', changeAnswer: '修改回复',
      copied: '账号已复制！', needPersonalLink: '请通过您的专属链接打开邀请函以确认出席。',
      sending: '发送中…', rsvpThanks: '谢谢，您的回复已记录。',
      rsvpFailed: '发送失败，请重试。', rsvpOffline: '发送失败，请检查网络连接。',
      needGuests: '请填写出席人数。',
      wishEmpty: '请先写下您的祝福。', wishPreview: '预览模式下无法发送祝福。',
      wishLimit: '您已发送最多 3 条祝福与祈祷。', wishFailed: '祝福发送失败，请重试。',
      wishThanks: '感谢您的祝福！', wishOffline: '祝福发送失败，请检查网络连接。',
      guestFallback: '宾客', downloadIcs: '下载 .ics', addGoogle: '添加到 Google 日历', musicLabel: '背景音乐',
      sheetEyebrow: '继续之前', sheetTitle: '我们想了解几件事', yes: '是', no: '否',
      sheetSend: '提交回答', sheetSkip: '跳过', optional: '选填',
      noteTitle: '回复已记录', close: '关闭', noteAdult: '{n} 位成人', noteChild: '{n} 位儿童',
      noteYes: '出席：{parts}', noteNo: '无法出席',
      pagePrev: '‹ 上一页', pageNext: '下一页 ›', pageOf: '第 {p} / {n} 页'
    }
  };

  // The page's texts for one render. The language preset's own script texts (assets/labels.js, already
  // translated there) win for the few that both have: the wish limit and the anonymous guest's name.
  function uiText(data) {
    var text = Object.assign({}, UI_TEXT.id, UI_TEXT[data.language]);
    if (data.textWishLimitReached) text.wishLimit = data.textWishLimitReached;
    if (data.textGuestFallback) text.guestFallback = data.textGuestFallback;
    return text;
  }

  function fmt(template, vars) {
    return template.replace(/\{(\w+)\}/g, function (match, key) { return vars[key] != null ? vars[key] : match; });
  }

  // CSS text for a style="..." written into raw markup: escaped, so a value holding a quote (a colour, a
  // font stack) cannot close the attribute and start another one.
  function styleStr(obj) {
    var out = '';
    for (var key in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
      var value = obj[key];
      if (value === undefined || value === null || value === '') continue;
      var cssKey = key.replace(/[A-Z]/g, function (m) { return '-' + m.toLowerCase(); });
      out += cssKey + ':' + escapeHtml(value) + ';';
    }
    return out;
  }

  // A venue pin the couple never set stays the "#" placeholder wizard.js
  // writes by convention (see src/worker.js's own hasRealMapHref) - ported
  // here so the Map button link only appears once there's somewhere real to
  // send a guest.
  // (through safeHref, so the "#" placeholder and any javascript:/data: address count as unset)
  function hasRealMapHref(event) {
    return !!(event && safeHref(event.map_href));
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

  // Used by decorateText's 'Countdown number N' override below (the catalog
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
  // response (guestEventRsvp, threaded in from viewer.html) wins, otherwise
  // default to Ya -
  // same rule assets/engine.js's own attendingFor() uses.
  function attendingDefaultFor(ctx, eventName) {
    var prev = (ctx.data.guestEventRsvp || {})[eventName];
    if (!prev) return true;
    return (prev.dewasa || 0) + (prev.anak || 0) > 0;
  }

  // What a fresh "Ya" starts from for one event: their earlier answer if they gave one,
  // else one adult (an attendance of 0 people is a decline) - kept inside the caps.
  function guestCountDefaults(ev) {
    var answered = (ev.rsvpPrefillDewasa || 0) + (ev.rsvpPrefillAnak || 0) > 0;
    if (answered) return { dewasa: ev.rsvpPrefillDewasa || 0, anak: ev.rsvpPrefillAnak || 0 };
    var d = ev.rsvpDewasaMax != null ? Math.min(1, ev.rsvpDewasaMax) : 1;
    var a = 0;
    if (d === 0) a = ev.rsvpAnakMax != null ? Math.min(1, ev.rsvpAnakMax) : 1;
    if (ev.rsvpTotalMax != null && d + a > ev.rsvpTotalMax) { d = Math.min(d, ev.rsvpTotalMax); a = Math.min(a, ev.rsvpTotalMax - d); }
    return { dewasa: d, anak: a };
  }

  // What a locked card says instead of the steppers (the .dc.html form's wording).
  function guestSummaryText(dewasa, anak, ui) {
    return dewasa + anak > 0 ? fmt(ui.summaryYes, { d: dewasa, a: anak }) : ui.summaryNo;
  }

  function guestCountAttrs(ev) {
    var def = guestCountDefaults(ev);
    var attrs = { 'data-zd2-counts-event': ev.nama_acara || '', 'data-zd2-def-dewasa': String(def.dewasa), 'data-zd2-def-anak': String(def.anak) };
    // a cap that is not set has no attribute at all (an empty one would read as 0)
    if (ev.rsvpDewasaMax != null) attrs['data-zd2-max-dewasa'] = String(ev.rsvpDewasaMax);
    if (ev.rsvpAnakMax != null) attrs['data-zd2-max-anak'] = String(ev.rsvpAnakMax);
    if (ev.rsvpTotalMax != null) attrs['data-zd2-max-total'] = String(ev.rsvpTotalMax);
    return attrs;
  }

  // One "Dewasa  [-] 2 [+]" box, in the theme's own line/accent/ink so it matches
  // whichever template it lands in. The label is Indonesian only for now, like the
  // toasts below (ponytail: route through the language presets when those reach this page).
  function guestCountHtml(field, label, ctx) {
    var ev = ctx.repeatItem;
    var def = guestCountDefaults(ev);
    var attending = attendingDefaultFor(ctx, ev.nama_acara || '');
    var palette = ctx.theme.palette;
    var radius = px(Math.min(ctx.theme.radius || 0, 12));
    var stepStyle = styleStr({ width: px(24), height: px(24), padding: 0, flex: 'none', border: '1px solid ' + palette.accent, borderRadius: radius, background: 'transparent', color: palette.accent, fontFamily: 'inherit', fontSize: px(15), lineHeight: 1, cursor: 'pointer' });
    var step = function (delta, sign, word) {
      return '<button type="button" data-zd2-step="' + delta + '" data-zd2-field="' + field + '" aria-label="' + escapeHtml(word + ' ' + label.toLowerCase()) + '" style="' + stepStyle + '">' + sign + '</button>';
    };
    return '<div class="zd2-cnt" style="' + styleStr({ flex: 1, minWidth: 0, height: '100%', boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: px(4), padding: '0 8px', border: '1px solid ' + palette.line, borderRadius: radius, fontFamily: ctx.theme.fonts.body, fontSize: px(12), color: palette.ink }) + '">' +
      '<span>' + escapeHtml(label) + '</span>' +
      '<span style="display:flex;align-items:center;gap:2px">' + step(-1, '&minus;', ctx.ui.decrease) +
      '<input class="zd2-num" type="number" min="0" inputmode="numeric" data-zd2-field="' + field + '" value="' + (attending ? def[field] : 0) + '" aria-label="' + escapeHtml(label) + '" style="' + styleStr({ width: px(30), border: 'none', background: 'transparent', outline: 'none', textAlign: 'center', color: palette.ink, fontFamily: 'inherit', fontSize: px(13), padding: 0 }) + '">' +
      step(1, '+', ctx.ui.increase) + '</span></div>';
  }

  // --- links typed by the organizer / couple ------------------------------------------------
  // Every address a person types - the couple card's Instagram/Facebook (the couple item's `ig` / `fb`), the
  // map pin, the WhatsApp and live-streaming buttons - ends up in a guest's browser, so only web links go
  // out: an address with any other scheme (javascript:, data:...) is dropped, and a bare
  // "instagram.com/bagas" gets https://. Anything else ("#", a lone @handle) is no link.
  function safeHref(url) {
    var text = String(url == null ? '' : url).trim();
    if (!text || /\s/.test(text)) return '';
    if (/^https?:\/\//i.test(text)) return text;
    if (/^[a-z][a-z0-9+.\-]*:/i.test(text)) return '';
    return /^[\w\-]+(\.[\w\-]+)+(\/|$)/.test(text) ? 'https://' + text : '';
  }

  function socialLinks(item) {
    var links = [];
    var ig = safeHref(item.ig);
    var fb = safeHref(item.fb);
    if (ig) links.push({ kind: 'ig', href: ig });
    if (fb) links.push({ kind: 'fb', href: fb });
    return links;
  }

  var SOCIAL_GLYPH = {
    ig: '<rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="17.3" cy="6.7" r=".9" fill="currentColor"/>',
    fb: '<path fill="currentColor" d="M13.5 21v-8h2.7l.4-3.1h-3.1V7.9c0-.9.25-1.5 1.55-1.5H17V3.5c-.3 0-1.2-.1-2.3-.1-2.3 0-3.9 1.4-3.9 4v2.5H8v3.1h2.8V21h2.7z"/>'
  };

  // Whether this document draws its own "IG" text on the ring; a bare ring gets the network's glyph instead.
  var socialLabelled = false;

  function hasNodeNamed(nodes, name) {
    return nodes.some(function (node) { return node.name === name || (node.children ? hasNodeNamed(node.children, name) : false); });
  }

  /**
   * A social node (ring, or "IG" text) of one couple card, as the couple's links: an <a> to their
   * Instagram and one to their Facebook side by side where the template has room for a single one,
   * only the ones they filled in, and nothing at all (the ring/label hidden) when they gave neither.
   */
  function socialViews(node, view, ctx) {
    var links = socialLinks(ctx.repeatItem);
    if (!links.length) {
      view.style = Object.assign({}, view.style, { display: 'none' });
      return view;
    }
    // A text as wide as the card ("IG" centred in a 388px box) has no icon-sized slot to split, so its
    // links sit inline in the text - an anchor around each word, side by side - and only the words are
    // clickable. The label drawn on a ring ("Social icon label") is as small as the ring and is
    // split the same way the ring is, below.
    if (node.type === 'text' && node.name !== 'Social icon label') {
      var label = view.children[0];
      var word = label.children[0];
      var networkWord = /^\s*ig\s*$/i.test(word);
      var inline = [];
      links.forEach(function (link, i) {
        if (i) inline.push('   ');
        inline.push({
          tag: 'a',
          attrs: { href: link.href, target: '_blank', rel: 'noopener', 'aria-label': link.kind === 'ig' ? 'Instagram' : 'Facebook' },
          style: { color: 'inherit', textDecoration: 'none', cursor: 'pointer' },
          children: [networkWord ? (link.kind === 'ig' ? 'IG' : 'FB') : word]
        });
      });
      view.children = [Object.assign({}, label, { children: inline })].concat(view.children.slice(1));
      return view;
    }
    var left = parseFloat(view.style.left) || 0;
    var step = node.frame.w + 10;
    var copies = links.map(function (link, i) {
      var children = view.children.slice();
      if (node.type === 'text') {
        // the text is the template's "IG"; the Facebook copy says FB
        var label = children[0];
        if (label && /^\s*ig\s*$/i.test(label.children[0])) children[0] = Object.assign({}, label, { children: [link.kind === 'ig' ? 'IG' : 'FB'] });
      } else if (!socialLabelled) {
        var color = node.stroke && node.stroke.width > 0 ? resolveColor(node.stroke.color, ctx.theme) : ctx.theme.palette.accent;
        var size = Math.round(Math.min(node.frame.w, node.frame.h) * 0.47);
        children.push({ raw: '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" aria-hidden="true" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);pointer-events:none;color:' + escapeHtml(color) + '">' + SOCIAL_GLYPH[link.kind] + '</svg>' });
      }
      return {
        tag: 'a',
        attrs: Object.assign({}, view.attrs, { href: link.href, target: '_blank', rel: 'noopener', 'aria-label': link.kind === 'ig' ? 'Instagram' : 'Facebook' }),
        style: Object.assign({}, view.style, { left: px(left + (i - (links.length - 1) / 2) * step), display: 'block', textDecoration: 'none', cursor: 'pointer' }),
        children: children
      };
    });
    return copies.length === 1 ? copies[0] : { fragment: copies };
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
      if (ctx.repeatItem.rsvpShowInputs === false) attrs['data-zd2-untracked'] = '1';
    }
    // a paged wishes list: which slot and which field this text is, so the pager can swap another page into it
    if (ctx.wishPaging && ctx.repeatListKey === 'wishes' && ctx.repeatItem && node.binding && /^(name|time|message)$/.test(node.binding.key)) {
      var wishSlot = ctx.data.wishes.indexOf(ctx.repeatItem);
      if (wishSlot !== -1) { attrs['data-zd2-wish-i'] = String(wishSlot); attrs['data-zd2-wish-key'] = node.binding.key; }
    }
    textView.attrs = attrs;
    textView.children = [text];
  }

  /** A link-bucket counterpart to the field lookups - link_konfirmasi_wa and
   *  friends live in ctx.data.links, not ctx.data.fields (see bucketFor above). */
  function linkVal(ctx, key) {
    return (ctx.data.links && ctx.data.links[key]) || '';
  }

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
      itemsHtml += '<a href="' + escapeHtml(icsHref) + '" download="acara.ics" style="' + styleStr(itemStyle) + '">' + escapeHtml(ctx.ui.downloadIcs) + '</a>';
    }
    if (gcalHref) {
      var gcalStyle = Object.assign({}, itemStyle, icsHref ? { borderTop: '1px solid ' + ctx.theme.palette.line } : {});
      itemsHtml += '<a href="' + escapeHtml(gcalHref) + '" target="_blank" rel="noopener" style="' + styleStr(gcalStyle) + '">' + escapeHtml(ctx.ui.addGoogle) + '</a>';
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
        html += '<a href="' + escapeHtml(safeHref(event.map_href)) + '" target="_blank" rel="noopener" style="' + linkStyle + '"></a>';
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
      case 'text': {
        decorateText(node, view, ctx);
        var textSocial = ZeDocCore.guestRole(node);
        if (textSocial && textSocial.role === 'social-link' && ctx.repeatItem) return socialViews(node, view, ctx);
        return;
      }
      case 'shape': {
        // "Yes button"/"No button" (see ZeDocCore.GUEST_ROLES) pair
        // with their own text label siblings (decorateText's matching
        // 'attend-label' role) to form one attendance toggle -
        // both the "off" (normal) and "on" look are pre-computed into data
        // attributes so handDrawnRsvpWishScript can swap the inner div's
        // style on click without knowing this theme.
        var shapeRole = ZeDocCore.guestRole(node);
        if (shapeRole && shapeRole.role === 'social-link' && ctx.repeatItem) return socialViews(node, view, ctx);
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
        var attendAttrs = {
          'data-zd2-attend': attendShapeRole,
          'data-zd2-event': attendEvent,
          'data-zd2-style-on': ZeDocCore.styleText(onStyle),
          'data-zd2-style-off': ZeDocCore.styleText(offStyle),
          'data-zd2-selected': attendSelected ? '1' : '0'
        };
        if (ctx.repeatItem.rsvpShowInputs === false) attendAttrs['data-zd2-untracked'] = '1';
        return {
          tag: 'div',
          attrs: attendAttrs,
          style: Object.assign({}, wrapStyle, { cursor: 'pointer' }),
          children: [{ tag: 'div', style: attendSelected ? onStyle : offStyle }]
        };
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
          // a guest opened by their own link signs the wish as themselves (the .dc.html form shows
          // their name as fixed text): the name box is filled in and read-only
          var lockedName = !isTextarea && ctx.data.guestName ? String(ctx.data.guestName) : '';
          // the input types in the placeholder text's own font/size, not the
          // browser default (a bare <input> would fall back to Times 16px)
          var inputType = placeholderNode ? {
            fontFamily: resolveFont(placeholderNode.style.font, ctx.theme),
            fontSize: px(resolveTextStyle(placeholderNode, ctx).size),
            fontWeight: lockedName ? 600 : resolveTextStyle(placeholderNode, ctx).weight
          } : { font: 'inherit' };
          // wrapStyle already provides position:absolute. It is also the
          // containing block for the transparent input overlay; overriding it
          // with position:relative makes this group participate in flow and
          // overlap the submit button below it.
          view.children = ZeDocCore.childViews(node.children.filter(function (c) { return c.type !== 'text'; }), gctx, o.path).concat([{
            raw: '<' + inputTag + (isTextarea ? '' : ' type="text"') + ' id="zd2-' + wishInputRole + '"' +
              (lockedName ? ' value="' + escapeHtml(lockedName) + '" readonly' : '') +
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

        // "Wish pager" (under the wishes list, see ZeDocCore.withWishPager): previous / "Halaman 1 dari 3" / next, wired in
        // wishPagerScript. Starts on page 1, so "previous" is disabled.
        if (role === 'wish-pager') {
          var pagerColors = ctx.theme.palette;
          var pagerButton = styleStr({ padding: '6px 14px', border: '1px solid ' + pagerColors.accent, borderRadius: px(Math.min(ctx.theme.radius || 0, 12)), background: 'transparent', color: pagerColors.accent, fontFamily: 'inherit', fontSize: px(12), cursor: 'pointer' });
          var pageCount = Math.ceil((ctx.wishPaging || 0) / ZeDocCore.WISHES_PER_PAGE);
          view.attrs = { 'data-zd2-wish-pager': true };
          view.style = Object.assign({}, wrapStyle, { display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontFamily: ctx.theme.fonts.body, fontSize: px(12), color: pagerColors.ink });
          view.children = [{ raw:
            '<button type="button" data-zd2-wish-prev disabled style="' + pagerButton + '">' + escapeHtml(ctx.ui.pagePrev) + '</button>' +
            '<span data-zd2-wish-label>' + escapeHtml(fmt(ctx.ui.pageOf, { p: 1, n: pageCount })) + '</span>' +
            '<button type="button" data-zd2-wish-next style="' + pagerButton + '">' + escapeHtml(ctx.ui.pageNext) + '</button>' }];
          return;
        }

        // "Guest count" (inside the RSVP events repeat, see ZeDocCore.withGuestCounts):
        // dewasa/anak steppers for this event, wired in guestCountScript. Hidden while
        // the guest is declining; absent for an event they have no quota on.
        if (role === 'guest-count' && ctx.repeatItem) {
          view.children = [];
          if (ctx.repeatItem.rsvpShowInputs === false) return;
          var countAttending = attendingDefaultFor(ctx, ctx.repeatItem.nama_acara || '');
          view.attrs = guestCountAttrs(ctx.repeatItem);
          view.style = Object.assign({}, wrapStyle, { display: countAttending ? 'flex' : 'none', gap: px(10), alignItems: 'center' });
          var prevAnswer = ctx.data.guestEventRsvp && ctx.data.guestEventRsvp[ctx.repeatItem.nama_acara || ''];
          var summary = guestSummaryText((prevAnswer && prevAnswer.dewasa) || 0, (prevAnswer && prevAnswer.anak) || 0, ctx.ui);
          view.children = [
            { raw: guestCountHtml('dewasa', ctx.ui.adult, ctx) }, { raw: guestCountHtml('anak', ctx.ui.child, ctx) },
            // shown instead of the two boxes while the page is locked (body[data-zd2-locked])
            { raw: '<div class="zd2-sum" style="' + styleStr({ display: 'none', flex: 1, alignItems: 'center', height: '100%', fontFamily: ctx.theme.fonts.body, fontSize: px(13), color: ctx.theme.palette.ink }) + '">' + escapeHtml(summary) + '</div>' }
          ];
          return;
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
        // templates have a generic RSVP/wishes/gift component.
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
          var groupHref = safeHref(linkVal(ctx, role === 'wa-button' ? 'link_konfirmasi_wa' : 'link_live_streaming'));
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

  // Escapes JSON so it can sit inside a <script> tag.
  function jsonForScript(value) {
    return JSON.stringify(value).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, '');
  }

  // The two things that happen around sending an RSVP, drawn in the template's own colours
  // (cfg.theme). Written as a real function and inlined into the page with toString(), like
  // ZeDocCore.flowBoxes: it must not reach for anything outside itself.
  //   window.zd2Questions(done)  the organizer's extra questions (up to 3) as a sheet, before the
  //                              RSVP goes out; done(answers) then sends them with it. Only defined
  //                              when there is at least one question.
  //   window.zd2Recorded(sent)   the "RSVP Tercatat" notice after a send succeeded: which event and
  //                              how many people (or a decline), for every send.
  function rsvpFollowUp(cfg) {
    var theme = cfg.theme;
    var styleEl = document.createElement('style');
    styleEl.textContent = [
      '.zd2-sheet-back{position:fixed;inset:0;background:rgba(10,10,12,.55);display:flex;align-items:flex-end;justify-content:center;z-index:2147483000;opacity:0;transition:opacity .25s ease}',
      '.zd2-sheet-back.zd2-open{opacity:1}',
      '.zd2-sheet{width:100%;max-width:440px;background:var(--zd2-bg);color:var(--zd2-ink);font-family:var(--zd2-font);border-radius:20px 20px 0 0;padding:26px 22px calc(20px + env(safe-area-inset-bottom));box-shadow:0 -10px 40px rgba(0,0,0,.28);transform:translateY(28px);transition:transform .32s cubic-bezier(.2,.8,.2,1);max-height:88vh;overflow-y:auto;box-sizing:border-box}',
      '.zd2-sheet-back.zd2-open .zd2-sheet{transform:translateY(0)}',
      '@media (min-width:640px){.zd2-sheet-back{align-items:center}.zd2-sheet{border-radius:20px}}',
      '.zd2-eyebrow{margin:0 0 6px;font-size:11px;letter-spacing:2.5px;text-transform:uppercase;opacity:.6}',
      '.zd2-sheet-title{margin:0 0 20px;font-size:18px;font-weight:600;line-height:1.4}',
      '.zd2-field{display:flex;flex-direction:column;gap:9px;margin-bottom:18px}',
      '.zd2-label{font-size:13.5px;font-weight:500;line-height:1.5}',
      '.zd2-choices{display:flex;gap:10px}',
      '.zd2-choice{flex:1;padding:12px;border-radius:10px;border:1.5px solid var(--zd2-accent);background:transparent;color:inherit;font-size:14px;cursor:pointer;font-family:inherit}',
      '.zd2-choice.zd2-active{background:var(--zd2-accent);color:var(--zd2-accent-ink)}',
      '.zd2-text{padding:12px;border-radius:10px;border:1.5px solid rgba(128,128,128,.4);background:rgba(128,128,128,.06);color:inherit;font-size:16px;font-family:inherit;box-sizing:border-box;width:100%}',
      '.zd2-text:focus{outline:none;border-color:var(--zd2-accent)}',
      '.zd2-actions{display:flex;flex-direction:column;gap:10px;margin-top:4px}',
      '.zd2-send{padding:14px;border:none;border-radius:10px;background:var(--zd2-accent);color:var(--zd2-accent-ink);font-size:15px;cursor:pointer;font-family:inherit}',
      '.zd2-skip{padding:6px;border:none;background:transparent;color:inherit;opacity:.55;font-size:13px;cursor:pointer;text-decoration:underline;font-family:inherit}',
      '.zd2-note-wrap{position:fixed;top:0;left:0;right:0;display:flex;justify-content:center;padding:calc(14px + env(safe-area-inset-top)) 14px 0;z-index:2147483001;pointer-events:none}',
      '.zd2-note{pointer-events:auto;width:100%;max-width:420px;background:var(--zd2-bg);color:var(--zd2-ink);font-family:var(--zd2-font);border-radius:14px;box-shadow:0 12px 32px rgba(0,0,0,.22);padding:16px 18px;box-sizing:border-box;opacity:0;transform:translateY(-16px);transition:opacity .3s ease,transform .3s ease}',
      '.zd2-note.zd2-open{opacity:1;transform:translateY(0)}',
      '.zd2-note-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}',
      '.zd2-note-title{margin:0;font-size:14.5px;font-weight:700;display:flex;align-items:center;gap:8px}',
      '.zd2-note-check{flex:none;width:20px;height:20px;border-radius:50%;background:var(--zd2-accent);color:var(--zd2-accent-ink);display:flex;align-items:center;justify-content:center;font-size:12px;line-height:1}',
      '.zd2-note-close{flex:none;border:none;background:transparent;color:inherit;opacity:.5;cursor:pointer;font-size:16px;line-height:1;padding:2px}',
      '.zd2-note-event{margin:10px 0 0;font-size:13px;line-height:1.5}',
      '.zd2-note-event+.zd2-note-event{margin-top:8px;padding-top:8px;border-top:1px solid rgba(128,128,128,.2)}',
      '.zd2-note-name{font-weight:600}',
      '.zd2-note-meta{opacity:.6;font-size:12px;margin-top:2px}'
    ].join('\n');
    document.head.appendChild(styleEl);

    function paint(el) {
      el.style.setProperty('--zd2-bg', theme.bg);
      el.style.setProperty('--zd2-ink', theme.ink);
      el.style.setProperty('--zd2-accent', theme.accent);
      el.style.setProperty('--zd2-accent-ink', theme.accentInk);
      el.style.setProperty('--zd2-font', theme.font);
    }
    function add(parent, tag, cls, text) {
      var el = document.createElement(tag);
      if (cls) el.className = cls;
      if (text != null) el.textContent = text;
      parent.appendChild(el);
      return el;
    }

    if (cfg.questions.length) {
      window.zd2Questions = function (done) {
        var values = {};
        cfg.questions.forEach(function (q) {
          var prior = cfg.answers[q.id];
          var has = prior !== undefined && prior !== null && prior !== '';
          values[q.id] = has ? prior : (q.type === 'yesno' ? false : '');
        });
        var back = add(document.body, 'div', 'zd2-sheet-back');
        var sheet = add(back, 'div', 'zd2-sheet');
        paint(sheet);
        add(sheet, 'p', 'zd2-eyebrow', cfg.t.sheetEyebrow);
        add(sheet, 'p', 'zd2-sheet-title', cfg.t.sheetTitle);
        cfg.questions.forEach(function (q) {
          var field = add(sheet, 'div', 'zd2-field');
          add(field, 'div', 'zd2-label', q.label);
          if (q.type === 'yesno') {
            var choices = add(field, 'div', 'zd2-choices');
            var yes = add(choices, 'button', 'zd2-choice', cfg.t.yes);
            var no = add(choices, 'button', 'zd2-choice', cfg.t.no);
            yes.type = no.type = 'button';
            var show = function () {
              yes.classList.toggle('zd2-active', values[q.id] === true);
              no.classList.toggle('zd2-active', values[q.id] !== true);
            };
            yes.addEventListener('click', function () { values[q.id] = true; show(); });
            no.addEventListener('click', function () { values[q.id] = false; show(); });
            show();
          } else {
            var input = add(field, 'input', 'zd2-text');
            input.type = 'text';
            input.maxLength = 300;
            input.placeholder = q.placeholder || cfg.t.optional;
            input.value = values[q.id] || '';
            input.addEventListener('input', function () { values[q.id] = input.value; });
          }
        });
        var actions = add(sheet, 'div', 'zd2-actions');
        var send = add(actions, 'button', 'zd2-send', cfg.t.sheetSend);
        var skip = add(actions, 'button', 'zd2-skip', cfg.t.sheetSkip);
        send.type = skip.type = 'button';
        var before = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        requestAnimationFrame(function () { back.classList.add('zd2-open'); });
        var closed = false;
        // "Lewati" still records what is set (a fast path, not a way to opt out of the answers)
        function close() {
          if (closed) return;
          closed = true;
          back.classList.remove('zd2-open');
          document.body.style.overflow = before;
          setTimeout(function () { back.remove(); }, 300);
          // a same-visit "Ubah Jawaban" opens with what was just answered
          Object.keys(values).forEach(function (id) { cfg.answers[id] = values[id]; });
          done(Object.assign({}, values));
        }
        send.addEventListener('click', close);
        skip.addEventListener('click', close);
        back.addEventListener('click', function (e) { if (e.target === back) close(); });
      };
    }

    window.zd2Recorded = function (sent) {
      var names = Object.keys(sent || {});
      if (!names.length) return;
      var old = document.querySelector('.zd2-note-wrap');
      if (old) old.remove();
      var wrap = add(document.body, 'div', 'zd2-note-wrap');
      var note = add(wrap, 'div', 'zd2-note');
      paint(note);
      var head = add(note, 'div', 'zd2-note-head');
      var title = add(head, 'p', 'zd2-note-title');
      add(title, 'span', 'zd2-note-check', '\u2713');
      add(title, 'span', null, cfg.t.noteTitle);
      var closeBtn = add(head, 'button', 'zd2-note-close', '\u00d7');
      closeBtn.type = 'button';
      closeBtn.setAttribute('aria-label', cfg.t.close);
      names.forEach(function (name) {
        var counts = sent[name] || {};
        var parts = [];
        if (counts.dewasa) parts.push(cfg.t.noteAdult.replace('{n}', counts.dewasa));
        if (counts.anak) parts.push(cfg.t.noteChild.replace('{n}', counts.anak));
        var line = add(note, 'div', 'zd2-note-event');
        add(line, 'div', 'zd2-note-name', name + ' \u2014 ' + (parts.length ? cfg.t.noteYes.replace('{parts}', parts.join(', ')) : cfg.t.noteNo));
        var info = cfg.events[name];
        var meta = info ? [info.keterangan, info.venue].filter(Boolean).join(' \u00b7 ') : '';
        if (meta) add(line, 'div', 'zd2-note-meta', meta);
      });
      requestAnimationFrame(function () { note.classList.add('zd2-open'); });
      var timer;
      function dismiss() {
        clearTimeout(timer);
        note.classList.remove('zd2-open');
        setTimeout(function () { wrap.remove(); }, 300);
      }
      timer = setTimeout(dismiss, 7000);
      closeBtn.addEventListener('click', dismiss);
    };
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
    var message = envelopeOff ? (fields.teks_pesan_tanpa_kado || data.textNoGiftMessage || NO_GIFT_MESSAGE)
      : (fields.teks_pesan_tanpa_kado_fisik || data.textNoPhysicalGiftMessage || NO_PHYSICAL_GIFT_MESSAGE);
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
    socialLabelled = doc.artboards.some(function (artboard) { return hasNodeNamed(artboard.nodes, 'Social icon label') || hasNodeNamed(artboard.nodes, 'Social link') || hasNodeNamed(artboard.nodes, 'Profile social'); });
    data = data || {};
    // The guest's language: the preset (fields, hardcoded-text replacements, script texts) merged in
    // before anything reads the data. opts.labels, else the page's own window.INVITATION_LABELS.
    var labels = opts.labels || (typeof globalThis !== 'undefined' ? globalThis.INVITATION_LABELS : undefined);
    data = ZeDocCore.applyLanguage(data, data.language && labels && labels[data.language]);
    var ui = uiText(data);
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

    // Which events this guest sees, and what each asks of them (quota caps,
    // previous answer). The filtered list replaces data.events before reflow, so
    // a guest invited to fewer events gets a shorter events section. Same shallow
    // copy reasoning as the couple swap above.
    var guest = ZeDocCore.guestEvents(data);
    data = Object.assign({}, data, { events: guest.events, canRsvp: guest.canRsvp, rsvpLocked: guest.responded });

    // A long wishes list is drawn one page at a time (ZeDocCore.withWishPager): the page is built from the first
    // page's worth of wishes and the whole list travels as JSON for the pager to swap in.
    var wishPaging = null;
    if (Array.isArray(data.wishes) && data.wishes.length > ZeDocCore.WISHES_PER_PAGE) {
      wishPaging = data.wishes.map(function (w) {
        w = w || {};
        return { name: String(w.name == null ? '' : w.name), time: String(w.time == null ? '' : w.time), message: String(w.message == null ? '' : w.message) };
      });
      data = Object.assign({}, data, { wishes: data.wishes.slice(0, ZeDocCore.WISHES_PER_PAGE) });
    }
    var wishPagerAdded = false;

    var role = opts.artboardRole || 'invitation';
    var artboards = doc.artboards.filter(function (a) { return a.role === role; });
    if (artboards.length === 0) artboards = doc.artboards.slice(0, 1);
    var ctx = { theme: doc.theme, data: data, assets: doc.assets || [], mode: 'guest', decorate: decorateNode, ui: ui, replacements: data.textReplacements, wishPaging: wishPaging ? wishPaging.length : 0 };

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
      return { theme: theme, data: data, assets: ctx.assets, mode: 'guest', decorate: decorateNode, fontStyleOverride: fontStyleOverride, ui: ui, replacements: data.textReplacements, wishPaging: wishPaging ? wishPaging.length : 0 };
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
      // a guest who may RSVP also says how many are coming: add the counters to the RSVP cards
      var counted = data.canRsvp ? ZeDocCore.withGuestCounts(unwrapBlock(section.nodes)) : { nodes: unwrapBlock(section.nodes), extra: 0 };
      var paged = wishPaging ? ZeDocCore.withWishPager(counted.nodes, wishPaging.length) : { nodes: counted.nodes, extra: 0, added: false };
      if (paged.added) wishPagerAdded = true;
      var sectionLaid = reflowNodes(paged.nodes, data);
      var sectionHeight = section.size.h + counted.extra + paged.extra + sectionLaid.extra;
      var sectionBodyHtml = sectionLaid.items.map(function (entry, i) { return renderNode(entry.node, sectionCtx, entry.y, sectionLaid.bgHeightGrow[i]); }).join('');
      var sectionBgStyle = styleStr(resolveFill(section.background, sectionCtx));
      var sectionKey = ZeDocCore.sectionOf(section);
      bodyHtml += '<div' + (sectionKey ? ' data-zd-section="' + sectionKey + '"' : '') + ' data-zd-section-index="' + s + '" data-zd-base-height="' + px(sectionHeight) + '" style="' + styleStr({ position: 'absolute', top: px(cursorY), left: 0, width: px(section.size.w), height: px(sectionHeight) }) + sectionBgStyle + '">' + sectionBodyHtml + '</div>';
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
    // `skipOpeningOverlay` (data or opts) starts the invitation already opened - the
    // wizard/catalog preview - exactly like switching the gate off.
    var skipGate = !!(data.skipOpeningOverlay || opts.skipOpeningOverlay);
    if (envelope && envelope.nodes.length > 0 && switches['opening-overlay'] !== false && !skipGate) {
      var envelopeCtx = ctxFor(envelope);
      var gateLaid = reflowNodes(unwrapBlock(envelope.nodes), data);
      var gateBodyHtml = gateLaid.items.map(function (entry, i) { return renderNode(entry.node, envelopeCtx, entry.y, gateLaid.bgHeightGrow[i]); }).join('');
      var gateTotalHeight = envelope.size.h + gateLaid.extra;
      var gateBgStyle = styleStr(resolveFill(envelope.background, envelopeCtx));
      gateHtml = '<div id="zd-gate" style="' + styleStr({ position: 'fixed', inset: 0, zIndex: 1000, overflow: 'hidden', cursor: 'pointer' }) + gateBgStyle +
        'transition:opacity 1.1s ease, visibility 1.1s ease" onclick="' +
        'this.style.opacity=0;this.style.visibility=\'hidden\';this.style.pointerEvents=\'none\'' +
        // read from the cover down, not from wherever the page was scrolled while the gate covered it
        // (the .dc.html engine does the same); a #rsvp link scrolls to RSVP afterwards (rsvpLinkScript)
        ';window.scrollTo(0,0)' +
        // animations behind the gate wait for it to open (zdMotionStart below)
        (motionUsed.any ? ';window.zdMotionStart&&window.zdMotionStart()' : '') + '">' +
        '<div id="zd-gate-stage" data-zd-base-height="' + px(gateTotalHeight) + '" style="' + styleStr({ position: 'absolute', top: 0, left: 0, width: px(envelope.size.w), height: px(gateTotalHeight) }) + gateBgStyle + '">' +
        gateBodyHtml +
        '</div></div>';
      gateScript = 'var GW=' + envelope.size.w + ',GH=' + gateTotalHeight + ',gateStage=document.getElementById("zd-gate-stage");' +
        // min(...,innerHeight/GH) too (not just width, unlike the invitation
        // stage's own fit()) - the gate is a fixed, non-scrolling overlay, so
        // content taller than the viewport must shrink to fit or it's simply
        // clipped with no way to scroll to the rest.
        'function fitGate(){var s=Math.min(1,window.innerWidth/GW,window.innerHeight/GH);gateStage.style.transform="scale("+s+")";gateStage.style.transformOrigin="top left";gateStage.style.left=Math.max(0,(window.innerWidth-GW*s)/2)+"px";gateStage.style.top=Math.max(0,(window.innerHeight-GH*s)/2)+"px";}' +
        'window.zdGateHeight=function(h){GH=h;fitGate();};' +
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

    // Ticks every data-zd-cd-unit digit (decorateText's 'Countdown number N'
    // override stamps these), reading target/unit straight off the element so
    // no shell/grouping is needed here - a no-op querySelectorAll when a doc
    // has no countdown).
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
      // a wishes slot the pager has hidden (data-zd-hidden) is not laid out
      'return Array.prototype.filter.call(container.children,function(el){return !el.hasAttribute("data-zd-hidden");}).map(function(el){' +
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
      // the opening gate is one more stage of absolutely placed nodes: a long guest name (or a larger
      // font size) pushes what is below it down, and the gate is fitted to its new height. It grows by how far
      // its lowest content moved (flowed.shift), not to the lowest bottom: decoration may hang past the edge
      'var gate=document.getElementById("zd-gate-stage");' +
      'if(gate&&window.zdGateHeight){var gboxes=boxesOf(gate),gflow=flowBoxes(gboxes);apply(gboxes);' +
      'var gh=(parseFloat(gate.getAttribute("data-zd-base-height"))||0)+Math.max(0,gflow.shift);gate.style.height=gh+"px";window.zdGateHeight(gh);}' +
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
      'window.zdReflow=run;' +
      'if(document.fonts&&document.fonts.ready)document.fonts.ready.then(run);' +
      'window.addEventListener("load",run);' +
      'window.addEventListener("resize",run);' +
      'setTimeout(run,0);setTimeout(run,500);' +
      '})();';

    // Fullscreen photo viewer for every [data-zd-gallery-src] image
    // (ZeDocCore.imageView's gallery-repeat case stamps that attribute) - one
    // delegated click listener rather than a
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

    // RSVP attendance toggle/submit + wish submit against the same backend
    // endpoints assets/engine.js's own .dc.html components use (PUT
    // .../guests/:id/rsvp, POST .../wishes), for the hand-drawn catalog
    // templates' zd2-* hooks (decorateNode's 'shape'/'group' cases and
    // decorateText's 'attend-label' role).
    // slug/guestId live on <body> (data-zd2-slug/-guest-id below) since
    // there's no single hand-drawn node to carry them. Status feedback is the zd2Toast() below, not an inline
    // message line - the hand-drawn templates have no spare decorative node
    // to repurpose as one; upgrade path is picking one more name to match on.
    var handDrawnRsvpWishScript = '(function(){var T=window.zd2T;' +
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
      'zd2Toast(T.copied);' +
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
      // locked (a repeat visit, or just sent): the button is "Ubah Jawaban" and only unlocks the form
      'if(document.body.hasAttribute("data-zd2-locked")){if(window.zd2Unlock)window.zd2Unlock();return;}' +
      'var slug=document.body.getAttribute("data-zd2-slug")||"",guestId=document.body.getAttribute("data-zd2-guest-id")||"";' +
      'if(!slug||!guestId||document.body.getAttribute("data-zd2-can-rsvp")==="0"){zd2Toast(T.needPersonalLink);return;}' +
      'var payload={},seen={},noOne=false;' +
      'Array.prototype.forEach.call(document.querySelectorAll("[data-zd2-attend][data-zd2-selected=\\"1\\"]"),function(el){' +
      'var ev=el.getAttribute("data-zd2-event");if(!ev||seen[ev])return;seen[ev]=1;' +
      // an event this guest has no quota on is not theirs to answer (same as the .dc.html form)
      'if(el.hasAttribute("data-zd2-untracked"))return;' +
      'var attending=el.getAttribute("data-zd2-attend")==="yes";' +
      // "Ya" with the counters' numbers; 0 adults + 0 children would be stored as a decline
      'var counts=attending&&window.zd2Counts?window.zd2Counts(ev):null;' +
      'if(counts&&counts.dewasa+counts.anak===0)noOne=true;' +
      'payload[ev]=attending?(counts||{dewasa:1,anak:0}):{dewasa:0,anak:0};});' +
      'if(noOne){zd2Toast(T.needGuests);return;}' +
      // the organizer's extra questions are asked first, only when someone is coming (window.zd2Questions)
      'var attendingAny=Object.keys(payload).some(function(k){return payload[k].dewasa+payload[k].anak>0;});' +
      'var send=function(answers){zd2Toast(T.sending);var body={event_rsvp:payload};if(answers)body.rsvp_answers=answers;' +
      'fetch("/api/invitations/"+encodeURIComponent(slug)+"/guests/"+encodeURIComponent(guestId)+"/rsvp",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)})' +
      '.then(function(r){' +
      'if(!r.ok){zd2Toast(T.rsvpFailed);return;}' +
      'if(window.zd2Lock)window.zd2Lock(payload);' +
      // "RSVP Tercatat" replaces the plain toast once the send actually succeeded
      'if(window.zd2Recorded){var t=document.getElementById("zd2-toast");if(t)t.style.opacity="0";window.zd2Recorded(payload);}' +
      'else zd2Toast(T.rsvpThanks);})' +
      '.catch(function(){zd2Toast(T.rsvpOffline);});};' +
      'if(attendingAny&&window.zd2Questions)window.zd2Questions(send);else send(null);' +
      'return;}' +
      'if(e.target.closest&&e.target.closest("#zd2-wish-submit")){' +
      'var wslug=document.body.getAttribute("data-zd2-slug")||"";' +
      'var nameEl=document.getElementById("zd2-wish-name"),msgEl=document.getElementById("zd2-wish-message");' +
      'var message=msgEl?msgEl.value.trim():"";' +
      'var name=(nameEl?nameEl.value.trim():"")||T.guestFallback;' +
      'if(!message){zd2Toast(T.wishEmpty);return;}' +
      'if(!wslug){zd2Toast(T.wishPreview);return;}' +
      'zd2Toast(T.sending);' +
      'fetch("/api/invitations/"+encodeURIComponent(wslug)+"/wishes",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:name,message:message})})' +
      '.then(function(r){' +
      'if(!r.ok){zd2Toast(r.status===429?T.wishLimit:T.wishFailed);return;}' +
      'zd2Toast(T.wishThanks);setTimeout(function(){location.reload();},900);' +
      '})' +
      '.catch(function(){zd2Toast(T.wishOffline);});' +
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
        '<button id="zd-music-btn" type="button" aria-label="' + escapeHtml(ui.musicLabel) + '" style="' + styleStr({
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

    // What rsvpFollowUp draws with: the template's own palette, the organizer's questions (up to 3,
    // as the server also caps them), this guest's earlier answers, and each event's date/venue.
    var followUpCfg = {
      t: ui,
      theme: { bg: doc.theme.palette.bg, ink: doc.theme.palette.ink, accent: doc.theme.palette.accent, accentInk: doc.theme.palette.accentInk, font: doc.theme.fonts.body },
      questions: (Array.isArray(data.customRsvpQuestions) ? data.customRsvpQuestions : []).filter(function (q) { return q && q.id && q.label; }).slice(0, 3),
      answers: Object.assign({}, data.guestRsvpAnswers),
      events: {}
    };
    (guest.events || []).forEach(function (ev) { if (ev && ev.nama_acara) followUpCfg.events[ev.nama_acara] = { keterangan: ev.keterangan, venue: ev.venue }; });

    // The wishes pager: swaps the next batch of wishes (window.zd2Wishes, all of them) into the slots the page drew,
    // hides the slots a short last page does not need, and moves the pager and the section end up by their height;
    // the text flow (window.zdReflow) then lays the section and everything after it out again.
    var wishPagerScript = '(function(){' +
      'var all=window.zd2Wishes,T=window.zd2T,PER=' + ZeDocCore.WISHES_PER_PAGE + ';' +
      'var pager=document.querySelector("[data-zd2-wish-pager]");if(!all||!pager)return;' +
      'var section=pager.closest("[data-zd-section-index]");if(!section)return;' +
      'var pages=Math.ceil(all.length/PER),page=0;' +
      'var prev=pager.querySelector("[data-zd2-wish-prev]"),next=pager.querySelector("[data-zd2-wish-next]"),label=pager.querySelector("[data-zd2-wish-label]");' +
      // an element's authored top, remembered under the attribute the text flow starts from (same value it would record)
      'function baseTop(el){var v=el.getAttribute("data-zd-flow-base-top");if(v===null){v=String(parseFloat(el.style.top)||0);el.setAttribute("data-zd-flow-base-top",v);}return parseFloat(v)||0;}' +
      'function texts(i){var out=[],els=document.querySelectorAll("[data-zd2-wish-i]");for(var k=0;k<els.length;k++)if(els[k].getAttribute("data-zd2-wish-i")===String(i))out.push(els[k]);return out;}' +
      // a slot is the wrapper around its texts: text -> its positioned box -> the repeat item
      'var slots=[];for(var i=0;i<PER;i++){var t=texts(i)[0];slots.push(t?t.parentElement.parentElement:null);}' +
      'if(!slots[0]||!slots[1])return;' +
      'var stride=baseTop(slots[1])-baseTop(slots[0]),pagerTop=baseTop(pager),height=parseFloat(section.getAttribute("data-zd-base-height"))||0;' +
      'function show(p){page=p;var start=p*PER,n=Math.min(PER,all.length-start);' +
      'for(var i=0;i<PER;i++){var s=slots[i];if(!s)continue;' +
      'if(i<n){texts(i).forEach(function(el){el.textContent=all[start+i][el.getAttribute("data-zd2-wish-key")];});s.removeAttribute("data-zd-hidden");s.style.display="";}' +
      'else{s.setAttribute("data-zd-hidden","1");s.style.display="none";}}' +
      'var gone=(PER-n)*stride;' +
      'pager.setAttribute("data-zd-flow-base-top",String(pagerTop-gone));section.setAttribute("data-zd-base-height",(height-gone)+"px");' +
      'label.textContent=T.pageOf.replace("{p}",p+1).replace("{n}",pages);' +
      'prev.disabled=p===0;next.disabled=p===pages-1;' +
      'if(window.zdReflow)window.zdReflow();}' +
      'document.addEventListener("click",function(e){var b=e.target.closest&&e.target.closest("[data-zd2-wish-prev],[data-zd2-wish-next]");' +
      'if(!b||b.disabled)return;show(b.hasAttribute("data-zd2-wish-prev")?page-1:page+1);});' +
      '})();';

    // The dewasa/anak counters of the RSVP cards (decorateNode's 'guest-count' role).
    // Same clamp rule as the .dc.html form: each field to its own cap, then the total
    // cap takes what is over off the field just edited. Choosing "Ya" starts from the
    // event's defaults when both are 0, "Tidak" zeroes them and hides the box.
    // window.zd2Counts(event) hands the numbers to the RSVP submit above.
    var guestCountScript = '(function(){var T=window.zd2T;' +
      'function all(){return Array.prototype.slice.call(document.querySelectorAll("[data-zd2-counts-event]"));}' +
      'function wrapFor(ev){return all().filter(function(w){return w.getAttribute("data-zd2-counts-event")===ev;})[0]||null;}' +
      'function box(w,f){return w.querySelector("input[data-zd2-field="+f+"]");}' +
      'function val(w,f){return Math.max(0,parseInt(box(w,f).value,10)||0);}' +
      'function cap(w,k){var v=w.getAttribute("data-zd2-max-"+k);return v===null?null:parseInt(v,10);}' +
      'function put(w,d,a){box(w,"dewasa").value=d;box(w,"anak").value=a;}' +
      'function set(w,f,v){' +
      'var n={dewasa:val(w,"dewasa"),anak:val(w,"anak")};n[f]=Math.max(0,v||0);' +
      'var md=cap(w,"dewasa"),ma=cap(w,"anak"),mt=cap(w,"total");' +
      'if(md!==null)n.dewasa=Math.min(n.dewasa,md);if(ma!==null)n.anak=Math.min(n.anak,ma);' +
      'if(mt!==null&&n.dewasa+n.anak>mt)n[f]=Math.max(0,n[f]-(n.dewasa+n.anak-mt));' +
      'put(w,n.dewasa,n.anak);}' +
      // the submit button reads "Ubah Jawaban" while locked; its own text is kept to put back
      'function label(){var t=document.querySelector("#zd2-rsvp-submit [data-zd-text-node]");return t&&t.firstElementChild;}' +
      'function relabel(locked){var l=label();if(!l)return;if(l.getAttribute("data-zd2-orig")===null)l.setAttribute("data-zd2-orig",l.textContent);' +
      'l.textContent=locked?T.changeAnswer:l.getAttribute("data-zd2-orig");}' +
      'window.zd2Lock=function(sent){all().forEach(function(w){var c=sent[w.getAttribute("data-zd2-counts-event")];if(!c)return;' +
      'w.querySelector(".zd2-sum").textContent=c.dewasa+c.anak>0?T.summaryYes.replace("{d}",c.dewasa).replace("{a}",c.anak):T.summaryNo;});' +
      'document.body.setAttribute("data-zd2-locked","1");relabel(true);};' +
      'window.zd2Unlock=function(){document.body.removeAttribute("data-zd2-locked");relabel(false);};' +
      'if(document.body.hasAttribute("data-zd2-locked"))relabel(true);' +
      'window.zd2Counts=function(ev){var w=wrapFor(ev);return w?{dewasa:val(w,"dewasa"),anak:val(w,"anak")}:null;};' +
      'document.addEventListener("click",function(e){' +
      'var st=e.target.closest&&e.target.closest("[data-zd2-step]");' +
      'if(st){var w=st.closest("[data-zd2-counts-event]"),f=st.getAttribute("data-zd2-field");if(w)set(w,f,val(w,f)+parseInt(st.getAttribute("data-zd2-step"),10));return;}' +
      'var at=e.target.closest&&e.target.closest("[data-zd2-attend]");' +
      'if(!at)return;var cw=wrapFor(at.getAttribute("data-zd2-event"));if(!cw)return;' +
      'if(at.getAttribute("data-zd2-attend")==="yes"){cw.style.display="flex";' +
      'if(val(cw,"dewasa")+val(cw,"anak")===0)put(cw,cw.getAttribute("data-zd2-def-dewasa"),cw.getAttribute("data-zd2-def-anak"));}' +
      'else{cw.style.display="none";put(cw,0,0);}' +
      '});' +
      // typed numbers settle on change, not per keystroke (clearing the box to retype must not snap to 0)
      'document.addEventListener("change",function(e){var i=e.target;' +
      'if(!(i.matches&&i.matches("input[data-zd2-field]")))return;' +
      'var w=i.closest("[data-zd2-counts-event]");if(w)set(w,i.getAttribute("data-zd2-field"),parseInt(i.value,10));});' +
      '})();';

    // The WhatsApp "Konfirmasi Kehadiran" link ends in #rsvp (worker.js's
    // handleWaShortLink): open the gate for the guest and scroll to the RSVP
    // section instead of making them tap through and scroll. The layout is still
    // settling right after load (fonts, the text flow above), which can outrun a
    // single smooth scroll, so it nudges back a few times - same as the .dc.html one.
    // No RSVP section (switched off, or a canvas the couple made) = just opens the gate.
    var rsvpLinkScript = '(function(){if(location.hash!=="#rsvp")return;' +
      'var gate=document.getElementById("zd-gate");if(gate)gate.click();' +
      'var n=0;function go(){var el=document.querySelector("[data-zd-section=rsvp]");' +
      'if(el)el.scrollIntoView({behavior:"smooth",block:"start"});if(++n<5)setTimeout(go,400);}' +
      'setTimeout(go,400);})();';

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
      '<style>*{box-sizing:border-box}body{margin:0;background:#e9e7d9}' +
      (wishPagerAdded ? '[data-zd2-wish-pager] button:disabled{opacity:.4;cursor:default}' : '') +
      // a repeat visit opens locked: the toggle only shows the earlier answer, the summary replaces the steppers
      'body[data-zd2-locked] [data-zd2-attend]{pointer-events:none}body[data-zd2-locked] [data-zd2-counts-event]{display:flex!important}' +
      'body[data-zd2-locked] .zd2-cnt{display:none!important}body[data-zd2-locked] .zd2-sum{display:flex!important}' +
      '.zd2-num{-moz-appearance:textfield}.zd2-num::-webkit-inner-spin-button,.zd2-num::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}' + motionCss + musicCss + '</style>' +
      '</head><body' + (motionUsed.any && gateHtml ? ' data-zd-gated="1"' : '') + ' data-zd2-slug="' + escapeHtml(data.slug || '') + '" data-zd2-guest-id="' + escapeHtml(data.guestId || '') + '"' + (data.canRsvp ? '' : ' data-zd2-can-rsvp="0"') + (data.rsvpLocked ? ' data-zd2-locked="1"' : '') + '>' +
      '<div id="zd-wrap" style="position:relative;width:100%;overflow:hidden">' +
      '<div id="zd-stage" style="' + styleStr({ position: 'absolute', top: 0, left: 0, width: px(stageWidth), height: px(totalHeight) }) + '">' +
      bodyHtml +
      '</div></div>' +
      gateHtml +
      lightboxHtml +
      musicHtml +
      '<script>window.zd2T=' + jsonForScript(ui) + ';</script>' +
      '<script>(function(){' +
      'var W=' + stageWidth + ',H=' + totalHeight + ';' +
      'var stage=document.getElementById("zd-stage"),wrap=document.getElementById("zd-wrap");' +
      'function fit(){var s=Math.min(1,window.innerWidth/W);stage.style.transform="scale("+s+")";stage.style.transformOrigin="top left";stage.style.left=Math.max(0,(window.innerWidth-W*s)/2)+"px";wrap.style.height=(H*s)+"px";}' +
      'window.addEventListener("resize",fit);fit();' +
      gateScript +
      countdownScript +
      '})();</script>' +
      '<script>' + textReflowScript + '</script>' +
      (wishPagerAdded ? '<script>window.zd2Wishes=' + jsonForScript(wishPaging) + ';</script><script>' + wishPagerScript + '</script>' : '') +
      '<script>' + lightboxScript + '</script>' +
      '<script>' + handDrawnRsvpWishScript + '</script>' +
      (motionUsed.any ? '<script>' + motionScript + '</script>' : '') +
      (musicUrl ? '<script>' + musicScript + '</script>' : '') +
      (guest.canRsvp ? '<script>' + guestCountScript + '</script>' : '') +
      (guest.canRsvp ? '<script>(' + rsvpFollowUp.toString() + ')(' + jsonForScript(followUpCfg) + ');</script>' : '') +
      '<script>' + rsvpLinkScript + '</script>' +
      '</body></html>';
  }

  return { render: render };
});
