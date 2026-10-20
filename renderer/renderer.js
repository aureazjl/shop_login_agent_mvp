(() => {
window.addEventListener('error', (event) => showFatal(`客户端脚本错误：${event.message}`));
window.addEventListener('unhandledrejection', (event) => showFatal(`客户端运行错误：${event.reason?.message || event.reason || '未知错误'}`));

const shopApi = window.shopApi;
let shops = [];
let platforms = {};
let platformDetails = [];
let rows = [];
let performanceShopFocus = null;
const $ = (selector) => document.querySelector(selector);
function ensureAgentPage() {
  if ($('#agentPage')) return;
  const nav = document.createElement('div'); nav.className = 'nav'; nav.dataset.page = 'agent'; nav.textContent = 'AI运营助手';
  const reportsNav = document.querySelector('.nav[data-page="reports"]'); reportsNav?.parentNode.insertBefore(nav, reportsNav);
  const page = document.createElement('div'); page.id = 'agentPage'; page.className = 'hidden';
  page.innerHTML = '<div class="toolbar"><h2>AI运营助手</h2><span class="muted">MVP：基于已采集经营数据</span></div><div class="card"><div id="agentMessages"><div class="muted">可以问我：查询昨天各店铺销售额、退款金额和净销售额。</div></div><div class="filters" style="margin-top:16px"><input id="agentInput" style="flex:1;min-width:320px" placeholder="例如：查询昨天各店铺销售额"><button class="btn primary" id="agentAskBtn">分析</button></div></div><div class="card"><h3>数据明细</h3><div id="agentResult" class="muted">尚未执行查询</div></div>';
  document.querySelector('.content')?.prepend(page);
  nav.addEventListener('click', () => { document.querySelectorAll('.nav').forEach(x=>x.classList.remove('active')); nav.classList.add('active'); document.querySelectorAll('[id$="Page"]').forEach(x=>x.classList.add('hidden')); page.classList.remove('hidden'); $('#title').textContent='AI运营助手'; });
  $('#agentAskBtn').addEventListener('click', askAgent); $('#agentInput').addEventListener('keydown', e=>{ if(e.key==='Enter') askAgent(); });
}
async function askAgent() {
  const input = $('#agentInput'); const query = input?.value?.trim(); if (!query) return;
  $('#agentMessages').insertAdjacentHTML('beforeend', `<div class="card"><b>你：</b>${escapeHtml(query)}</div>`); input.disabled = true;
  try { const result = await shopApi.agentAsk(query); const text = result.ok ? result.answer : (result.message || '执行失败'); $('#agentMessages').insertAdjacentHTML('beforeend', `<div class="card"><b>智能体：</b>${escapeHtml(text)}</div>`); $('#agentResult').innerHTML = result.ok && result.rows?.length ? result.rows.map(x=>`${escapeHtml(x.shopName)}：销售 ¥${Number(x.sales).toFixed(2)}，退款 ¥${Number(x.refund).toFixed(2)}`).join('<br>') : `<span class="muted">${escapeHtml(result.source || '暂无数据')}</span>`; } catch (e) { $('#agentMessages').insertAdjacentHTML('beforeend', `<div class="card danger">${escapeHtml(e.message)}</div>`); } finally { input.disabled=false; input.focus(); }
}
function renderPlatformTabs(containerId, selected, onSelect) {
  let box = $(`#${containerId}`);
  if (!box) {
    box = document.createElement('div'); box.id = containerId; box.className = 'platform-tabs';
    const target = containerId === 'shopPlatformTabs'
      ? $('#shopTable')
      : ($('#reportTable') || $('#reportList')?.parentElement);
    target?.parentNode.insertBefore(box, target);
  }
  box.innerHTML = `<button class="tab ${!selected ? 'active' : ''}" data-platform-tab="" data-platform-target="${containerId}">全部</button>` + platformDetails.map(item => `<button class="tab ${selected === item.key ? 'active' : ''}" data-platform-tab="${escapeHtml(item.key)}" data-platform-target="${containerId}">${escapeHtml(item.name)}</button>`).join('');
  box._onSelect = onSelect;
}
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const platformName = (key) => platformDetails.find(item => item.key === key)?.name || '未命名平台';
function resolveTable(tableSelector) {
  return $(tableSelector) || (tableSelector === '#reportTable' ? $('#reportList')?.parentElement : null);
}
function applyColumnLayout(tableSelector, storageKey) {
  const table = resolveTable(tableSelector); const header = table?.querySelector('.th');
  if (!header) return;
  const rowsContainer = tableSelector === '#shopTable' ? $('#shopList') : $('#reportList');
  const count = header.children.length;
  localStorage.removeItem(storageKey);
  const order = [...Array(count).keys()];
  const reorder = (row) => { const cells = [...row.children]; if (cells.length !== count) return; order.forEach(index => { if (cells[index]) row.appendChild(cells[index]); }); };
  reorder(header); [...(rowsContainer?.children || [])].forEach(reorder);
  [...header.children].forEach((cell) => {
    cell.draggable = false;
    cell.style.cursor = 'default';
    cell.ondragstart = null;
    cell.ondragover = null;
    cell.ondrop = null;
  });
  enableColumnResize(tableSelector, `${storageKey}-widths`);
}
function enableColumnResize(tableSelector, storageKey) {
  const table = resolveTable(tableSelector); const header = table?.querySelector('.th');
  if (!table || !header) return;
  const rows = () => [header, ...(tableSelector === '#shopTable' ? [...($('#shopList')?.children || [])] : [...($('#reportList')?.children || [])])];
  let widths; try { widths = JSON.parse(localStorage.getItem(storageKey) || 'null'); } catch (_) { widths = null; }
  const current = getComputedStyle(header).gridTemplateColumns.split(' ').map(Number);
  if (!Array.isArray(widths) || widths.length !== header.children.length) widths = current;
  const apply = () => rows().forEach(row => { row.style.gridTemplateColumns = widths.map(x => `${Math.round(x)}px`).join(' '); });
  apply();
  [...header.children].forEach((cell, index) => {
    cell.querySelector('.resize-handle')?.remove();
    if (index >= header.children.length - 1) return;
    const handle = document.createElement('span'); handle.className = 'resize-handle';
    handle.style.cssText = 'position:absolute;top:0;right:-4px;width:8px;height:100%;cursor:col-resize;z-index:5';
    cell.style.position = 'relative'; cell.appendChild(handle);
    handle.onpointerdown = (event) => {
      event.preventDefault(); event.stopPropagation();
      const startX = event.clientX; const startLeft = widths[index]; const startRight = widths[index + 1];
      const move = (e) => { const delta = e.clientX - startX; widths[index] = Math.max(90, startLeft + delta); widths[index + 1] = Math.max(90, startRight - delta); apply(); };
      const up = () => { localStorage.setItem(storageKey, JSON.stringify(widths)); document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); };
      document.addEventListener('pointermove', move); document.addEventListener('pointerup', up, { once: true });
    };
  });
}
function bindAddButton() {
  const button = $('#addBtn');
  if (!button) return;
  button.disabled = false;
  button.style.pointerEvents = 'auto';
  button.onclick = (event) => { event.preventDefault(); event.stopPropagation(); openAddShop(); };
}
function ensurePerformancePage() {
  if ($('#performancePage')) return;
  const platformNav = document.querySelector('.nav[data-page="platforms"]');
  if (platformNav && !document.querySelector('.nav[data-page="performance"]')) { const nav = document.createElement('div'); nav.className = 'nav'; nav.dataset.page = 'performance'; nav.textContent = '业绩分析'; platformNav.parentNode.insertBefore(nav, platformNav); }
  const page = document.createElement('div');
  page.id = 'performancePage'; page.className = 'hidden';
  page.innerHTML = `<div class="toolbar"><h2>业绩分析</h2></div><div class="card"><div class="filters"><label>日期范围 <select id="performanceRange"><option value="7">最近7天</option><option value="30">最近30天</option><option value="custom">自定义</option></select></label><label>平台 <select id="performancePlatform"><option value="">全部平台</option></select></label><label>店铺 <select id="performanceShop"><option value="">全部店铺</option></select></label><label>指标 <select id="performanceMetric"><option value="sales">销售额</option><option value="refund">退款金额</option><option value="net">净销售额</option></select></label><input id="performanceStart" type="date" class="hidden"><input id="performanceEnd" type="date" class="hidden"><button class="btn primary" id="performanceQueryBtn">查询</button></div></div><div id="performancePlatformTabs" class="platform-tabs"></div><div class="stat performance-stats"><div>销售总额<b id="performanceSalesTotal">¥0.00</b></div><div>退款总额<b id="performanceRefundTotal">¥0.00</b></div><div>净销售额<b id="performanceNetTotal">¥0.00</b></div><div>日均销售额<b id="performanceDailyAvg">¥0.00</b></div></div><div class="performance-grid"><div class="card performance-chart-card"><div class="performance-chart-title"><h3>每日业绩趋势</h3><button class="performance-back-icon" id="performanceBackBtn" title="返回全部店铺" aria-label="返回全部店铺" style="display:none">↶</button></div><div id="performanceChart" class="performance-chart"></div></div><div class="card performance-platform-card"><h3>平台占比</h3><div id="performancePlatformShare"></div></div></div><div class="card"><h3>店铺业绩排行 <span class="muted">点击店铺行查看单店铺趋势</span></h3><div class="table performance-rank-table"><div class="report-tr th"><div>排名</div><div>平台</div><div>店铺</div><div>销售额</div><div>退款金额</div><div>净销售额</div></div><div id="performanceRankList"></div></div></div>`;
  $('#platformsPage')?.parentNode.insertBefore(page, $('#platformsPage'));
}
function ensureCollectionPage() {
  if ($('#collectionPage')) return;
  const reportNav = document.querySelector('.nav[data-page="reports"]');
  if (reportNav && !document.querySelector('.nav[data-page="collection"]')) { const nav = document.createElement('div'); nav.className = 'nav'; nav.dataset.page = 'collection'; nav.textContent = '数据采集'; reportNav.parentNode.insertBefore(nav, reportNav); }
  const page = document.createElement('div'); page.id = 'collectionPage'; page.className = 'hidden';
  page.innerHTML = `<div class="toolbar"><h2>数据采集</h2></div><div class="card muted">账号页只用于登录和状态检查，所有销售额、退款金额采集统一在本模块执行。</div><div class="card"><div class="filters"><label>采集日期 <input type="date" id="collectionDate"></label><button class="btn green" data-collection-yesterday>采集昨日</button><button class="btn primary" data-collection-batch>批量采集</button></div></div><div class="table"><div class="tr th"><div>店铺</div><div>平台</div><div>登录状态</div><div><button class="btn" data-select-all="collection">全选</button></div></div><div id="collectionShopList"></div></div>`;
  $('#platformsPage')?.parentNode.insertBefore(page, $('#platformsPage'));
  const d = new Date(Date.now() - 86400000); $('#collectionDate').value = d.toISOString().slice(0, 10);
}
function arrangeReportFilters() {
  const page = $('#reportsPage'); if (!page || $('#reportDateToolbar')) return;
  const card = page.querySelector('.card'); const filters = card?.querySelector('.filters'); if (!filters) return;
  const toolbar = document.createElement('div'); toolbar.id = 'reportDateToolbar'; toolbar.className = 'report-date-toolbar'; toolbar.innerHTML = '<span>时间</span>';
  ['startDate', 'endDate'].forEach(id => { const input = document.getElementById(id); if (input) { const label = input.closest('label'); if (label) toolbar.appendChild(label); } });
  const query = document.getElementById('queryBtn'); if (query) toolbar.appendChild(query);
  card.style.display = 'none'; const tabs = $('#reportPlatformTabs'); tabs?.parentNode.insertBefore(toolbar, tabs);
}
function renderCollectionShops() {
  ensureCollectionPage();
  $('#collectionShopList').innerHTML = shops.length ? shops.map(shop => `<div class="tr"><div><b>${escapeHtml(shop.name)}</b></div><div>${escapeHtml(platformName(shop.platform))}</div><div>${escapeHtml(shop.status || '未登录')}</div><div><input type="checkbox" class="collection-shop-select" value="${escapeHtml(shop.id)}"></div></div>`).join('') : '<div class="empty">暂无店铺</div>';
}
async function collectForShops(shopIds, date) {
  const ids = shopIds.length ? shopIds : shops.map(shop => shop.id); if (!ids.length) { toast('暂无可采集店铺'); return; }
  $('#collectionProgress')?.remove(); const overlay = document.createElement('div'); overlay.id = 'collectionProgress'; overlay.style = 'position:fixed;inset:0;background:#17243a66;display:flex;align-items:center;justify-content:center;z-index:10001'; overlay.innerHTML = `<div style="background:#fff;border-radius:12px;padding:24px;width:460px;box-shadow:0 20px 60px #0003"><h3 style="margin:0 0 12px">正在采集数据</h3><div id="collectionProgressText" style="color:#52627a;margin-bottom:10px">准备开始...</div><div style="height:10px;background:#edf2f9;border-radius:8px;overflow:hidden"><div id="collectionProgressBar" style="height:100%;width:0;background:#347cf4;transition:width .2s"></div></div><div id="collectionProgressResult" style="margin-top:12px;color:#8995a7"></div></div>`; document.body.appendChild(overlay);
  let success = 0, failed = 0;
  for (let i = 0; i < ids.length; i += 1) { const shop = shops.find(item => String(item.id) === String(ids[i])); $('#collectionProgressText').textContent = `正在采集：${shop?.name || '店铺'}（${i + 1}/${ids.length}）`; $('#collectionProgressBar').style.width = `${Math.round((i / ids.length) * 100)}%`; try { const result = await shopApi.batchReports({ date, shopIds: [ids[i]] }); if (result.some(item => item.error)) failed += 1; else success += 1; } catch (_) { failed += 1; } $('#collectionProgressResult').textContent = `已完成 ${i + 1}/${ids.length}，成功 ${success}，失败 ${failed}`; }
  $('#collectionProgressBar').style.width = '100%'; $('#collectionProgressText').textContent = '采集完成'; await new Promise(resolve => setTimeout(resolve, 500)); overlay.remove(); toast(`已完成 ${success} 个店铺采集${failed ? `，${failed} 个失败` : ''}`); await queryReports();
}
async function confirmCollection(date) {
  if (!date) throw new Error('请选择采集日期');
  $('#collectionChoiceModal')?.remove();
  const overlay = document.createElement('div'); overlay.id = 'collectionChoiceModal'; overlay.style = 'position:fixed;inset:0;background:#17243a66;display:flex;align-items:center;justify-content:center;z-index:10000';
  overlay.innerHTML = `<div style="background:#fff;border-radius:12px;padding:24px;width:420px;box-shadow:0 20px 60px #0003"><h3 style="margin:0 0 10px">批量数据采集</h3><p style="color:#52627a;margin:0 0 20px">请选择本次采集范围：${escapeHtml(date)}</p><div style="display:flex;gap:10px;justify-content:flex-end"><button class="btn" data-choice-cancel>取消</button><button class="btn green" data-choice-selected>选择店铺</button><button class="btn primary" data-choice-all>全部店铺</button></div></div>`;
  document.body.appendChild(overlay);
  return new Promise((resolve) => {
    overlay.querySelector('[data-choice-cancel]').onclick = () => { overlay.remove(); resolve(); };
    overlay.querySelector('[data-choice-all]').onclick = async () => { overlay.remove(); resolve(await collectForShops([], date)); };
    overlay.querySelector('[data-choice-selected]').onclick = () => { overlay.remove(); openShopCollectionModal(date); };
  });
}
function openShopCollectionModal(date) {
  $('#shopCollectionModal')?.remove(); const overlay = document.createElement('div'); overlay.id = 'shopCollectionModal'; overlay.style = 'position:fixed;inset:0;background:#17243a66;display:flex;align-items:center;justify-content:center;z-index:10000';
  overlay.innerHTML = `<div style="background:#fff;border-radius:12px;padding:24px;width:620px;max-height:78vh;box-shadow:0 20px 60px #0003;display:flex;flex-direction:column"><h3 style="margin:0 0 8px">选择采集店铺</h3><p style="color:#52627a;margin:0 0 14px">采集日期：${escapeHtml(date)}</p><div style="display:flex;justify-content:flex-end;margin-bottom:8px"><button class="btn" data-select-all="modal">全选</button></div><div style="max-height:420px;overflow:auto;border:1px solid #e5eaf2;border-radius:8px">${shops.length ? shops.map(shop => `<label style="display:grid;grid-template-columns:28px 1fr 120px;align-items:center;padding:11px 14px;border-bottom:1px solid #edf0f5;cursor:pointer"><input type="checkbox" class="modal-collection-shop" value="${escapeHtml(shop.id)}"><span>${escapeHtml(shop.name)}</span><span class="muted">${escapeHtml(platformName(shop.platform))}</span></label>`).join('') : '<div class="empty">暂无店铺</div>'}</div><div style="display:flex;justify-content:flex-end;gap:10px;margin-top:18px"><button class="btn" data-modal-collection-cancel>取消</button><button class="btn primary" data-modal-collection-confirm>确定采集</button></div></div>`;
  document.body.appendChild(overlay); overlay.querySelector('[data-modal-collection-cancel]').onclick = () => overlay.remove(); overlay.querySelector('[data-modal-collection-confirm]').onclick = async () => { const selected = [...overlay.querySelectorAll('.modal-collection-shop:checked')].map(input => input.value); if (!selected.length) { toast('请至少选择一家店铺'); return; } overlay.remove(); await collectForShops(selected, date); };
}
function formatMoney(value) { return `¥${Number(value || 0).toFixed(2)}`; }
function performanceDateRange() {
  const range = $('#performanceRange').value; const end = new Date(); let start = new Date(end);
  if (range === 'custom') return { start: $('#performanceStart').value, end: $('#performanceEnd').value };
  start.setDate(end.getDate() - Number(range || 7) + 1);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}
function renderPerformanceChart(data, metric) {
  const width = 760, height = 260, pad = 38; const values = data.map(x => Number(x[metric] || 0)); const max = Math.max(...values, 1); const step = data.length > 1 ? (width - pad * 2) / (data.length - 1) : 0;
  const points = values.map((v, i) => `${pad + i * step},${height - pad - (v / max) * (height - pad * 2)}`).join(' ');
  $('#performanceChart').innerHTML = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none"><line x1="${pad}" y1="${height-pad}" x2="${width-pad}" y2="${height-pad}" stroke="#dbe3ee"/><polyline points="${points}" fill="none" stroke="#347cf4" stroke-width="3"/>${values.map((v,i)=>`<circle cx="${pad+i*step}" cy="${height-pad-(v/max)*(height-pad*2)}" r="4" fill="#347cf4"><title>${data[i].date} ${formatMoney(v)}</title></circle>`).join('')}</svg><div class="chart-labels">${data.map(x => `<span>${escapeHtml(x.date.slice(5))}</span>`).join('')}</div>`;
}
async function queryPerformance() {
  const range = performanceDateRange(); const filter = { start: range.start, end: range.end, platform: $('#performancePlatform').value, shopId: $('#performanceShop').value };
  let source = await shopApi.reports(filter); const byShop = {}; source.forEach(item => { const sales = Number(item.salesAmount || 0), refund = Number(item.refundAmount || 0); const key = `${item.platform}::${item.shopName}`; (byShop[key] ||= { shopName: item.shopName, platform: item.platform, sales: 0, refund: 0 }); byShop[key].sales += sales; byShop[key].refund += refund; });
  const viewSource = performanceShopFocus ? source.filter(item => item.platform === performanceShopFocus.platform && item.shopName === performanceShopFocus.shopName) : source; const byDate = {};
  viewSource.forEach(item => { const sales = Number(item.salesAmount || 0), refund = Number(item.refundAmount || 0); (byDate[item.date] ||= { date: item.date, sales: 0, refund: 0, net: 0 }); byDate[item.date].sales += sales; byDate[item.date].refund += refund; byDate[item.date].net += sales - refund; });
  const dates = Object.values(byDate).sort((a,b) => a.date.localeCompare(b.date)); const sales = viewSource.reduce((n,x)=>n+Number(x.salesAmount||0),0), refund = viewSource.reduce((n,x)=>n+Number(x.refundAmount||0),0);
  $('#performanceBackBtn').style.display = performanceShopFocus ? 'inline-flex' : 'none';
  $('#performanceSalesTotal').textContent = formatMoney(sales); $('#performanceRefundTotal').textContent = formatMoney(refund); $('#performanceNetTotal').textContent = formatMoney(sales-refund); $('#performanceDailyAvg').textContent = formatMoney(dates.length ? sales/dates.length : 0);
  renderPerformanceChart(dates, $('#performanceMetric').value); const ranks = Object.values(byShop).sort((a,b)=>b.sales-a.sales); $('#performanceRankList').innerHTML = ranks.length ? ranks.map((x,i)=>{ const active = performanceShopFocus && performanceShopFocus.platform === x.platform && performanceShopFocus.shopName === x.shopName ? ' active' : ''; return `<div class="report-tr performance-rank-row${active}" data-performance-shop="${escapeHtml(x.shopName)}" data-performance-platform="${escapeHtml(x.platform)}"><div>${i+1}</div><div>${escapeHtml(platformName(x.platform))}</div><div>${escapeHtml(x.shopName)}</div><div>${formatMoney(x.sales)}</div><div>${formatMoney(x.refund)}</div><div>${formatMoney(x.sales-x.refund)}</div></div>`; }).join('') : '<div class="empty">暂无业绩数据</div>';
  const platformTotals = {}; viewSource.forEach(x => platformTotals[x.platform] = (platformTotals[x.platform] || 0) + Number(x.salesAmount || 0)); const total = Object.values(platformTotals).reduce((a,b)=>a+b,0); $('#performancePlatformShare').innerHTML = Object.entries(platformTotals).sort((a,b)=>b[1]-a[1]).map(([key,value])=>`<div class="share-row"><span>${escapeHtml(platformName(key))}</span><b>${total ? (value/total*100).toFixed(1) : '0.0'}%</b><em>${formatMoney(value)}</em></div>`).join('') || '<div class="empty">暂无平台数据</div>';
}

function showFatal(message) {
  let box = document.querySelector('#fatalError');
  if (!box) {
    box = document.createElement('div');
    box.id = 'fatalError';
    box.style = 'position:fixed;left:20px;right:20px;bottom:20px;background:#9b2020;color:#fff;padding:14px;z-index:20000;border-radius:8px';
    document.body.appendChild(box);
  }
  box.textContent = message;
}

function toast(message) {
  const element = $('#toast');
  element.textContent = message || '操作完成';
  element.style.display = 'block';
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { element.style.display = 'none'; }, 3500);
}

function modal(title, fields, onSubmit) {
  $('#appModal')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'appModal';
  overlay.style = 'position:fixed;inset:0;background:#17243a66;display:flex;align-items:center;justify-content:center;z-index:10000';
  overlay.innerHTML = `<div style="background:#fff;border-radius:12px;padding:24px;width:420px;box-shadow:0 20px 60px #0003"><h3 style="margin:0 0 18px">${escapeHtml(title)}</h3>${fields.map((field) => `<label style="display:block;margin:12px 0;color:#52627a">${escapeHtml(field.label)}${field.type === 'select' ? `<select id="m_${field.id}" style="display:block;width:100%;padding:10px;margin-top:6px;border:1px solid #dbe3ee;border-radius:6px">${field.options}</select>` : `<input id="m_${field.id}" type="${field.type || 'text'}" value="${escapeHtml(field.value || '')}" placeholder="${escapeHtml(field.placeholder || '')}" style="box-sizing:border-box;display:block;width:100%;padding:10px;margin-top:6px;border:1px solid #dbe3ee;border-radius:6px">`}</label>`).join('')}<div style="text-align:right;margin-top:20px"><button id="m_cancel" class="btn">取消</button> <button id="m_ok" class="btn primary">确定</button></div></div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#m_cancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#m_ok').addEventListener('click', async () => {
    const button = overlay.querySelector('#m_ok');
    const data = Object.fromEntries(fields.map((field) => [field.id, overlay.querySelector(`#m_${field.id}`).value.trim()]));
    button.disabled = true;
    try { await onSubmit(data); overlay.remove(); }
    catch (error) { toast(error.message || String(error)); }
    finally { button.disabled = false; }
  });
  overlay.querySelector('input,select')?.focus();
}

async function loadShops() {
  ensureAgentPage();
  ensurePerformancePage();
  ensureCollectionPage();
  $('#batchBtn')?.remove();
  arrangeReportFilters();
  ensureCollectionPage();
  shops = await shopApi.list();
  platformDetails = typeof shopApi.platformDetails === 'function' ? await shopApi.platformDetails() : Object.entries(await shopApi.platforms()).map(([key, url]) => ({ key, name: key, url }));
  platforms = Object.fromEntries(platformDetails.map(item => [item.key, item.url]));
  const options = platformDetails.map((item) => `<option value="${escapeHtml(item.key)}">${escapeHtml(item.name)}</option>`).join('');
  $('#shopPlatformFilter').innerHTML = '<option value="">全部平台</option>' + options;
  $('#reportPlatform').innerHTML = '<option value="">全部平台</option>' + options;
  $('#performancePlatform').innerHTML = '<option value="">全部平台</option>' + options;
  $('#performanceShop').innerHTML = '<option value="">全部店铺</option>' + shops.map(shop => `<option value="${escapeHtml(shop.id)}">${escapeHtml(shop.name)}（${escapeHtml(platformName(shop.platform))}）</option>`).join('');
  renderPlatformTabs('shopPlatformTabs', $('#shopPlatformFilter').value, (key) => { $('#shopPlatformFilter').value = key; renderShops(); });
  renderPlatformTabs('reportPlatformTabs', $('#reportPlatform').value, (key) => { $('#reportPlatform').value = key; queryReports(); });
  renderShops();
  renderCollectionShops();
  renderPlatforms();
  renderPlatformTabs('performancePlatformTabs', $('#performancePlatform').value, (key) => { $('#performancePlatform').value = key; queryPerformance(); });
  bindAddButton();
}

function renderPlatforms() {
  const list = platformDetails;
  $('#platformList').innerHTML = list.length ? list.map((item) => `<div class="tr"><div><b>${escapeHtml(item.name)}</b></div><div class="muted">${escapeHtml(item.url)}</div><div>已启用</div><div></div><div><button class="btn" data-edit-platform="${escapeHtml(item.key)}">修改</button></div></div>`).join('') : '<div class="empty">暂无平台，请新增平台</div>';
}

function openEditPlatform(key) {
  const detail = platformDetails.find(item => item.key === key) || { key, name: key, url: platforms[key] };
  modal('修改平台', [
    { id: 'key', label: '平台编码', value: detail.key },
    { id: 'name', label: '平台名称', value: detail.name },
    { id: 'url', label: '登录链接', value: detail.url, placeholder: 'https://' }
  ], async (data) => {
    if (!data.url) throw new Error('请填写登录链接');
    await shopApi.addPlatform({ key, name: data.name || key, url: data.url });
    await loadShops();
    toast('平台配置已修改');
  });
}

function renderShops() {
  const filter = $('#shopPlatformFilter').value;
  const visible = shops.filter((shop) => !filter || shop.platform === filter);
  $('#shopList').innerHTML = visible.length ? visible.map((shop) => `<div class="tr"><div><b>${escapeHtml(shop.name)}</b><div class="muted">${escapeHtml(shop.id.slice(0, 8))}</div></div><div>${escapeHtml(platformName(shop.platform))}</div><div class="status ${shop.status === '已登录' ? 'ok' : 'bad'}">● ${escapeHtml(shop.status || '未登录')}</div><div class="muted">${shop.lastCheck ? new Date(shop.lastCheck).toLocaleString('zh-CN', { hour12: false }) : '—'}</div><div class="actions"><button class="btn primary" data-login="${shop.id}">登录</button><button class="btn" data-check="${shop.id}">检查</button><button class="btn danger" data-remove="${shop.id}">删除</button></div></div>`).join('') : '<div class="empty">没有符合条件的店铺</div>';
  applyColumnLayout('#shopTable', 'shop-login-layout');
}

async function queryReports() {
  rows = await shopApi.reports({ start: $('#startDate').value, end: $('#endDate').value, platform: $('#reportPlatform').value });
  $('#salesTotal').textContent = '¥' + rows.reduce((sum, item) => sum + (item.salesAmount || 0), 0).toFixed(2);
  $('#refundTotal').textContent = '¥' + rows.reduce((sum, item) => sum + (item.refundAmount || 0), 0).toFixed(2);
  $('#recordTotal').textContent = rows.length;
  $('#reportList').innerHTML = rows.length ? rows.map((item) => `<div class="report-tr"><div>${escapeHtml(item.date)}</div><div>${escapeHtml(platformName(item.platform))}</div><div>${escapeHtml(item.shopName)}</div><div>¥${Number(item.salesAmount || 0).toFixed(2)}</div><div>¥${Number(item.refundAmount || 0).toFixed(2)}</div><div>${item.refundOrders ?? '-'}</div><div><button class="btn danger" data-delete-report="${escapeHtml(item.id)}">删除</button></div></div>`).join('') : '<div class="empty">暂无历史数据，请先采集数据</div>';
  applyColumnLayout('#reportTable', 'shop-report-layout');
}

function openAddShop() {
  const options = platformDetails.map((item) => `<option value="${escapeHtml(item.key)}">${escapeHtml(item.name)}（${escapeHtml(item.key)}）</option>`).join('');
  modal('新增店铺', [{ id: 'name', label: '店铺名称', placeholder: '例如：女装旗舰店' }, { id: 'platform', label: '所属平台', type: 'select', options }], async (data) => {
    if (!data.name || !data.platform) throw new Error('请填写完整信息');
    const shop = await shopApi.add(data);
    await loadShops();
    const result = await shopApi.login(shop.id);
    toast(result.message || '已打开登录窗口');
  });
}
window.__openAddShop = openAddShop;

function bindEvents() {
  bindAddButton();
  $('#addPlatformBtn')?.addEventListener('click', () => modal('新增平台', [{ id: 'key', label: '平台编码（英文）', placeholder: 'alibaba' }, { id: 'name', label: '平台名称' }, { id: 'url', label: '登录链接', placeholder: 'https://' }], async (data) => {
    await shopApi.addPlatform(data); await loadShops(); toast('平台已保存');
  }));
  $('#queryBtn')?.addEventListener('click', queryReports);
  $('#deleteSelectedBtn')?.addEventListener('click', async () => {
    if (!rows.length || !confirm(`确定删除当前 ${rows.length} 条报表记录吗？`)) return;
    await shopApi.deleteReports(rows.map((item) => item.id));
    toast('已删除筛选结果');
    await queryReports();
  });
  $('#exportBtn')?.addEventListener('click', async () => { const result = await shopApi.exportReports(rows); if (result.ok) toast('已导出报表'); });
  $('#shopPlatformFilter')?.addEventListener('change', renderShops);
  $('#reportPlatform')?.addEventListener('change', () => { renderPlatformTabs('reportPlatformTabs', $('#reportPlatform').value, (key) => { $('#reportPlatform').value = key; queryReports(); }); });
  $('#performanceRange')?.addEventListener('change', () => { const custom = $('#performanceRange').value === 'custom'; $('#performanceStart')?.classList.toggle('hidden', !custom); $('#performanceEnd')?.classList.toggle('hidden', !custom); });
  $('#performancePlatform')?.addEventListener('change', () => { renderPlatformTabs('performancePlatformTabs', $('#performancePlatform').value, (key) => { $('#performancePlatform').value = key; queryPerformance(); }); });
  $('#performanceShop')?.addEventListener('change', queryPerformance);
  $('#performanceMetric')?.addEventListener('change', queryPerformance);
  $('#performanceQueryBtn')?.addEventListener('click', queryPerformance);
  $('#performanceBackBtn')?.addEventListener('click', () => { performanceShopFocus = null; $('#performanceShop').value = ''; queryPerformance(); });
  if (typeof shopApi.onShopStatusChanged === 'function') shopApi.onShopStatusChanged((shop) => {
    const current = shops.find((item) => item.id === shop?.id);
    if (current) Object.assign(current, shop);
    loadShops().catch((error) => toast(error.message));
    if (shop?.status === '已登录') toast(`${shop.name} 已自动同步为已登录`);
  });
  document.querySelectorAll('.nav[data-page]').forEach((nav) => nav.addEventListener('click', () => {
    document.querySelectorAll('.nav').forEach((item) => item.classList.remove('active'));
    nav.classList.add('active');
    const page = nav.dataset.page;
    $('#shopsPage').classList.toggle('hidden', page !== 'shops');
    $('#agentPage')?.classList.toggle('hidden', page !== 'agent');
    $('#reportsPage').classList.toggle('hidden', page !== 'reports');
    $('#collectionPage').classList.toggle('hidden', page !== 'collection');
    $('#performancePage').classList.toggle('hidden', page !== 'performance');
    $('#platformsPage').classList.toggle('hidden', page !== 'platforms');
    $('#title').textContent = page === 'agent' ? 'AI运营助手' : page === 'reports' ? '销售/退款报表' : page === 'collection' ? '数据采集' : page === 'performance' ? '业绩分析' : page === 'platforms' ? '平台管理' : '店铺账号';
    if (page === 'agent') ensureAgentPage();
    if (page === 'reports') queryReports().catch((error) => toast(error.message));
    if (page === 'performance') queryPerformance().catch((error) => toast(error.message));
    if (page === 'platforms') { loadShops().catch((error) => toast(error.message)); }
  }));
  document.addEventListener('click', async (event) => {
    const selectAll = event.target.closest('[data-select-all]');
    if (selectAll) { event.preventDefault(); const scope = selectAll.dataset.selectAll === 'modal' ? document.querySelector('#shopCollectionModal') : document.querySelector('#collectionPage'); const boxes = [...(scope?.querySelectorAll('input[type="checkbox"]') || [])]; const shouldCheck = boxes.some(box => !box.checked); boxes.forEach(box => { box.checked = shouldCheck; }); selectAll.textContent = shouldCheck ? '取消全选' : '全选'; return; }
    const collectionButton = event.target.closest('[data-collection-batch],[data-collection-yesterday]');
    if (collectionButton) { event.preventDefault(); event.stopImmediatePropagation(); if (collectionButton.dataset.collectionYesterday !== undefined) $('#collectionDate').value = new Date(Date.now() - 86400000).toISOString().slice(0, 10); confirmCollection($('#collectionDate').value).catch(error => toast(error.message)); return; }
    const tab = event.target.closest('[data-platform-tab]');
    if (tab) {
      const box = $(`#${tab.dataset.platformTarget}`); box?._onSelect?.(tab.dataset.platformTab || '');
      renderPlatformTabs(tab.dataset.platformTarget, tab.dataset.platformTab || '', box?._onSelect); return;
    }
    const performanceRow = event.target.closest('[data-performance-shop]');
    if (performanceRow) { performanceShopFocus = { shopName: performanceRow.dataset.performanceShop, platform: performanceRow.dataset.performancePlatform }; $('#performanceShop').value = ''; queryPerformance().catch(error => toast(error.message)); return; }
    const target = event.target.closest('[data-login],[data-check],[data-yesterday],[data-date],[data-remove],[data-delete-report],[data-edit-platform]');
    if (!target) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    try {
      if (target.dataset.login) { const result = await shopApi.login(target.dataset.login); toast(result.message); await loadShops(); }
      else if (target.dataset.check) { const result = await shopApi.check(target.dataset.check); toast(result.message); await loadShops(); }
      else if (target.dataset.yesterday) {
        const result = await shopApi.yesterdayMetrics(target.dataset.yesterday);
        toast(result.ok === false ? result.message : `昨日成交 ¥${Number(result.salesAmount || 0).toFixed(2)}，退款 ¥${Number(result.refundAmount || 0).toFixed(2)}`);
        await queryReports();
      }
      else if (target.dataset.date) {
        const shopId = target.dataset.date;
        modal('查询指定日期', [{ id: 'date', label: '日期', type: 'date' }], async (data) => {
          if (!data.date) throw new Error('请选择日期');
          const result = await shopApi.dateMetrics(shopId, data.date);
          toast(result.ok ? `${data.date} 成交 ¥${result.salesAmount}，退款 ¥${result.refundAmount}` : result.message);
          await queryReports();
        });
      } else if (target.dataset.remove && confirm('确定删除该店铺及登录信息吗？')) { await shopApi.remove(target.dataset.remove); await loadShops(); }
      else if (target.dataset.deleteReport && confirm('确定删除这条报表记录吗？')) { await shopApi.deleteReports([target.dataset.deleteReport]); await queryReports(); toast('报表记录已删除'); }
      else if (target.dataset.editPlatform) openEditPlatform(target.dataset.editPlatform);
    } catch (error) { toast(error.message || String(error)); }
  });
}

async function init() {
  if (!shopApi) throw new Error('预加载接口未加载，请重新安装最新版客户端');
  const versionMark = document.createElement('div');
  versionMark.id = 'versionMark';
  versionMark.textContent = 'v1.0.4 · 页面脚本已加载';
  versionMark.style = 'position:fixed;top:4px;right:12px;z-index:9999;color:#9aa6b7;font-size:11px;pointer-events:none';
  document.body.appendChild(versionMark);
  const reportLayoutStyle = document.createElement('style');
  reportLayoutStyle.textContent = '.table{overflow-x:auto}.platform-tabs{display:flex;gap:8px;margin:-4px 0 14px;padding:4px 0;flex-wrap:wrap}.platform-tabs .tab{border:1px solid #dbe3ee;background:#fff;color:#52627a;border-radius:18px;padding:7px 18px;cursor:pointer}.platform-tabs .tab.active{background:#347cf4;border-color:#347cf4;color:#fff}.report-date-toolbar{display:flex;justify-content:flex-end;align-items:center;gap:8px;margin:0 0 14px;padding:12px 16px;background:#fff;border:1px solid #e5eaf2;border-radius:10px}.report-date-toolbar>span{color:#52627a}.report-date-toolbar label{display:flex;align-items:center;gap:6px;color:#52627a}.report-date-toolbar input{padding:8px;border:1px solid #dbe3ee;border-radius:6px}.report-tr{grid-template-columns:1fr .8fr 1.3fr 1fr 1fr .9fr 100px;min-width:1050px;white-space:nowrap}.report-tr>div{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.report-tr .btn{white-space:nowrap;padding:7px 10px}#platformsPage .table .tr{grid-template-columns:1.2fr 2.4fr 90px 1fr 120px;min-width:760px}#platformsPage .table .tr>div{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.performance-grid{display:grid;grid-template-columns:minmax(0,2fr) minmax(280px,1fr);gap:16px}.performance-chart-card h3,.performance-platform-card h3{margin-top:0}.performance-chart-title{display:flex;align-items:center;justify-content:space-between}.performance-back-icon{display:none;border:0;background:#edf4ff;color:#347cf4;width:28px;height:28px;border-radius:50%;font-size:19px;line-height:28px;cursor:pointer}.performance-chart{height:260px}.performance-chart svg{width:100%;height:220px}.chart-labels{display:flex;justify-content:space-between;color:#8995a7;font-size:12px}.share-row{display:grid;grid-template-columns:1fr 70px 110px;padding:14px 0;border-bottom:1px solid #edf0f5}.share-row b{color:#347cf4}.share-row em{font-style:normal;text-align:right;color:#52627a}.performance-rank-table{overflow:auto}.performance-rank-table .report-tr{grid-template-columns:70px 100px 1.5fr 1fr 1fr 1fr;min-width:700px}.performance-rank-row{cursor:pointer}.performance-rank-row:hover,.performance-rank-row.active{background:#edf5ff}.performance-rank-row.active{box-shadow:inset 3px 0 #347cf4}.performance-stats{flex-wrap:wrap}';
  document.head.appendChild(reportLayoutStyle);
  const reportHeader = document.querySelector('.report-tr.th');
  if (reportHeader && reportHeader.children.length === 6) {
    const operationHeader = document.createElement('div');
    operationHeader.textContent = '操作';
    reportHeader.appendChild(operationHeader);
  }
  const refundHeader = document.querySelector('.report-tr.th div:nth-child(5)');
  if (refundHeader) refundHeader.textContent = '退款金额';
  const refundOrdersHeader = document.querySelector('.report-tr.th div:nth-child(6)');
  if (refundOrdersHeader) refundOrdersHeader.textContent = '退款订单数';
  ensurePerformancePage();
  bindEvents();
  await loadShops();
}

init().catch((error) => showFatal(error.message || String(error)));
})();
