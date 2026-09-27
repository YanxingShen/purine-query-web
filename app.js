/* ============================================================
 * 嘌呤查询 App —— 主逻辑
 * 纯原生 JS，无框架。手机 PWA 与桌面 Electron 复用同一套。
 * 本地存储键名前缀：purineapp_
 * ============================================================ */
'use strict';

/* 应用版本（与数据版本分开） */
const APP_VERSION = '1.0.5';

/* ---------------- 0. 环境检测 ---------------- */
const IS_DESKTOP = (function () {
  try {
    if (window.electronAPI) return true;
    if (navigator.userAgent && /Electron/i.test(navigator.userAgent)) return true;
  } catch (e) {}
  return false;
})();

/* 内联 SVG 线性图标（stroke 风格，currentColor，24x24） */
const ICONS = {
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>',
  log: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11h18l-1.5 9h-15z"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
  records: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.7l4.9 4.9a7 7 0 1 1-9.8 0z"/></svg>',
  tools: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 6h8M8 12h2M14 12h2M8 16h2M14 16h2"/></svg>',
  me: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>',
  admin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5"/><path d="M3 12c0 1.7 4 3 9 3s9-1.3 9-3"/></svg>',
  keygen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="15" r="4"/><path d="m10.8 12.2 8.3-8.3M17 5l3 3M14 8l2 2"/></svg>',
  book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V4H6.5A2.5 2.5 0 0 0 4 6.5v13z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/></svg>',
  empty: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3M8 11h6"/></svg>'
};

/* ---------------- 1. 本地存储工具 ---------------- */
const LS = {
  get(k, def) {
    try { const v = localStorage.getItem('purineapp_' + k); return v == null ? def : JSON.parse(v); }
    catch (e) { return def; }
  },
  set(k, v) { try { localStorage.setItem('purineapp_' + k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem('purineapp_' + k); } catch (e) {} }
};

/* ---------------- 2. 数据库加载（localStorage 覆盖嵌入数据） ---------------- */
let DB = null;        // 当前使用的数据库对象
let KNOWLEDGE = window.KNOWLEDGE || { sections: [], disclaimer: '' };

function loadDB() {
  const override = LS.get('db_override', null);
  if (override && override.items && override.items.length) {
    DB = override;
  } else {
    DB = window.PURINE_DB;
  }
}

/* ---------------- 3. 工具函数 ---------------- */
function $(sel, root) { return (root || document).querySelector(sel); }
function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function fmtDate(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function levelTag(level) {
  return '<span class="f-tag tag-' + level + '">' + (level || '未知') + '</span>';
}
function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
// 语义化版本比较：a > b ? 1 : (a < b ? -1 : 0)
function cmpVer(a, b) {
  const pa = String(a).split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

/* ---------------- 4. 底部 Tab 渲染（按模式） ---------------- */
const TABS_MOBILE = [
  { id: 'search',  ico: 'search',  label: '查询' },
  { id: 'log',     ico: 'log',     label: '记食' },
  { id: 'records', ico: 'records', label: '记录' },
  { id: 'kb',      ico: 'book',    label: '知识' },
  { id: 'tools',   ico: 'tools',   label: '工具' },
  { id: 'me',      ico: 'me',      label: '我的' }
];
const TABS_DESKTOP = [
  { id: 'search', ico: 'search', label: '嘌呤查询' },
  { id: 'admin',   ico: 'admin',  label: '数据管理' },
  { id: 'keygen',  ico: 'keygen', label: '密钥生成器' }
];

function renderTabs() {
  const tabs = IS_DESKTOP ? TABS_DESKTOP : TABS_MOBILE;
  const bar = $('#tabbar');
  bar.innerHTML = tabs.map((t, i) =>
    '<button class="tab' + (i === 0 ? ' active' : '') + '" data-tab="' + t.id + '">' +
    (ICONS[t.ico] || '') + '<span>' + t.label + '</span></button>'
  ).join('');
  ['page-log', 'page-records', 'page-kb', 'page-tools', 'page-me'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = IS_DESKTOP ? 'none' : '';
  });
  ['page-admin', 'page-keygen'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = IS_DESKTOP ? '' : 'none';
  });
}

/* ---------------- 5. Tab 切换 ---------------- */
function switchTab(tabId) {
  $all('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
  $all('.page').forEach(p => {
    const mobileOnly = ['page-log', 'page-records', 'page-kb', 'page-tools', 'page-me'].includes(p.id);
    const desktopOnly = ['page-admin', 'page-keygen'].includes(p.id);
    let show = p.id === 'page-' + tabId;
    if (IS_DESKTOP && mobileOnly) show = false;
    if (!IS_DESKTOP && desktopOnly) show = false;
    p.classList.toggle('active', show);
  });
  const titles = { search: '嘌呤查询', log: '每日记食', records: '健康记录', kb: '健康知识', tools: '健康工具', me: '我的', keygen: '密钥生成器', admin: '数据管理' };
  $('#appTitle').textContent = titles[tabId] || '嘌呤查询';
  window.scrollTo(0, 0);
  if (tabId === 'admin') renderAdminList();
  if (tabId === 'kb') renderKbPage();
}

/* ---------------- 6. 搜索（中文 + 拼音 + 首字母，带排序） ---------------- */
// 预构建每条食物的搜索索引
let searchIndex = [];
function buildSearchIndex() {
  const pm = window.PINYIN_MAP || {};
  searchIndex = DB.items.map(item => {
    const py = pm[item.id] || [];
    const arr = Array.isArray(py) ? py : [py];
    return {
      item: item,
      nameLower: (item.name || '').toLowerCase(),
      aliasLower: (item.aliases || []).map(a => a.toLowerCase()),
      fullList: arr.map(x => (x.full || '').toLowerCase().replace(/[\s()（）]/g, '')),
      initList: arr.map(x => (x.initials || '').toLowerCase().replace(/[\s()（）]/g, ''))
    };
  });
}

// 对查询词归一化：小写、去空格标点
function normQ(q) {
  return q.toLowerCase().replace(/[\s()（）\-_,，。、]/g, '');
}

// 返回匹配分数：0=不匹配，越大越相关
// 优先级：名称精确(100) > 名称子串(80) > 别名匹配(60) > 拼音全拼(40) > 首字母(20)
function scoreEntry(idx, qNorm) {
  if (!qNorm) return 50; // 空查询：中性分
  const it = idx.item;
  // 中文/名称子串
  if (idx.nameLower === qNorm) return 100;
  if (idx.nameLower.includes(qNorm)) return 80;
  // 别名
  for (const a of idx.aliasLower) {
    if (a === qNorm) return 70;
    if (a.includes(qNorm)) return 60;
  }
  // 拼音全拼（去空格后子串）
  for (const f of idx.fullList) {
    if (f === qNorm) return 50;
    if (f.includes(qNorm)) return 40;
  }
  // 首字母
  for (const s of idx.initList) {
    if (s === qNorm) return 30;
    if (s.includes(qNorm)) return 20;
  }
  return 0;
}

let curFilterLevel = '';
let curFilterCat = '';

function renderFoodItem(item, showCat) {
  const v = item.purine_mg_per_100g;
  const valStr = v == null ? '未知' : (v + ' mg');
  return '<li data-id="' + item.id + '" class="lv-' + (item.level || '未知') + '">' +
    '<div><div class="f-name">' + escapeHtml(item.name) + '</div>' +
    '<div class="f-meta">' + escapeHtml(showCat ? item.category : (item.subcategory || item.category)) +
    (item.aliases && item.aliases.length ? ' · 别名：' + escapeHtml(item.aliases.join('、')) : '') + '</div></div>' +
    '<div class="f-right"><div class="f-val">' + valStr + '</div>' + levelTag(item.level) + '</div>' +
    '</li>';
}

function doSearch() {
  const q = normQ($('#searchInput').value || '');
  const list = searchIndex.map(idx => {
    const s = scoreEntry(idx, q);
    return { idx, score: s };
  }).filter(x => {
    if (x.score <= 0) return false;
    if (curFilterLevel && x.idx.item.level !== curFilterLevel) return false;
    if (curFilterCat && x.idx.item.category !== curFilterCat) return false;
    return true;
  }).sort((a, b) => b.score - a.score || a.idx.item.name.localeCompare(b.idx.item.name, 'zh'));

  $('#resultMeta').textContent = '共 ' + list.length + ' 条结果';
  $('#searchList').innerHTML = list.length
    ? list.map(x => renderFoodItem(x.idx.item, true)).join('')
    : '<li style="cursor:default;color:#999;justify-content:center">无匹配食物</li>';
}

/* ---------------- 7. 分类浏览 ---------------- */
function renderCatBrowser() {
  const box = $('#catBrowser');
  const cats = DB.categories;
  box.innerHTML = cats.map(cat => {
    const items = DB.items.filter(it => it.category === cat);
    return '<details class="cat-group"><summary>' + escapeHtml(cat) +
      '<span class="cat-count">' + items.length + ' 条</span></summary>' +
      '<ul class="food-list">' + items.map(it => renderFoodItem(it, false)).join('') + '</ul></details>';
  }).join('');
}

/* ---------------- 8. 大类筛选 chips ---------------- */
function renderCatFilter() {
  const box = $('#catFilterList');
  box.innerHTML = '<button class="chip' + (curFilterCat === '' ? ' active' : '') + '" data-cat="">不限</button>' +
    DB.categories.map(c => '<button class="chip' + (curFilterCat === c ? ' active' : '') + '" data-cat="' + escapeHtml(c) + '">' + escapeHtml(c) + '</button>').join('');
}

/* ---------------- 9. 食物详情弹窗 ---------------- */
let currentDetailItem = null;
function openDetail(item) {
  currentDetailItem = item;
  $('#dName').textContent = item.name;
  const v = item.purine_mg_per_100g;
  const range = item.purine_range;
  $('#dBody').innerHTML =
    '<div class="detail-title-row"><h3>' + escapeHtml(item.name) + '</h3>' + levelTag(item.level) + '</div>' +
    '<div class="detail-big-val">' + (v == null ? '未知' : v) + ' <small>mg/100g</small></div>' +
    (range && range.length === 2 ? '<div class="detail-row"><span class="k">参考范围</span>' + range[0] + '–' + range[1] + ' mg/100g</div>' : '') +
    '<div class="detail-section"><h4>基本信息</h4>' +
    '<div class="detail-row"><span class="k">大类</span>' + escapeHtml(item.category) + (item.subcategory ? ' / ' + escapeHtml(item.subcategory) : '') + '</div>' +
    (item.aliases && item.aliases.length ? '<div class="detail-row"><span class="k">别名</span>' + escapeHtml(item.aliases.join('、')) + '</div>' : '') +
    (item.preparation ? '<div class="detail-row"><span class="k">食用状态</span>' + escapeHtml(item.preparation) + '</div>' : '') +
    (item.note ? '<div class="detail-row"><span class="k">备注</span>' + escapeHtml(item.note) + '</div>' : '') +
    '</div>' +
    '<div class="detail-section"><h4>来源</h4><ul class="sources-list">' +
    (item.sources || []).map(s => '<li>' + escapeHtml(s) + '</li>').join('') + '</ul></div>';
  $('#dFoot').style.display = IS_DESKTOP ? 'none' : '';
  openModal('detailModal');
}

/* ---------------- 10. 弹窗通用 ---------------- */
function openModal(id) { document.getElementById(id).classList.add('show'); }
function closeModal(id) { document.getElementById(id).classList.remove('show'); }

/* ---------------- 11. 记食（每日嘌呤估算） ---------------- */
let logDate = todayStr();
function logKey(date) { return 'log_' + date; }

function loadLog() { return LS.get(logKey(logDate), []); }
function saveLog(arr) { LS.set(logKey(logDate), arr); }

function renderLog() {
  $('#logDate').value = logDate;
  const arr = loadLog();
  let total = 0;
  arr.forEach(e => total += e.purine);
  $('#totalPurine').textContent = Math.round(total * 10) / 10;
  let hint, cls;
  if (total < 400) { hint = '安全范围'; }
  else if (total <= 600) { hint = '注意：接近上限'; }
  else { hint = '超标：建议减少高嘌呤食物'; }
  $('#logHint').textContent = hint;

  $('#logList').innerHTML = arr.length ? arr.map((e, i) =>
    '<li><div><div class="l-name">' + escapeHtml(e.name) + '</div>' +
    '<div class="l-sub">' + e.grams + ' g · 约 ' + Math.round(e.purine * 10) / 10 + ' mg</div></div>' +
    '<button class="l-del" data-i="' + i + '">删除</button></li>'
  ).join('') : '<li style="justify-content:center;color:#999;border:none;background:none">今日还没有记录</li>';
}

/* 添加食物弹窗：搜索选择 + 克数 */
let pickedFood = null;
function openAddFood() {
  pickedFood = null;
  $('#pickSearch').value = '';
  $('#pickForm').classList.add('hidden');
  renderPickList('');
  openModal('addFoodModal');
}
function renderPickList(qRaw) {
  const q = normQ(qRaw || '');
  const list = searchIndex.map(idx => ({ idx, s: scoreEntry(idx, q) }))
    .filter(x => q ? x.s > 0 : true)
    .sort((a, b) => b.s - a.s).slice(0, 50);
  $('#pickList').innerHTML = list.length
    ? list.map(x => renderFoodItem(x.idx.item, true)).join('')
    : '<li style="cursor:default;color:#999;justify-content:center">无匹配</li>';
}

/* ---------------- 12. 饮水记录 ---------------- */
function waterKey(date) { return 'water_' + date; }
function loadWater(date) { return LS.get(waterKey(date), 0); }
function saveWater(date, ml) { LS.set(waterKey(date), ml); }

function renderWater() {
  const goal = LS.get('water_goal', 2000);
  $('#waterGoal').value = goal;
  $('#waterGoalShow').textContent = goal;
  const now = loadWater(todayStr());
  $('#waterNow').textContent = now;
  $('#waterBar').style.width = Math.min(100, (now / goal) * 100) + '%';
  drawWaterChart();
}

// 最近 7 天柱状图
function drawWaterChart() {
  const cv = $('#waterChart');
  if (!cv) return;
  const dpr = window.devicePixelRatio || 1;
  const W = cv.width, H = cv.height;
  cv.width = W * dpr; cv.height = H * dpr;
  const ctx = cv.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const s = fmtDate(d);
    days.push({ s, label: (d.getMonth() + 1) + '/' + d.getDate(), val: loadWater(s) });
  }
  const goal = LS.get('water_goal', 2000);
  const maxV = Math.max(goal, ...days.map(d => d.val), 500) * 1.15;
  const padL = 40, padR = 10, padT = 16, padB = 24;
  const cw = (W - padL - padR) / days.length;

  // Y 轴刻度
  ctx.strokeStyle = '#e3ece7'; ctx.fillStyle = '#999'; ctx.font = '12px sans-serif';
  for (let i = 0; i <= 4; i++) {
    const y = padT + (H - padT - padB) * i / 4;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
    ctx.fillText(Math.round(maxV * (4 - i) / 4) + '', 4, y + 4);
  }
  // 柱子
  days.forEach((d, i) => {
    const x = padL + cw * i + cw * 0.15;
    const bw = cw * 0.7;
    const bh = (d.val / maxV) * (H - padT - padB);
    const y = H - padB - bh;
    ctx.fillStyle = d.val >= goal ? '#2e7d5b' : '#7fc4a3';
    ctx.fillRect(x, y, bw, bh);
    ctx.fillStyle = '#667'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(d.label, x + bw / 2, H - 8);
    if (d.val > 0) { ctx.fillStyle = '#345'; ctx.fillText(d.val + '', x + bw / 2, y - 4); }
  });
  ctx.textAlign = 'start';
}

/* ---------------- 13. 尿酸记录 + 折线图 ---------------- */
function loadUric() { return LS.get('uric_records', []); }
function saveUric(arr) { LS.set('uric_records', arr); }

function renderUricList() {
  const arr = loadUric().slice().sort((a, b) => a.date < b.date ? 1 : -1);
  $('#uricList').innerHTML = arr.length ? arr.map((r, i) =>
    '<li><div><div class="u-val">' + r.value + ' μmol/L</div>' +
    '<div class="u-date">' + escapeHtml(r.date) + (r.note ? ' · ' + escapeHtml(r.note) : '') + '</div></div>' +
    '<button class="u-del" data-i="' + i + '">删除</button></li>'
  ).join('') : '<li style="justify-content:center;color:#999;border:none;background:none">暂无记录</li>';
}

let uricRange = 'week';
function drawUricChart() {
  const cv = $('#uricChart');
  if (!cv) return;
  const dpr = window.devicePixelRatio || 1;
  const W = cv.width, H = cv.height;
  cv.width = W * dpr; cv.height = H * dpr;
  const ctx = cv.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  let arr = loadUric().slice().sort((a, b) => a.date < b.date ? -1 : 1);
  const now = new Date();
  let start;
  if (uricRange === 'week') start = new Date(now.getTime() - 7 * 864e5);
  else if (uricRange === 'month') start = new Date(now.getTime() - 30 * 864e5);
  else if (uricRange === '3month') start = new Date(now.getTime() - 90 * 864e5);
  else start = null;
  if (start) {
    const ss = fmtDate(start);
    arr = arr.filter(r => r.date >= ss);
  }

  const padL = 40, padR = 16, padT = 16, padB = 28;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  let minV = 180, maxV = 540;
  arr.forEach(r => { minV = Math.min(minV, r.value); maxV = Math.max(maxV, r.value); });
  minV = Math.floor((minV - 20) / 50) * 50; maxV = Math.ceil((maxV + 20) / 50) * 50;

  // 网格 + Y 轴
  ctx.strokeStyle = '#e3ece7'; ctx.fillStyle = '#999'; ctx.font = '12px sans-serif';
  for (let i = 0; i <= 4; i++) {
    const v = minV + (maxV - minV) * i / 4;
    const y = padT + plotH - (v - minV) / (maxV - minV) * plotH;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
    ctx.fillText(Math.round(v), 4, y + 4);
  }
  // 参考线：360（绿） 420（红）
  function refLine(v, color, label) {
    const y = padT + plotH - (v - minV) / (maxV - minV) * plotH;
    ctx.strokeStyle = color; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = color; ctx.fillText(label, padL + 4, y - 3);
  }
  refLine(360, '#2e7d5b', '360');
  refLine(420, '#c0392b', '420');

  if (!arr.length) {
    ctx.fillStyle = '#999'; ctx.font = '13px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('该时间段暂无记录', W / 2, H / 2);
    ctx.textAlign = 'start';
    return;
  }

  const xOf = i => padL + (arr.length === 1 ? plotW / 2 : plotW * i / (arr.length - 1));
  const yOf = v => padT + plotH - (v - minV) / (maxV - minV) * plotH;

  // 折线
  ctx.strokeStyle = '#2e7d5b'; ctx.lineWidth = 2; ctx.beginPath();
  arr.forEach((r, i) => { const x = xOf(i), y = yOf(r.value); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
  ctx.stroke();
  // 数据点
  ctx.fillStyle = '#2e7d5b';
  arr.forEach((r, i) => {
    const x = xOf(i), y = yOf(r.value);
    ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
    // X 轴日期（稀疏显示）
    if (arr.length <= 8 || i % Math.ceil(arr.length / 6) === 0) {
      ctx.fillStyle = '#999'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(r.date.slice(5), x, H - 10);
      ctx.fillStyle = '#2e7d5b'; ctx.textAlign = 'start';
    }
  });
}

/* ---------------- 14. BMI ---------------- */
function calcBMI() {
  const h = parseFloat($('#bmiHeight').value);
  const w = parseFloat($('#bmiWeight').value);
  if (!h || !w || h <= 0 || w <= 0) { $('#bmiResult').innerHTML = '<span style="color:#c0392b">请输入有效身高体重</span>'; return; }
  const m = h / 100;
  const bmi = w / (m * m);
  let cat, tip;
  if (bmi < 18.5) { cat = '偏瘦'; }
  else if (bmi < 24) { cat = '正常'; }
  else if (bmi < 28) { cat = '超重'; }
  else { cat = '肥胖'; }
  if (bmi >= 24) tip = '超重/肥胖是高尿酸与痛风的重要危险因素，建议逐步减重。';
  else if (bmi < 18.5) tip = '体重偏轻，注意营养均衡。';
  else tip = '体重在正常范围，继续保持。';
  $('#bmiResult').innerHTML = '<b>BMI = ' + bmi.toFixed(1) + '</b>（' + cat + '）<br><span class="tip-text">' + tip + '</span>';
}

/* ---------------- 14b. 嘌呤预算计算器 ---------------- */
function calcBudget() {
  const w = parseFloat($('#budgetWeight').value);
  if (!w || w <= 0) { $('#budgetResult').innerHTML = '<span style="color:#c62828">请输入有效体重</span>'; return; }
  const acute = 150, remission = 400;
  // 按体重微调：参考指南，体重越大代谢负担略增，但急性/缓解期区间为主
  $('#budgetResult').innerHTML =
    '<div style="margin-bottom:6px">当前体重 <b>' + w + ' kg</b></div>' +
    '<div>急性期每日建议：<b style="color:#c62828"><150 mg</b></div>' +
    '<div>缓解期每日建议：<b style="color:#2e7d5b"><400 mg</b></div>' +
    '<div style="margin-top:8px;font-size:13px;color:#5a6b63">三餐分配参考：早餐约 20%、午餐约 40%、晚餐约 40%。优先选低嘌呤食物，避免集中一餐超标。</div>';
}

/* ---------------- 14c. 饮水量计算器 ---------------- */
function calcWater() {
  const w = parseFloat($('#waterCalcWeight').value);
  if (!w || w <= 0) { $('#waterCalcResult').innerHTML = '<span style="color:#c62828">请输入有效体重</span>'; return; }
  const low = Math.round(w * 30), high = Math.round(w * 35);
  const rec = Math.max(2000, Math.round((low + high) / 2));
  $('#waterCalcResult').innerHTML =
    '<div>按体重 <b>' + w + ' kg</b>，每日推荐 <b style="color:#2e7d5b">' + low + '–' + high + ' ml</b></div>' +
    '<div style="margin-top:6px">痛风患者建议至少 <b>2000 ml</b>，推荐目标 <b style="color:#2e7d5b">' + rec + ' ml</b>。</div>' +
    '<div style="margin-top:6px;font-size:13px;color:#5a6b63">分次建议：早起 300ml、上午 500ml、午餐前后 400ml、下午 500ml、晚餐前后 400ml、睡前 200ml（少量多次）。</div>';
  // 一键设为今日目标
  $('#setWaterGoal').onclick = () => { LS.set('water_goal', rec); renderWater(); alert('已将今日饮水目标设为 ' + rec + ' ml'); };
}

/* ---------------- 15. 知识库 Tab ---------------- */
let kbCat = '-1';      // 一级大类，-1=全部
let kbSubcat = '-1';   // 二级小类，-1=全部

// 汇总所有文章的 cat/subcat
function kbBuildTree() {
  const map = new Map(); // cat -> Set(subcat)
  const all = [];
  (KNOWLEDGE.sections || []).forEach((s, si) => {
    (s.articles || []).forEach((a, ai) => {
      const cat = a.cat || '未分类';
      const sub = a.subcat || '未分类';
      if (!map.has(cat)) map.set(cat, new Set());
      map.get(cat).add(sub);
      all.push({ s, si, a, ai, cat, sub });
    });
  });
  return { map, all };
}

function renderKbPage() {
  const q = ($('#kbSearch').value || '').trim().toLowerCase();
  const { map, all } = kbBuildTree();
  // 填充大类下拉
  const catSel = $('#kbCat');
  const cats = [...map.keys()].sort((a,b)=>a.localeCompare(b,'zh'));
  if (catSel.options.length !== cats.length + 1) {
    catSel.innerHTML = '<option value="-1">全部大类</option>' +
      cats.map(c => '<option value="' + escapeHtml(c) + '">' + escapeHtml(c) + '</option>').join('');
  }
  catSel.value = kbCat;
  // 填充小类下拉（联动）
  const subSel = $('#kbSubcat');
  const subCats = kbCat === '-1' ? [...new Set(all.map(x=>x.sub))].sort((a,b)=>a.localeCompare(b,'zh'))
                                 : [...(map.get(kbCat) || [])].sort((a,b)=>a.localeCompare(b,'zh'));
  subSel.innerHTML = '<option value="-1">全部小类</option>' +
    subCats.map(s => '<option value="' + escapeHtml(s) + '">' + escapeHtml(s) + '</option>').join('');
  subSel.value = kbSubcat;
  // 过滤
  let filtered = all.filter(x => (kbCat === '-1' || x.cat === kbCat) && (kbSubcat === '-1' || x.sub === kbSubcat));
  if (q) filtered = filtered.filter(x => (x.a.title||'').toLowerCase().includes(q) || (x.a.content||'').toLowerCase().includes(q));
  if (!filtered.length) {
    $('#kbBody').innerHTML = '<div class="empty-state">' + ICONS.empty + '<div class="t">未找到相关文章</div></div>';
    return;
  }
  // 渲染：按板块分组
  const bySec = {};
  filtered.forEach(x => { (bySec[x.si] = bySec[x.si] || []).push(x); });
  $('#kbBody').innerHTML = Object.keys(bySec).sort((a,b)=>a-b).map(si => {
    const list = bySec[si];
    const s = list[0].s;
    return '<details class="cat-group" open><summary>' + escapeHtml(s.title) +
      '<span class="cat-count">' + list.length + ' 篇</span></summary><ul class="food-list">' +
      list.map(x => '<li data-article="' + x.si + ':' + x.ai + '" style="cursor:pointer">' +
        '<div><div class="f-name">' + escapeHtml(x.a.title) + '</div>' +
        '<div class="f-meta">' + escapeHtml((x.a.content||'').slice(0,40)) + '…</div></div></li>').join('') +
      '</ul></details>';
  }).join('');
}

function openArticle(si, ai) {
  const sec = KNOWLEDGE.sections[si]; if (!sec) return;
  const art = sec.articles[ai]; if (!art) return;
  $('#aTitle').textContent = art.title;
  // 正文按段落换行
  $('#aContent').innerHTML = (art.content || '').split(/\n+/).filter(p => p.trim()).map(p => '<p>' + escapeHtml(p.trim()) + '</p>').join('');
  $('#aSources').innerHTML = '参考来源：<ul class="sources-list">' + (art.sources || []).map(s => '<li>' + escapeHtml(s) + '</li>').join('') + '</ul>';
  openModal('articleModal');
}

/* ---------------- 15. 数据库信息 / 免责声明 ---------------- */
function renderMe() {
  $('#dbInfo').innerHTML =
    '<li>应用版本：<b>v' + escapeHtml(APP_VERSION) + '</b></li>' +
    '<li>数据版本：<b>v' + escapeHtml(DB.db_version) + '</b>' +
    (LS.get('db_override', null) ? ' <span style="color:#e07b24">(本地已更新)</span>' : '') + '</li>' +
    '<li>数据更新日期：' + escapeHtml(DB.updated || '') + '</li>' +
    '<li>条目数：' + DB.items.length + ' 条</li>' +
    '<li>覆盖大类：' + DB.categories.length + ' 个</li>';
  $('#channel1Info').innerHTML =
    '<li>数据版本：v' + escapeHtml(DB.db_version) + '（' + DB.items.length + ' 条）</li>' +
    '<li>应用版本：v' + escapeHtml(APP_VERSION) + '</li>' +
    '<li>托管地址：' + (LS.get('host_url', '') || '未配置') + '</li>';
  $('#hostUrl').value = LS.get('host_url', '');
  $('#disclaimerText').textContent = KNOWLEDGE.disclaimer || '';
  $('#honestyList').innerHTML = [
    '本软件仅供健康参考，不替代专业医疗诊断与治疗建议。',
    '通道①自动更新需将应用部署在公网 HTTPS 静态地址，未部署时仅能使用本地数据。',
    '通道②二维码只承载地址+签名，不承载数据，扫码后需联网下载；type=full 时会同时更新 UI 代码。',
    '通道③离线包密钥极长，仅适合无网络兜底，且仅更新数据、不更新 UI。',
    '密钥验证为本地格式+哈希校验，非银行级安全机制。',
    '嘌呤数据来源于国家卫健委《成人高尿酸血症与痛风食养指南(2024年版)》等公开资料。'
  ].map(t => '<li>' + t + '</li>').join('');
}

/* ---------------- 16. 更新密钥：解码 + 校验 + 下载 + 校验 + 写入 ---------------- */
function b64urlDecode(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  // UTF-8 解码
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}
function b64urlEncode(bytes) {
  let bin = '';
  bytes.forEach(b => bin += String.fromCharCode(b));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
/* 安全相关常量（必须与 scripts/generate_update_key.py 完全一致） */
const PURINE_MAC_SALT = 'purine-app-v1-mac-salt-2026';

/* 规范 JSON 序列化：键排序、无空格、非 ASCII 保留原文（对应 Python ensure_ascii=False） */
function canonicalJson(obj) {
  const keys = Object.keys(obj).sort();
  const parts = keys.map(k => {
    const v = obj[k];
    let vs;
    if (typeof v === 'string') vs = '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
    else vs = JSON.stringify(v);
    return JSON.stringify(k) + ':' + vs;
  });
  return '{' + parts.join(',') + '}';
}

/* 字节数组转 hex */
function bufToHex(buf) {
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/* 短码字母表（32 字母表，剔除 0/O/1/I） */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/* 规范化用户输入：转大写、去非字母表字符；返回 {mode, code} */
function normalizeInput(raw) {
  raw = (raw || '').trim();
  if (raw.toUpperCase().startsWith('PUR-') && raw.length > 20) return { mode: 'long', code: raw };
  // 短码：保留字母表内字符（大小写不敏感）
  const up = raw.toUpperCase();
  let code = '';
  for (const ch of up) if (CODE_ALPHABET.includes(ch)) code += ch;
  if (code.length >= 8) return { mode: 'short', code: code.slice(0, 16) };
  return { mode: 'unknown', code: raw };
}

/* 由码算索引文件名：sha256(码大写)[:16] hex */
async function codeHashPrefix(code) {
  const buf = await sha256Bytes(new TextEncoder().encode(code.toUpperCase()));
  return bufToHex(buf).slice(0, 16);
}

/* 取应用部署基地址（去掉 index.html 和尾部斜杠） */
function appBase() {
  let b = location.origin + location.pathname;
  b = b.replace(/\/index\.html.*$/, '/').replace(/\/$/, '');
  return b;
}

/* 两级 HMAC-SHA256：mac = HMAC(K, HMAC(K, canonical(no-mac)) + '|' + code)，K=sha256(盐) */
async function computeMac(tokenWithoutMac, code) {
  const K = await sha256Bytes(new TextEncoder().encode(PURINE_MAC_SALT));
  const canonical = canonicalJson(tokenWithoutMac);
  let innerKey;
  if (window.crypto && crypto.subtle) {
    innerKey = await crypto.subtle.importKey('raw', K, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const innerBuf = await crypto.subtle.sign('HMAC', innerKey, new TextEncoder().encode(canonical));
    const innerHex = bufToHex(innerBuf);
    const outerBuf = await crypto.subtle.sign('HMAC', innerKey, new TextEncoder().encode(innerHex + '|' + code));
    return bufToHex(outerBuf);
  }
  // Electron 降级：Node crypto
  try {
    const c = window.require && window.require('crypto');
    if (c) {
      const Kbuf = Buffer.from(new Uint8Array(K));
      const inner = c.createHmac('sha256', Kbuf).update(canonical, 'utf8').digest('hex');
      return c.createHmac('sha256', Kbuf).update(inner + '|' + code, 'utf8').digest('hex');
    }
  } catch (e) {}
  return null;
}

/* 旧版单级 MAC（长码兼容）：sha256(规范token串(不含mac) + 盐) */
async function computeMacLegacy(tokenWithoutMac) {
  const canonical = canonicalJson(tokenWithoutMac);
  const bytes = new TextEncoder().encode(canonical + PURINE_MAC_SALT);
  return await sha256Hex(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}
/* sha256Bytes：返回 ArrayBuffer */
async function sha256Bytes(data) {
  if (window.crypto && crypto.subtle) return await crypto.subtle.digest('SHA-256', data);
  try {
    const c = window.require && window.require('crypto');
    if (c) return c.createHash('sha256').update(Buffer.from(data)).digest().buffer;
  } catch (e) {}
  return new ArrayBuffer(0);
}

/* 一次性密钥指纹：用 v+u/data+h 规范串，改末尾补位字符不影响指纹 */
function getKeyFingerprint(token) {
  return [token.v, token.u || token.data || '', token.h].join('|');
}

async function sha256Hex(buf) {
  // 优先 Web Crypto
  if (window.crypto && crypto.subtle) {
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  // Electron 降级
  try {
    const c = window.require && window.require('crypto');
    if (c) return c.createHash('sha256').update(Buffer.from(buf)).digest('hex');
  } catch (e) {}
  return null;
}

/* 更新进度提示（写入通道②结果区） */
function setProgress(msg) {
  const el = $('#updateResult');
  if (!el) return;
  el.innerHTML = msg ? '<div class="upgrade-progress">' + escapeHtml(msg) + '</div>' : '';
}

/* 短码路径：从托管索引拉 token，两级 HMAC 校验，设备级一次性 */
async function handleShortCode(code) {
  setProgress('正在校验更新码…');
  // a) 设备级一次性：used_codes
  const codeBuf = await sha256Bytes(new TextEncoder().encode(code));
  const codeHash = bufToHex(codeBuf);
  const usedCodes = LS.get('used_codes', []);
  if (usedCodes.includes(codeHash)) { setProgress('❌ 该码已在本设备使用过'); return; }

  // b) 拉取索引
  const f = await codeHashPrefix(code);
  let token;
  try {
    const resp = await fetch(appBase() + '/keys/' + f + '.json?t=' + Date.now(), { cache: 'no-store' });
    if (!resp.ok) { setProgress('❌ 未找到该更新码（可能已过期或输入错误）'); return; }
    token = await resp.json();
  } catch (e) { setProgress('❌ 无法获取更新索引：' + e.message); return; }

  // c) 两级 HMAC 校验
  if (!token.mac) { setProgress('❌ 索引文件缺少签名，拒绝'); return; }
  const { mac, ...rest } = token;
  const expectedMac = await computeMac(rest, code);
  if (!expectedMac || String(mac).toLowerCase() !== expectedMac.toLowerCase()) {
    setProgress('❌ 更新码签名校验失败，可能已被篡改'); return;
  }

  // d) 基本校验
  if (!token.v) { setProgress('❌ 索引缺少版本号'); return; }
  if (token.exp && token.exp < todayStr()) { setProgress('❌ 更新码已过期（' + token.exp + '）'); return; }
  const isFull = token.type === 'full';
  const curVer = isFull ? APP_VERSION : DB.db_version;
  if (cmpVer(token.v, curVer) <= 0) { setProgress('已是最新（当前 ' + curVer + '）'); return; }

  // e) 设备级一次性：used_types
  const typeFp = token.v + '|' + (token.u ? 'data' : 'offline') + '|' + token.h;
  const usedTypes = LS.get('used_types', []);
  if (usedTypes.includes(typeFp)) { setProgress('❌ 本设备已使用过该类型的更新码（数据版本相同）'); return; }

  // f) 下载数据
  let newDB = null;
  if (token.data) {
    try {
      const bin = b64ToBytes(token.data);
      const jsonBytes = pako.ungzip(bin);
      newDB = JSON.parse(new TextDecoder('utf-8').decode(jsonBytes));
    } catch (e) { setProgress('❌ 离线包解压失败：' + e.message); return; }
  } else {
    setProgress('正在下载数据…');
    const dataUrl = isFull ? token.u.replace(/\/$/, '') + '/data/purine-db.json' : token.u;
    try {
      const resp = await fetch(dataUrl, { cache: 'no-store' });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const buf = await resp.arrayBuffer();
      const hex = await sha256Hex(buf);
      if (hex && hex.toLowerCase() !== String(token.h).toLowerCase()) { setProgress('❌ 文件校验失败：哈希不匹配'); return; }
      newDB = JSON.parse(new TextDecoder('utf-8').decode(buf));
    } catch (e) { setProgress('❌ 下载失败：' + e.message); return; }
  }
  if (!newDB || !newDB.items || !newDB.items.length) { setProgress('❌ 数据结构不正确'); return; }

  // g) type=full：下载 UI 代码
  if (isFull) {
    setProgress('正在更新界面代码…');
    try {
      const cache = await caches.open('purine-app-' + APP_VERSION);
      for (const f2 of ['app.js', 'style.css', 'index.html', 'sw.js']) {
        const r = await fetch(token.u.replace(/\/$/, '') + '/' + f2, { cache: 'no-store' });
        if (r.ok) await cache.put(token.u.replace(/\/$/, '') + '/' + f2, r);
      }
    } catch (e) {}
  }

  // h) 写入并标记
  LS.set('db_override', newDB);
  usedCodes.push(codeHash); LS.set('used_codes', usedCodes);
  usedTypes.push(typeFp); LS.set('used_types', usedTypes);
  setProgress('✅ 更新成功！v' + newDB.db_version + '，共 ' + newDB.items.length + ' 条。即将刷新…');
  setTimeout(() => location.reload(), 1200);
}
async function applyUpdateKey() {
  const raw = ($('#updateKey').value || $('#shortCodeInput').value || '').trim();
  if (!raw) { setProgress('请输入更新码或密钥'); return; }
  const norm = normalizeInput(raw);
  if (norm.mode === 'short') { await handleShortCode(norm.code); return; }
  if (norm.mode === 'unknown') { setProgress('❌ 无法识别的输入格式'); return; }
  // 长码路径
  const payload = raw.slice(4);
  // 安全修复①：base64url 往返校验——任何字符改动（含末尾补位区）都会导致重编码不匹配
  let decodedBytes = null;
  try { decodedBytes = b64ToBytes(payload); }
  catch (e) { setProgress('❌ 密钥无效：base64url 解码失败'); return; }
  const reEncoded = b64urlEncode(decodedBytes);
  if (reEncoded !== payload) {
    setProgress('❌ 密钥无效或已被篡改（编码往返校验失败）');
    return;
  }
  let token;
  try { token = JSON.parse(new TextDecoder('utf-8').decode(decodedBytes)); }
  catch (e) { setProgress('❌ 密钥解析失败：不是合法 JSON'); return; }

  // 校验必填字段
  if (!token.v) { setProgress('❌ 密钥缺少版本号 v'); return; }
  const hasOnline = !!token.u;
  const hasOffline = !!token.data;
  if (!hasOnline && !hasOffline) { setProgress('❌ 密钥既无下载地址 u 也无离线数据 data，无法更新'); return; }
  if (!token.h) { setProgress('❌ 密钥缺少哈希 h'); return; }
  if (token.exp && token.exp < todayStr()) { setProgress('❌ 密钥已过期（' + token.exp + '）'); return; }

  // 长码路径：单级 MAC（与上一版一致）；无 mac 旧格式跳过
  if (token.mac) {
    const { mac, ...rest } = token;
    const expectedMac = await computeMacLegacy(rest);
    if (!expectedMac || String(mac).toLowerCase() !== expectedMac.toLowerCase()) {
      setProgress('❌ 密钥签名校验失败，可能已被篡改');
      return;
    }
  }

  // type=full 比对应用版本，否则比对数据版本
  const isFull = token.type === 'full';
  const curVer = isFull ? APP_VERSION : DB.db_version;
  if (cmpVer(token.v, curVer) <= 0) { setProgress('已是最新或更新版本不高于当前（当前 ' + curVer + '）'); return; }

  // 安全修复③：一次性去重改用规范指纹（v|u/data|h），改末尾字符不绕过
  const used = LS.get('used_keys', []);
  const fp = getKeyFingerprint(token);
  if (used.includes(fp)) { setProgress('该密钥已在本设备使用过'); return; }

  let newDB = null;
  if (hasOffline) {
    // 通道③：离线包 —— base64 解码 → pako.ungzip → JSON.parse
    try {
      const bin = b64ToBytes(token.data);
      const jsonBytes = pako.ungzip(bin);
      const text = new TextDecoder('utf-8').decode(jsonBytes);
      newDB = JSON.parse(text);
    } catch (e) { alert('离线包解压失败：' + e.message); return; }
  } else {
    // 通道②：在线下载。type=full 时 u 是应用根地址；type=data（默认）时 u 是单个 JSON 文件
    const isFull = token.type === 'full';
    const dataUrl = isFull ? token.u.replace(/\/$/, '') + '/data/purine-db.json' : token.u;
    setProgress('正在下载数据…');
    let buf;
    try {
      const resp = await fetch(dataUrl, { cache: 'no-store' });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      buf = await resp.arrayBuffer();
    } catch (e) { setProgress(''); alert('下载失败：' + e.message + '\n（需联网，且服务器允许跨域）'); return; }
    // 计算 SHA-256 比对（h 始终是 purine-db.json 的哈希）
    const hex = await sha256Hex(buf);
    if (hex && hex.toLowerCase() !== String(token.h).toLowerCase()) {
      setProgress('');
      alert('文件校验失败：SHA-256 不匹配。\n期望: ' + token.h + '\n实际: ' + hex);
      return;
    }
    if (!hex) { if (!confirm('当前环境无法计算 SHA-256（非安全上下文），跳过完整性校验？')) { setProgress(''); return; } }
    try { newDB = JSON.parse(new TextDecoder('utf-8').decode(buf)); }
    catch (e) { setProgress(''); alert('下载的不是合法 JSON'); return; }

    // type=full：额外下载 UI 代码文件并写入 SW 缓存
    if (isFull) {
      setProgress('正在更新界面代码…');
      const base = token.u.replace(/\/$/, '');
      const codeFiles = ['app.js', 'style.css', 'index.html', 'sw.js'];
      let codeOk = true;
      try {
        const cacheName = 'purine-app-' + APP_VERSION;
        const cache = await caches.open(cacheName);
        for (const f of codeFiles) {
          try {
            const r = await fetch(base + '/' + f, { cache: 'no-store' });
            if (r.ok) await cache.put(base + '/' + f, r);
            else codeOk = false;
          } catch (e) { codeOk = false; }
        }
        if (navigator.serviceWorker) navigator.serviceWorker.register('sw.js').catch(() => {});
      } catch (e) { codeOk = false; }
      // 数据已写入，无论代码是否成功都继续；刷新后由 SW 自动接管新缓存
      LS.set('db_override', newDB);
      used.push(raw); LS.set('used_keys', used);
      if (codeOk) {
        setProgress('完成，即将刷新…');
        setTimeout(() => location.reload(), 1500);
      } else {
        alert('数据已更新到 v' + newDB.db_version + '，但 UI 代码下载失败。\n请联网后再次使用密钥更新，或手动刷新页面。');
        setProgress('');
      }
      return;
    }
  }

  // 离线包也要校验解压后 JSON 的 SHA-256
  if (hasOffline) {
    const bytes = new TextEncoder().encode(JSON.stringify(newDB));
    const hex = await sha256Hex(bytes);
    // 注意：token.h 是"解压后原始 JSON 字节"的哈希；这里重序列化可能有空格差异，宽松比对
    if (hex && hex.toLowerCase() !== String(token.h).toLowerCase()) {
      // 尝试对原始解压字节直接哈希
      try {
        const rawBin = b64ToBytes(token.data);
        const rawJson = pako.ungzip(rawBin);
        const hexRaw = await sha256Hex(rawJson.buffer.slice(rawJson.byteOffset, rawJson.byteOffset + rawJson.byteLength));
        if (hexRaw.toLowerCase() !== String(token.h).toLowerCase()) {
          alert('离线包校验失败：SHA-256 不匹配。\n期望: ' + token.h + '\n实际: ' + hexRaw);
          return;
        }
      } catch (e) { alert('离线包校验异常：' + e.message); return; }
    }
  }

  if (!newDB.items || !newDB.items.length) { alert('数据库结构不正确'); return; }

  LS.set('db_override', newDB);
  used.push(fp); LS.set('used_keys', used);
  setProgress('✅ 更新成功！已升级到 v' + newDB.db_version + '，共 ' + newDB.items.length + ' 条。即将刷新…');
  setTimeout(() => location.reload(), 1200);
}

// base64（含 base64url）字符串 → Uint8Array
function b64ToBytes(b64) {
  b64 = String(b64).replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}
// Uint8Array → base64
function bytesToB64(bytes) {
  let bin = '';
  bytes.forEach(b => bin += String.fromCharCode(b));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/* 本地文件导入数据库 */
function importFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const obj = JSON.parse(reader.result);
      if (!obj.items || !obj.items.length) throw new Error('结构不正确');
      LS.set('db_override', obj);
      alert('导入成功：v' + obj.db_version + '，共 ' + obj.items.length + ' 条。即将刷新。');
      location.reload();
    } catch (e) { alert('导入失败：' + e.message); }
  };
  reader.readAsText(file, 'utf-8');
}

/* ---------------- 17. 密钥生成器（桌面端） ---------------- */
let kgMode = 'short'; // 'short' | 'online' | 'offline'
let lastShortCode = '';   // 最近生成的短码
let lastIndexData = null; // 最近生成的索引 JSON（用于导出 keys/<f>.json）

async function genKey() {
  const url = $('#kgUrl').value.trim();
  const exp = $('#kgExp').value;
  const notes = $('#kgNotes').value.trim();
  const type = $('#kgType').value; // 'data' | 'full'
  if (!exp) { alert('请选择过期日期'); return; }
  if ((kgMode === 'online' || kgMode === 'short') && !url) { alert('短码/在线模式需输入应用托管根地址'); return; }
  const v = type === 'full' ? APP_VERSION : DB.db_version;

  // ===== 短码模式：生成 16 位码 + 两级 HMAC + 索引 JSON =====
  if (kgMode === 'short') {
    // 生成 16 位随机码
    const rand = new Uint8Array(16);
    crypto.getRandomValues(rand);
    let code = '';
    for (let i = 0; i < 16; i++) code += CODE_ALPHABET[rand[i] % CODE_ALPHABET.length];
    lastShortCode = code;
    // 计算数据库哈希
    let h = null;
    try { const r = await fetch('data/purine-db.json'); if (r.ok) { const b = await r.arrayBuffer(); h = await sha256Hex(b); } } catch (e) {}
    if (!h) { const b = new TextEncoder().encode(JSON.stringify(DB)); h = await sha256Hex(b); }
    // token（不含 mac）
    const token = { v: v, u: url.replace(/\/$/, ''), h: h, exp: exp, iat: todayStr(), typ: 'purine-update', notes: notes };
    if (type === 'full') token.type = 'full';
    // 两级 HMAC
    token.mac = await computeMac(token, code);
    lastIndexData = token;
    const f = await codeHashPrefix(code);
    const formatted = code.match(/.{1,4}/g).join('-');
    $('#kgResultCard').style.display = '';
    $('#kgOutput').value = formatted;
    $('#kgMeta').innerHTML =
      '<div>更新码：<b style="font-size:18px;letter-spacing:1px">' + formatted + '</b></div>' +
      '<div>升级类型：<b>' + (type === 'full' ? '完整升级（数据+UI）' : '仅数据') + '</b></div>' +
      '<div>目标版本：<b>v' + escapeHtml(v) + '</b></div>' +
      '<div>索引文件名：<code>keys/' + f + '.json</code></div>' +
      '<div style="color:#e07b24;font-size:12px;margin-top:6px">请将下方导出的索引文件上传到托管地址的 keys/ 目录，并把 16 位更新码发给用户。</div>';
    return;
  }

  if (kgMode === 'online') {
    let h = null, usedRaw = false;
    try {
      const resp = await fetch('data/purine-db.json');
      if (resp.ok) { const buf = await resp.arrayBuffer(); h = await sha256Hex(buf); usedRaw = true; }
    } catch (e) {}
    if (!h) {
      const buf = new TextEncoder().encode(JSON.stringify(DB));
      h = await sha256Hex(buf);
    }
    if (!h) { alert('当前环境无法计算 SHA-256'); return; }
    const token = { v: v, u: url, h: h, exp: exp, notes: notes };
    if (type === 'full') token.type = 'full';
    // 长码单级 MAC（与 Python 脚本一致）
    token.mac = await computeMacLegacy(token);
    const encoded = b64urlEncode(new TextEncoder().encode(canonicalJson(token)));
    $('#kgResultCard').style.display = '';
    $('#kgOutput').value = 'PUR-' + encoded;
    $('#kgMeta').innerHTML =
      '<div>升级类型：<b>' + (type === 'full' ? '完整升级（数据+UI代码）' : '仅数据') + '</b></div>' +
      '<div>目标版本：<b>v' + escapeHtml(v) + '</b>' + (type === 'full' ? '（应用版本）' : '（数据版本）') + '</div>' +
      '<div>数据库 SHA-256：<code>' + h + '</code></div>' +
      '<div style="color:' + (usedRaw ? '#2e7d5b' : '#e07b24') + ';font-size:12px">' +
      (usedRaw ? '已对 web/data/purine-db.json 原始文件计算哈希。' : 'file:// 下降级为内存序列化哈希，请在 http 服务下使用。') + '</div>';
  } else {
    // 通道③：离线包 —— gzip 压缩整个 DB JSON，h 是解压后原始 JSON 字节的 SHA-256
    try {
      const rawJson = JSON.stringify(DB);
      const rawBytes = new TextEncoder().encode(rawJson);
      const h = await sha256Hex(rawBytes.buffer.slice(rawBytes.byteOffset, rawBytes.byteOffset + rawBytes.byteLength));
      const gz = pako.gzip(rawBytes);
      const b64 = bytesToB64(gz);
      const token = { v: v, h: h, exp: exp, data: b64, notes: notes || ('离线更新包 v' + v) };
      token.mac = await computeMacLegacy(token);
      const encoded = b64urlEncode(new TextEncoder().encode(canonicalJson(token)));
      $('#kgResultCard').style.display = '';
      $('#kgOutput').value = 'PUR-' + encoded;
      $('#kgMeta').innerHTML =
        '<div>目标版本：<b>v' + escapeHtml(v) + '</b></div>' +
        '<div>SHA-256（解压后 JSON）：<code>' + h + '</code></div>' +
        '<div>压缩后 base64 长度：约 ' + (b64.length / 1024).toFixed(0) + ' KB</div>' +
        '<div style="color:#e07b24;font-size:12px">警告：离线包密钥很长，不适合二维码，仅适合复制粘贴。</div>';
    } catch (e) { alert('生成离线包失败：' + e.message); }
  }
  $('#qrBox').style.display = 'none';
}

// 用 qrcode-generator 把密钥字符串渲染为二维码
function renderQR(text) {
  const box = $('#qrImg');
  box.innerHTML = '';
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const img = qr.createImgTag(6, 8);
  box.innerHTML = img;
  $('#qrBox').style.display = '';
}

/* ---------------- 17b. 数据管理（桌面端） ---------------- */
let adminData = null;   // 工作副本（深拷贝 DB.items）
let adminCatList = [];
let adminEditingId = null;

function adminInit() {
  // 深拷贝当前 DB 作为编辑工作区
  adminData = JSON.parse(JSON.stringify(DB.items));
  adminCatList = DB.categories;
  $('#catList').innerHTML = adminCatList.map(c => '<option>' + escapeHtml(c) + '</option>').join('');
  renderAdminList();
}

function renderAdminList() {
  if (!adminData) adminInit();
  const q = normQ($('#adminSearch').value || '');
  const lv = $('#adminLevel').value;
  let list = adminData.filter(it => {
    if (lv && it.level !== lv) return false;
    if (!q) return true;
    // 简单中文+拼音筛选（复用 searchIndex 不方便，这里按名称+别名子串）
    const hay = (it.name + ' ' + (it.aliases || []).join(' ')).toLowerCase();
    return hay.includes(q);
  });
  $('#adminMeta').textContent = '共 ' + list.length + ' 条（编辑工作区，未导出前不影响嵌入数据）';
  $('#adminList').innerHTML = list.map(it =>
    '<li data-id="' + it.id + '"' + (it.id === adminEditingId ? ' class="editing"' : '') + '>' +
    '<div><div class="f-name">' + escapeHtml(it.name) + '</div>' +
    '<div class="f-meta">' + escapeHtml(it.category) + (it.subcategory ? ' / ' + escapeHtml(it.subcategory) : '') + '</div></div>' +
    '<div class="f-right"><div class="f-val">' + (it.purine_mg_per_100g == null ? '?' : it.purine_mg_per_100g) + '</div>' + levelTag(it.level) + '</div></li>'
  ).join('') || '<li style="cursor:default;color:#999;justify-content:center">无条目</li>';
  // 导出信息
  const nextVer = bumpVer(DB.db_version);
  $('#adminExportMeta').innerHTML =
    '<div>当前版本：<b>' + escapeHtml(DB.db_version) + '</b> → 导出版本：<b>v' + nextVer + '</b></div>' +
    '<div>条目数：' + adminData.length + ' 条</div>' +
    '<div>updated：' + todayStr() + '</div>';
}

// 版本号末位 +0.0.1
function bumpVer(v) {
  const p = String(v).split('.').map(n => parseInt(n, 10) || 0);
  while (p.length < 3) p.push(0);
  p[2] = (p[2] || 0) + 1;
  return p.join('.');
}

function fillForm(it) {
  adminEditingId = it ? it.id : null;
  $('#edName').value = it ? it.name : '';
  $('#edAliases').value = it && it.aliases ? it.aliases.join(', ') : '';
  $('#edCategory').value = it ? it.category : '';
  $('#edSub').value = it && it.subcategory ? it.subcategory : '';
  $('#edPurine').value = it && it.purine_mg_per_100g != null ? it.purine_mg_per_100g : '';
  $('#edLevel').value = it ? it.level : '低';
  $('#edPrep').value = it && it.preparation ? it.preparation : '';
  $('#edSources').value = it && it.sources ? it.sources.join('\n') : '';
  $('#edNote').value = it && it.note ? it.note : '';
  renderAdminList();
}

function saveEdit() {
  const name = $('#edName').value.trim();
  if (!name) { alert('名称不能为空'); return; }
  const purine = $('#edPurine').value === '' ? null : parseFloat($('#edPurine').value);
  // 根据数值自动判定等级（若未知则保留手动选择）
  let level = $('#edLevel').value;
  if (purine != null && !isNaN(purine)) {
    if (purine < 75) level = '低';
    else if (purine < 150) level = '中';
    else if (purine <= 300) level = '高';
    else level = '极高';
  } else if (purine == null) {
    level = '未知';
  }
  const obj = {
    id: adminEditingId || genId($('#edCategory').value),
    name: name,
    aliases: $('#edAliases').value.split(',').map(s => s.trim()).filter(Boolean),
    category: $('#edCategory').value.trim() || '其他',
    subcategory: $('#edSub').value.trim(),
    purine_mg_per_100g: purine,
    purine_range: (purine != null && !isNaN(purine)) ? [purine, purine] : undefined,
    level: level,
    preparation: $('#edPrep').value.trim(),
    sources: $('#edSources').value.split('\n').map(s => s.trim()).filter(Boolean),
    note: $('#edNote').value.trim()
  };
  if (adminEditingId) {
    const idx = adminData.findIndex(x => x.id === adminEditingId);
    if (idx >= 0) adminData[idx] = obj;
  } else {
    adminData.push(obj);
  }
  adminEditingId = obj.id;
  renderAdminList();
  alert('已保存到工作区（id=' + obj.id + '）。继续编辑或点"导出新版本"。');
}

// 生成新条目 id（按大类首字母）
function genId(cat) {
  const prefixMap = { '谷薯类': 'G', '豆类及制品': 'B', '蔬菜类': 'V', '菌藻类': 'M', '水果类': 'F', '坚果种子': 'N', '畜禽肉类': 'C', '水产类': 'S', '蛋类': 'E', '奶类及制品': 'D', '饮料': 'T', '调味品': 'A', '加工食品': 'P', '其他': 'O' };
  const p = prefixMap[cat] || 'X';
  let max = 0;
  adminData.forEach(it => { if (it.id && it.id.startsWith(p)) { const n = parseInt(it.id.slice(1), 10); if (n > max) max = n; } });
  return p + String(max + 1).padStart(3, '0');
}

function deleteEdit() {
  if (!adminEditingId) { alert('请先选择一条条目'); return; }
  if (!confirm('确认删除条目 ' + adminEditingId + '？')) return;
  adminData = adminData.filter(x => x.id !== adminEditingId);
  adminEditingId = null;
  fillForm(null);
}

function exportNewVersion() {
  const newDB = {
    schema_version: DB.schema_version,
    db_version: bumpVer(DB.db_version),
    updated: todayStr(),
    unit: DB.unit,
    level_definition: DB.level_definition,
    categories: DB.categories,
    items: adminData
  };
  const blob = new Blob([JSON.stringify(newDB, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'purine-db-v' + newDB.db_version + '.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ---------------- 17c. 通道①：检查更新 ---------------- */
async function checkUpdate() {
  const host = $('#hostUrl').value.trim().replace(/\/$/, '');
  LS.set('host_url', host);
  const box = $('#channel1Result');
  if (!host) { box.innerHTML = '<span style="color:#789">未配置托管地址。部署到公网后填入地址，即可检查远端版本。</span>'; return; }
  box.innerHTML = '正在检查…';
  try {
    const resp = await fetch(host + '/manifest.json', { cache: 'no-store' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const m = await resp.json();
    if (cmpVer(m.db_version, DB.db_version) > 0) {
      box.innerHTML = '<span style="color:#e07b24">发现新版本 v' + escapeHtml(m.db_version) + '（当前 ' + DB.db_version + '）。请将整个 web/ 部署到该地址后，下次打开应用由 Service Worker 自动更新。</span>';
    } else {
      box.innerHTML = '<span style="color:#2e7d5b">已是最新（当前 v' + DB.db_version + '，远端 v' + escapeHtml(m.db_version) + '）。</span>';
    }
  } catch (e) {
    box.innerHTML = '<span style="color:#c0392b">检查失败：' + escapeHtml(e.message) + '（需联网且地址可访问）</span>';
  }
}

/* ---------------- 17d. 扫码更新（通道②） ---------------- */
let scanStream = null;
let scanTimer = null;

async function startScan() {
  $('#scannerBox').style.display = '';
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setProgress('当前环境无法访问摄像头，请改用下方"选择二维码图片"。');
    return;
  }
  try {
    scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const video = $('#qrVideo');
    // PWA 添加到主屏幕后必须 muted + playsinline 才能自动播放摄像头画面
    video.muted = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.setAttribute('x5-playsinline', '');
    video.srcObject = scanStream;
    await video.play();
    scanTimer = setInterval(tickScan, 300);
    // 自检：500ms 后画面仍未渲染则友好提示
    setTimeout(() => {
      if (video.videoWidth > 0) {
        console.log('摄像头画面正常', video.videoWidth + 'x' + video.videoHeight);
      } else {
        setProgress('摄像头画面未渲染，请尝试改用下方"选择二维码图片"。');
      }
    }, 500);
  } catch (err) {
    if (err.name === 'NotAllowedError' || err.name === 'SecurityError') {
      setProgress('摄像头权限被拒绝。请在浏览器/系统设置中允许本应用使用摄像头，或改用下方"选择二维码图片"扫码。');
    } else if (err.name === 'NotFoundError' || err.name === 'OverconstrainedError') {
      setProgress('未检测到可用摄像头设备，请改用下方"选择二维码图片"扫码。');
    } else {
      setProgress('摄像头启动失败（' + (err.name || 'Error') + '），请改用下方"选择二维码图片"扫码。');
    }
  }
}

function tickScan() {
  const video = $('#qrVideo');
  if (!video.videoWidth) return;
  const c = document.createElement('canvas');
  c.width = video.videoWidth; c.height = video.videoHeight;
  const ctx = c.getContext('2d');
  ctx.drawImage(video, 0, 0, c.width, c.height);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  try {
    const code = jsQR(img.data, c.width, c.height);
    if (code && code.data) {
      stopScan();
      $('#updateKey').value = code.data.trim();
      setProgress('✅ 识别成功，正在更新…');
      applyUpdateKey();
    }
  } catch (e) {}
}

function stopScan() {
  if (scanTimer) { clearInterval(scanTimer); scanTimer = null; }
  const video = $('#qrVideo');
  // 彻底释放摄像头轨道，关闭指示灯
  if (video && video.srcObject) {
    video.srcObject.getTracks().forEach(t => t.stop());
    video.srcObject = null;
  }
  if (scanStream) { scanStream.getTracks().forEach(t => t.stop()); scanStream = null; }
  $('#scannerBox').style.display = 'none';
}

function scanImageFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, c.width, c.height);
      try {
        const code = jsQR(data.data, c.width, c.height);
        if (code && code.data) {
          $('#updateKey').value = code.data.trim();
          setProgress('✅ 识别成功，正在更新…');
          applyUpdateKey();
        } else { alert('未识别到二维码'); }
      } catch (e) { alert('识别失败：' + e.message); }
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

/* ---------------- 17e. 离线包文件导入（通道③，桌面端/手机端通用） ---------------- */
function importOfflineFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const obj = JSON.parse(reader.result);
      if (!obj.items || !obj.items.length) throw new Error('结构不正确');
      LS.set('db_override', obj);
      alert('导入成功：v' + obj.db_version + '，共 ' + obj.items.length + ' 条。即将刷新。');
      location.reload();
    } catch (e) { alert('导入失败：' + e.message); }
  };
  reader.readAsText(file, 'utf-8');
}

/* ---------------- 18. 通知提醒 ---------------- */
let notifyTimer = null;
function enableNotify() {
  if (!('Notification' in window)) { alert('当前浏览器不支持通知'); return; }
  if (Notification.permission !== 'granted') {
    Notification.requestPermission().then(p => { if (p === 'granted') startNotify(); });
  } else startNotify();
}
function startNotify() {
  if (notifyTimer) clearInterval(notifyTimer);
  const gap = Math.max(1, parseInt($('#notifyGap').value || '60', 10)) * 60 * 1000;
  notifyTimer = setInterval(() => {
    const now = new Date();
    const t = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    if (t >= $('#notifyStart').value && t <= $('#notifyEnd').value) {
      try { new Notification('该喝水啦 💧', { body: '记得补充 250ml 水，保持充足饮水有助于尿酸排泄。' }); } catch (e) {}
    }
  }, gap);
  alert('提醒已开启（每 ' + $('#notifyGap').value + ' 分钟检查一次，仅在设定时间段内弹出）');
}

/* ---------------- 19. 事件绑定 ---------------- */
function bindEvents() {
  // Tab 切换
  $('#tabbar').addEventListener('click', e => {
    const btn = e.target.closest('.tab');
    if (btn) switchTab(btn.dataset.tab);
  });

  // 搜索
  $('#searchInput').addEventListener('input', doSearch);
  $('#levelChips').addEventListener('click', e => {
    const c = e.target.closest('.chip'); if (!c) return;
    curFilterLevel = c.dataset.level;
    $all('#levelChips .chip').forEach(x => x.classList.toggle('active', x === c));
    doSearch();
  });
  $('#catFilterList').addEventListener('click', e => {
    const c = e.target.closest('.chip'); if (!c) return;
    curFilterCat = c.dataset.cat;
    $all('#catFilterList .chip').forEach(x => x.classList.toggle('active', x === c));
    doSearch();
  });

  // 食物列表点击（事件委托：搜索结果 + 分类浏览 + 选择食物）
  document.body.addEventListener('click', e => {
    const li = e.target.closest('li[data-id]');
    if (!li) return;
    const id = li.dataset.id;
    const item = DB.items.find(x => x.id === id);
    if (!item) return;
    // 若在"添加食物"弹窗内，选择食物
    if ($('#addFoodModal').classList.contains('show')) {
      pickedFood = item;
      $('#pickedName').textContent = item.name + '（' + (item.purine_mg_per_100g == null ? '未知' : item.purine_mg_per_100g + ' mg/100g') + '）';
      $('#pickForm').classList.remove('hidden');
    } else {
      openDetail(item);
    }
  });

  // 弹窗关闭
  $all('.modal-close').forEach(b => b.addEventListener('click', () => closeModal(b.dataset.close)));
  $all('.modal-mask').forEach(m => m.addEventListener('click', e => { if (e.target === m) m.classList.remove('show'); }));

  // 记食
  $('#openAddFood').addEventListener('click', openAddFood);
  $('#pickSearch').addEventListener('input', e => renderPickList(e.target.value));
  $('#cancelPick').addEventListener('click', () => { pickedFood = null; $('#pickForm').classList.add('hidden'); });
  $('#confirmPick').addEventListener('click', () => {
    if (!pickedFood) return;
    const g = parseFloat($('#pickGrams').value);
    if (!g || g <= 0) { alert('请输入克数'); return; }
    const per = pickedFood.purine_mg_per_100g || 0;
    const arr = loadLog();
    arr.push({ id: pickedFood.id, name: pickedFood.name, grams: g, purine: per * g / 100 });
    saveLog(arr);
    closeModal('addFoodModal');
    renderLog();
  });
  $('#addToMeal').addEventListener('click', () => {
    if (!currentDetailItem) return;
    closeModal('detailModal');
    // 切到记食 Tab 并打开添加
    if (!IS_DESKTOP) switchTab('log');
    pickedFood = currentDetailItem;
    $('#pickedName').textContent = currentDetailItem.name + '（' + (currentDetailItem.purine_mg_per_100g == null ? '未知' : currentDetailItem.purine_mg_per_100g + ' mg/100g') + '）';
    $('#pickForm').classList.remove('hidden');
    openModal('addFoodModal');
  });
  $('#logList').addEventListener('click', e => {
    const b = e.target.closest('.l-del'); if (!b) return;
    const arr = loadLog(); arr.splice(parseInt(b.dataset.i, 10), 1); saveLog(arr); renderLog();
  });
  $('#logDate').addEventListener('change', e => { logDate = e.target.value || todayStr(); renderLog(); });
  $('#prevDay').addEventListener('click', () => {
    const d = new Date(logDate); d.setDate(d.getDate() - 1); logDate = fmtDate(d); renderLog();
  });
  $('#nextDay').addEventListener('click', () => {
    const d = new Date(logDate); d.setDate(d.getDate() + 1); logDate = fmtDate(d); renderLog();
  });

  // 记录子 Tab
  $all('#page-records .seg-tabs .seg').forEach(s => s.addEventListener('click', () => {
    $all('#page-records .seg-tabs .seg').forEach(x => x.classList.toggle('active', x === s));
    $('#seg-water').classList.toggle('hidden', s.dataset.seg !== 'water');
    $('#seg-uric').classList.toggle('hidden', s.dataset.seg !== 'uric');
    if (s.dataset.seg === 'uric') drawUricChart(); else drawWaterChart();
  }));

  // 饮水
  $all('[data-addwater]').forEach(b => b.addEventListener('click', () => {
    const ml = parseInt(b.dataset.addwater, 10);
    const cur = loadWater(todayStr()); saveWater(todayStr(), cur + ml); renderWater();
  }));
  $('#addCustomWater').addEventListener('click', () => {
    const v = parseInt($('#customWater').value, 10);
    if (!v || v <= 0) { alert('请输入毫升数'); return; }
    const cur = loadWater(todayStr()); saveWater(todayStr(), cur + v); $('#customWater').value = ''; renderWater();
  });
  $('#resetWater').addEventListener('click', () => { saveWater(todayStr(), 0); renderWater(); });
  $('#saveWaterGoal').addEventListener('click', () => {
    const g = parseInt($('#waterGoal').value, 10); if (g > 0) { LS.set('water_goal', g); renderWater(); }
  });
  $('#enableNotify').addEventListener('click', enableNotify);

  // 尿酸
  $('#addUric').addEventListener('click', () => {
    const v = parseFloat($('#uricValue').value);
    const d = $('#uricDate').value || todayStr();
    const note = $('#uricNote').value.trim();
    if (!v || v <= 0) { alert('请输入有效尿酸值'); return; }
    const arr = loadUric(); arr.push({ value: v, date: d, note: note }); saveUric(arr);
    $('#uricValue').value = ''; $('#uricNote').value = '';
    renderUricList(); drawUricChart();
  });
  $('#uricList').addEventListener('click', e => {
    const b = e.target.closest('.u-del'); if (!b) return;
    const arr = loadUric().slice().sort((a, b2) => a.date < b2.date ? 1 : -1);
    arr.splice(parseInt(b.dataset.i, 10), 1);
    saveUric(arr); renderUricList(); drawUricChart();
  });
  $('#uricRange').addEventListener('click', e => {
    const s = e.target.closest('.seg'); if (!s) return;
    uricRange = s.dataset.range;
    $all('#uricRange .seg').forEach(x => x.classList.toggle('active', x === s));
    drawUricChart();
  });

  // BMI
  $('#calcBmi').addEventListener('click', calcBMI);

  // 更新密钥
  $('#applyKey').addEventListener('click', applyUpdateKey);
  // 通道③：应用离线包密钥按钮
  const _aok = document.getElementById('applyOfflineKey');
  if (_aok) _aok.addEventListener('click', function() {
    const raw = (document.getElementById('updateKey').value || '').trim();
    if (!raw) { setProgress('请先粘贴离线包密钥'); return; }
    if (!raw.startsWith('PUR-')) { setProgress('离线包密钥应以 PUR- 开头'); return; }
    applyUpdateKey();
  });
  $('#offlineFile').addEventListener('change', e => { if (e.target.files[0]) importOfflineFile(e.target.files[0]); });

  // 通道①
  $('#hostUrl').addEventListener('change', e => LS.set('host_url', e.target.value.trim()));
  $('#checkUpdate').addEventListener('click', checkUpdate);

  // 通道② 扫码
  $('#scanKey').addEventListener('click', startScan);
  $('#stopScan').addEventListener('click', stopScan);
  $('#qrFile').addEventListener('change', e => { if (e.target.files[0]) scanImageFile(e.target.files[0]); });

  // 密钥生成器：模式切换
  $('#kgMode').addEventListener('click', e => {
    const s = e.target.closest('.seg'); if (!s) return;
    kgMode = s.dataset.mode;
    $all('#kgMode .seg').forEach(x => x.classList.toggle('active', x === s));
    const needUrl = (kgMode === 'online' || kgMode === 'short');
    $('#kgUrlLabel').style.display = needUrl ? '' : 'none';
    $('#kgModeHint').textContent =
      kgMode === 'short' ? '短码模式：生成 16 位码，需将索引文件上传到托管地址 keys/ 目录。'
      : kgMode === 'online' ? '长码模式：密钥含下载地址，手机端输入 PUR- 后联网拉取。'
      : '离线模式：gzip 压缩整个数据库内嵌进密钥，无需联网，但密钥极长。';
  });
  // 短码输入自动格式化（每4位加连字符，只保留字母表字符）
  $('#shortCodeInput').addEventListener('input', e => {
    let v = e.target.value.toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 16);
    e.target.value = v.match(/.{1,4}/g) ? v.match(/.{1,4}/g).join('-') : '';
  });
  // 导出索引文件 keys/<f>.json
  $('#exportIndex').addEventListener('click', async () => {
    if (!lastIndexData) { alert('请先生成更新码'); return; }
    const f = await codeHashPrefix(lastShortCode);
    const blob = new Blob([JSON.stringify(lastIndexData, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = f + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $('#genQr').addEventListener('click', () => {
    const k = $('#kgOutput').value.trim();
    if (!k) { alert('请先生成密钥'); return; }
    if (kgMode === 'offline') { alert('离线包密钥过长，不适合二维码。请改用复制粘贴。'); return; }
    renderQR(k);
  });

  // 数据管理
  $('#adminSearch').addEventListener('input', renderAdminList);
  $('#adminLevel').addEventListener('change', renderAdminList);
  $('#adminList').addEventListener('click', e => {
    const li = e.target.closest('li[data-id]'); if (!li) return;
    const it = adminData.find(x => x.id === li.dataset.id);
    if (it) fillForm(it);
  });
  $('#adminNew').addEventListener('click', () => fillForm(null));
  $('#adminSaveEdit').addEventListener('click', saveEdit);
  $('#adminDelete').addEventListener('click', deleteEdit);
  $('#adminClearForm').addEventListener('click', () => fillForm(null));
  $('#adminExport').addEventListener('click', exportNewVersion);

  // 知识库 Tab：搜索 + 板块导航 + 文章点击
  $('#kbSearch').addEventListener('input', renderKbPage);
  $("#kbCat").addEventListener('change', e => {
    kbCat = e.target.value;
    kbSubcat = '-1';
    renderKbPage();
  });
  $("#kbSubcat").addEventListener('change', e => {
    kbSubcat = e.target.value;
    renderKbPage();
  });
  $('#kbBody').addEventListener('click', e => {
    const li = e.target.closest('li[data-article]'); if (!li) return;
    const [si, ai] = li.dataset.article.split(':').map(Number);
    openArticle(si, ai);
  });

  // 新工具
  $('#calcBudget').addEventListener('click', calcBudget);
  $('#calcWater').addEventListener('click', calcWater);

  // 密钥生成器：升级类型切换
  $('#kgType').addEventListener('change', e => {
    const t = e.target.value;
    const hint = $('#kgTypeHint');
    const lbl = $('#kgUrlLabel');
    if (t === 'full') {
      hint.textContent = '完整升级：u 为应用托管根地址（如 https://yanxingshen.github.io/purine-query-web/），将同时更新数据库和 UI 代码。';
      lbl.childNodes[0].textContent = '应用托管根地址：';
      $('#kgUrl').placeholder = 'https://example.com/purine-query-web/';
    } else {
      hint.textContent = '仅数据更新：u 为单个数据库 JSON 文件地址，手机端拉取后替换数据。';
      lbl.childNodes[0].textContent = '数据库下载地址 URL：';
      $('#kgUrl').placeholder = 'https://example.com/purine-db-v1.1.0.json';
    }
  });

  // 密钥生成器
  $('#genKey').addEventListener('click', genKey);
  $('#copyKey').addEventListener('click', () => {
    $('#kgOutput').select(); document.execCommand('copy');
    alert('已复制到剪贴板');
  });
  $('#clearKey').addEventListener('click', () => { $('#kgOutput').value = ''; $('#kgResultCard').style.display = 'none'; });
}

/* ---------------- 20. Service Worker 注册 ---------------- */
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  // file:// 下不注册，避免报错
  if (location.protocol === 'file:') return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW 注册失败', err));
  });
}

/* ---------------- 启动 ---------------- */
document.addEventListener('DOMContentLoaded', () => {
  loadDB();
  buildSearchIndex();
  renderTabs();
  renderCatFilter();
  renderCatBrowser();
  renderMe();
  doSearch();
  // 记食页初始化
  $('#logDate').value = logDate;
  renderLog();
  // 尿酸日期默认今天
  $('#uricDate').value = todayStr();
  renderWater();
  renderUricList();
  renderKbPage();
  // 密钥生成器默认明天+一年后过期
  const d = new Date(); d.setFullYear(d.getFullYear() + 1);
  $('#kgExp').value = fmtDate(d);
  bindEvents();
  switchTab('search');
  registerSW();
});

// ===== Splash Screen =====
(function initSplash() {
  var splash = document.getElementById('splash');
  if (!splash) return;
  setTimeout(function () {
    splash.classList.add('hide');
    setTimeout(function () {
      if (splash.parentNode) splash.parentNode.removeChild(splash);
    }, 700);
  }, 1500);
})();
