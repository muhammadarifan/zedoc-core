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
    var open = '<' + view.tag + attrs + ' style="' + styleText(view.style || {}) + '">';
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
      case 'icon':
      case 'block': return [{ ext: node.type, node: node, ctx: ctx }];
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
    nodeView: nodeView, groupCtx: groupCtx, childViews: childViews, repeatItemViews: repeatItemViews, contentViews: contentViews,
    childPath: childPath, itemPath: itemPath, COUPLE_FIELD_REMAP: COUPLE_FIELD_REMAP, eventUnboundTextKey: eventUnboundTextKey
  };
});
