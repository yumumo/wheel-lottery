/* app.js —— 幸运转盘主逻辑 */
'use strict';
(() => {
  const MAX_ITEMS = 60;
  const STORE_KEY = 'wheel-items-v1';

  // 马卡龙色板
  const PALETTE = [
    '#FFB3BA', '#FFDFBA', '#FFFFBA', '#BAFFC9', '#BAE1FF', '#D4BAFF',
    '#FFB3E6', '#B3FFE0', '#FFD4BA', '#C9FFB3', '#B3D9FF', '#E6B3FF',
  ];

  const state = {
    items: [],
    totalAngle: 0,      // 当前累计旋转角（rad）
    spinning: false,
    lastWin: -1,
    animId: 0,
    toastTimer: 0,
  };

  const $ = (id) => document.getElementById(id);
  const canvas = $('wheel');
  const ctx = canvas.getContext('2d');
  const listEl = $('list');
  const countEl = $('count');
  const spinBtn = $('spinBtn');
  const toastEl = $('toast');

  /* ---------------- 存储 ---------------- */
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state.items)); } catch (e) { /* 隐私模式忽略 */ }
  }
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          state.items = arr
            .filter((it) => it && typeof it.label === 'string')
            .map((it) => ({
              label: it.label,
              weight: (Number(it.weight) > 0 ? Number(it.weight) : 1),
              color: /^#[0-9a-fA-F]{6}$/.test(it.color || '') ? it.color : pickColor(0),
            }));
        }
      }
    } catch (e) { /* 数据损坏则从默认开始 */ }
  }

  function pickColor(i) { return PALETTE[i % PALETTE.length]; }

  /* ---------------- 选项操作 ---------------- */
  function addItem(label = '新选项', weight = 1, silent = false) {
    if (state.items.length >= MAX_ITEMS) { toast(`最多 ${MAX_ITEMS} 个选项`); return false; }
    let i = 0; // 找第一个还没被用掉的色号，让相邻颜色尽量不重复
    let color = pickColor(i);
    while (state.items.some((it) => it.color === color)) { i++; color = pickColor(i); }
    state.items.push({ label, weight, color });
    refresh(silent);
    return true;
  }
  function removeItem(idx) {
    state.items.splice(idx, 1);
    refresh();
  }
  // 编辑（名称/权重）：只改状态 + 重绘 + 保存，不重建列表，避免输入框失焦
  function updateItem(idx, patch) {
    state.items[idx] = Object.assign({}, state.items[idx], patch);
    draw();
    save();
  }
  function equalize() {
    state.items.forEach((it) => { it.weight = 1; });
    refresh();
    toast('已均分，每个选项概率相等 ✨');
  }
  function recolor() {
    const pool = PALETTE.slice();
    // Fisher–Yates 洗牌，让每个选项随机拿一个马卡龙色
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    state.items.forEach((it, i) => { it.color = pool[i % pool.length]; });
    refresh();
    toast('已随机换色 🌈');
  }
  function clearAll() {
    if (!state.items.length) return;
    state.items = [];
    refresh();
    toast('已清空');
  }

  // 结构变化后全量刷新（列表 + 转盘 + 存储）
  function refresh(silent) {
    renderList();
    draw();
    save();
    if (!silent) countEl.textContent = state.items.length;
  }

  /* ---------------- 列表渲染 ---------------- */
  function renderList() {
    countEl.textContent = state.items.length;
    if (!state.items.length) {
      listEl.innerHTML = '';
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = '还没有选项～\n点「＋ 添加选项」或「📥 导入」开始吧';
      listEl.appendChild(empty);
      return;
    }
    const frag = document.createDocumentFragment();
    state.items.forEach((it, i) => {
      const row = document.createElement('div');
      row.className = 'item';
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = it.color;
      const labelIn = document.createElement('input');
      labelIn.type = 'text';
      labelIn.className = 'label';
      labelIn.maxLength = 40;
      labelIn.value = it.label; // value 赋值天然转义，无 XSS
      const weightIn = document.createElement('input');
      weightIn.type = 'number';
      weightIn.className = 'weight';
      weightIn.min = '0.1';
      weightIn.step = 'any';
      weightIn.value = it.weight;
      const del = document.createElement('button');
      del.className = 'del';
      del.textContent = '✕';
      row.append(dot, labelIn, weightIn, del);
      labelIn.addEventListener('input', () => updateItem(i, { label: labelIn.value }));
      weightIn.addEventListener('input', () => {
        const w = Number(weightIn.value);
        updateItem(i, { weight: w > 0 ? w : 1 });
      });
      del.addEventListener('click', () => removeItem(i));
      frag.appendChild(row);
    });
    listEl.innerHTML = '';
    listEl.appendChild(frag);
  }

  /* ---------------- 转盘绘制 ---------------- */
  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const size = Math.floor(canvas.clientWidth * dpr);
    if (canvas.width !== size || canvas.height !== size) {
      canvas.width = size;
      canvas.height = size;
    }
  }

  function totalWeight() {
    return state.items.reduce((s, it) => s + Math.max(0, it.weight), 0);
  }

  function sectorAngles() {
    const total = totalWeight();
    return state.items.map((it) => (total > 0 ? (Math.max(0, it.weight) / total) * Math.PI * 2 : 0));
  }

  function draw() {
    resizeCanvas();
    const dpr = window.devicePixelRatio || 1;
    const size = canvas.width;
    const cx = size / 2, cy = size / 2;
    const R = size / 2 - 8 * dpr;
    ctx.clearRect(0, 0, size, size);

    if (!state.items.length) {
      ctx.fillStyle = '#fdf1de';
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#d9c3a8';
      ctx.font = `${16 * dpr}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('先添加选项吧', cx, cy);
      return;
    }

    const angles = sectorAngles();
    const total = totalWeight();
    const maxLen = Math.max.apply(null, state.items.map((it) => it.label.length));
    // 字号：标签总宽约等于 0.9R，再限制在 10~20px
    const fontSize = clamp(Math.min(R * 0.22, (R * 0.9) / Math.max(1, maxLen)), 10 * dpr, 20 * dpr);

    // 中奖高亮：在旋转坐标系内重画一次该扇区描边（金色 + 提亮）
    const hl = state.lastWin >= 0 && state.lastWin < state.items.length ? state.lastWin : -1;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(state.totalAngle);

    let start = -Math.PI / 2;
    state.items.forEach((it, i) => {
      const ang = angles[i];
      const mid = start + ang / 2;

      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, R, start, start + ang);
      ctx.closePath();
      if (i === hl) {
        ctx.fillStyle = lighten(it.color);
      } else {
        ctx.fillStyle = it.color;
      }
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.5 * dpr;
      ctx.stroke();

      if (ang > 0.12) { // 扇区太窄就不写文字
        ctx.save();
        ctx.rotate(mid);
        // 底部半圆翻转 180°，保证文字可正读（头部朝内属主流妥协，可读性优先）
        const needFlip = mid > Math.PI / 2 && mid < Math.PI * 1.5;
        if (needFlip) ctx.rotate(Math.PI);
        ctx.fillStyle = '#5b4636';
        ctx.font = `700 ${fontSize}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(it.label, needFlip ? -R * 0.58 : R * 0.58, 0);
        ctx.restore();
      }
      start += ang;
    });
    ctx.restore();

    // 中奖扇区金色描边
    if (hl >= 0) {
      let s2 = -Math.PI / 2;
      for (let i = 0; i < hl; i++) s2 += angles[i];
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(state.totalAngle);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, R * 0.985, s2, s2 + angles[hl]);
      ctx.closePath();
      ctx.lineWidth = 5 * dpr;
      ctx.strokeStyle = 'rgba(255, 201, 60, 0.95)';
      ctx.stroke();
      ctx.restore();
    }

    // 中心装饰圆
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.2, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 3 * dpr;
    ctx.strokeStyle = '#ffd1a8';
    ctx.stroke();
  }

  function lighten(hex) {
    // 简单提亮：转 RGB 后向白色方向混合 22%
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const m = (c) => Math.round(c + (255 - c) * 0.22);
    return `rgb(${m(r)}, ${m(g)}, ${m(b)})`;
  }

  function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

  /* ---------------- 抽奖 ---------------- */
  function pickIndex() {
    const total = totalWeight();
    if (total <= 0) return 0;
    let r = Math.random() * total;
    for (let i = 0; i < state.items.length; i++) {
      r -= Math.max(0, state.items[i].weight);
      if (r <= 0) return i;
    }
    return state.items.length - 1;
  }

  function spin() {
    if (state.spinning) return;
    if (!state.items.length) { toast('先添加选项再抽奖吧～'); return; }
    const total = totalWeight();
    if (total <= 0) { toast('权重不能全为 0'); return; }

    // 按概率选定结果
    const idx = pickIndex();

    // 扇区内的随机落点：不固定正中，更接近真实转盘手感（留 20% 边缘余量避免贴边）
    const angles = sectorAngles();
    let mid = -Math.PI / 2;
    for (let i = 0; i <= idx; i++) {
      if (i === idx) mid += angles[i] * (0.2 + Math.random() * 0.6);
      else mid += angles[i];
    }

    // 指针固定于 -PI/2：转盘角 + 总旋转角 ≡ -PI/2 (mod 2PI)，
    // 即 target = -PI/2 - mid + 2PI*k，选一个在当前角度之后的 k
    const cur = state.totalAngle;
    const base = -Math.PI / 2 - mid;
    const spins = 5 + Math.floor(Math.random() * 4); // 5~8 圈
    // 找到比 cur 更大的同余目标：从 cur 向上取整到同余类的下一圈
    const k = Math.floor((cur - base) / (Math.PI * 2)) + 1;
    const target = base + k * Math.PI * 2 + spins * Math.PI * 2;

    state.spinning = true;
    spinBtn.disabled = true;
    state.lastWin = -1;

    const t0 = performance.now();
    const duration = 3600;
    const from = cur;
    const delta = target - from;

    cancelAnimationFrame(state.animId);
    const tick = (now) => {
      const t = Math.min(1, (now - t0) / duration);
      const ease = 1 - Math.pow(1 - t, 4); // easeOutQuart：先快后慢
      state.totalAngle = from + delta * ease;
      draw();
      if (t < 1) {
        state.animId = requestAnimationFrame(tick);
      } else {
        finishSpin(idx);
      }
    };
    state.animId = requestAnimationFrame(tick);
  }

  function finishSpin(idx) {
    state.spinning = false;
    spinBtn.disabled = false;
    state.lastWin = idx;
    draw();
    vibrate();
    playDing();
    showResult(state.items[idx].label);
  }

  /* ---------------- 音效 / 震动 ---------------- */
  let audioCtx = null;
  function playDing() {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const t = audioCtx.currentTime;
      [523.25, 659.25, 783.99].forEach((f, i) => {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.type = 'triangle';
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t + i * 0.12);
        g.gain.exponentialRampToValueAtTime(0.35, t + i * 0.12 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.12 + 0.3);
        o.connect(g); g.connect(audioCtx.destination);
        o.start(t + i * 0.12); o.stop(t + i * 0.12 + 0.32);
      });
    } catch (e) { /* 不支持则静音 */ }
  }
  function vibrate() {
    try { if (navigator.vibrate) navigator.vibrate([60, 40, 60]); } catch (e) { /* ignore */ }
  }

  /* ---------------- 结果弹窗 ---------------- */
  const resultDialog = $('resultDialog');
  const resultText = $('resultText');
  function showResult(label) {
    resultText.textContent = label;
    openDialog(resultDialog);
  }
  $('againBtn').addEventListener('click', () => { closeDialog(resultDialog); setTimeout(spin, 90); });
  $('resultCloseBtn').addEventListener('click', () => closeDialog(resultDialog));

  /* ---------------- 弹窗工具 ---------------- */
  function openDialog(d) {
    if (typeof d.showModal === 'function') d.showModal();
    else d.setAttribute('open', '');
  }
  function closeDialog(d) {
    if (typeof d.close === 'function') d.close();
    else d.removeAttribute('open');
  }

  /* ---------------- 导入 ---------------- */
  const importDialog = $('importDialog');
  const fileInput = $('fileInput');
  const importMsg = $('importMsg');

  $('importBtn').addEventListener('click', () => {
    importMsg.textContent = '';
    importMsg.className = 'msg';
    fileInput.value = '';
    openDialog(importDialog);
  });

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    importMsg.textContent = '解析中…';
    importMsg.className = 'msg';
    try {
      const rows = await readFileRows(file);
      if (!rows.length) { importMsg.textContent = '没有解析到有效选项，请检查格式'; return; }
      importMsg.textContent = `解析成功：${rows.length} 项 ✨（点击下方「替换」或「追加」）`;
      importMsg.className = 'msg ok';
      importDialog.dataset.rows = JSON.stringify(rows);
    } catch (e) {
      importMsg.textContent = '解析失败：' + (e && e.message ? e.message : e);
    }
  });

  function applyRows(mode) {
    const raw = importDialog.dataset.rows;
    if (!raw) { toast('请先选择文件'); return; }
    const rows = JSON.parse(raw);
    if (mode === 'replace') {
      state.items = [];
      state.totalAngle = 0; // 重置旋转角
    }
    let added = 0;
    for (const pair of rows) {
      if (addItem(pair[0], pair[1], true)) added++;
    }
    state.lastWin = -1;
    renderList(); draw(); save();
    closeDialog(importDialog);
    importDialog.dataset.rows = '';
    toast(`已${mode === 'replace' ? '替换为' : '追加'} ${added} 项 🎉`);
  }
  $('replaceBtn').addEventListener('click', () => applyRows('replace'));
  $('appendBtn').addEventListener('click', () => applyRows('append'));

  // 由 File 推断格式扩展名。
  // Android WebView 经 content:// 选文件时 file.name 常为空或无扩展名，
  // 此时退回 MIME 判断，否则导入功能在 APK 里会失效。
  function extOf(file) {
    const m = (file.name || '').toLowerCase().match(/\.(txt|csv|xlsx|xls|docx)$/);
    if (m) return m[1];
    const t = (file.type || '').toLowerCase();
    if (!t) return null;
    if (t.includes('spreadsheetml') || t.includes('ms-excel')) return 'xlsx';
    if (t.includes('wordprocessingml') || t.includes('msword')) return 'docx';
    if (t.includes('csv')) return 'csv';
    if (t.startsWith('text/')) return 'txt';
    return null;
  }

  async function readFileRows(file) {
    const ext = extOf(file);
    if (ext === 'txt' || ext === 'csv') {
      return WheelParser.parseText(await readAsText(file));
    }
    if (ext === 'xlsx' || ext === 'xls') {
      if (!window.XLSX) throw new Error('解析库未加载，请联网后重试');
      const buf = await readAsBuffer(file);
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      if (!ws) throw new Error('Excel 文件里没有工作表');
      const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
      return WheelParser.parseExcel(aoa);
    }
    if (ext === 'docx') {
      if (!window.JSZip) throw new Error('解析库未加载，请联网后重试');
      const buf = await readAsBuffer(file);
      const zip = await JSZip.loadAsync(buf);
      const xmlFile = zip.file('word/document.xml');
      if (!xmlFile) throw new Error('不是有效的 .docx 文件');
      const xml = await xmlFile.async('string');
      return WheelParser.parseDocxXML(xml);
    }
    throw new Error('仅支持 .txt / .csv / .xlsx / .xls / .docx');
  }

  // File.text()/arrayBuffer() 在较旧的 Android WebView 上缺失，退回 FileReader
  function readAsText(file) {
    if (file.text) return file.text();
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result || ''));
      fr.onerror = () => reject(fr.error || new Error('读取失败'));
      fr.readAsText(file, 'utf-8');
    });
  }
  function readAsBuffer(file) {
    if (file.arrayBuffer) return file.arrayBuffer();
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(fr.error || new Error('读取失败'));
      fr.readAsArrayBuffer(file);
    });
  }

  /* ---------------- 初始化 ---------------- */
  load();
  renderList();
  draw();
  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(draw, 120);
  });

  spinBtn.addEventListener('click', spin);
  $('equalBtn').addEventListener('click', equalize);
  $('recolorBtn').addEventListener('click', recolor);
  $('clearBtn').addEventListener('click', clearAll);
  $('addBtn').addEventListener('click', () => addItem());

  // 首次交互时解锁音频（浏览器自动播放策略）
  document.addEventListener('pointerdown', () => {
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  }, { once: true });

  /* ---------------- Toast ---------------- */
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
  }
})();