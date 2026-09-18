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

  return { repeatGridPlacements: repeatGridPlacements, reflowNodes: reflowNodes };
});
