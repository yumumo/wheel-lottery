/* parser.js —— 导入解析的纯函数部分（浏览器 / Node 通用，便于自检） */
(function (g) {
  'use strict';

  // 常见的表头词（Excel 第一行第一列命中则跳过）
  const HEADERS = new Set([
    '名称', '选项', '内容', '标签', '选项名称', '选项内容', '内容名称',
    'item', 'label', 'name', 'text', 'value', 'option', 'options',
    '名称/权重', '选项/权重',
  ]);

  // 解析一行：支持 名称=权重 / 名称,权重 / 名称|权重（全角半角分隔符都认）
  // 行尾不是数字时不拆分隔符，整行作为名称
  function parseLine(line) {
    if (line == null) return null;
    const s = String(line).trim();
    if (!s || s.startsWith('#')) return null;
    const m = s.match(/^(.+?)\s*[=＝,，|｜]\s*(\d+(?:\.\d+)?)\s*$/);
    if (m && m[1].trim()) {
      const w = Number(m[2]);
      return [m[1].trim(), w > 0 ? w : 1];
    }
    return [s, 1];
  }

  // txt / csv 文本 → [[名称, 权重], ...]
  function parseText(text) {
    const rows = [];
    if (text == null) return rows;
    for (const raw of String(text).split(/\r?\n/)) {
      const p = parseLine(raw);
      if (p) rows.push(p);
    }
    return rows;
  }

  // Excel 二维数组（已转成 aoa）→ [[名称, 权重], ...]
  // A 列名称，B 列权重（可空，默认 1）；首行表头自动跳过
  function parseExcel(aoa) {
    const rows = [];
    if (!Array.isArray(aoa)) return rows;
    let first = true;
    for (const line of aoa) {
      if (!Array.isArray(line)) continue;
      const label = String(line[0] == null ? '' : line[0]).trim();
      if (!label) continue;
      if (first) {
        first = false;
        if (HEADERS.has(label.toLowerCase())) continue;
      }
      let w = 1;
      const raw = line[1];
      if (typeof raw === 'number' && raw > 0) w = raw;
      else if (typeof raw === 'string' && raw.trim()) {
        const n = Number(raw);
        if (n > 0) w = n;
      }
      rows.push([label, w]);
    }
    return rows;
  }

  // Word .docx 的 document.xml 文本 → [[名称, 权重], ...]
  // 每个段落一个选项
  function parseDocxXML(xml) {
    const rows = [];
    if (!xml) return rows;
    const doc = new DOMParser().parseFromString(String(xml), 'text/xml');
    const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const ps = doc.getElementsByTagNameNS(ns, 'p');
    for (const p of ps) {
      const ts = p.getElementsByTagNameNS(ns, 't');
      let text = '';
      for (const t of ts) text += t.textContent || '';
      const parsed = parseLine(text);
      if (parsed) rows.push(parsed);
    }
    return rows;
  }

  const api = { parseLine, parseText, parseExcel, parseDocxXML, HEADERS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  // 浏览器普通 <script> 与 Node ESM（工作区 package.json 为 type:module）都可用：
  // 一律挂到 globalThis，测试/页面通过 window.WheelParser 取用
  if (typeof globalThis !== 'undefined') globalThis.WheelParser = api;
})(typeof window !== 'undefined' ? window : globalThis);
