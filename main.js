const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');

// 管理页不依赖 GPU；关闭硬件加速可避免部分 Windows 环境因 GPU/缓存权限导致启动即退出。
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('disable-direct-composition');
app.commandLine.appendSwitch('disable-features', 'DirectCompositionVideoOverlays');
app.disableHardwareAcceleration();
const electronDataPath = path.join(__dirname, 'electron-user-data');
try {
  require('fs').mkdirSync(electronDataPath, { recursive: true });
  const cachePath = path.join(electronDataPath, 'cache');
  require('fs').mkdirSync(cachePath, { recursive: true });
  app.setPath('userData', electronDataPath);
  app.setPath('cache', cachePath);
  app.commandLine.appendSwitch('disk-cache-dir', cachePath);
} catch (_) {}
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const http = require('http');
const net = require('net');
const { chromium } = require('playwright');

// 新项目只允许一个实例，避免多个 Electron 进程重复抢占本地智能体桥接端口。
const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

let win;
let agentServer;
const browsers = new Map();
const loginWatchers = new Map();
const normalChromeProcesses = new Map();
const normalChromePorts = new Map();
const urls = {
  douyin: 'https://fxg.jinritemai.com/ffa/mshop/homepage',
  taobao: 'https://loginmyseller.taobao.com/',
  jd: 'https://jdsz.jd.com/szweb/view/index/home.html',
  pinduoduo: 'https://mms.pinduoduo.com/',
  dewu: 'https://stark.dewu.com/'
};
function shopUrl(shop) {
  if (shop.platform === 'jd') return 'https://jdsz.jd.com/szweb/view/index/home.html';
  if (shop.platform === 'taobao') return urls.taobao;
  return shop.loginUrl || urls[shop.platform];
}
const names = { douyin: '抖店', taobao: '淘宝/天猫', jd: '京东', pinduoduo: '拼多多', dewu: '得物' };

function paths() {
  const preferredRoot = path.join(__dirname, 'data_runtime');
  const fallbackRoot = path.join(app.getPath('userData'), 'shop-login-data');
  let root = fallbackRoot;
  try {
    fs.mkdirSync(preferredRoot, { recursive: true });
    root = preferredRoot;
    const oldFile = path.join(fallbackRoot, 'shops.json');
    const newFile = path.join(preferredRoot, 'shops.json');
    if (fs.existsSync(oldFile) && !fs.existsSync(newFile)) {
      fs.copyFileSync(oldFile, newFile);
      const oldProfiles = path.join(fallbackRoot, 'profiles');
      const newProfiles = path.join(preferredRoot, 'profiles');
      if (fs.existsSync(oldProfiles) && !fs.existsSync(newProfiles)) {
        fs.cpSync(oldProfiles, newProfiles, { recursive: true });
      }
    }
  } catch (_) {
    root = fallbackRoot;
  }
  return { root, file: path.join(root, 'shops.json'), profiles: path.join(root, 'profiles') };
}
function readShops() {
  const p = paths(); fs.mkdirSync(p.profiles, { recursive: true });
  if (!fs.existsSync(p.file)) return [];
  try {
    const rows = JSON.parse(fs.readFileSync(p.file, 'utf8'));
    return rows.map(shop => ({ ...shop, profileDir: path.join(p.profiles, shop.id) }));
  } catch { return []; }
}
function writeShops(rows) { const p = paths(); fs.mkdirSync(p.root, { recursive: true }); fs.writeFileSync(p.file, JSON.stringify(rows, null, 2), 'utf8'); }
function historyFile() { return path.join(paths().root, 'metrics-history.json'); }
function authStateFile(shop) { return path.join(paths().root, 'auth-state', `${shop.id}.json`); }
function readHistory() { try { return fs.existsSync(historyFile()) ? JSON.parse(fs.readFileSync(historyFile(), 'utf8')) : []; } catch { return []; } }
function writeHistory(rows) { fs.mkdirSync(paths().root, { recursive: true }); fs.writeFileSync(historyFile(), JSON.stringify(rows, null, 2), 'utf8'); }
function platformFile() { return path.join(paths().root, 'platforms.json'); }
function platformNamesFile() { return path.join(paths().root, 'platform-names.json'); }
function readPlatformNames() { const f = platformNamesFile(); if (!fs.existsSync(f)) writePlatformNames(names); try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return names; } }
function writePlatformNames(v) { const p = paths(); fs.mkdirSync(p.root, { recursive: true }); fs.writeFileSync(platformNamesFile(), JSON.stringify(v, null, 2), 'utf8'); }
function readPlatforms() { const f = platformFile(); if (!fs.existsSync(f)) { writePlatforms(urls); } try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return urls; } }
function writePlatforms(v) { const p = paths(); fs.mkdirSync(p.root, { recursive: true }); fs.writeFileSync(platformFile(), JSON.stringify(v, null, 2), 'utf8'); }
function getShop(id) { return readShops().find(x => x.id === id); }
function patchShop(id, patch) { const rows = readShops().map(x => x.id === id ? { ...x, ...patch } : x); writeShops(rows); return rows; }
function isLoginPage(url, title='') {
  const s = `${url} ${title}`.toLowerCase();
  return /login|passport|signin|verify|captcha|登录|验证/.test(s);
}
async function detectTaobaoLoggedIn(page, context) {
  const info = await page.evaluate(() => ({
    url: location.href,
    title: document.title || '',
    text: (document.body?.innerText || '').slice(0, 20000),
    passwordInputs: document.querySelectorAll('input[type="password"]').length,
    loginButtons: document.querySelectorAll('[class*="login"], [id*="login"], [class*="Login"], [id*="Login"]').length
  })).catch(() => ({ url: page.url(), title: '', text: '', passwordInputs: 0, loginButtons: 0 }));
  const text = `${info.title} ${info.text}`;
  const hasLoginForm = info.passwordInputs > 0 && info.loginButtons > 0;
  const hasSellerContent = /卖家中心|商家中心|店铺管理|千牛|交易管理|订单管理|生意参谋/.test(text);
  const redirectedAway = !/loginmyseller\.taobao\.com|login\.taobao\.com|passport\.taobao\.com/i.test(info.url);
  const cookies = await context.cookies(['https://taobao.com', 'https://seller.taobao.com', 'https://loginmyseller.taobao.com']).catch(() => []);
  const hasSessionCookie = cookies.some(x => ['_tb_token_', 'cookie2', 'unb', 'sgcookie', 'tracknick'].includes(x.name) && x.value);
  return Boolean(!hasLoginForm && (hasSellerContent || (redirectedAway && hasSessionCookie)));
}
async function detectDewuLoggedIn(page) {
  const info = await page.evaluate(() => ({
    url: location.href,
    title: document.title || '',
    text: (document.body?.innerText || '').slice(0, 30000)
  })).catch(() => ({ url: page.url(), title: '', text: '' }));
  const text = `${info.title} ${info.text}`;
  return /得物商家后台|商品分析|经营概览|交易|售后|数据中心|商家管理/.test(text) && !/请登录|密码登录|验证码登录|扫码登录/.test(text);
}
async function checkTaobao(id, shop) {
  const stateFile = authStateFile(shop);
  let session;
  try {
    session = await connectNormalChrome(shop, { launchIfMissing: false });
    // 检查时只读取当前登录窗口，不能再次 goto 登录入口，否则会把已登录页重定向回登录页。
    await session.page.waitForTimeout(1200);
    const logged = await detectTaobaoLoggedIn(session.page, session.context);
    if (logged) {
      fs.mkdirSync(path.dirname(stateFile), { recursive: true });
      await session.context.storageState({ path: stateFile });
    }
    const url = session.page.url();
    const status = logged ? '已登录' : '需登录';
    patchShop(id, { status, lastCheck: new Date().toISOString(), currentUrl: url });
    releaseCdp(session);
    return { ok: true, status, message: logged ? '检测到淘宝店铺已登录，已保存后台登录态' : '当前淘宝仍处于登录页，请先完成登录' };
  } catch (_) {
    if (!fs.existsSync(stateFile)) {
      return { ok: false, message: '未连接到淘宝登录会话。请点击“登录”，完成淘宝登录后保持窗口开启，再点击“检查登录”。' };
    }
    const browser = await chromium.launch({ headless: true, channel: 'chrome' });
    const context = await browser.newContext({ storageState: stateFile });
    const page = await context.newPage();
    try {
      await page.goto(shopUrl(shop), { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      await page.waitForTimeout(2500);
      const logged = await detectTaobaoLoggedIn(page, context);
      const status = logged ? '已登录' : '需登录';
      patchShop(id, { status, lastCheck: new Date().toISOString(), currentUrl: page.url() });
      return { ok: true, status, message: logged ? '已从淘宝后台登录态检测到店铺已登录' : '淘宝登录态已失效，请重新点击登录' };
    } finally {
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
    }
  }
}
function normalChromePath() {
  const candidates = [
    path.join(process.env.PROGRAMFILES || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe')
  ];
  return candidates.find(x => x && fs.existsSync(x)) || 'chrome.exe';
}
function cdpPort(shop) {
  let hash = 0;
  for (const ch of String(shop.id)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return 9400 + (hash % 100);
}
function portIsFree(port) {
  return new Promise(resolve => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '127.0.0.1');
  });
}
async function findCdpPort(shop) {
  const preferred = normalChromePorts.get(shop.id) || shop.cdpPort;
  if (preferred && await portIsFree(Number(preferred))) return Number(preferred);
  for (let port = 9222; port <= 9322; port += 1) {
    if (await portIsFree(port)) return port;
  }
  throw new Error('没有可用的 Chrome CDP 端口');
}
async function openNormalChrome(shop) {
  const old = normalChromeProcesses.get(shop.id);
  if (old && old.exitCode === null && !old.killed) return old;
  const profileDir = shop.platform === 'taobao'
    ? path.join('D:', '店铺登录客户端数据', 'profiles', shop.id)
    : shop.profileDir;
  fs.mkdirSync(profileDir, { recursive: true });
  const port = await findCdpPort(shop);
  normalChromePorts.set(shop.id, port);
  const child = spawn(normalChromePath(), [
    '--new-window',
    '--start-maximized',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    shop.loginUrl || urls[shop.platform]
  ], { cwd: __dirname, detached: true, stdio: 'ignore', windowsHide: false });
  child.unref();
  normalChromeProcesses.set(shop.id, child);
  child.once('exit', () => { if (normalChromeProcesses.get(shop.id) === child) normalChromeProcesses.delete(shop.id); });
  return child;
}
async function waitForCdp(shop, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const session = await connectNormalChrome(shop, { launchIfMissing: false });
      return session;
    } catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`淘宝登录窗口未建立 CDP 连接（端口 ${normalChromePorts.get(shop.id) || '动态分配'}），请重试登录`);
}
async function connectNormalChrome(shop, options = {}) {
  const launchIfMissing = options.launchIfMissing !== false;
  let lastError;
  const known = [normalChromePorts.get(shop.id), shop.cdpPort, cdpPort(shop)].filter(Boolean).map(Number);
  const candidates = [...new Set([...known, ...Array.from({ length: 101 }, (_, i) => 9222 + i)])];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0 && launchIfMissing) await openNormalChrome(shop);
    const ports = attempt === 0 ? candidates : [normalChromePorts.get(shop.id)];
    for (const port of ports.filter(Boolean)) {
      try {
        const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
        const context = browser.contexts()[0];
        if (!context) throw new Error('Chrome 未返回浏览器上下文');
        const page = context.pages()[0] || await context.newPage();
        normalChromePorts.set(shop.id, port);
        return { context, page, browser, cdp: true, port };
      } catch (error) {
        lastError = error;
      }
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw lastError || new Error('普通 Chrome 会话不可用');
}
async function connectDewuChrome(shop) {
  // 得物与淘宝/千牛共用同一套“复用店铺 Chrome 会话”的连接逻辑，
  // 只在页面选择和登录识别阶段使用得物自己的规则。
  const session = await connectNormalChrome(shop, { launchIfMissing: false });
  const page = session.context.pages().find(p => /stark\.dewu\.com/i.test(p.url()));
  if (!page) {
    releaseCdp(session);
    throw new Error('当前 Chrome 会话中未找到得物商家后台页面');
  }
  return { ...session, page };
}
async function waitForDewuCdp(shop, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try { return await connectDewuChrome(shop); }
    catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`得物登录窗口未建立 CDP 连接（端口 ${cdpPort(shop)}），请重试登录`);
}
function releaseCdp(session) {
  if (!session?.browser) return;
  // Playwright 没有 Puppeteer 的 browser.disconnect()；关闭底层传输，保留用户的 Chrome 窗口。
  const connection = session.browser._connection;
  if (connection && typeof connection.close === 'function') connection.close();
}
function moneyAfterYesterday(text, label) {
  const compact = text.replace(/\s+/g, ' ');
  const re = new RegExp(`${label}[^¥\\d]{0,20}(?:¥\\s*)?[\\d,.]+[^¥\\d]{0,20}昨日[^¥\\d]{0,20}(?:¥\\s*)?([\\d,.]+)`);
  const m = compact.match(re); return m ? Number(m[1].replace(/,/g, '')) : null;
}
async function yesterdayMetrics(id) {
  const shop = getShop(id); if (!shop) throw new Error('店铺不存在');
  const date = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  return dateMetrics(id, date);
  /*
  const session = await getPage(id, false); const { page } = session;
  await page.goto('https://compass.jinritemai.com/shop', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(10000);
  const text = await page.locator('body').innerText();
  const result = { date: new Date(Date.now() - 86400000).toISOString().slice(0, 10), salesAmount: moneyAfterYesterday(text, '成交金额'), refundAmount: moneyAfterYesterday(text, '退款金额（退款时间）'), refundAmountByPaymentTime: moneyAfterYesterday(text, '退款金额（支付时间）') };
  await session.context.close().catch(() => {}); browsers.delete(id); return result;
  */
}
async function dateMetrics(id, date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('日期格式应为 YYYY-MM-DD');
  const shop = getShop(id); if (!shop) throw new Error('店铺不存在');
  if (shop.platform === 'jd') return jdDateMetrics(shop, date);
  if (shop.platform === 'taobao') return taobaoDateMetrics(shop, date);
  if (shop.platform === 'dewu') return dewuDateMetrics(shop, date);
  if (shop.platform !== 'douyin') throw new Error('目前该平台暂不支持销售额和退款采集');
  const session = await getPage(id, false); const { page } = session;
  await page.goto('https://compass.jinritemai.com/shop', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(7000);
  const result = await page.evaluate(async (date) => {
    const begin = `${date.replaceAll('-', '/')} 00:00:00`, end = `${date.replaceAll('-', '/')} 23:59:59`;
    // refund_amt 是“成交退款金额”口径；报表要求使用“退款金额（退款时间）”，对应 rfndsuc_amt。
    const q = new URLSearchParams({ begin_date: begin, end_date: end, date_type: '2', activity_id: '', index_selected: 'income_amt,rfndsuc_amt,refund_order_cnt', operate_type: '0' });
    const response = await fetch('/compass_api/shop/common/homepage/core_index_v3?' + q.toString(), { credentials: 'include' });
    const json = await response.json(); const data = json?.data?.module_data?.homepage_core_index?.compass_general_multi_index_card_value?.data?.[0] || {};
    const value = key => data[key]?.index_value?.value?.value ?? null;
    return { salesAmount: value('income_amt') == null ? null : value('income_amt') / 100, refundAmount: value('rfndsuc_amt') == null ? null : value('rfndsuc_amt') / 100, refundOrders: value('refund_order_cnt') };
  }, date);
  await session.context.close().catch(() => {}); browsers.delete(id);
  const record = { id: crypto.randomUUID(), shopId: shop.id, shopName: shop.name, platform: shop.platform, date, salesAmount: result.salesAmount, refundAmount: result.refundAmount, refundOrders: result.refundOrders, collectedAt: new Date().toISOString() };
  const history = readHistory().filter(x => !(x.shopId === record.shopId && x.date === record.date)); history.push(record); writeHistory(history);
  return record;
}
async function taobaoDateMetrics(shop, date) {
  const authFile = authStateFile(shop);
  if (!fs.existsSync(authFile)) throw new Error('尚未保存淘宝登录态，请先点击登录并完成淘宝登录');
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const context = await browser.newContext({ storageState: authFile });
  const page = await context.newPage();
  try {
    await page.goto('https://sycm.taobao.com/bda/tradinganaly/overview/overview.htm', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    const salesData = await page.evaluate(async (selectedDate) => {
      const query = new URLSearchParams({ dateRange: `${selectedDate}|${selectedDate}`, dateType: 'day', device: '0', dtUpdateTime: 'true', indexs: 'payAmt' });
      const response = await fetch(`/bda/tradinganaly/overview/get_summary.json?${query}`, { credentials: 'include' });
      return response.json();
    }, date);
    const salesValue = Number(salesData?.data?.payAmt);
    if (!Number.isFinite(salesValue)) throw new Error('淘宝接口未返回昨日支付金额');
    await page.goto('https://sycm.taobao.com/fa/refund/analysis', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(3500);
    const refund = await page.evaluate(async (date) => {
      const u = `/csp/api/refund/close/overview.json?refundDateType=pay&dateType=day&dateRange=${encodeURIComponent(`${date}|${date}`)}`;
      const r = await fetch(u, { credentials: 'include' });
      const j = await r.json();
      const row = (j?.data?.data || []).find(x => x.caseScene?.value === 'ALL') || j?.data?.data?.[0] || {};
      return { amount: row.shopRfdAmt?.value ?? null, orders: row.shopSucRfdOrdCnt?.value ?? null, code: j?.code };
    }, date);
    if (refund.code !== 0 || refund.amount == null) throw new Error('淘宝接口未返回昨日退款金额');
    const record = { id: crypto.randomUUID(), shopId: shop.id, shopName: shop.name, platform: shop.platform, date, salesAmount: salesValue, refundAmount: Number(refund.amount), refundOrders: refund.orders == null ? null : Number(refund.orders), collectedAt: new Date().toISOString(), source: '淘宝生意参谋真实接口' };
    const history = readHistory().filter(x => !(x.shopId === record.shopId && x.date === record.date)); history.push(record); writeHistory(history);
    return record;
  } finally { await context.close().catch(() => {}); await browser.close().catch(() => {}); }
}
async function jdDateMetrics(shop, date) {
  const authFile = authStateFile(shop);
  if (!fs.existsSync(authFile)) throw new Error('尚未保存京东商智登录态，请先点击登录并完成商智登录');
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const context = await browser.newContext({ storageState: authFile });
  const page = await context.newPage();
  try {
    const summaryUrl = 'https://jdsz.jd.com/szweb/view/tradeAnalysis/tradeSummary.html';
    await page.goto(summaryUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(2500);
    const capture = page.waitForRequest(req => req.url().includes('/api/lowcode/tradeSummary/summary/getSummary.ajax'), { timeout: 30000 });
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    const actual = await capture;
    const originalBody = JSON.parse(actual.postData() || '{}');
    const previous = new Date(`${date}T00:00:00`); previous.setDate(previous.getDate() - 1);
    const previousDate = previous.toISOString().slice(0, 10);
    const body = {
      ...originalBody,
      realtime: false,
      interval: 'DAY',
      dateType: 'day',
      startDate: date,
      endDate: date,
      compareStartDate: previousDate,
      compareEndDate: previousDate,
      compareType: 'hb',
      channel: 'all',
      indicators: Array.from(new Set([...(originalBody.indicators || []),
        'jdr_sch_trade_deal_ord_ord_amt_sz_trade_deal_snapshot',
        'fo_jdr_sch_trade_cancel_refund_ord_amt',
        'fo_jdr_sch_trade_cancel_refund_ord_qtty'
      ]))
    };
    const sourceHeaders = actual.headers();
    const headers = {
      'content-type': sourceHeaders['content-type'] || 'application/json',
      'x-requested-with': 'XMLHttpRequest',
      'user-mnp': sourceHeaders['user-mnp'] || '',
      'user-mup': sourceHeaders['user-mup'] || '',
      uuid: sourceHeaders.uuid || '',
      accept: 'application/json, text/plain, */*',
      referer: sourceHeaders.referer || summaryUrl
    };
    const response = await page.evaluate(async ({ body, headers }) => {
      const r = await fetch('https://szgateway.jd.com/api/lowcode/tradeSummary/summary/getSummary.ajax', {
        method: 'POST', credentials: 'include', headers, body: JSON.stringify(body)
      });
      return { status: r.status, json: await r.json() };
    }, { body, headers });
    if (response.status !== 200) throw new Error(`京东商智接口 HTTP ${response.status}`);
    if (response.json?.header?.code !== 0) throw new Error(`京东商智接口未返回数据：${response.json?.header?.desc || '未知错误'}`);
    const rows = response.json?.body?.data || response.json?.data || [];
    const values = Object.assign({}, ...rows.map(row => row?.data || row?.indicatorData || row || {}));
    const number = (value) => { if (value == null || value === '') return null; const n = Number(String(value).replace(/[¥￥,]/g, '')); return Number.isFinite(n) ? n : null; };
    const salesRaw = number(values.jdr_sch_trade_deal_ord_ord_amt_sz_trade_deal_snapshot);
    const refundRaw = number(values.fo_jdr_sch_trade_cancel_refund_ord_amt);
    const refundOrders = number(values.fo_jdr_sch_trade_cancel_refund_ord_qtty);
    const result = { salesAmount: salesRaw, refundAmount: refundRaw, refundOrders };
    if (result.salesAmount == null && result.refundAmount == null) throw new Error('京东接口未返回销售额或退款金额，请确认当前店铺已登录商智');
    const record = { id: crypto.randomUUID(), shopId: shop.id, shopName: shop.name, platform: shop.platform, date, salesAmount: result.salesAmount, refundAmount: result.refundAmount, refundOrders: result.refundOrders, collectedAt: new Date().toISOString(), source: '京东商智销售汇总与售后退款接口' };
    const history = readHistory().filter(x => !(x.shopId === record.shopId && x.date === record.date)); history.push(record); writeHistory(history);
    return record;
  } finally { await context.close().catch(() => {}); await browser.close().catch(() => {}); }
}
async function dewuDateMetrics(shop, date) {
  // 得物的登录态只存在于用户当前维护的普通 Chrome/CDP 会话中。
  // 不复制 profile、不启动后台浏览器，避免出现“明明已登录却被重定向到登录页”。
  const session = await connectDewuChrome(shop);
  try {
    const page = session.page;
    const dataUrl = 'https://stark.dewu.com/main/dataCenter/productList';
    if (!/stark\.dewu\.com/i.test(page.url())) await page.goto(dataUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    const selected = new Date(`${date}T00:00:00`);
    const weekday = ['日', '一', '二', '三', '四', '五', '六'][selected.getDay()];
    const aria = `Choose ${selected.getFullYear()}年${selected.getMonth() + 1}月${selected.getDate()}日 星期${weekday}`;
    await page.getByText('自定义', { exact: true }).first().evaluate(el => el.click());
    const day = page.locator(`[aria-label="${aria}"]`).first();
    if (!(await day.count())) throw new Error('得物日期选择器未加载目标日期，请先打开商品分析页并确认日期在当前月份');
    const capture = page.waitForResponse(res => res.url().includes('/api/v1/h5/biz/data-operation/datacenter/productAnalysis/getSpuSimplePage') && res.status() === 200, { timeout: 30000 });
    await day.evaluate(el => el.click());
    const confirm = page.getByText(/确\s*定/, { exact: false }).last();
    await confirm.evaluate(el => el.click());
    const response = await capture;
    const payload = await response.json();
    if (payload?.code !== 200) throw new Error(`得物商家后台接口未返回数据（HTTP ${response.status()}）`);
    const rows = payload?.data?.contents || [];
    const sum = key => rows.reduce((n, row) => n + (Number(row?.[key]) || 0), 0);
    const result = { salesAmount: sum('payAmount') / 100, refundAmount: sum('refundAmountForRefundTime') / 100, refundOrders: sum('refundOrderCntForRefundTime') };
    if (!rows.length) throw new Error('得物商家后台未返回商品数据，请确认当前会话已登录商家后台');
    const record = { id: crypto.randomUUID(), shopId: shop.id, shopName: shop.name, platform: shop.platform, date, salesAmount: result.salesAmount, refundAmount: result.refundAmount, refundOrders: result.refundOrders, collectedAt: new Date().toISOString(), source: '得物商家后台商品分析真实接口（退款时间口径）' };
    const history = readHistory().filter(x => !(x.shopId === record.shopId && x.date === record.date)); history.push(record); writeHistory(history);
    return record;
  } finally { releaseCdp(session); }
}
async function getPage(id, visible = true) {
  const shop = getShop(id); if (!shop) throw new Error('店铺不存在');
  const old = browsers.get(id);
  if (old) {
    const alive = old.context && old.context.pages && old.context.pages().some(p => !p.isClosed());
    if (alive) return old;
    browsers.delete(id);
    await old.context.close().catch(() => {});
  }
  const sourceProfile = path.join(paths().profiles, shop.id);
  let profile = sourceProfile;
  let runtimeProfile = null;
  if (!visible) {
    runtimeProfile = path.join(app.getPath('temp'), 'shop-login-runtime', shop.id);
    safeRemoveDir(runtimeProfile);
    fs.mkdirSync(path.dirname(runtimeProfile), { recursive: true });
    fs.cpSync(sourceProfile, runtimeProfile, { recursive: true, filter: (source) => {
      const name = path.basename(source);
      return !/^Singleton(?:Cookie|Lock|Socket)$/.test(name) && name !== 'Crashpad' && name !== 'DevToolsActivePort';
    } });
    profile = runtimeProfile;
  }
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, { headless: !visible, channel: 'chrome', viewport: { width: 1280, height: 820 } });
  } catch (error) {
    if (!visible && /Target page|context or browser has been closed|user data directory|profile/i.test(String(error.message))) {
      throw new Error('该店铺登录目录无法启动后台浏览器，请重试检查或采集数据');
    }
    throw error;
  }
  const page = context.pages()[0] || await context.newPage();
  const session = { context, page };
  context.on('close', () => { stopLoginWatch(id); if (browsers.get(id) === session) browsers.delete(id); safeRemoveDir(runtimeProfile); });
  page.on('close', () => { if (browsers.get(id) === session && context.pages().length === 0) browsers.delete(id); });
  browsers.set(id, session);
  session.runtimeProfile = runtimeProfile;
  return session;
}
function stopLoginWatch(id) {
  const timer = loginWatchers.get(id);
  if (timer) clearInterval(timer);
  loginWatchers.delete(id);
}
function safeRemoveDir(dir) {
  if (!dir) return;
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch (_) {}
}
function startLoginWatch(id, session) {
  stopLoginWatch(id);
  const timer = setInterval(async () => {
    try {
      if (!session.page || session.page.isClosed()) { stopLoginWatch(id); return; }
      const url = session.page.url();
      const title = await session.page.title().catch(() => '');
      if (url && url !== 'about:blank' && !isLoginPage(url, title)) {
        stopLoginWatch(id);
        const shop = getShop(id);
        if (shop) {
          const updated = patchShop(id, { status: '已登录', lastCheck: new Date().toISOString(), loginAt: new Date().toISOString(), currentUrl: url });
          win?.webContents.send('shop:status-changed', updated.find(x => x.id === id));
        }
      }
    } catch (_) {}
  }, 3000);
  loginWatchers.set(id, timer);
}
async function login(id) {
  const shop = getShop(id); if (!shop) throw new Error('店铺不存在');
  if (shop.platform === 'taobao') {
    stopLoginWatch(id);
    await openNormalChrome(shop);
    const cdp = await waitForCdp(shop, 10000);
    releaseCdp(cdp);
    patchShop(id, { status: '需登录', lastAction: '已打开原项目淘宝 Chrome 登录窗口，请完成验证后点击检查登录', updatedAt: new Date().toISOString() });
    return { ok: true, manualCheck: true, message: '已按原项目方式打开淘宝 Chrome，请完成登录并保持窗口开启，再点击“检查登录”' };
  }
  if (shop.platform === 'taobao' || shop.platform === 'pinduoduo' || shop.platform === 'jd') {
    stopLoginWatch(id);
    await openNormalChrome(shop);
    if (shop.platform === 'taobao') {
      const cdp = await waitForCdp(shop, 10000);
      releaseCdp(cdp);
    }
    patchShop(id, { status: '需登录', lastAction: '已打开店铺独立 Chrome 登录窗口，请完成验证后点击检查登录', updatedAt: new Date().toISOString() });
    return { ok: true, manualCheck: true, message: `已用店铺独立 Chrome 打开${names[shop.platform] || shop.platform}，完成登录后请保持窗口开启，再点击“检查登录”` };
  }
  if (shop.platform === 'dewu') {
    stopLoginWatch(id);
    await openNormalChrome(shop);
    const cdp = await waitForDewuCdp(shop, 10000);
    releaseCdp(cdp);
    patchShop(id, { status: '需登录', lastAction: '已打开得物独立 Chrome 登录窗口，请完成登录后点击检查登录', updatedAt: new Date().toISOString() });
    return { ok: true, manualCheck: true, message: '已用得物店铺独立 Chrome 打开登录窗口，完成登录后请保持窗口开启，再点击“检查登录”' };
  }
  const session = await getPage(id, true); const { page } = session;
  await page.goto(shopUrl(shop), { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  patchShop(id, { status: '需登录', lastAction: '已打开登录窗口', updatedAt: new Date().toISOString() });
  startLoginWatch(id, session);
  return { ok: true, message: `已打开${names[shop.platform] || shop.platform}登录窗口，完成登录后客户端会自动同步状态` };
}
async function check(id) {
  stopLoginWatch(id);
  const shop = getShop(id); let session;
  if (shop.platform === 'jd') {
    try {
      const cdp = await connectNormalChrome(shop, { launchIfMissing: false });
      await cdp.page.waitForTimeout(1200);
      const currentUrl = cdp.page.url();
      const title = await cdp.page.title().catch(() => '');
      const text = await cdp.page.locator('body').innerText().catch(() => '');
      const logged = !/passport\.jd\.com|login|登录/i.test(`${currentUrl} ${title} ${text}`) && /jdsz\.jd\.com/i.test(currentUrl);
      if (!logged) {
        releaseCdp(cdp);
        patchShop(id, { status: '需登录', lastCheck: new Date().toISOString(), currentUrl });
        return { ok: true, status: '需登录', message: '当前京东商智实际已跳转登录页，请重新登录' };
      }
      fs.mkdirSync(path.dirname(authStateFile(shop)), { recursive: true });
      await cdp.context.storageState({ path: authStateFile(shop) });
      releaseCdp(cdp);
      patchShop(id, { status: '已登录', lastCheck: new Date().toISOString(), currentUrl });
      return { ok: true, status: '已登录', message: '已保存京东商智登录态，后续采集将后台执行' };
    } catch (_) {
      patchShop(id, { status: '需登录', lastCheck: new Date().toISOString() });
      return { ok: true, status: '需登录', message: '未连接到有效的京东商智登录会话，请在新客户端中点击“登录”后重新检查' };
    }
  }
  if (shop.platform === 'dewu') {
    try {
      const cdp = await connectDewuChrome(shop);
      const currentUrl = cdp.page.url();
      const logged = /stark\.dewu\.com/i.test(currentUrl) && await detectDewuLoggedIn(cdp.page);
      releaseCdp(cdp);
      const status = logged ? '已登录' : '需登录';
      patchShop(id, { status, lastCheck: new Date().toISOString(), currentUrl });
      return { ok: true, status, message: logged ? '检测到得物商家后台已登录' : '当前得物仍需登录' };
    } catch (_) { return { ok: false, message: '请先点击“登录”并在得物商家后台完成登录，保持窗口开启后再点击“检查登录”' }; }
  }
  if (shop.platform === 'taobao') {
    try { return await checkTaobao(id, shop); }
    catch (_) {
      patchShop(id, { status: '需登录', lastCheck: new Date().toISOString() });
      return { ok: true, status: '需登录', message: `未连接到当前店铺 Chrome（CDP ${cdpPort(shop)}）。请先点击“登录”，使用客户端打开的原有 Chrome 完成登录，保持窗口开启后再检查` };
    }
  }
  try {
    if (shop.platform === 'taobao') {
      await page.goto(shopUrl(shop), { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      await page.waitForTimeout(2500);
      const logged = await detectTaobaoLoggedIn(page, session.context);
      const url = page.url();
      const status = logged ? '已登录' : '需登录';
      patchShop(id, { status, lastCheck: new Date().toISOString(), currentUrl: url });
      if (session.cdp) releaseCdp(session); else await session.context.close().catch(() => {});
      browsers.delete(id);
      return { ok: true, status, message: logged ? '检测到淘宝店铺已登录' : '当前淘宝仍处于登录页，请先完成登录' };
    }
    if (shop.platform === 'taobao' || shop.platform === 'pinduoduo' || shop.platform === 'jd') {
      try {
        session = await connectNormalChrome(shop, { launchIfMissing: false });
      } catch (_) {
        // 普通 Chrome/CDP 只用于人工登录；检查状态时优先保证能用店铺 profile 后台完成。
        session = await getPage(id, false);
      }
    } else session = await getPage(id, false);
  } catch (e) {
    return { ok: false, message: '无法读取该店铺登录状态。请关闭该店铺的普通 Chrome 窗口后，再点击“检查登录”；检查过程不会自动打开网页。' };
  }
  const { page } = session;
  await page.goto(shopUrl(shop), { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  const url = page.url(); const title = await page.title().catch(() => '');
  const logged = !isLoginPage(url, title) && url !== 'about:blank';
  const status = logged ? '已登录' : '需登录';
  patchShop(id, { status, lastCheck: new Date().toISOString(), currentUrl: url });
  if (session.cdp) releaseCdp(session); else await session.context.close().catch(() => {});
  browsers.delete(id);
  return { ok: true, status, message: logged ? '检测到当前店铺已登录' : '当前仍处于登录页，请先完成登录' };
}
function createWindow() {
  win = new BrowserWindow({ width: 1180, height: 760, minWidth: 900, minHeight: 620, title: '店铺经营中心 v1.0.4', webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false } });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.on('did-finish-load', () => win.webContents.executeJavaScript(`(() => {
    const e=document.createElement('div'); e.textContent='v1.0.4 · Electron页面已加载'; e.style='position:fixed;top:4px;right:12px;z-index:99999;color:#9aa6b7;font:11px Arial;pointer-events:none'; document.body.appendChild(e);
    window.addEventListener('unhandledrejection',x=>{e.textContent='v1.0.4 · 页面错误: '+x.reason});
    document.querySelectorAll('.nav[data-page]').forEach(n=>n.addEventListener('click',()=>{const page=n.dataset.page;document.querySelectorAll('.nav').forEach(x=>x.classList.remove('active'));n.classList.add('active');document.querySelector('#shopsPage').classList.toggle('hidden',page!=='shops');document.querySelector('#agentPage')?.classList.toggle('hidden',page!=='agent');document.querySelector('#reportsPage').classList.toggle('hidden',page!=='reports');document.querySelector('#collectionPage')?.classList.toggle('hidden',page!=='collection');document.querySelector('#platformsPage').classList.toggle('hidden',page!=='platforms');document.querySelector('#performancePage')?.classList.toggle('hidden',page!=='performance');document.querySelector('#title').textContent=page==='agent'?'AI运营助手':page==='reports'?'销售/退款报表':page==='collection'?'数据采集':page==='performance'?'业绩分析':page==='platforms'?'平台管理':'店铺账号'}));
  })()`));
  win.webContents.on('did-finish-load', () => win.webContents.executeJavaScript("(() => { document.querySelectorAll('.nav[data-page]').forEach(n=>n.addEventListener('click',()=>{const page=n.dataset.page;document.querySelector('#shopsPage').classList.toggle('hidden',page!=='shops');document.querySelector('#reportsPage').classList.toggle('hidden',page!=='reports');document.querySelector('#collectionPage')?.classList.toggle('hidden',page!=='collection');document.querySelector('#platformsPage').classList.toggle('hidden',page!=='platforms');document.querySelector('#performancePage')?.classList.toggle('hidden',page!=='performance');document.querySelector('#title').textContent=page==='reports'?'销售/退款报表':page==='collection'?'数据采集':page==='performance'?'业绩分析':page==='platforms'?'平台管理':'店铺账号'})); })()"));
}
app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
ipcMain.handle('shops:list', () => readShops());
ipcMain.handle('platforms:list', () => readPlatforms());
ipcMain.handle('platforms:details', () => { const urlsMap = readPlatforms(); const namesMap = readPlatformNames(); return Object.keys(urlsMap).map(key => ({ key, name: namesMap[key] || names[key] || key, url: urlsMap[key] })); });
ipcMain.handle('shops:dataPath', () => paths());
ipcMain.handle('shops:add', (_, data) => {
  const rows = readShops();
  const id = crypto.randomUUID();
  const name = String(data?.name || '').trim();
  const platform = String(data?.platform || '').trim().toLowerCase();
  const platformMap = readPlatforms();
  if (!name) throw new Error('请输入店铺名称');
  if (!platform || !platformMap[platform]) throw new Error('请选择有效的平台');
  const shop = { id, name, platform, loginUrl: platformMap[platform], profileDir: path.join(paths().profiles, id), browserEngine: 'playwright-chrome', status: '未登录', createdAt: new Date().toISOString() };
  rows.push(shop); writeShops(rows); return shop;
});
ipcMain.handle('platforms:add', (_, data) => { const key = data.key.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-'); const displayName = data.name.trim(); if (!key || !displayName || !/^https?:\/\//i.test(data.url.trim())) throw new Error('请填写正确的平台编码、名称和登录链接'); const platforms = readPlatforms(); const platformNames = readPlatformNames(); platforms[key] = data.url.trim(); platformNames[key] = displayName; writePlatforms(platforms); writePlatformNames(platformNames); return { key, name: displayName, url: platforms[key] }; });
ipcMain.handle('shops:login', async (_, id) => { try { return await login(id); } catch (e) { dialog.showErrorBox('打开登录失败', e.message); return { ok: false, message: e.message }; } });
ipcMain.handle('shops:check', async (_, id) => { try { return await check(id); } catch (e) { return { ok: false, message: e.message }; } });
ipcMain.handle('shops:yesterdayMetrics', async (_, id) => { try { return { ok: true, ...(await yesterdayMetrics(id)) }; } catch (e) { return { ok: false, message: e.message }; } });
ipcMain.handle('shops:dateMetrics', async (_, { id, date }) => { try { return { ok: true, ...(await dateMetrics(id, date)) }; } catch (e) { return { ok: false, message: e.message }; } });
ipcMain.handle('reports:list', (_, filter = {}) => readHistory().filter(x => (!filter.platform || x.platform === filter.platform) && (!filter.shopId || x.shopId === filter.shopId) && (!filter.start || x.date >= filter.start) && (!filter.end || x.date <= filter.end)).sort((a,b) => `${b.date}${b.shopName}`.localeCompare(`${a.date}${a.shopName}`)));
ipcMain.handle('reports:delete', (_, ids = []) => { const remove = new Set(ids.map(String)); const before = readHistory(); const after = before.filter(item => !remove.has(String(item.id))); writeHistory(after); return { ok: true, deleted: before.length - after.length }; });
ipcMain.handle('reports:batch', async (_, { date, shopIds = [] }) => { const selected = new Set((shopIds || []).map(String)); const shops = readShops().filter(x => selected.size ? selected.has(String(x.id)) : (x.platform === 'douyin' || x.platform === 'jd' || x.platform === 'taobao' || x.platform === 'dewu')); const result=[]; for (const shop of shops) { try { result.push(await dateMetrics(shop.id, date)); } catch (e) { result.push({ shopId: shop.id, shopName: shop.name, platform: shop.platform, date, error: e.message }); } } return result; });
ipcMain.handle('reports:csv', async (_, rows) => { const file = await dialog.showSaveDialog(win, { defaultPath: '店铺经营报表.csv', filters: [{ name: 'CSV', extensions: ['csv'] }] }); if (file.canceled) return { ok: false }; const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`; const csv = '\ufeff' + ['日期,平台,店铺,销售额,退款金额,退款订单数,采集时间', ...rows.map(x => [x.date,x.platform,x.shopName,x.salesAmount,x.refundAmount,x.refundOrders,x.collectedAt].map(esc).join(','))].join('\r\n'); fs.writeFileSync(file.filePath, csv, 'utf8'); return { ok: true, path: file.filePath }; });
function agentDate(query) { const d = new Date(); if (/前天/.test(query)) d.setDate(d.getDate()-2); else if (/昨天|昨日/.test(query)) d.setDate(d.getDate()-1); const m = String(query).match(/(20\d{2})[-年](\d{1,2})[-月](\d{1,2})日?/); return m ? `${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}` : d.toISOString().slice(0,10); }
ipcMain.handle('agent:ask', async (_, query = '') => {
  const text = String(query).trim(); if (!text) return { ok: false, message: '请输入运营问题。' };
  const date = agentDate(text); const source = readHistory().filter(x => x.date === date); const byShop = {};
  source.forEach(x => { const key = `${x.platform}::${x.shopName}`; const row = byShop[key] ||= { platform:x.platform, shopName:x.shopName, sales:0, refund:0, orders:0 }; row.sales += Number(x.salesAmount||0); row.refund += Number(x.refundAmount||0); row.orders += Number(x.refundOrders||0); });
  const rows = Object.values(byShop).sort((a,b)=>b.sales-a.sales); const sales = rows.reduce((n,x)=>n+x.sales,0); const refund = rows.reduce((n,x)=>n+x.refund,0); const top = rows[0];
  const answer = rows.length ? `已查询 ${date}：销售额 ¥${sales.toFixed(2)}，退款金额 ¥${refund.toFixed(2)}，净销售额 ¥${(sales-refund).toFixed(2)}，共 ${rows.length} 个店铺。${top ? `销售额最高的是 ${top.shopName}，¥${top.sales.toFixed(2)}。` : ''}` : `本地没有 ${date} 的历史采集数据，请先获取该日期数据。`;
  return { ok:true, intent:'sales_summary', date, rows, totals:{sales, refund, net:sales-refund}, answer, source:rows.length?'metrics-history.json':'none', nextAction:rows.length?'none':'collect' };
});
ipcMain.handle('shops:remove', async (_, id) => { const shop = getShop(id); if (!shop) return { ok: false }; const open = browsers.get(id); if (open) await open.context.close().catch(() => {}); browsers.delete(id); writeShops(readShops().filter(x => x.id !== id)); return { ok: true }; });

function startAgentBridge() {
  agentServer = http.createServer(async (req, res) => {
    const send = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify(body)); };
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (req.method === 'GET' && url.pathname === '/agent/shops') return send(200, { shops: readShops().map(x => ({ id:x.id, name:x.name, platform:x.platform, status:x.status })) });
      if (req.method === 'POST' && url.pathname === '/agent/collect-sales') {
        let raw = ''; for await (const chunk of req) raw += chunk; const data = JSON.parse(raw || '{}');
        const shop = getShop(data.shop_id); if (!shop) return send(404, { ok:false, error:'shop_not_found' });
        const result = await dateMetrics(shop.id, data.date); return send(200, { ok:true, ...result });
      }
      if (req.method === 'POST' && url.pathname === '/agent/check-login') {
        let raw = ''; for await (const chunk of req) raw += chunk; const data = JSON.parse(raw || '{}');
        const result = await check(data.shop_id); return send(200, result);
      }
      return send(404, { ok:false, error:'not_found' });
    } catch (e) { send(500, { ok:false, error:e.message }); }
  });
  agentServer.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      // 已有实例正在提供同一桥接服务，当前实例不再抛出未捕获异常。
      agentServer = null;
      return;
    }
    console.error('Agent bridge error:', error);
  });
  agentServer.listen(18769, '127.0.0.1');
}
app.whenReady().then(startAgentBridge);
app.on('will-quit', () => agentServer?.close());
