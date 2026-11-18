/* =========================================================
   levels.js — 关卡布局生成器（程序化，无限关卡）
   grid[r][c]: 0 = 空, 1..5 = 砖块血量, -1 = 爆炸砖
   ========================================================= */
(function (global) {
  'use strict';

  var COLS = 12;
  var MAX_ROWS = 9;

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  /* 7 种基础图案，之后按关卡混用 */
  var patterns = [
    // 0 实心
    function (r, c, rows, cols) { return 1; },
    // 1 棋盘
    function (r, c, rows, cols) { return (r + c) % 2 === 0 ? 1 : 0; },
    // 2 金字塔
    function (r, c, rows, cols) {
      var mid = (cols - 1) / 2;
      var half = Math.floor((r + 1) * (cols / 2) / rows);
      return Math.abs(c - mid) <= half ? 1 : 0;
    },
    // 3 菱形
    function (r, c, rows, cols) {
      var midC = (cols - 1) / 2, midR = (rows - 1) / 2;
      var d = Math.abs(c - midC) / (cols / 2) + Math.abs(r - midR) / (rows / 2);
      return d <= 1.02 ? 1 : 0;
    },
    // 4 竖条纹
    function (r, c, rows, cols) { return c % 3 === 1 ? 0 : 1; },
    // 5 城墙（中间拱门）
    function (r, c, rows, cols) {
      var midC = (cols - 1) / 2;
      var arch = Math.abs(c - midC) <= 1.6 && r >= rows - 3;
      return arch ? 0 : 1;
    },
    // 6 波浪
    function (r, c, rows, cols) {
      var wave = Math.sin((c / cols) * Math.PI * 2) * (rows / 3.2);
      return Math.abs(r - (rows - 1) / 2 - wave) <= rows / 3.4 ? 1 : 0;
    },
    // 7 交错蜂窝
    function (r, c, rows, cols) {
      var off = (r % 2) ? 1 : 0;
      return (c + off) % 3 !== 2 ? 1 : 0;
    }
  ];

  function build(level) {
    level = Math.max(1, level | 0);
    var rows = clamp(4 + Math.floor((level - 1) * 0.7), 4, MAX_ROWS);
    var pi = (level - 1) % patterns.length;
    var fn = patterns[pi];
    // 高关卡叠加第二种图案做混排，避免重复感
    var fn2 = (level > patterns.length) ? patterns[(level * 3 + 1) % patterns.length] : null;

    var grid = [];
    var r, c, v;
    for (r = 0; r < rows; r++) {
      var row = [];
      for (c = 0; c < COLS; c++) {
        v = fn(r, c, rows, COLS);
        if (v && fn2) v = (fn2(r, c, rows, COLS) || v);
        if (!v) { row.push(0); continue; }

        // 血量：越靠上越硬，随关卡整体变硬
        var hp = 1;
        if (r < 2) hp += 1;
        if (r < 1 && level > 4) hp += 1;
        hp += Math.floor((level - 1) / 3);
        hp = clamp(hp, 1, 5);

        // 第 2 关起出现爆炸砖
        var bomb = level >= 2 && ((r * 7 + c * 13 + level * 5) % 11 === 0);
        row.push(bomb ? -1 : hp);
      }
      grid.push(row);
    }

    // 保证至少有一块砖（防止图案全空导致卡关）
    var any = grid.some(function (row) { return row.some(function (x) { return x !== 0; }); });
    if (!any) grid[0][Math.floor(COLS / 2)] = 1;

    return { cols: COLS, rows: rows, grid: grid };
  }

  global.Levels = { COLS: COLS, MAX_ROWS: MAX_ROWS, build: build };
})(window);