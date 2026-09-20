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

  return { repeatGridPlacements: repeatGridPlacements, reflowNodes: reflowNodes, flowBoxes: flowBoxes };
});
