(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ZeDocCore = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function repeatGridPlacements(origin, itemW, itemH, columns, gap, count) {
    var safeColumns = Math.max(1, Math.round(columns));
    var cellW = (itemW - (safeColumns - 1) * gap) / safeColumns;
    var scale = itemW > 0 ? cellW / itemW : 1;
    var cellH = itemH * scale;
    var placements = [];

    for (var i = 0; i < count; i++) {
      var row = Math.floor(i / safeColumns);
      var col = i % safeColumns;
      placements.push({
        x: origin.x + col * (cellW + gap),
        y: origin.y + row * (cellH + gap),
        scale: scale
      });
    }

    var rows = Math.ceil(count / safeColumns);
    var totalHeight = rows > 0 ? rows * cellH + (rows - 1) * gap : 0;
    return { placements: placements, totalHeight: totalHeight };
  }

  /** Shared repeat geometry used by React and the guest DOM adapter. */
  function reflowNodes(nodes, data) {
    var repeats = [];
    nodes.forEach(function (node) {
      if (node.type !== 'repeat') return;
      var items = data[node.listKey];
      var count = Array.isArray(items) ? items.length : 0;
      var baseline = node.verifiedCount != null ? node.verifiedCount : 1;
      var columns = node.columns || 1;
      var amount;

      if (columns > 1) {
        var gap = node.gap || 0;
        var nowHeight = repeatGridPlacements({ x: 0, y: 0 }, node.frame.w, node.frame.h, columns, gap, count).totalHeight;
        var baselineHeight = repeatGridPlacements({ x: 0, y: 0 }, node.frame.w, node.frame.h, columns, gap, baseline).totalHeight;
        amount = Math.max(0, nowHeight - baselineHeight);
      } else {
        amount = Math.max(0, count - baseline) * node.frame.h;
      }

      if (amount > 0) repeats.push({ y: node.frame.y, amount: amount });
    });

    repeats.sort(function (a, b) { return a.y - b.y; });

    function shiftAbove(y) {
      var total = 0;
      for (var i = 0; i < repeats.length; i++) {
        if (repeats[i].y < y) total += repeats[i].amount;
      }
      return total;
    }

    var items = nodes.map(function (node) {
      return { node: node, y: node.frame.y + shiftAbove(node.frame.y) };
    });

    var bgHeightGrow = {};
    nodes.forEach(function (node, i) {
      if (node.type !== 'shape' || !/background$/i.test(node.name || '')) return;
      var y0 = node.frame.y;
      var y1 = y0 + node.frame.h;
      var grow = 0;
      for (var j = 0; j < repeats.length; j++) {
        if (repeats[j].y >= y0 && repeats[j].y < y1) grow += repeats[j].amount;
      }
      if (grow > 0) bgHeightGrow[i] = grow;
    });

    var extra = repeats.reduce(function (sum, repeat) { return sum + repeat.amount; }, 0);
    return { items: items, extra: extra, bgHeightGrow: bgHeightGrow };
  }

  /**
   * Text flow: the one place that decides how much room grown text takes and
   * what moves because of it. Shared by the guest page (a DOM adapter inside
   * engine.js's runtime script, inlined via toString - so this function must
   * stay self-contained: no references to anything else in this file) and
   * the designer canvas (an adapter over the document model).
   *
   * A box is { top, height, textHeight?, stretch?, children? }:
   *   - textHeight: a text leaf's real rendered height. It grows to fit when
   *     that is taller than `height`; it never shrinks.
   *   - children: makes the box a container (group, repeat item). It grows
   *     by however much its own children's flow grew.
   *   - stretch: a partial background (card, pill). It grows by the growth of
   *     the siblings that start inside its own [top, top+height) span, so a
   *     card still wraps its text - same rule reflowNodes applies to repeats.
   * Boxes are laid out top to bottom by `top` (ties keep array order). Every
   * later sibling shifts down by the growth above it, whatever its x.
   *
   * Writes `y` and `h` (final top and height) onto each box, recursively, and
   * returns { shift, bottom }: the container's total growth and the lowest
   * edge of its content.
   */
  function flowBoxes(boxes) {
    var order = boxes.map(function (box, index) { return { box: box, index: index }; })
      .sort(function (a, b) { return a.box.top - b.box.top || a.index - b.index; });
    var shift = 0;
    var bottom = 0;
    order.forEach(function (entry) {
      var box = entry.box;
      var grow = 0;
      box.y = box.top + shift;
      box.h = box.height;
      if (box.children) {
        grow = flowBoxes(box.children).shift;
      } else if (box.textHeight != null && box.textHeight > box.height) {
        grow = box.textHeight - box.height;
      }
      box.grow = box.stretch ? 0 : grow;
      if (!box.stretch) box.h = box.height + grow;
      shift += box.grow;
    });
    boxes.forEach(function (box) {
      if (!box.stretch) return;
      var extra = 0;
      boxes.forEach(function (other) {
        if (other !== box && other.grow > 0 && other.top >= box.top && other.top < box.top + box.height) extra += other.grow;
      });
      box.h = box.height + extra;
    });
    boxes.forEach(function (box) { bottom = Math.max(bottom, box.y + box.h); });
    return { shift: shift, bottom: bottom };
  }

  // ---------------------------------------------------------------------
  // Resolve layer: document values -> CSS / text / urls. Pure functions of
  // (node, ctx) with ctx = { theme, data, assets, repeatItem?, fontStyleOverride?,
  // preferLiteralText? }; the guest engine and the designer canvas both call
  // these instead of keeping their own copies. Style values carry their units
  // ('12px') so the result is valid as React inline style and as CSS text.
  // ---------------------------------------------------------------------

  /**
   * The invitation data vocabulary - a closed list, ported from
   * be-invitation/templates/VARIABLE_REFERENCE.md. A key outside it renders
   * empty for every real couple, so there is no "add your own key" path.
   */
  var FIELDS = [
    {"key": "guest_name", "label": "Nama tamu", "kind": "text", "group": "opening", "sample": "Bapak/Ibu/Saudara/i Tamu Undangan"},
    {"key": "teks_tombol_buka", "label": "Tombol buka undangan", "kind": "text", "group": "opening", "sample": "Buka Undangan"},
    {"key": "judul_acara", "label": "Judul acara", "kind": "text", "group": "cover", "sample": "The Wedding Of"},
    {"key": "nama_panggilan_mempelai_1", "label": "Nama panggilan mempelai 1", "kind": "text", "group": "cover", "sample": "Bagas"},
    {"key": "nama_panggilan_mempelai_2", "label": "Nama panggilan mempelai 2", "kind": "text", "group": "cover", "sample": "Larasati"},
    {"key": "tanggal_acara_cover", "label": "Tanggal di sampul", "kind": "text", "group": "cover", "sample": "12 . 06 . 2027"},
    {"key": "teks_judul_profil_1", "label": "Judul mempelai baris 1", "kind": "text", "group": "couple", "sample": "Mempelai"},
    {"key": "teks_judul_profil_2", "label": "Judul mempelai baris 2", "kind": "text", "group": "couple", "sample": "Kedua Mempelai"},
    {"key": "teks_judul_countdown_1", "label": "Judul hitung mundur baris 1", "kind": "text", "group": "countdown", "sample": "Menuju Hari Bahagia"},
    {"key": "teks_judul_countdown_2", "label": "Judul hitung mundur baris 2", "kind": "text", "group": "countdown", "sample": "Hitung Mundur"},
    {"key": "teks_countdown_hari", "label": "Satuan hari", "kind": "text", "group": "countdown", "sample": "Hari"},
    {"key": "teks_countdown_jam", "label": "Satuan jam", "kind": "text", "group": "countdown", "sample": "Jam"},
    {"key": "teks_countdown_menit", "label": "Satuan menit", "kind": "text", "group": "countdown", "sample": "Menit"},
    {"key": "teks_countdown_detik", "label": "Satuan detik", "kind": "text", "group": "countdown", "sample": "Detik"},
    {"key": "teks_judul_jadwal_1", "label": "Judul jadwal baris 1", "kind": "text", "group": "events", "sample": "Jadwal"},
    {"key": "teks_judul_jadwal_2", "label": "Judul jadwal baris 2", "kind": "text", "group": "events", "sample": "Acara"},
    {"key": "teks_buka_peta", "label": "Tombol buka peta", "kind": "text", "group": "events", "sample": "Buka Peta"},
    {"key": "teks_tambah_ke_kalender", "label": "Tombol tambah ke kalender", "kind": "text", "group": "events", "sample": "+ Kalender"},
    {"key": "teks_judul_love_story_1", "label": "Judul kisah cinta baris 1", "kind": "text", "group": "loveStory", "sample": "Kisah"},
    {"key": "teks_judul_love_story_2", "label": "Judul kisah cinta baris 2", "kind": "text", "group": "loveStory", "sample": "Cinta Kami"},
    {"key": "teks_judul_love_story_3", "label": "Judul kisah cinta baris 3", "kind": "text", "group": "loveStory", "sample": "Perjalanan"},
    {"key": "teks_judul_galeri_1", "label": "Judul galeri baris 1", "kind": "text", "group": "gallery", "sample": "Galeri"},
    {"key": "teks_judul_galeri_2", "label": "Judul galeri baris 2", "kind": "text", "group": "gallery", "sample": "Momen Kami"},
    {"key": "teks_judul_live_streaming", "label": "Judul live streaming", "kind": "text", "group": "liveStreaming", "sample": "Live Streaming"},
    {"key": "teks_keterangan_live_streaming", "label": "Keterangan live streaming", "kind": "text", "group": "liveStreaming", "sample": "Saksikan momen bahagia kami secara langsung."},
    {"key": "teks_tombol_bergabung", "label": "Tombol bergabung", "kind": "text", "group": "liveStreaming", "sample": "Bergabung Sekarang"},
    {"key": "teks_judul_hadiah", "label": "Judul amplop", "kind": "text", "group": "envelope", "sample": "Amplop Digital"},
    {"key": "teks_keterangan_hadiah", "label": "Keterangan amplop", "kind": "text", "group": "envelope", "sample": "Doa restu Anda adalah hadiah terindah bagi kami."},
    {"key": "teks_judul_pengiriman_kado", "label": "Judul kirim kado", "kind": "text", "group": "sendGift", "sample": "Kirim Kado"},
    {"key": "nama_penerima_kado", "label": "Nama penerima kado", "kind": "text", "group": "sendGift", "sample": "Bagas Pramudya"},
    {"key": "alamat_pengiriman_kado", "label": "Alamat pengiriman", "kind": "text", "group": "sendGift", "sample": "Jl. Melati No. 21, Yogyakarta"},
    {"key": "teks_tombol_konfirmasi_wa", "label": "Tombol konfirmasi WhatsApp", "kind": "text", "group": "sendGift", "sample": "Konfirmasi via WhatsApp"},
    {"key": "teks_pesan_tanpa_kado", "label": "Pesan saat hadiah dimatikan", "kind": "text", "group": "sendGift", "sample": "Kehadiran Anda sudah lebih dari cukup bagi kami."},
    {"key": "teks_pesan_tanpa_kado_fisik", "label": "Pesan saat kado fisik dimatikan", "kind": "text", "group": "sendGift", "sample": "Mohon maaf, kami tidak menerima kado dalam bentuk barang."},
    {"key": "teks_judul_protokol_1", "label": "Judul protokol baris 1", "kind": "text", "group": "healthProtocol", "sample": "Protokol"},
    {"key": "teks_judul_protokol_2", "label": "Judul protokol baris 2", "kind": "text", "group": "healthProtocol", "sample": "Kesehatan"},
    {"key": "teks_judul_protokol_3", "label": "Judul protokol baris 3", "kind": "text", "group": "healthProtocol", "sample": "Bagi Tamu Undangan"},
    {"key": "teks_pakai_masker", "label": "Poin: pakai masker", "kind": "text", "group": "healthProtocol", "sample": "Mengenakan masker"},
    {"key": "teks_cuci_tangan", "label": "Poin: cuci tangan", "kind": "text", "group": "healthProtocol", "sample": "Mencuci tangan"},
    {"key": "teks_pakai_sabun", "label": "Poin: pakai sabun", "kind": "text", "group": "healthProtocol", "sample": "Menggunakan sabun"},
    {"key": "teks_pakai_sanitizer", "label": "Poin: pakai sanitizer", "kind": "text", "group": "healthProtocol", "sample": "Menggunakan hand sanitizer"},
    {"key": "teks_hindari_kerumunan", "label": "Poin: hindari kerumunan", "kind": "text", "group": "healthProtocol", "sample": "Menghindari kerumunan"},
    {"key": "teks_tidak_jabat_tangan", "label": "Poin: tidak berjabat tangan", "kind": "text", "group": "healthProtocol", "sample": "Tidak berjabat tangan"},
    {"key": "teks_judul_rsvp", "label": "Judul RSVP", "kind": "text", "group": "rsvp", "sample": "Konfirmasi Kehadiran"},
    {"key": "teks_tombol_konfirmasi", "label": "Tombol konfirmasi", "kind": "text", "group": "rsvp", "sample": "Kirim Konfirmasi"},
    {"key": "teks_pilihan_hadir", "label": "Pilihan hadir", "kind": "text", "group": "rsvp", "sample": "Hadir"},
    {"key": "teks_pilihan_tidak_hadir", "label": "Pilihan tidak hadir", "kind": "text", "group": "rsvp", "sample": "Tidak Hadir"},
    {"key": "teks_label_jumlah_tamu", "label": "Label jumlah tamu", "kind": "text", "group": "rsvp", "sample": "Jumlah Tamu"},
    {"key": "teks_placeholder_nama_tamu", "label": "Placeholder nama tamu", "kind": "text", "group": "rsvp", "sample": "Nama Anda"},
    {"key": "teks_rsvp_terkirim", "label": "Pesan RSVP terkirim", "kind": "text", "group": "rsvp", "sample": "Terima kasih atas konfirmasinya."},
    {"key": "teks_judul_wish", "label": "Judul ucapan", "kind": "text", "group": "wishes", "sample": "Ucapan & Doa"},
    {"key": "teks_keterangan_wish", "label": "Keterangan ucapan", "kind": "text", "group": "wishes", "sample": "Kirimkan doa terbaik Anda untuk kami."},
    {"key": "teks_placeholder_ucapan", "label": "Placeholder ucapan", "kind": "text", "group": "wishes", "sample": "Tulis ucapan Anda…"},
    {"key": "teks_tombol_kirim_ucapan", "label": "Tombol kirim ucapan", "kind": "text", "group": "wishes", "sample": "Kirim Ucapan"},
    {"key": "teks_ucapan_terkirim", "label": "Pesan ucapan terkirim", "kind": "text", "group": "wishes", "sample": "Ucapan Anda sudah terkirim."},
    {"key": "teks_terima_kasih", "label": "Teks terima kasih", "kind": "text", "group": "closing", "sample": "Terima Kasih"},
    {"key": "tambahan_thank_you_section", "label": "Teks tambahan penutup", "kind": "text", "group": "closing", "sample": "Sampai jumpa di hari bahagia kami."},
    {"key": "teks_keluarga_besar", "label": "Teks keluarga besar", "kind": "text", "group": "closing", "sample": "Kami yang berbahagia"},
    {"key": "ortu_kedua_mempelai", "label": "Orang tua kedua mempelai", "kind": "text", "group": "closing", "sample": "Keluarga Bapak Suryo & Keluarga Bapak Hartono"},
    {"key": "foto_profile_berdua", "label": "Foto berdua", "kind": "image", "group": "opening", "sample": ""},
    {"key": "foto_background_halaman_awal", "label": "Latar halaman awal", "kind": "image", "group": "cover", "sample": ""},
    {"key": "foto_background_jadwal_acara", "label": "Latar jadwal acara", "kind": "image", "group": "events", "sample": ""},
    {"key": "foto_background_thankyou", "label": "Latar penutup", "kind": "image", "group": "closing", "sample": ""},
    {"key": "link_live_streaming", "label": "Tautan live streaming", "kind": "link", "group": "liveStreaming", "sample": "https://youtube.com/live/…"},
    {"key": "link_konfirmasi_wa", "label": "Tautan konfirmasi WhatsApp", "kind": "link", "group": "sendGift", "sample": "https://wa.me/628…"},
    {"key": "link_video_youtube", "label": "Tautan video YouTube", "kind": "link", "group": "gallery", "sample": "https://youtube.com/watch?v=…"},
    {"key": "background_music", "label": "Musik latar", "kind": "audio", "group": "cover", "sample": ""},
    {"key": "countdownDatetime", "label": "Waktu acara utama", "kind": "datetime", "group": "countdown", "sample": "2027-06-12T10:00:00+07:00"}
  ];

  /** Repeating lists (VARIABLE_REFERENCE section 3), bound by repeat nodes/blocks. */
  var LISTS = [
    {"key": "couple", "label": "Mempelai", "itemKeys": ["foto", "nama", "ortu", "nama_ayah", "nama_ibu", "ig", "fb"], "fixedCount": 2},
    {"key": "quotes", "label": "Kutipan", "itemKeys": ["isi_quote", "sumber_quote"]},
    {"key": "events", "label": "Acara", "itemKeys": ["nama_acara", "keterangan", "venue", "map_href", "kalender_href", "tanggal", "jam", "zona", "acara_utama"]},
    {"key": "loveStory", "label": "Kisah cinta", "itemKeys": ["judul_cerita", "isi_cerita"]},
    {"key": "gallery", "label": "Galeri", "itemKeys": ["foto"]},
    {"key": "envelope", "label": "Amplop", "itemKeys": ["nama_bank", "no_rekening", "nama_pemilik_rekening"]},
    {"key": "wishes", "label": "Ucapan", "itemKeys": ["name", "message", "time"]}
  ];

  var FIELD_BY_KEY = {};
  FIELDS.forEach(function (field) { FIELD_BY_KEY[field.key] = field; });

  function findField(key) { return Object.prototype.hasOwnProperty.call(FIELD_BY_KEY, key) ? FIELD_BY_KEY[key] : undefined; }
  function isKnownField(key) { return findField(key) !== undefined; }

  function px(n) { return n + 'px'; }

  function resolveColor(ref, theme) {
    return ref.kind === 'token' ? theme.palette[ref.token] : ref.value;
  }

  function resolveFont(ref, theme) {
    return ref.kind === 'token' ? theme.fonts[ref.token] : ref.family;
  }

  /** Merges a section's/block's style override (palette + fonts) over the theme. */
  function mergeTheme(theme, style) {
    if (!style) return theme;
    return Object.assign({}, theme, {
      palette: Object.assign({}, theme.palette, style.palette),
      fonts: Object.assign({}, theme.fonts, style.fonts)
    });
  }

  /**
   * Folds a styled section's fontStyle (per-token size/weight/italic/
   * underline) into whatever override already applies from an enclosing
   * section, incoming taking precedence field by field.
   */
  function mergeFontStyleOverride(existing, incoming) {
    if (!incoming) return existing;
    return {
      display: Object.assign({}, existing && existing.display, incoming.display),
      body: Object.assign({}, existing && existing.body, incoming.body)
    };
  }

  /** The size/weight/italic/underline a text node renders with, after ctx.fontStyleOverride. */
  function resolveTextStyle(node, ctx) {
    var token = node.style.font.kind === 'token' ? node.style.font.token : null;
    var override = (token && ctx.fontStyleOverride) ? ctx.fontStyleOverride[token] : null;
    function pick(key) { return (override && override[key] != null) ? override[key] : node.style[key]; }
    return { size: pick('size'), weight: pick('weight'), italic: pick('italic'), underline: pick('underline') };
  }

  function findAsset(assets, assetId) {
    if (!assetId) return null;
    for (var i = 0; i < assets.length; i++) if (assets[i].id === assetId) return assets[i];
    return null;
  }

  /**
   * mapSrc rewrites an asset/image url on its way out (the designer prefixes
   * be-invitation-relative paths with its origin; the guest page needs none).
   */
  function resolveFill(fill, ctx, mapSrc) {
    switch (fill.kind) {
      case 'solid':
        return { background: resolveColor(fill.color, ctx.theme) };
      case 'gradient':
        return { background: 'linear-gradient(' + fill.angle + 'deg, ' + resolveColor(fill.from, ctx.theme) + ', ' + resolveColor(fill.to, ctx.theme) + ')' };
      case 'image': {
        var asset = findAsset(ctx.assets, fill.assetId);
        if (!asset) return {};
        return {
          backgroundImage: 'url(' + (mapSrc ? mapSrc(asset.src) : asset.src) + ')',
          backgroundSize: fill.fit === 'fill' ? '100% 100%' : fill.fit,
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
          opacity: fill.opacity
        };
      }
      default:
        return {};
    }
  }

  // Most catalog templates bake the combined "Groom & Bride" line as one
  // unbound text node with static sample text - there is no single field for
  // a two-name line to bind to - so these three node names show the couple's
  // real names instead of the baked ones.
  var COMBINED_COUPLE_NAME_NODES = { 'Envelope names': 1, 'Cover names': 1, 'Closing names': 1 };

  /**
   * The text a node shows. A bound node ignores its own text and reads the
   * data instead, falling back to the literal text only when the data has
   * nothing for that key (a design never renders an empty box).
   */
  function resolveText(node, ctx) {
    var fields = ctx.data.fields || {};
    if (!node.binding && COMBINED_COUPLE_NAME_NODES[node.name || '']) {
      return (fields.nama_panggilan_mempelai_1 || 'Bagas') + ' & ' + (fields.nama_panggilan_mempelai_2 || 'Larasati');
    }
    if (!node.binding || ctx.preferLiteralText) return node.text;

    var key = node.binding.key;
    // Known top-level fields (a repeat's own static "Buka Peta" label) always
    // come from the flat buckets; only item keys (venue, nama, isi_quote...)
    // resolve against the enclosing repeat's item.
    if (ctx.repeatItem && !isKnownField(key) && key in ctx.repeatItem) {
      var value = ctx.repeatItem[key];
      if (value) return String(value);
    }
    return bucketFor(key, ctx.data)[key] || node.text;
  }

  // The vocabulary says which bucket a known key lives in; a key it does not
  // list is looked up by where the data actually has it (links before fields).
  function bucketFor(key, data) {
    var def = findField(key);
    if (def && def.kind === 'link') return data.links || {};
    if (def && def.kind === 'audio') return data.audio || {};
    if (!def && data.links && key in data.links) return data.links;
    return data.fields || {};
  }

  /** The image URL a node shows, honouring a binding over its own asset. */
  function resolveImageSrc(node, ctx, mapSrc) {
    var map = mapSrc || function (src) { return src; };
    if (node.binding) {
      var key = node.binding.key;
      if (ctx.repeatItem && !isKnownField(key) && key in ctx.repeatItem) {
        var value = ctx.repeatItem[key];
        if (value) return map(String(value));
      }
      var bound = (ctx.data.images || {})[key];
      if (bound) return map(bound);
    }
    var asset = findAsset(ctx.assets, node.assetId);
    return asset ? map(asset.src) : null;
  }

  /** Absolute positioning for a node inside its artboard. */
  function frameStyle(frame, opacity) {
    var transforms = [];
    if (frame.rotate) transforms.push('rotate(' + frame.rotate + 'deg)');
    if (frame.flipX) transforms.push('scaleX(-1)');
    if (frame.flipY) transforms.push('scaleY(-1)');
    return {
      position: 'absolute',
      left: px(frame.x),
      top: px(frame.y),
      width: px(frame.w),
      height: px(frame.h),
      opacity: opacity,
      transform: transforms.length ? transforms.join(' ') : undefined,
      // rotation pivots on the box's own centre
      transformOrigin: 'center center'
    };
  }

  /** A "frame" group's crop, as CSS on the inner wrapper that holds its children. */
  function clipStyleFor(clip) {
    if (clip.shape === 'rect') return { overflow: 'hidden', borderRadius: px(clip.radius || 0) };
    if (clip.shape === 'ellipse') return { overflow: 'hidden', borderRadius: '50%' };
    if (clip.shape === 'custom' && clip.polygon) return { clipPath: 'polygon(' + clip.polygon + ')' };
    return {};
  }

  // ---------------------------------------------------------------------
  // Icons. The catalogue a designer can place, as lucide path data: an icon
  // node stores just a name, so the canvas and the guest page draw the very
  // same glyph. The data between the markers is generated - to add an icon,
  // edit the list in ze-designer/scripts/sync-core-icons.mjs and run
  // `npm run sync-icons` there.
  // ---------------------------------------------------------------------

  // <icons>
  var ICONS = {
    "Heart": [["path",{"d":"M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5"}]],
    "HeartHandshake": [["path",{"d":"M19.414 14.414C21 12.828 22 11.5 22 9.5a5.5 5.5 0 0 0-9.591-3.676.6.6 0 0 1-.818.001A5.5 5.5 0 0 0 2 9.5c0 2.3 1.5 4 3 5.5l5.535 5.362a2 2 0 0 0 2.879.052 2.12 2.12 0 0 0-.004-3 2.124 2.124 0 1 0 3-3 2.124 2.124 0 0 0 3.004 0 2 2 0 0 0 0-2.828l-1.881-1.882a2.41 2.41 0 0 0-3.409 0l-1.71 1.71a2 2 0 0 1-2.828 0 2 2 0 0 1 0-2.828l2.823-2.762"}]],
    "Handshake": [["path",{"d":"m11 17 2 2a1 1 0 1 0 3-3"}],["path",{"d":"m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4"}],["path",{"d":"m21 3 1 11h-2"}],["path",{"d":"M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3"}],["path",{"d":"M3 4h8"}]],
    "Star": [["path",{"d":"M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"}]],
    "Sparkle": [["path",{"d":"M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"}]],
    "Sparkles": [["path",{"d":"M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"}],["path",{"d":"M20 2v4"}],["path",{"d":"M22 4h-4"}],["circle",{"cx":"4","cy":"20","r":"2"}]],
    "Flower": [["circle",{"cx":"12","cy":"12","r":"3"}],["path",{"d":"M12 16.5A4.5 4.5 0 1 1 7.5 12 4.5 4.5 0 1 1 12 7.5a4.5 4.5 0 1 1 4.5 4.5 4.5 4.5 0 1 1-4.5 4.5"}],["path",{"d":"M12 7.5V9"}],["path",{"d":"M7.5 12H9"}],["path",{"d":"M16.5 12H15"}],["path",{"d":"M12 16.5V15"}],["path",{"d":"m8 8 1.88 1.88"}],["path",{"d":"M14.12 9.88 16 8"}],["path",{"d":"m8 16 1.88-1.88"}],["path",{"d":"M14.12 14.12 16 16"}]],
    "Flower2": [["path",{"d":"M12 5a3 3 0 1 1 3 3m-3-3a3 3 0 1 0-3 3m3-3v1M9 8a3 3 0 1 0 3 3M9 8h1m5 0a3 3 0 1 1-3 3m3-3h-1m-2 3v-1"}],["circle",{"cx":"12","cy":"8","r":"2"}],["path",{"d":"M12 10v12"}],["path",{"d":"M12 22c4.2 0 7-1.667 7-5-4.2 0-7 1.667-7 5Z"}],["path",{"d":"M12 22c-4.2 0-7-1.667-7-5 4.2 0 7 1.667 7 5Z"}]],
    "Leaf": [["path",{"d":"M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"}],["path",{"d":"M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"}]],
    "Sprout": [["path",{"d":"M14 9.536V7a4 4 0 0 1 4-4h1.5a.5.5 0 0 1 .5.5V5a4 4 0 0 1-4 4 4 4 0 0 0-4 4c0 2 1 3 1 5a5 5 0 0 1-1 3"}],["path",{"d":"M4 9a5 5 0 0 1 8 4 5 5 0 0 1-8-4"}],["path",{"d":"M5 21h14"}]],
    "TreePalm": [["path",{"d":"M13 8c0-2.76-2.46-5-5.5-5S2 5.24 2 8h2l1-1 1 1h4"}],["path",{"d":"M13 7.14A5.82 5.82 0 0 1 16.5 6c3.04 0 5.5 2.24 5.5 5h-3l-1-1-1 1h-3"}],["path",{"d":"M5.89 9.71c-2.15 2.15-2.3 5.47-.35 7.43l4.24-4.25.7-.7.71-.71 2.12-2.12c-1.95-1.96-5.27-1.8-7.42.35"}],["path",{"d":"M11 15.5c.5 2.5-.17 4.5-1 6.5h4c2-5.5-.5-12-1-14"}]],
    "Mountain": [["path",{"d":"m8 3 4 8 5-5 5 15H2L8 3z"}]],
    "Bird": [["path",{"d":"M16 7h.01"}],["path",{"d":"M3.4 18H12a8 8 0 0 0 8-8V7a4 4 0 0 0-7.28-2.3L2 20"}],["path",{"d":"m20 7 2 .5-2 .5"}],["path",{"d":"M10 18v3"}],["path",{"d":"M14 17.75V21"}],["path",{"d":"M7 18a6 6 0 0 0 3.84-10.61"}]],
    "Feather": [["path",{"d":"M14.086 18.412A2 2 0 0112.67 19H5v-7.672a2 2 0 01.586-1.414L11.75 3.75a6 6 0 118.49 8.49z"}],["path",{"d":"M16 8 2 22"}],["path",{"d":"M17.488 15H9"}]],
    "Gem": [["path",{"d":"M10.5 3 8 9l4 13 4-13-2.5-6"}],["path",{"d":"M17 3a2 2 0 0 1 1.6.8l3 4a2 2 0 0 1 .013 2.382l-7.99 10.986a2 2 0 0 1-3.247 0l-7.99-10.986A2 2 0 0 1 2.4 7.8l2.998-3.997A2 2 0 0 1 7 3z"}],["path",{"d":"M2 9h20"}]],
    "Diamond": [["path",{"d":"M2.7 10.3a2.41 2.41 0 0 0 0 3.41l7.59 7.59a2.41 2.41 0 0 0 3.41 0l7.59-7.59a2.41 2.41 0 0 0 0-3.41l-7.59-7.59a2.41 2.41 0 0 0-3.41 0Z"}]],
    "Crown": [["path",{"d":"M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z"}],["path",{"d":"M5 21h14"}]],
    "Church": [["path",{"d":"M10 9h4"}],["path",{"d":"M12 7v5"}],["path",{"d":"M14 21v-3a2 2 0 0 0-4 0v3"}],["path",{"d":"m18 9 3.52 2.147a1 1 0 0 1 .48.854V19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6.999a1 1 0 0 1 .48-.854L6 9"}],["path",{"d":"M6 21V7a1 1 0 0 1 .376-.782l5-3.999a1 1 0 0 1 1.249.001l5 4A1 1 0 0 1 18 7v14"}]],
    "Users": [["path",{"d":"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"}],["path",{"d":"M16 3.128a4 4 0 0 1 0 7.744"}],["path",{"d":"M22 21v-2a4 4 0 0 0-3-3.87"}],["circle",{"cx":"9","cy":"7","r":"4"}]],
    "MapPin": [["path",{"d":"M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"}],["circle",{"cx":"12","cy":"10","r":"3"}]],
    "Compass": [["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z"}]],
    "Calendar": [["path",{"d":"M8 2v3"}],["path",{"d":"M16 2v3"}],["rect",{"x":"3","y":"3","width":"18","height":"18","rx":"2"}],["path",{"d":"M3 9h18"}]],
    "Clock": [["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"M12 6v6l4 2"}]],
    "Camera": [["path",{"d":"M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z"}],["circle",{"cx":"12","cy":"13","r":"3"}]],
    "Music": [["path",{"d":"M9 18V5l12-2v13"}],["circle",{"cx":"6","cy":"18","r":"3"}],["circle",{"cx":"18","cy":"16","r":"3"}]],
    "Music2": [["circle",{"cx":"8","cy":"18","r":"4"}],["path",{"d":"M12 18V2l7 4"}]],
    "Gift": [["path",{"d":"M12 7v14"}],["path",{"d":"M20 11v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8"}],["path",{"d":"M7.5 7a1 1 0 0 1 0-5A4.8 8 0 0 1 12 7a4.8 8 0 0 1 4.5-5 1 1 0 0 1 0 5"}],["rect",{"x":"3","y":"7","width":"18","height":"4","rx":"1"}]],
    "Cake": [["path",{"d":"M20 21v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8"}],["path",{"d":"M4 16s.5-1 2-1 2.5 2 4 2 2.5-2 4-2 2.5 2 4 2 2-1 2-1"}],["path",{"d":"M2 21h20"}],["path",{"d":"M7 8v3"}],["path",{"d":"M12 8v3"}],["path",{"d":"M17 8v3"}],["path",{"d":"M7 4h.01"}],["path",{"d":"M12 4h.01"}],["path",{"d":"M17 4h.01"}]],
    "PartyPopper": [["path",{"d":"M5.8 11.3 2 22l10.7-3.79"}],["path",{"d":"M4 3h.01"}],["path",{"d":"M22 8h.01"}],["path",{"d":"M15 2h.01"}],["path",{"d":"M22 20h.01"}],["path",{"d":"m22 2-2.24.75a2.9 2.9 0 0 0-1.96 3.12c.1.86-.57 1.63-1.45 1.63h-.38c-.86 0-1.6.6-1.76 1.44L14 10"}],["path",{"d":"m22 13-.82-.33c-.86-.34-1.82.2-1.98 1.11c-.11.7-.72 1.22-1.43 1.22H17"}],["path",{"d":"m11 2 .33.82c.34.86-.2 1.82-1.11 1.98C9.52 4.9 9 5.52 9 6.23V7"}],["path",{"d":"M11 13c1.93 1.93 2.83 4.17 2 5-.83.83-3.07-.07-5-2-1.93-1.93-2.83-4.17-2-5 .83-.83 3.07.07 5 2Z"}]],
    "Wine": [["path",{"d":"M8 22h8"}],["path",{"d":"M7 10h10"}],["path",{"d":"M12 15v7"}],["path",{"d":"M12 15a5 5 0 0 0 5-5c0-2-.5-4-2-8H9c-1.5 4-2 6-2 8a5 5 0 0 0 5 5Z"}]],
    "Utensils": [["path",{"d":"M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"}],["path",{"d":"M7 2v20"}],["path",{"d":"M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"}]],
    "Mail": [["path",{"d":"m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7"}],["rect",{"x":"2","y":"4","width":"20","height":"16","rx":"2"}]],
    "Phone": [["path",{"d":"M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384"}]],
    "Bell": [["path",{"d":"M10.268 21a2 2 0 0 0 3.464 0"}],["path",{"d":"M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"}]],
    "Sun": [["circle",{"cx":"12","cy":"12","r":"4"}],["path",{"d":"M12 2v2"}],["path",{"d":"M12 20v2"}],["path",{"d":"m4.93 4.93 1.41 1.41"}],["path",{"d":"m17.66 17.66 1.41 1.41"}],["path",{"d":"M2 12h2"}],["path",{"d":"M20 12h2"}],["path",{"d":"m6.34 17.66-1.41 1.41"}],["path",{"d":"m19.07 4.93-1.41 1.41"}]],
    "Moon": [["path",{"d":"M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"}]],
    "Cloud": [["path",{"d":"M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"}]],
    "Quote": [["path",{"d":"M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"}],["path",{"d":"M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"}]],
    "Asterisk": [["path",{"d":"M12 6v12"}],["path",{"d":"M17.196 9 6.804 15"}],["path",{"d":"m6.804 9 10.392 6"}]],
    "CircleDot": [["circle",{"cx":"12","cy":"12","r":"10"}],["circle",{"cx":"12","cy":"12","r":"1"}]],
    "Minus": [["path",{"d":"M5 12h14"}]]
  };
  // </icons>

  /** An icon's svg as a view tree, or null for a name outside the catalogue. */
  function iconSvg(name, color, strokeWidth, style) {
    var shapes = Object.prototype.hasOwnProperty.call(ICONS, name) ? ICONS[name] : null;
    if (!shapes) return null;
    return {
      tag: 'svg',
      attrs: {
        xmlns: 'http://www.w3.org/2000/svg',
        width: '24',
        height: '24',
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: color,
        'stroke-width': String(strokeWidth),
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        'aria-hidden': 'true'
      },
      style: style,
      children: shapes.map(function (shape) { return { tag: shape[0], attrs: shape[1] }; })
    };
  }

  /**
   * An icon node. A name outside the catalogue is a dashed placeholder on the
   * canvas (so the designer can see and fix it) and nothing for a guest.
   */
  function iconView(node, ctx) {
    var svg = iconSvg(node.icon, resolveColor(node.color, ctx.theme), node.strokeWidth, { width: '100%', height: '100%', display: 'block' });
    if (svg) return svg;
    if (ctx.mode !== 'edit') return null;
    return {
      tag: 'div',
      attrs: { title: 'Ikon "' + node.icon + '" tidak ada di katalog' },
      style: { width: '100%', height: '100%', border: '1px dashed #c9c9d0', borderRadius: '4px' }
    };
  }

  // ---------------------------------------------------------------------
  // Node views. Each returns a neutral tree - { tag, attrs?, style?, children?,
  // html? } - that a host turns into its own output: toHtml() below for the
  // guest page, a small createElement adapter in the designer canvas. The
  // drawing rules therefore live here once. `attrs` keep insertion order (it
  // is the serialised attribute order); `style` is CSS-in-JS with units.
  // ---------------------------------------------------------------------

  /**
   * opts.autoHeight - leave the text box at its content height instead of
   * filling the frame. The canvas measures that height (scrollHeight) to grow
   * the frame; the guest page fills the frame and measures after resetting it.
   */
  function textView(node, ctx, opts) {
    var effective = resolveTextStyle(node, ctx);
    return {
      tag: 'div',
      style: {
        fontFamily: resolveFont(node.style.font, ctx.theme),
        fontSize: px(effective.size),
        fontWeight: effective.weight,
        lineHeight: node.style.lineHeight,
        letterSpacing: px(node.style.letterSpacing),
        textAlign: node.style.align,
        color: resolveColor(node.style.color, ctx.theme),
        fontStyle: effective.italic ? 'italic' : 'normal',
        textDecoration: effective.underline ? 'underline' : 'none',
        textTransform: node.style.transform === 'none' ? undefined : node.style.transform,
        width: '100%',
        height: opts && opts.autoHeight ? undefined : '100%',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word'
      },
      children: [resolveText(node, ctx)],
      // the canvas reads the rendered height back under this key (edit mode)
      measure: opts && opts.measure
    };
  }

  /**
   * ctx.mapSrc rewrites the url (designer origin prefix); ctx.repeatListKey ===
   * 'gallery' marks a gallery photo for the guest page's lightbox.
   */
  function imageView(node, ctx) {
    var src = resolveImageSrc(node, ctx, ctx.mapSrc);
    if (!src) {
      return {
        tag: 'div',
        style: {
          width: '100%',
          height: '100%',
          borderRadius: px(node.radius),
          background: 'repeating-conic-gradient(#e9e9ee 0% 25%, #f7f7fa 0% 50%) 50% / 16px 16px',
          border: '1px dashed #c9c9d0'
        }
      };
    }
    var isGalleryPhoto = ctx.repeatListKey === 'gallery' && ctx.mode !== 'edit';
    var attrs = { src: src, alt: node.alt, draggable: 'false' };
    if (isGalleryPhoto) attrs['data-zd-gallery-src'] = src;
    return {
      tag: 'img',
      attrs: attrs,
      style: {
        width: '100%',
        height: '100%',
        objectFit: node.fit,
        borderRadius: px(node.radius),
        display: 'block',
        cursor: isGalleryPhoto ? 'pointer' : undefined
      }
    };
  }

  function shapeView(node, ctx) {
    var mapSrc = ctx.mapSrc;
    var border = node.stroke.width > 0 ? {
      borderWidth: px(node.stroke.width),
      borderStyle: node.stroke.style,
      borderColor: resolveColor(node.stroke.color, ctx.theme)
    } : {};
    var base = Object.assign({ width: '100%', height: '100%', boxSizing: 'border-box' }, resolveFill(node.fill, ctx, mapSrc), border);

    if (node.shape === 'ellipse') return { tag: 'div', style: Object.assign({}, base, { borderRadius: '50%' }) };
    // clipped, not drawn with the border trick, so the fill can be a gradient or an image
    if (node.shape === 'triangle') return { tag: 'div', style: Object.assign({}, base, { clipPath: 'polygon(50% 0%, 100% 100%, 0% 100%)' }) };
    if (node.shape === 'line') {
      // a line ignores the frame's height and draws a rule down its middle
      var thickness = Math.max(node.stroke.width, 1);
      return {
        tag: 'div',
        style: { width: '100%', height: '100%', display: 'flex', alignItems: 'center' },
        children: [{
          tag: 'div',
          style: { width: '100%', height: px(thickness), background: resolveColor(node.stroke.color, ctx.theme), borderRadius: px(thickness) }
        }]
      };
    }
    return { tag: 'div', style: Object.assign({}, base, { borderRadius: px(node.radius) }) };
  }

  /** Literal imported SVG markup; colours are whatever the source baked in. */
  function svgView(node) {
    return { tag: 'div', style: { width: '100%', height: '100%' }, html: node.markup };
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function styleText(style) {
    var out = '';
    for (var key in style) {
      if (!Object.prototype.hasOwnProperty.call(style, key)) continue;
      var value = style[key];
      if (value === undefined || value === null || value === '') continue;
      out += key.replace(/[A-Z]/g, function (m) { return '-' + m.toLowerCase(); }) + ':' + value + ';';
    }
    return out;
  }

  var VOID_TAGS = { img: 1, br: 1, input: 1 };

  /**
   * Serialises a view tree: attrs in insertion order, then style. A `fragment`
   * is its children with no wrapper, `raw` is trusted markup, an attr set to
   * `true` is written bare (`<div data-x style=..>`), and an `ext` view (block,
   * icon: things only the host knows how to draw) is written by the host's
   * own `ext(view)` or as nothing.
   */
  function toHtml(view, ext) {
    if (typeof view === 'string') return escapeHtml(view);
    if (view.raw != null) return view.raw;
    if (view.ext) return ext ? ext(view) : '';
    if (view.fragment) return view.fragment.map(function (child) { return toHtml(child, ext); }).join('');
    var attrs = '';
    for (var name in view.attrs) {
      if (!Object.prototype.hasOwnProperty.call(view.attrs, name)) continue;
      attrs += view.attrs[name] === true ? ' ' + name : ' ' + name + '="' + escapeHtml(view.attrs[name]) + '"';
    }
    var open = '<' + view.tag + attrs + (view.style ? ' style="' + styleText(view.style) + '"' : '') + '>';
    if (VOID_TAGS[view.tag]) return open;
    var inner = view.html != null ? view.html : (view.children || []).map(function (child) { return toHtml(child, ext); }).join('');
    return open + inner + '</' + view.tag + '>';
  }

  // ---------------------------------------------------------------------
  // Node trees: a node inside its container, recursively. nodeView() is the
  // node's positioned wrapper (what the guest page and the canvas both draw
  // for a child of a group or a repeat item); contentViews() are the pieces
  // inside it. Hosts customise through ctx:
  //   ctx.mode      'edit' (designer canvas) or guest (default): the canvas
  //                 measures text at content height, shows placeholders for
  //                 empty repeats/frames, and skips guest-only hooks
  //   ctx.place     (path) -> { y, h } | undefined - where the text flow put
  //                 this node instance (canvas)
  //   ctx.decorate  (node, view, ctx, o) -> view | undefined - guest-only
  //                 behaviour (RSVP, calendar...) layered on by the engine
  // A node instance is named by its path: `id` at the top level, `group/child`
  // in a group, `repeat#2/child` in the third item of a repeat - a repeat draws
  // the same child ids once per item, so ids alone are ambiguous.
  // ---------------------------------------------------------------------

  function childPath(parent, id) { return parent + '/' + id; }
  function itemPath(repeat, index) { return repeat + '#' + index; }

  /**
   * Some repeat children were captured by the importer under a key other than
   * the item schema's own (coupleItemSchema's nama/ortu/foto), and an events
   * item's keterangan/venue have no binding at all - they are the first and
   * second unbound text in the card. Both the HTML compiler and every renderer
   * need the same effective key, so the remap lives here once.
   */
  var COUPLE_FIELD_REMAP = {
    nama_lengkap_mempelai: 'nama',
    profile_ortu_mempelai: 'ortu',
    foto_profile_mempelai: 'foto'
  };

  function eventUnboundTextKey(unboundIndex) {
    return unboundIndex === 0 ? 'keterangan' : unboundIndex === 1 ? 'venue' : null;
  }

  var CHECKERBOARD = 'repeating-conic-gradient(#e9e9ee 0% 25%, #f7f7fa 0% 50%) 50% / 16px 16px';

  function childViews(nodes, ctx, path) {
    var out = [];
    for (var i = 0; i < nodes.length; i++) {
      var view = nodeView(nodes[i], ctx, { path: childPath(path, nodes[i].id) });
      if (!view) continue;
      if (view.fragment) out = out.concat(view.fragment); else out.push(view);
    }
    return out;
  }

  // a styled group's own palette/font overrides apply to what is inside it
  function groupCtx(node, ctx) {
    if (!node.style) return ctx;
    return Object.assign({}, ctx, {
      theme: mergeTheme(ctx.theme, node.style),
      fontStyleOverride: mergeFontStyleOverride(ctx.fontStyleOverride, node.style.fontStyle)
    });
  }

  /**
   * The wrapper views of a repeat: one per real item (one empty stand-in in
   * edit mode when the list is empty), stacked at `i * frame.h` below `origin`.
   * `>1 column` lays items out as a scaled grid instead. The guest page puts
   * these straight into the section (origin = the node's own position); the
   * canvas draws them inside the repeat's box (origin 0,0, opacity 1 - the box
   * already applied it).
   */
  function repeatItemViews(node, ctx, path, o) {
    var items = ctx.data[node.listKey] || [];
    var fan = items.length > 0 ? items : (ctx.mode === 'edit' ? [undefined] : []);
    var frame = o.frame;
    var columns = node.columns || 1;
    var grid = columns > 1 ? repeatGridPlacements({ x: o.origin.x, y: o.origin.y }, frame.w, frame.h, columns, node.gap || 0, fan.length) : null;
    var views = [];
    for (var i = 0; i < fan.length; i++) {
      var item = fan[i];
      var itemCtx = item ? Object.assign({}, ctx, { repeatItem: item, repeatListKey: node.listKey }) : ctx;
      var key = itemPath(path, i);
      var style;
      if (grid) {
        var placement = grid.placements[i];
        style = frameStyle(Object.assign({}, frame, { x: placement.x, y: placement.y }), o.opacity);
        style.transform = 'scale(' + placement.scale + ')';
        style.transformOrigin = 'top left';
      } else {
        var itemFrame = Object.assign({}, frame, { x: o.origin.x, y: o.origin.y + i * frame.h });
        var placed = ctx.place && ctx.place(key);
        if (placed) itemFrame = Object.assign(itemFrame, { y: placed.y, h: placed.h });
        style = frameStyle(itemFrame, o.opacity);
      }
      var unboundEventText = 0;
      var children = node.children.map(function (child) {
        var effective = child;
        if (item && node.listKey === 'couple' && child.binding && (child.type === 'text' || child.type === 'image')) {
          var remapped = COUPLE_FIELD_REMAP[child.binding.key];
          if (remapped) effective = Object.assign({}, child, { binding: { key: remapped } });
        } else if (item && node.listKey === 'events' && child.type === 'text' && !child.binding) {
          var eventKey = eventUnboundTextKey(unboundEventText++);
          if (eventKey) effective = Object.assign({}, child, { binding: { key: eventKey } });
        }
        return effective;
      });
      views.push({ tag: 'div', style: style, children: childViews(children, itemCtx, key) });
    }
    return views;
  }

  function contentViews(node, ctx, path) {
    switch (node.type) {
      case 'text': return [textView(node, ctx, { autoHeight: ctx.mode === 'edit', measure: ctx.mode === 'edit' ? path : undefined })];
      case 'image': return [imageView(node, ctx)];
      case 'shape': return [shapeView(node, ctx)];
      case 'svg': return [svgView(node)];
      case 'icon': {
        var icon = iconView(node, ctx);
        return icon ? [icon] : [];
      }
      case 'block': return [{ ext: 'block', node: node, ctx: ctx }];
      case 'group': {
        var inner = childViews(node.children, groupCtx(node, ctx), path);
        // a "frame" crops its children to a shape; an empty one shows the same
        // checkerboard as an empty image so there is something to drop onto
        if (!node.clip) return inner;
        var clipStyle = Object.assign({ position: 'absolute', inset: '0' }, clipStyleFor(node.clip));
        if (node.children.length === 0 && ctx.mode === 'edit') {
          return [{ tag: 'div', style: clipStyle, children: [{ tag: 'div', style: { width: '100%', height: '100%', background: CHECKERBOARD } }] }];
        }
        return [{ tag: 'div', style: clipStyle, children: inner }];
      }
      default: return [];
    }
  }

  /**
   * `o`: { path, y, heightGrow } - y/heightGrow are the repeat reflow's
   * override (guest); the canvas's flow comes through ctx.place(path).
   * Returns null for a hidden node; a repeat returns { fragment: [items] }.
   */
  function nodeView(node, ctx, o) {
    if (node.visible === false) return null;
    o = o || {};
    var path = o.path || node.id;
    var frame = node.frame;
    if (o.y != null || o.heightGrow) {
      frame = Object.assign({}, frame);
      if (o.y != null) frame.y = o.y;
      if (o.heightGrow) frame.h += o.heightGrow;
    } else if (ctx.place) {
      var placed = ctx.place(path);
      if (placed) frame = Object.assign({}, frame, { y: placed.y, h: placed.h });
    }

    if (node.type === 'repeat') {
      return { fragment: repeatItemViews(node, ctx, path, { frame: frame, origin: { x: frame.x, y: frame.y }, opacity: node.opacity }) };
    }

    var attrs = {};
    if (node.type === 'text') {
      attrs['data-zd-text-node'] = node.id;
      attrs['data-zd-base-height'] = px(node.frame.h);
    } else if (node.type === 'shape' && /background$/i.test(node.name || '')) {
      // a partial background stretches with the text that grows inside it
      attrs['data-zd-flow-bg'] = '1';
    }
    var view = { tag: 'div', attrs: attrs, style: frameStyle(frame, node.opacity), children: contentViews(node, ctx, path) };
    var decorated = ctx.decorate ? ctx.decorate(node, view, ctx, { path: path, frame: frame }) : undefined;
    return decorated || view;
  }

  return {
    repeatGridPlacements: repeatGridPlacements, reflowNodes: reflowNodes, flowBoxes: flowBoxes,
    FIELDS: FIELDS, LISTS: LISTS, findField: findField, isKnownField: isKnownField,
    resolveColor: resolveColor, resolveFont: resolveFont, mergeTheme: mergeTheme,
    mergeFontStyleOverride: mergeFontStyleOverride, resolveTextStyle: resolveTextStyle,
    findAsset: findAsset, resolveFill: resolveFill, resolveText: resolveText, bucketFor: bucketFor,
    resolveImageSrc: resolveImageSrc, frameStyle: frameStyle, clipStyleFor: clipStyleFor,
    textView: textView, imageView: imageView, shapeView: shapeView, svgView: svgView, toHtml: toHtml, styleText: styleText, escapeHtml: escapeHtml,
    iconSvg: iconSvg, iconView: iconView, ICONS: ICONS,
    nodeView: nodeView, groupCtx: groupCtx, childViews: childViews, repeatItemViews: repeatItemViews, contentViews: contentViews,
    childPath: childPath, itemPath: itemPath, COUPLE_FIELD_REMAP: COUPLE_FIELD_REMAP, eventUnboundTextKey: eventUnboundTextKey
  };
});
