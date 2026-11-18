/* =========================================================
   qr.mjs — 极简 QR 编码器（字节模式 / 纠错等级 L / 版本 1-5）
   仅用于在终端打印局域网地址二维码，零第三方依赖。
   ========================================================= */

const VERSIONS = {
  1: { data: 19, ec: 7, align: [] },
  2: { data: 34, ec: 10, align: [6, 18] },
  3: { data: 55, ec: 15, align: [6, 22] },
  4: { data: 80, ec: 20, align: [6, 26] },
  5: { data: 108, ec: 26, align: [6, 30] }
};

/* ---------- GF(256) ---------- */
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(function initGF() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

function gfMul(a, b) {
  if (!a || !b) return 0;
  return EXP[LOG[a] + LOG[b]];
}

/* 生成多项式 (x - a^0)(x - a^1)... */
function rsGenerator(ecLen) {
  let poly = [1];
  for (let i = 0; i < ecLen; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly; // 降幂，长度 ecLen + 1
}

function rsEncode(data, ecLen) {
  const gen = rsGenerator(ecLen);
  const rem = new Uint8Array(ecLen);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ rem[0];
    rem.copyWithin(0, 1);
    rem[ecLen - 1] = 0;
    if (factor) {
      for (let j = 0; j < ecLen; j++) rem[j] ^= gfMul(gen[j + 1], factor);
    }
  }
  return rem;
}

/* ---------- 数据编码 ---------- */
function pickVersion(byteLength) {
  for (const v of [1, 2, 3, 4, 5]) {
    // 4bit 模式 + 8bit 长度 + 数据，向上取整字节，需留终止符空间
    if (byteLength + 2 <= VERSIONS[v].data) return v;
  }
  return 0;
}

function buildCodewords(bytes, version) {
  const spec = VERSIONS[version];
  const bits = [];
  const push = (value, len) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, 8);
  for (const b of bytes) push(b, 8);

  const capacityBits = spec.data * 8;
  const term = Math.min(4, capacityBits - bits.length);
  push(0, term);
  while (bits.length % 8 !== 0) bits.push(0);

  const data = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    data.push(byte);
  }
  let pad = 0;
  while (data.length < spec.data) data.push(pad++ % 2 === 0 ? 0xec : 0x11);

  const ec = rsEncode(data, spec.ec);
  // 单块：数据码字在前，纠错码字在后
  return Uint8Array.from([...data, ...ec]);
}

/* ---------- 矩阵构建 ---------- */
function makeMatrix(version) {
  const size = 17 + version * 4;
  const modules = [];
  const reserved = [];
  for (let r = 0; r < size; r++) {
    modules.push(new Int8Array(size).fill(-1));
    reserved.push(new Uint8Array(size));
  }

  const set = (r, c, dark) => {
    if (r < 0 || c < 0 || r >= size || c >= size) return;
    modules[r][c] = dark ? 1 : 0;
    reserved[r][c] = 1;
  };

  // 定位图形 + 分隔符
  const finder = (r0, c0) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const rr = r0 + r, cc = c0 + c;
        if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
        const inRing = (r >= 0 && r <= 6 && c >= 0 && c <= 6);
        let dark = false;
        if (inRing) {
          const edge = (r === 0 || r === 6 || c === 0 || c === 6);
          const core = (r >= 2 && r <= 4 && c >= 2 && c <= 4);
          dark = edge || core;
        }
        set(rr, cc, dark);
      }
    }
  };
  finder(0, 0);
  finder(0, size - 7);
  finder(size - 7, 0);

  // 时序图形
  for (let i = 8; i < size - 8; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }

  // 校正图形
  const align = VERSIONS[version].align;
  for (const r0 of align) {
    for (const c0 of align) {
      const nearFinder =
        (r0 <= 8 && c0 <= 8) ||
        (r0 <= 8 && c0 >= size - 9) ||
        (r0 >= size - 9 && c0 <= 8);
      if (nearFinder) continue;
      for (let r = -2; r <= 2; r++) {
        for (let c = -2; c <= 2; c++) {
          const dark = Math.max(Math.abs(r), Math.abs(c)) !== 1;
          set(r0 + r, c0 + c, dark);
        }
      }
    }
  }

  // 预留格式信息区域
  for (let i = 0; i <= 8; i++) {
    if (modules[8][i] === -1) set(8, i, false);
    if (modules[i][8] === -1) set(i, 8, false);
  }
  for (let i = 0; i < 8; i++) {
    set(8, size - 1 - i, false);
    set(size - 1 - i, 8, false);
  }
  // 固定暗模块
  set(size - 8, 8, true);

  return { size, modules, reserved };
}

function placeData(m, codewords) {
  const { size, modules, reserved } = m;
  const bits = [];
  for (const b of codewords) {
    for (let i = 7; i >= 0; i--) bits.push((b >>> i) & 1);
  }

  let idx = 0;
  let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--; // 跳过竖向时序线
    for (let step = 0; step < size; step++) {
      const row = upward ? size - 1 - step : step;
      for (let k = 0; k < 2; k++) {
        const c = col - k;
        if (reserved[row][c]) continue;
        modules[row][c] = idx < bits.length ? bits[idx++] : 0;
      }
    }
    upward = !upward;
  }
  // 剩余位（不足一字节）保持 0 已处理
}

const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0
];

function applyMask(m, maskId) {
  const { size, modules, reserved } = m;
  const fn = MASKS[maskId];
  const out = modules.map((row) => Int8Array.from(row));
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (reserved[r][c]) continue;
      if (fn(r, c)) out[r][c] ^= 1;
    }
  }
  return out;
}

/* 格式信息：ECL(L=01) + mask，BCH(15,5) */
function formatBits(maskId) {
  let data = (0b01 << 3) | maskId;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

function writeFormat(matrix, size, maskId) {
  const bits = formatBits(maskId);
  const get = (i) => ((bits >>> i) & 1) === 1;   // i = 位序号（0 为最低位）
  const at = (pos) => get(14 - pos);             // copy A 按 bit14 → bit0 的顺序铺设

  for (let i = 0; i <= 5; i++) matrix[8][i] = at(i) ? 1 : 0;
  matrix[8][7] = at(6) ? 1 : 0;      // 跳过竖向时序线 (6,8) 之外的 (8,6)
  matrix[8][8] = at(7) ? 1 : 0;
  matrix[7][8] = at(8) ? 1 : 0;
  for (let i = 9; i <= 14; i++) matrix[14 - i][8] = at(i) ? 1 : 0;

  // copy B：右侧竖排 bit0..bit6，底部横排 bit7..bit14
  for (let i = 0; i <= 6; i++) matrix[size - 1 - i][8] = get(i) ? 1 : 0;
  for (let i = 7; i <= 14; i++) matrix[8][size - 15 + i] = get(i) ? 1 : 0;
  matrix[size - 8][8] = 1;           // 固定暗模块
}

function penalty(matrix) {
  const size = matrix.length;
  let score = 0;
  // 规则 1：同色连续 5 个以上
  for (let r = 0; r < size; r++) {
    let runColor = -1, run = 0;
    for (let c = 0; c < size; c++) {
      const v = matrix[r][c];
      if (v === runColor) run++;
      else { if (run >= 5) score += 3 + (run - 5); runColor = v; run = 1; }
    }
    if (run >= 5) score += 3 + (run - 5);
  }
  for (let c = 0; c < size; c++) {
    let runColor = -1, run = 0;
    for (let r = 0; r < size; r++) {
      const v = matrix[r][c];
      if (v === runColor) run++;
      else { if (run >= 5) score += 3 + (run - 5); runColor = v; run = 1; }
    }
    if (run >= 5) score += 3 + (run - 5);
  }
  // 规则 2：2x2 同色块
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = matrix[r][c];
      if (v === matrix[r][c + 1] && v === matrix[r + 1][c] && v === matrix[r + 1][c + 1]) score += 3;
    }
  }
  // 规则 3：类似定位图形的 1:1:3:1:1
  const pat1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const pat2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  const lineScore = (line) => {
    let s = 0;
    for (let i = 0; i + 10 < line.length; i++) {
      let m1 = true, m2 = true;
      for (let k = 0; k < 11; k++) {
        if (line[i + k] !== pat1[k]) m1 = false;
        if (line[i + k] !== pat2[k]) m2 = false;
      }
      if (m1) s += 40;
      if (m2) s += 40;
    }
    return s;
  };
  for (let r = 0; r < size; r++) score += lineScore(matrix[r]);
  for (let c = 0; c < size; c++) {
    const col = new Int8Array(size);
    for (let r = 0; r < size; r++) col[r] = matrix[r][c];
    score += lineScore(col);
  }
  // 规则 4：暗模块比例偏离 50%
  let dark = 0;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (matrix[r][c]) dark++;
  const ratio = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(ratio - 50) / 5) * 10;
  return score;
}

/**
 * 生成二维码矩阵
 * @param {string} text 内容（UTF-8 字节）
 * @returns {{size:number, modules:Int8Array[]}} 1 = 深色模块
 */
export function qrMatrix(text) {
  const bytes = Array.from(Buffer.from(String(text), 'utf8'));
  const version = pickVersion(bytes.length);
  if (!version) throw new Error('内容过长，无法生成二维码');

  const codewords = buildCodewords(bytes, version);
  const m = makeMatrix(version);
  placeData(m, codewords);

  let best = null;
  let bestScore = Infinity;
  for (let maskId = 0; maskId < 8; maskId++) {
    const matrix = applyMask(m, maskId);
    writeFormat(matrix, m.size, maskId);
    const score = penalty(matrix);
    if (score < bestScore) { bestScore = score; best = matrix; }
  }
  return { size: m.size, modules: best };
}

/* ---------- 终端渲染 ---------- */
const ESC = (fg, bg) => `\x1b[38;5;${fg ? 16 : 231}m\x1b[48;5;${bg ? 16 : 231}m`;

/**
 * 用半块字符渲染二维码（上下各一个模块），带 2 模块静区。
 * 强制黑白配色，避免深色终端导致反色扫不出来。
 */
export function renderTerminal(text, { quiet = 2, indent = '  ' } = {}) {
  const { size, modules } = qrMatrix(text);
  const total = size + quiet * 2;
  const at = (r, c) => {
    const rr = r - quiet, cc = c - quiet;
    if (rr < 0 || cc < 0 || rr >= size || cc >= size) return 0;
    return modules[rr][cc];
  };

  const lines = [];
  for (let r = 0; r < total; r += 2) {
    let line = '';
    let cur = -1;
    for (let c = 0; c < total; c++) {
      const top = at(r, c) ? 1 : 0;
      const bottom = r + 1 < total ? (at(r + 1, c) ? 1 : 0) : 0;
      const key = top * 2 + bottom;
      if (key !== cur) {
        line += ESC(top, bottom);
        cur = key;
      }
      line += '\u2580';
    }
    line += '\x1b[0m';
    lines.push(indent + line);
  }
  return lines.join('\n');
}