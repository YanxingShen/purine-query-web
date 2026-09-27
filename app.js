/* ============================================================
 * 嘌呤查询 App —— 主逻辑
 * 纯原生 JS，无框架。手机 PWA 与桌面 Electron 复用同一套。
 * 本地存储键名前缀：purineapp_
 * ============================================================ */
'use strict';

/* ---------------- 0. 环境检测 ---------------- */
const IS_DESKTOP = (function () {
  try {
    if (window.electronAPI) return true;
    if (navigator.userAgent && /Electron/i.test(navigator.userAgent)) return true;
  } catch (e) {}
  return false;
})();

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
  { id: 'search', ico: '🔍', label: '查询' },
  { id: 'log',    ico: '🍽️', label: '记食' },
  { id: 'records',ico: '📊', label: '记录' },
  { id: 'tools',  ico: '🛠️', label: '工具' },
  { id: 'me',     ico: '👤', label: '我的' }
];
const TABS_DESKTOP = [
  { id: 'search', ico: '🔍', label: '嘌呤查询' },
  { id: 'admin',   ico: '🗃️', label: '数据管理' },
  { id: 'keygen',  ico: '🔑', label: '密钥生成器' }
];

function renderTabs() {
  const tabs = IS_DESKTOP ? TABS_DESKTOP : TABS_MOBILE;
  const bar = $('#tabbar');
  bar.innerHTML = tabs.map((t, i) =>
    '<button class="tab' + (i === 0 ? ' active' : '') + '" data-tab="' + t.id + '">' +
    '<span class="tab-ico">' + t.ico + '</span><span>' + t.label + '</span></button>'
  ).join('');
  // 手机端专属页面：桌面模式隐藏
  ['page-log', 'page-records', 'page-tools', 'page-me'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = IS_DESKTOP ? 'none' : '';
  });
  // 桌面专属页面：手机模式隐藏
  ['page-admin', 'page-keygen'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = IS_DESKTOP ? '' : 'none';
  });
}

/* ---------------- 5. Tab 切换 ---------------- */
function switchTab(tabId) {
  $all('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
  $all('.page').forEach(p => {
    const mobileOnly = ['page-log', 'page-records', 'page-tools', 'page-me'].includes(p.id);
    const desktopOnly = ['page-admin', 'page-keygen'].includes(p.id);
    let show = p.id === 'page-' + tabId;
    if (IS_DESKTOP && mobileOnly) show = false;
    if (!IS_DESKTOP && desktopOnly) show = false;
    p.classList.toggle('active', show);
  });
  const titles = { search: '嘌呤查询', log: '每日记食', records: '健康记录', tools: '健康工具', me: '我的', keygen: '密钥生成器', admin: '数据管理' };
  $('#appTitle').textContent = titles[tabId] || '嘌呤查询';
  window.scrollTo(0, 0);
  // 切到数据管理时渲染列表
  if (tabId === 'admin') renderAdminList();
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
  return '<li data-id="' + item.id + '">' +
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
  const rangeStr = range && range.length === 2 ? ('（参考范围 ' + range[0] + '–' + range[1] + ' mg/100g）') : '';
  $('#dBody').innerHTML =
    '<div class="detail-row"><span class="k">嘌呤含量</span><span class="big-val">' +
    (v == null ? '未知' : v) + ' <small>mg/100g' + (v == null ? '' : '）') + '</small></span></div>' +
    (rangeStr ? '<div class="detail-row"><span class="k">范围</span>' + rangeStr + '</div>' : '') +
    '<div class="detail-row"><span class="k">等级</span>' + levelTag(item.level) + '</div>' +
    '<div class="detail-row"><span class="k">大类</span>' + escapeHtml(item.category) +
    (item.subcategory ? ' / ' + escapeHtml(item.subcategory) : '') + '</div>' +
    (item.aliases && item.aliases.length ? '<div class="detail-row"><span class="k">别名</span>' + escapeHtml(item.aliases.join('、')) + '</div>' : '') +
    (item.preparation ? '<div class="detail-row"><span class="k">食用状态</span>' + escapeHtml(item.preparation) + '</div>' : '') +
    (item.note ? '<div class="detail-row"><span class="k">备注</span>' + escapeHtml(item.note) + '</div>' : '') +
    '<div class="detail-row"><span class="k">来源</span><ul class="sources-list">' +
    (item.sources || []).map(s => '<li>' + escapeHtml(s) + '</li>').join('') + '</ul></div>';
  // 桌面模式不显示"加入今日饮食"
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
  ctx.strokeStyle = '#e3ece7'; ctx.fillStyle = '#999'; ctx.font = '11px sans-serif';
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
    ctx.fillStyle = '#667'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
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
  ctx.strokeStyle = '#e3ece7'; ctx.fillStyle = '#999'; ctx.font = '11px sans-serif';
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

/* ---------------- 15. 数据库信息 / 知识库 / 免责声明 ---------------- */
function renderMe() {
  // 数据库信息
  $('#dbInfo').innerHTML =
    '<li>当前版本：<b>' + escapeHtml(DB.db_version) + '</b>' +
    (LS.get('db_override', null) ? ' <span style="color:#e07b24">(本地已更新)</span>' : '') + '</li>' +
    '<li>更新日期：' + escapeHtml(DB.updated || '') + '</li>' +
    '<li>条目数：' + DB.items.length + ' 条</li>' +
    '<li>覆盖大类：' + DB.categories.length + ' 个</li>';
  // 通道①信息
  $('#channel1Info').innerHTML =
    '<li>当前版本：v' + escapeHtml(DB.db_version) + '（' + DB.items.length + ' 条）</li>' +
    '<li>托管地址：' + (LS.get('host_url', '') || '未配置') + '</li>';
  $('#hostUrl').value = LS.get('host_url', '');
  // 免责声明
  $('#disclaimerText').textContent = KNOWLEDGE.disclaimer || '';
  // 诚实性总声明
  $('#honestyList').innerHTML = [
    '本软件仅供健康参考，不替代专业医疗诊断与治疗建议。',
    '通道①自动更新需将应用部署在公网 HTTPS 静态地址，未部署时仅能使用本地数据。',
    '通道②二维码只承载地址+签名，不承载数据，扫码后需联网下载。',
    '通道③离线包密钥极长，仅适合无网络兜底，不建议日常使用。',
    '密钥验证为本地格式+哈希校验，非银行级安全机制。',
    '嘌呤数据来源于国家卫健委《成人高尿酸血症与痛风食养指南(2024年版)》等公开资料。'
  ].map(t => '<li>' + t + '</li>').join('');
  // 知识库卡片
  $('#knowledgeCards').innerHTML = (KNOWLEDGE.sections || []).map((s, i) =>
    '<div class="kb-card" data-s="' + i + '"><div class="ico">' + (s.icon || '📘') + '</div><div class="t">' + escapeHtml(s.title) + '</div></div>'
  ).join('');
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

async function applyUpdateKey() {
  const raw = ($('#updateKey').value || '').trim();
  if (!raw) { alert('请输入更新密钥'); return; }
  if (!raw.startsWith('PUR-')) { alert('密钥格式错误：应以 PUR- 开头'); return; }
  let token;
  try { token = JSON.parse(b64urlDecode(raw.slice(4))); }
  catch (e) { alert('密钥解析失败：base64url 不是合法 JSON'); return; }

  // 校验必填字段
  if (!token.v) { alert('密钥缺少版本号 v'); return; }
  const hasOnline = !!token.u;
  const hasOffline = !!token.data;
  if (!hasOnline && !hasOffline) { alert('密钥既无下载地址 u 也无离线数据 data，无法更新'); return; }
  if (!token.h) { alert('密钥缺少哈希 h'); return; }
  if (token.exp && token.exp < todayStr()) { alert('密钥已过期（' + token.exp + '）'); return; }
  if (cmpVer(token.v, DB.db_version) <= 0) { alert('已是最新或更新版本不高于当前（当前 ' + DB.db_version + '）'); return; }
  const used = LS.get('used_keys', []);
  if (used.includes(raw)) { alert('该密钥已在本设备使用过'); return; }

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
    // 通道②：在线下载
    alert('正在下载新数据库…');
    let buf;
    try {
      const resp = await fetch(token.u);
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      buf = await resp.arrayBuffer();
    } catch (e) { alert('下载失败：' + e.message + '\n（需联网，且服务器允许跨域）'); return; }
    // 计算 SHA-256 比对
    const hex = await sha256Hex(buf);
    if (hex && hex.toLowerCase() !== String(token.h).toLowerCase()) {
      alert('文件校验失败：SHA-256 不匹配。\n期望: ' + token.h + '\n实际: ' + hex);
      return;
    }
    if (!hex) { if (!confirm('当前环境无法计算 SHA-256（非安全上下文），跳过完整性校验？')) return; }
    try { newDB = JSON.parse(new TextDecoder('utf-8').decode(buf)); }
    catch (e) { alert('下载的不是合法 JSON'); return; }
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
  used.push(raw); LS.set('used_keys', used);
  alert('更新成功！已升级到 v' + newDB.db_version + '，共 ' + newDB.items.length + ' 条。即将刷新。');
  location.reload();
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
let kgMode = 'online'; // 'online' | 'offline'

async function genKey() {
  const url = $('#kgUrl').value.trim();
  const exp = $('#kgExp').value;
  const notes = $('#kgNotes').value.trim();
  if (!exp) { alert('请选择过期日期'); return; }
  if (kgMode === 'online' && !url) { alert('在线模式需输入下载地址 URL'); return; }
  const v = DB.db_version;

  if (kgMode === 'online') {
    // 通道②：读取原始 JSON 文件算哈希（与 CDN 上传文件一致）
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
    const encoded = b64urlEncode(new TextEncoder().encode(JSON.stringify(token)));
    $('#kgResultCard').style.display = '';
    $('#kgOutput').value = 'PUR-' + encoded;
    $('#kgMeta').innerHTML =
      '<div>目标版本：<b>v' + escapeHtml(v) + '</b></div>' +
      '<div>SHA-256：<code>' + h + '</code></div>' +
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
      const encoded = b64urlEncode(new TextEncoder().encode(JSON.stringify(token)));
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
    alert('当前环境无法访问摄像头，请改用"选择二维码图片"。');
    return;
  }
  try {
    scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const video = $('#qrVideo');
    video.srcObject = scanStream;
    await video.play();
    scanTimer = setInterval(tickScan, 300);
  } catch (e) {
    alert('摄像头开启失败：' + e.message + '\n可改用下方"选择二维码图片"。');
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
      applyUpdateKey();
    }
  } catch (e) {}
}

function stopScan() {
  if (scanTimer) { clearInterval(scanTimer); scanTimer = null; }
  if (scanStream) { scanStream.getTracks().forEach(t => t.stop()); scanStream = null; }
  $('#qrVideo').srcObject = null;
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
    const isOnline = kgMode === 'online';
    $('#kgUrlLabel').style.display = isOnline ? '' : 'none';
    $('#kgModeHint').textContent = isOnline
      ? '在线模式：密钥含下载地址，手机端扫码后需联网拉取更新包。'
      : '离线模式：gzip 压缩整个数据库内嵌进密钥，无需联网，但密钥极长（不适合二维码）。';
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

  // 知识库卡片 → 文章列表
  $('#knowledgeCards').addEventListener('click', e => {
    const c = e.target.closest('.kb-card'); if (!c) return;
    const sec = KNOWLEDGE.sections[parseInt(c.dataset.s, 10)]; if (!sec) return;
    // 简易文章列表：prompt 换成 confirm 风格 —— 这里用一个简化弹窗：列出文章标题
    const titles = sec.articles.map((a, i) => (i + 1) + '. ' + a.title).join('\n');
    const idx = prompt('【' + sec.title + '】选择文章编号（1-' + sec.articles.length + '）：\n' + titles);
    const n = parseInt(idx, 10) - 1;
    if (n >= 0 && n < sec.articles.length) {
      const art = sec.articles[n];
      $('#aTitle').textContent = art.title;
      $('#aContent').textContent = art.content;
      $('#aSources').innerHTML = '参考来源：<ul class="sources-list">' + (art.sources || []).map(s => '<li>' + escapeHtml(s) + '</li>').join('') + '</ul>';
      openModal('articleModal');
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
  // 密钥生成器默认明天+一年后过期
  const d = new Date(); d.setFullYear(d.getFullYear() + 1);
  $('#kgExp').value = fmtDate(d);
  bindEvents();
  switchTab('search');
  registerSW();
});
