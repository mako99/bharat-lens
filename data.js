/* ==========================================================================
   BharatLens — data layer: utils, universe, price series, indicators
   ========================================================================== */
'use strict';

/* ------------------------------------------------------------- utilities - */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gaussFrom(rnd) {
  let u = 0, v = 0;
  while (u === 0) u = rnd();
  while (v === 0) v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const nf = (v, d = 2) => (v == null || !isFinite(v)) ? '—' :
  v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtPrice = (v) => nf(v, Math.abs(v) >= 100 ? 2 : Math.abs(v) >= 1 ? 2 : 3);
const fmtPct = (v, d = 2) => {
  let r = Math.round(v * Math.pow(10, d)) / Math.pow(10, d);
  if (r === 0) r = 0;
  return (r > 0 ? '+' : '') + nf(r, d) + '%';
};
/* Accepts epoch ms/s or an ISO string; renders exchange-local wall clock. */
const fmtTime = (v) => {
  if (v == null || v === '') return '';
  let t = Number(v);
  if (!isFinite(t)) t = Date.parse(v);
  if (!isFinite(t)) return String(v);
  if (t > 1e9 && t < 1e11) t *= 1000;
  const d = new Date(t);
  if (isNaN(d.getTime())) return String(v);
  return d.toLocaleTimeString('en-IN', { hour12: false, timeZone: 'Asia/Kolkata' }) + ' IST';
};
/* Indian short scale: 41,589,882 shares -> 4.16 Cr · 250,000 -> 2.5 L */
function fmtBig(v) {
  const a = Math.abs(v);
  if (!isFinite(v)) return '—';
  if (a >= 1e7) { const c = a / 1e7; return (v < 0 ? '-' : '') + nf(c, c >= 100 ? 0 : c >= 10 ? 1 : 2) + 'Cr'; }
  if (a >= 1e5) return (v < 0 ? '-' : '') + nf(a / 1e5, 1) + 'L';
  if (a >= 1e3) return (v < 0 ? '-' : '') + nf(a / 1e3, 1) + 'K';
  return nf(v, 0);
}
/* Absolute rupees: 16,069,89,00,00,000 -> ₹16.07 L Cr */
const fmtCap = (v) => v >= 1e12 ? '₹' + nf(v / 1e12, 2) + ' L Cr'
  : v >= 1e9 ? '₹' + nf(v / 1e7, 0) + ' Cr'
    : '₹' + nf(v / 1e5, 1) + ' L';
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const signCls = (v) => Math.abs(v) < 0.05 ? 'flat' : v > 0 ? 'up' : 'down';

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
function pal() {
  return {
    up: cssVar('--up') || '#2ee6a8',
    down: cssVar('--down') || '#ff5c7c',
    acc: cssVar('--acc') || '#5b8cff',
    acc2: cssVar('--acc-2') || '#a879ff',
    warn: cssVar('--warn') || '#ffb547',
    txt: cssVar('--txt') || '#e8edf7',
    txt2: cssVar('--txt-2') || '#93a1bd',
    txt3: cssVar('--txt-3') || '#64728d',
    grid: cssVar('--grid') || 'rgba(255,255,255,.055)',
    stroke: cssVar('--stroke') || 'rgba(255,255,255,.08)',
    panel: cssVar('--panel-solid') || '#0e1524'
  };
}
function niceTicks(min, max, n) {
  if (!isFinite(min) || !isFinite(max) || min === max) return [min];
  const step0 = (max - min) / Math.max(1, n);
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const norm = step0 / mag;
  let step = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  step *= mag;
  const out = [];
  for (let t = Math.ceil(min / step) * step; t <= max + step * 1e-6; t += step) out.push(+t.toPrecision(12));
  return out;
}
function hexA(hex, a) {
  const h = String(hex).replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const n = parseInt(full, 16);
  if (isNaN(n)) return 'rgba(128,128,128,' + a + ')';
  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
}
function ctx2d(canvas) {
  if (!canvas) return null;
  const r = canvas.getBoundingClientRect();
  if (r.width < 3 || r.height < 3) return null;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round(r.width), h = Math.round(r.height);
  const W = Math.round(w * dpr), H = Math.round(h * dpr);
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.textBaseline = 'middle';
  return { ctx: ctx, w: w, h: h };
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}
function toast(msg) {
  const t = $('#toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2400);
}

/* -------------------------------------------------------------- universe - */
/* price ₹ · mcap ₹ absolute · rev/ni/cash ₹ billions · shares millions */
const UNIVERSE = {
  RELIANCE: { name: 'Reliance Industries Ltd.', sector: 'Energy', industry: 'Oil, Gas & Consumable Fuels', exch: 'NSE', price: 1186.40, mcap: 1.606e13, rev: 3094, ni: 790, eps: 58.4, beta: 1.05, div: 0.51, emp: 389414, born: 1966, hq: 'Mumbai, MH', pe: 20.3, ps: 5.2, roe: 8.9, gross: 38.2, op: 16.5, net: 25.5, growth: 7.8, debt: 0.42, cash: 200, shares: 13530, desc: 'Conglomerate spanning oil-to-chemicals, Jio telecom and broadband, and Retail — India’s largest company by market capitalisation.' },
  TCS: { name: 'Tata Consultancy Services Ltd.', sector: 'Technology', industry: 'IT Services & Consulting', exch: 'NSE', price: 3165.20, mcap: 1.146e13, rev: 2410, ni: 488, eps: 134.8, beta: 0.72, div: 1.72, emp: 601557, born: 1968, hq: 'Mumbai, MH', pe: 23.5, ps: 4.8, roe: 51.2, gross: 40.1, op: 24.8, net: 20.2, growth: 8.4, debt: 0.09, cash: 50, shares: 3620, desc: 'Largest Indian IT services company, delivering consulting, engineering and outsourcing across banking, retail and telecom worldwide.' },
  HDFCBANK: { name: 'HDFC Bank Ltd.', sector: 'Financials', industry: 'Private Sector Bank', exch: 'NSE', price: 975.60, mcap: 7.45e12, rev: 3500, ni: 640, eps: 84.2, beta: 0.94, div: 1.15, emp: 385000, born: 1994, hq: 'Mumbai, MH', pe: 11.6, ps: 2.1, roe: 14.5, gross: 62, op: 45, net: 18.3, growth: 11.5, debt: 6.5, cash: 5, shares: 7600, desc: 'India’s largest private sector bank by assets, known for retail deposit franchise, disciplined underwriting and nationwide branch reach.' },
  ICICIBANK: { name: 'ICICI Bank Ltd.', sector: 'Financials', industry: 'Private Sector Bank', exch: 'NSE', price: 1285.75, mcap: 9.05e12, rev: 3200, ni: 470, eps: 66.8, beta: 1.02, div: 0.78, emp: 90000, born: 1994, hq: 'Mumbai, MH', pe: 19.3, ps: 2.8, roe: 17.5, gross: 60, op: 48, net: 14.7, growth: 14.5, debt: 6.0, cash: 4, shares: 7040, desc: 'Second-largest private sector bank with strong retail and corporate books, digital-first ICICIstack platform and growing wealth business.' },
  INFY: { name: 'Infosys Ltd.', sector: 'Technology', industry: 'IT Services & Consulting', exch: 'NSE', price: 1525.30, mcap: 6.30e12, rev: 1650, ni: 260, eps: 62.8, beta: 0.82, div: 2.40, emp: 317243, born: 1981, hq: 'Bengaluru, KA', pe: 24.2, ps: 3.8, roe: 31.0, gross: 36.4, op: 25.9, net: 15.8, growth: 5.5, debt: 0.09, cash: 35, shares: 4140, desc: 'Global consulting and IT services pioneer, now pushing Topaz AI services and Cobalt cloud across enterprise clients worldwide.' },
  BHARTIARTL: { name: 'Bharti Airtel Ltd.', sector: 'Communication', industry: 'Telecom Services', exch: 'NSE', price: 1615.45, mcap: 9.50e12, rev: 1850, ni: 170, eps: 28.8, beta: 0.88, div: 0.85, emp: 20000, born: 1995, hq: 'New Delhi, DL', pe: 55.9, ps: 5.1, roe: 22.0, gross: 55, op: 25, net: 9.2, growth: 12.5, debt: 2.1, cash: 30, shares: 5900, desc: 'Telecommunications leader across India and Africa with 5G rollout, Airtel Xstream digital services and an enterprise connectivity arm.' },
  ITC: { name: 'ITC Ltd.', sector: 'Consumer Defensive', industry: 'FMCG — Diversified', exch: 'NSE', price: 415.85, mcap: 5.20e12, rev: 730, ni: 195, eps: 15.6, beta: 0.62, div: 3.40, emp: 36500, born: 1910, hq: 'Kolkata, WB', pe: 26.7, ps: 7.1, roe: 28.0, gross: 48, op: 30, net: 26.7, growth: 6.0, debt: 0.01, cash: 20, shares: 12500, desc: 'Diversified group with cigarettes, hotels, FMCG, paperboards and agri businesses — among India’s most consistent dividend payers.' },
  SBIN: { name: 'State Bank of India', sector: 'Financials', industry: 'Public Sector Bank', exch: 'NSE', price: 815.20, mcap: 7.25e12, rev: 4800, ni: 670, eps: 75.1, beta: 1.15, div: 1.70, emp: 312054, born: 1955, hq: 'Mumbai, MH', pe: 10.8, ps: 1.5, roe: 18.0, gross: 58, op: 40, net: 14.0, growth: 13.0, debt: 11.5, cash: 5, shares: 8925, desc: 'The country’s largest public sector bank, with the widest branch network, deep rural franchise and a growing digital YONO base.' },
  LT: { name: 'Larsen & Toubro Ltd.', sector: 'Industrials', industry: 'Engineering & Construction', exch: 'NSE', price: 3480.10, mcap: 4.75e12, rev: 2450, ni: 145, eps: 105.8, beta: 1.12, div: 0.94, emp: 55000, born: 1938, hq: 'Mumbai, MH', pe: 32.8, ps: 1.9, roe: 15.5, gross: 22, op: 9.5, net: 5.9, growth: 14.0, debt: 1.4, cash: 10, shares: 1370, desc: 'Engineering and construction giant with large order books in infrastructure, hydrocarbon, power and defence, plus technology services.' },
  KOTAKBANK: { name: 'Kotak Mahindra Bank Ltd.', sector: 'Financials', industry: 'Private Sector Bank', exch: 'NSE', price: 565.35, mcap: 2.15e12, rev: 1650, ni: 225, eps: 59.2, beta: 0.96, div: 0.12, emp: 42000, born: 1985, hq: 'Mumbai, MH', pe: 9.6, ps: 1.3, roe: 13.5, gross: 55, op: 40, net: 13.6, growth: 9.0, debt: 5.5, cash: 5, shares: 3800, desc: 'Diversified financial group — bank, securities, life insurance and asset management — with a conservative credit culture.' },
  HINDUNILVR: { name: 'Hindustan Unilever Ltd.', sector: 'Consumer Defensive', industry: 'FMCG — Personal Care', exch: 'NSE', price: 2440.65, mcap: 5.70e12, rev: 620, ni: 105, eps: 44.7, beta: 0.51, div: 1.90, emp: 18000, born: 1933, hq: 'Mumbai, MH', pe: 54.3, ps: 9.2, roe: 21.0, gross: 52, op: 23, net: 16.9, growth: 3.5, debt: 0.03, cash: 5, shares: 2350, desc: 'Household names across home care, beauty, foods and refreshments sold through millions of retail outlets across India.' },
  MARUTI: { name: 'Maruti Suzuki India Ltd.', sector: 'Automobile', industry: 'Passenger Cars', exch: 'NSE', price: 11250.00, mcap: 3.54e12, rev: 1450, ni: 133, eps: 423.6, beta: 0.92, div: 1.10, emp: 45000, born: 1981, hq: 'New Delhi, DL', pe: 26.6, ps: 2.4, roe: 16.5, gross: 28, op: 11, net: 9.2, growth: 10.0, debt: 0.04, cash: 15, shares: 314, desc: 'India’s largest carmaker, dominating the compact segment while scaling SUV output and expanding exports from Gujarat plants.' },
  AXISBANK: { name: 'Axis Bank Ltd.', sector: 'Financials', industry: 'Private Sector Bank', exch: 'NSE', price: 1195.80, mcap: 3.70e12, rev: 2800, ni: 335, eps: 108.4, beta: 1.08, div: 0.62, emp: 100000, born: 1993, hq: 'Mumbai, MH', pe: 11.0, ps: 1.3, roe: 16.5, gross: 58, op: 42, net: 12.0, growth: 14.0, debt: 6.2, cash: 4, shares: 3090, desc: 'Third-largest private sector bank with a strong urban franchise, Citi India retail acquisition and scaled-up digital payments.' },
  BAJFINANCE: { name: 'Bajaj Finance Ltd.', sector: 'Financials', industry: 'Non-Banking Finance', exch: 'NSE', price: 8850.00, mcap: 5.50e12, rev: 1800, ni: 195, eps: 312.0, beta: 1.18, div: 0.48, emp: 40000, born: 1987, hq: 'Pune, MH', pe: 28.2, ps: 3.1, roe: 14.5, gross: 62, op: 55, net: 10.8, growth: 17.0, debt: 5.8, cash: 15, shares: 625, desc: 'Large, fast-growing NBFC serving consumer loans, SME credit, rural finance and new-age commerce through digital platforms.' },
  TITAN: { name: 'Titan Company Ltd.', sector: 'Consumer Cyclical', industry: 'Jewellery & Watches', exch: 'NSE', price: 3480.55, mcap: 3.10e12, rev: 550, ni: 34, eps: 38.2, beta: 1.15, div: 0.35, emp: 13000, born: 1984, hq: 'Bengaluru, KA', pe: 88.4, ps: 5.6, roe: 32.0, gross: 46, op: 10, net: 6.2, growth: 18.0, debt: 0.9, cash: 5, shares: 890, desc: 'Titan Company operates Tanishq jewellery, watches (Titan, Fastrack), eyewear and a fast-growing precision-engineering arm.' },
  ASIANPAINT: { name: 'Asian Paints Ltd.', sector: 'Consumer Cyclical', industry: 'Paints & Decor', exch: 'NSE', price: 2450.30, mcap: 2.35e12, rev: 355, ni: 43, eps: 45.0, beta: 0.90, div: 1.40, emp: 8000, born: 1942, hq: 'Mumbai, MH', pe: 54.6, ps: 6.6, roe: 21.0, gross: 42, op: 16, net: 12.1, growth: 3.0, debt: 0.11, cash: 8, shares: 955, desc: 'Decorative paints leader with deep distribution, strong tinting capacity and services businesses in home improvement.' },
  SUNPHARMA: { name: 'Sun Pharmaceutical Industries Ltd.', sector: 'Healthcare', industry: 'Pharmaceuticals', exch: 'NSE', price: 1680.45, mcap: 4.00e12, rev: 510, ni: 115, eps: 47.9, beta: 0.68, div: 0.92, emp: 41000, born: 1983, hq: 'Mumbai, MH', pe: 34.8, ps: 7.8, roe: 17.0, gross: 55, op: 26, net: 22.5, growth: 8.5, debt: 0.02, cash: 10, shares: 2400, desc: 'India’s largest pharmaceutical company with a global specialty portfolio, dermatology franchises and R&D across sites worldwide.' },
  TATASTEEL: { name: 'Tata Steel Ltd.', sector: 'Materials', industry: 'Steel & Ferrous Metals', exch: 'NSE', price: 172.35, mcap: 2.15e12, rev: 2500, ni: 65, eps: 5.2, beta: 1.55, div: 2.00, emp: 105000, born: 1907, hq: 'Mumbai, MH', pe: 33.1, ps: 0.86, roe: 7.5, gross: 18, op: 7, net: 2.6, growth: 4.0, debt: 2.1, cash: 8, shares: 12500, desc: 'Integrated steelmaker with Jamshedpur and Kalinganagar campuses plus a European arm, moving toward lower-carbon electric-arc capacity.' },
  WIPRO: { name: 'Wipro Ltd.', sector: 'Technology', industry: 'IT Services & Consulting', exch: 'NSE', price: 245.10, mcap: 2.56e12, rev: 890, ni: 115, eps: 11.1, beta: 0.75, div: 1.20, emp: 230000, born: 1945, hq: 'Bengaluru, KA', pe: 22.3, ps: 2.9, roe: 16.5, gross: 35, op: 21, net: 12.9, growth: 1.5, debt: 0.07, cash: 15, shares: 10400, desc: 'Global IT and consulting group spanning cloud, cybersecurity and application services with a strong engineering heritage.' },
  POWERGRID: { name: 'Power Grid Corporation of India Ltd.', sector: 'Utilities', industry: 'Electric Transmission', exch: 'NSE', price: 285.40, mcap: 2.65e12, rev: 450, ni: 155, eps: 16.7, beta: 0.85, div: 3.60, emp: 100000, born: 1989, hq: 'Gurugram, HR', pe: 17.1, ps: 5.9, roe: 17.5, gross: 55, op: 40, net: 34.4, growth: 4.0, debt: 1.5, cash: 12, shares: 9300, desc: 'Central transmission utility owning the interstate grid backbone, with regulated returns and a growing green-corridor portfolio.' },
  HCLTECH: { name: 'HCL Technologies Ltd.', sector: 'Technology', industry: 'IT Services & Consulting', exch: 'NSE', price: 1690.25, mcap: 4.55e12, rev: 1200, ni: 175, eps: 64.3, beta: 0.78, div: 3.60, emp: 220000, born: 1976, hq: 'Noida, UP', pe: 26.0, ps: 3.8, roe: 24.0, gross: 38, op: 22, net: 14.6, growth: 7.5, debt: 0.04, cash: 20, shares: 2720, desc: 'IT services company with strength in infrastructure management, digital engineering and a majority-owned products business.' },
  TATAMOTORS: { name: 'Tata Motors Ltd.', sector: 'Automobile', industry: 'Passenger & Commercial Vehicles', exch: 'NSE', price: 705.60, mcap: 2.60e12, rev: 4400, ni: 300, eps: 81.3, beta: 1.45, div: 0.90, emp: 91000, born: 1945, hq: 'Mumbai, MH', pe: 8.7, ps: 0.6, roe: 24.0, gross: 34, op: 9, net: 6.8, growth: 12.0, debt: 1.1, cash: 15, shares: 3690, desc: 'Auto group spanning Tata, Jaguar Land Rover and commercial vehicles, with a leading position in Indian electric vehicles.' },
  NIFTY: { name: 'NIFTY 50 Index', sector: 'Index', industry: 'Index — Broad Market', exch: 'NSE', price: 22620.45, mcap: 0, rev: 0, ni: 0, eps: 0, beta: 1.00, div: 1.18, emp: 0, born: 1996, hq: 'Mumbai, MH', pe: 22.3, ps: 2.4, roe: 0, gross: 0, op: 0, net: 0, growth: 11.0, debt: 0, cash: 0, shares: 0, desc: 'Benchmark index of the National Stock Exchange tracking 50 large, liquid counters — the standard reference for Indian equities.' },
  SENSEX: { name: 'BSE SENSEX', sector: 'Index', industry: 'Index — Broad Market', exch: 'BSE', price: 74218.60, mcap: 0, rev: 0, ni: 0, eps: 0, beta: 1.00, div: 1.20, emp: 0, born: 1986, hq: 'Mumbai, MH', pe: 21.8, ps: 2.3, roe: 0, gross: 0, op: 0, net: 0, growth: 10.5, debt: 0, cash: 0, shares: 0, desc: 'The Bombay Stock Exchange’s 30-stock barometer, India’s oldest equity index and a gauge of blue-chip sentiment.' },
  BANKNIFTY: { name: 'NIFTY BANK Index', sector: 'Index', industry: 'Index — Sectoral', exch: 'NSE', price: 51060.25, mcap: 0, rev: 0, ni: 0, eps: 0, beta: 1.10, div: 0.95, emp: 0, born: 2000, hq: 'Mumbai, MH', pe: 15.2, ps: 2.6, roe: 0, gross: 0, op: 0, net: 0, growth: 12.0, debt: 0, cash: 0, shares: 0, desc: 'Sectoral index of the twelve most liquid banking counters on the NSE — the most-watched rate-sensitive benchmark.' }
};
const SYMBOLS = Object.keys(UNIVERSE);
const DEFAULT_WATCH = ['RELIANCE', 'TCS', 'HDFCBANK', 'ICICIBANK', 'INFY', 'BHARTIARTL', 'SBIN', 'ITC', 'LT', 'MARUTI'];

/* ---------------------------------------------------------- live overlay -- */
/* Populated by api.js-backed loaders in app.js. Any slot left empty makes the
   matching accessor fall through to the synthetic generator above, so the whole
   UI still works with no proxy running. */
const LIVE = {
  meta: {},    // sym  -> UNIVERSE-shaped fields from live quotes/company
  daily: {},   // sym  -> full daily history from /api/chart
  intra: {},   // sym:tf -> 1D/5D intraday bars
  spark: {},   // sym:range -> short history for market tables/scrub sparklines
  fund: {},    // sym  -> fundamentals in ₹ millions... ₹ crore (see fundNote)
  finRaw: {},  // sym  -> raw /api/financials payloads { annual, quarterly }
  quotes: {},  // sym  -> last quote from /api/quotes
  company: {}, // sym  -> full /api/company payload
  shareholding: {}, // sym -> /api/shareholding (quarterly pattern)
  news: {},    // sym  -> mapped live headlines
  market: null,
  marketNews: null,
  marketTs: 0,
  src: {},     // sym  -> source of the *history* payload ('yahoo' | 'nse' | 'screener' | …)
  ts: {},
  csrc: {},    // sym  -> source of the /api/company (profile + ratios) payload
  qsrc: {},    // sym  -> source + fetch time of the last /api/quotes payload (the header price)
  qts: {},
  loading: {}
};

function liveMeta(sym) {
  const u = UNIVERSE[sym];
  const m = LIVE.meta[sym];
  if (!m) return u || null;
  if (u) return Object.assign({}, u, m);
  return Object.assign({
    name: sym, sector: '—', industry: '—', exch: '—', price: 0, mcap: 0,
    rev: 0, ni: 0, eps: 0, beta: 1, div: 0, emp: 0, born: null, hq: '—',
    pe: null, ps: null, roe: 0, gross: 0, op: 0, net: 0, growth: 0,
    debt: 0, cash: 0, shares: 0, desc: ''
  }, m);
}

/* Only write fields that actually carry a value: an undefined must not wipe a
   synthetic default we still want as a fallback. */
function livePut(sym, key, val) {
  if (val == null || val === '' || (typeof val === 'number' && !isFinite(val))) return;
  const m = LIVE.meta[sym] || (LIVE.meta[sym] = {});
  m[key] = val;
}

/* ---------------------------------------------------------- price series - */
const _dailyCache = {};
const _intraCache = {};

function tradingDates(n, end) {
  const out = [];
  const d = new Date(end || Date.now());
  d.setHours(0, 0, 0, 0);
  while (out.length < n) {
    const wd = d.getDay();
    if (wd !== 0 && wd !== 6) out.push(new Date(d));
    d.setDate(d.getDate() - 1);
  }
  return out.reverse();
}

function genDaily(sym) {
  const live = LIVE.daily[sym];
  if (live && live.length > 120) return live;
  if (_dailyCache[sym]) return _dailyCache[sym];
  const lm = liveMeta(sym);
  const meta = (lm && lm.price > 0) ? lm : UNIVERSE.NIFTY;
  const N = 1560;
  const rnd = mulberry32(hashStr(sym) ^ 0x5eed);
  const dates = tradingDates(N);
  const bars = [];
  let drift = 0.0004 + (rnd() - 0.42) * 0.0011;
  let vol = 0.011 + rnd() * 0.013;
  let prevClose = 100;

  for (let i = 0; i < N; i++) {
    if (i % (90 + Math.floor(rnd() * 90)) === 0) {
      drift = (rnd() - 0.40) * 0.0018;
      vol = 0.009 + rnd() * 0.020;
    }
    let r = gaussFrom(rnd) * vol + drift;
    if (rnd() < 0.014) r += (rnd() < 0.45 ? -1 : 1) * vol * (2.5 + rnd() * 4);
    const o = prevClose * (1 + (rnd() - 0.5) * vol * 0.55);
    const c = Math.max(1, prevClose * (1 + r));
    const hi = Math.max(o, c) * (1 + rnd() * vol * 0.75);
    const lo = Math.min(o, c) * (1 - rnd() * vol * 0.75);
    const v = (0.55 + rnd() * 1.0) * (1 + Math.abs(r) * 22) * 1e6 * (meta.mcap > 1e12 ? 3.2 : 1);
    bars.push({ t: dates[i], o: o, h: hi, l: lo, c: c, v: v });
    prevClose = c;
  }
  const scale = meta.price / bars[bars.length - 1].c;
  for (const b of bars) { b.o *= scale; b.h *= scale; b.l *= scale; b.c *= scale; }
  _dailyCache[sym] = bars;
  return bars;
}

function genIntraday(sym, sessions, perSession) {
  const key = sym + ':' + sessions + 'x' + perSession;
  if (_intraCache[key]) return _intraCache[key];
  const daily = genDaily(sym);
  const tail = daily.slice(-sessions);
  const rnd = mulberry32(hashStr(key) ^ 0xa11);
  const bars = [];
  for (let s = 0; s < tail.length; s++) {
    const d = tail[s];
    const n = perSession;
    const vol = (d.h - d.l) / Math.max(1e-6, d.c) / Math.sqrt(n) * 0.95;
    const walk = [];
    let cum = 0;
    for (let i = 0; i < n; i++) { cum += gaussFrom(rnd) * vol; walk.push(cum); }
    const endAdj = walk[n - 1];
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1 || 1);
      const bridge = walk[i] - t * endAdj;
      const px = d.o + (d.c - d.o) * t + d.c * bridge * 0.55;
      const o = i === 0 ? d.o : bars[bars.length - 1].c;
      const c = px;
      const hi = Math.max(o, c) * (1 + Math.abs(gaussFrom(rnd)) * vol * 0.4);
      const lo = Math.min(o, c) * (1 - Math.abs(gaussFrom(rnd)) * vol * 0.4);
      const mins = 9 * 60 + 15 + i * Math.round(375 / n);
      const tm = new Date(d.t);
      tm.setHours(Math.floor(mins / 60), mins % 60, 0, 0);
      bars.push({ t: tm, o: o, h: Math.max(hi, o, c), l: Math.min(lo, o, c), c: c, v: (0.5 + rnd() * 1.1) * 4e5 * (1 + (s % 2) * 0.4) });
    }
  }
  _intraCache[key] = bars;
  return bars;
}

function aggregate(bars, per) {
  if (per <= 1) return bars;
  const out = [];
  for (let i = 0; i < bars.length; i += per) {
    const g = bars.slice(i, i + per);
    if (!g.length) break;
    let h = -Infinity, l = Infinity, v = 0;
    for (const x of g) { if (x.h > h) h = x.h; if (x.l < l) l = x.l; v += x.v; }
    out.push({ t: g[0].t, o: g[0].o, c: g[g.length - 1].c, h: h, l: l, v: v });
  }
  return out;
}

function seriesFor(sym, tf) {
  if (tf === '1D' || tf === '5D') {
    const live = LIVE.intra[sym + ':' + tf];
    if (live && live.length > 10) return live;
  }
  const daily = genDaily(sym);
  const W = 320;
  if (tf === '1D') return genIntraday(sym, 8, 78);
  if (tf === '5D') return genIntraday(sym, 12, 26);
  if (tf === '1M') return daily.slice(-(22 + W));
  if (tf === '6M') return daily.slice(-(126 + W));
  if (tf === 'YTD') {
    const y = new Date().getFullYear();
    let idx = -1;
    for (let i = 0; i < daily.length; i++) if (daily[i].t.getFullYear() === y) { idx = i; break; }
    if (idx < 0) return daily.slice(-(252 + W));
    return daily.slice(Math.max(0, idx - W));
  }
  if (tf === '1Y') return daily.slice(-(252 + W));
  if (tf === '5Y') return aggregate(daily, 5);
  if (tf === 'MAX') return aggregate(daily, 21);
  return daily;
}
const TF_DEFAULT = { '1D': 78, '5D': 130, '1M': 22, '6M': 126, 'YTD': 90, '1Y': 252, '5Y': 260, 'MAX': 74 };

/* ------------------------------------------------------------ indicators - */
function sma(src, p) {
  const out = new Array(src.length).fill(null);
  let s = 0;
  for (let i = 0; i < src.length; i++) {
    s += src[i];
    if (i >= p) s -= src[i - p];
    if (i >= p - 1) out[i] = s / p;
  }
  return out;
}
function ema(src, p) {
  const out = new Array(src.length).fill(null);
  const k = 2 / (p + 1);
  let prev = null;
  for (let i = 0; i < src.length; i++) {
    if (i === p - 1) {
      let s = 0;
      for (let j = 0; j < p; j++) s += src[j];
      prev = s / p; out[i] = prev;
    } else if (i >= p) { prev = src[i] * k + prev * (1 - k); out[i] = prev; }
  }
  return out;
}
function stdev(src, p) {
  const out = new Array(src.length).fill(null);
  for (let i = p - 1; i < src.length; i++) {
    let m = 0;
    for (let j = i - p + 1; j <= i; j++) m += src[j];
    m /= p;
    let v = 0;
    for (let j = i - p + 1; j <= i; j++) v += Math.pow(src[j] - m, 2);
    out[i] = Math.sqrt(v / p);
  }
  return out;
}
function bollinger(src, p, k) {
  p = p || 20; k = k || 2;
  const m = sma(src, p), s = stdev(src, p);
  return {
    mid: m,
    up: m.map((v, i) => v == null ? null : v + k * s[i]),
    dn: m.map((v, i) => v == null ? null : v - k * s[i])
  };
}
function rsi(src, p) {
  p = p || 14;
  const out = new Array(src.length).fill(null);
  let g = 0, l = 0;
  for (let i = 1; i < src.length; i++) {
    const d = src[i] - src[i - 1];
    const up = Math.max(0, d), dn = Math.max(0, -d);
    if (i <= p) {
      g += up / p; l += dn / p;
      if (i === p) out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    } else {
      g = (g * (p - 1) + up) / p;
      l = (l * (p - 1) + dn) / p;
      out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    }
  }
  return out;
}
function macd(src, f, s, sig) {
  f = f || 12; s = s || 26; sig = sig || 9;
  const ef = ema(src, f), es = ema(src, s);
  const line = src.map((_, i) => (ef[i] != null && es[i] != null) ? ef[i] - es[i] : null);
  const cleaned = line.map(v => v == null ? 0 : v);
  const sg = ema(cleaned, sig).map((v, i) => line[i] == null ? null : v);
  const hist = line.map((v, i) => (v == null || sg[i] == null) ? null : v - sg[i]);
  return { line: line, signal: sg, hist: hist };
}
function stochastic(bars, p, d) {
  p = p || 14; d = d || 3;
  const k = bars.map((b, i) => {
    if (i < p - 1) return null;
    let hi = -Infinity, lo = Infinity;
    for (let j = i - p + 1; j <= i; j++) { if (bars[j].h > hi) hi = bars[j].h; if (bars[j].l < lo) lo = bars[j].l; }
    return hi === lo ? 50 : ((b.c - lo) / (hi - lo)) * 100;
  });
  const kv = k.map(v => v == null ? 0 : v);
  const dv = ema(kv, d).map((v, i) => k[i] == null ? null : v);
  return { k: k, d: dv };
}
function atr(bars, p) {
  p = p || 14;
  const tr = bars.map((b, i) => i === 0 ? b.h - b.l :
    Math.max(b.h - b.l, Math.abs(b.h - bars[i - 1].c), Math.abs(b.l - bars[i - 1].c)));
  return ema(tr, p);
}
function vwap(bars) {
  const out = [];
  let pv = 0, vv = 0;
  for (const b of bars) {
    const tp = (b.h + b.l + b.c) / 3;
    pv += tp * b.v; vv += b.v;
    out.push(vv ? pv / vv : b.c);
  }
  return out;
}
function cci(bars, p) {
  p = p || 20;
  const tp = bars.map((b) => (b.h + b.l + b.c) / 3);
  const m = sma(tp, p);
  return tp.map((v, i) => {
    if (i < p - 1 || m[i] == null) return null;
    let s = 0;
    for (let j = i - p + 1; j <= i; j++) s += Math.abs(tp[j] - m[i]);
    s /= p;
    return s === 0 ? 0 : (v - m[i]) / (0.015 * s);
  });
}
function williams(bars, p) {
  p = p || 14;
  return bars.map((b, i) => {
    if (i < p - 1) return null;
    let hi = -Infinity, lo = Infinity;
    for (let j = i - p + 1; j <= i; j++) { if (bars[j].h > hi) hi = bars[j].h; if (bars[j].l < lo) lo = bars[j].l; }
    return hi === lo ? -50 : ((b.c - hi) / (hi - lo)) * 100;
  });
}
function returns(bars) {
  const out = [];
  for (let i = 1; i < bars.length; i++) out.push(bars[i].c / bars[i - 1].c - 1);
  return out;
}
function annVol(bars, per) {
  per = per || 252;
  const r = returns(bars);
  if (r.length < 2) return 0;
  const m = r.reduce((a, b) => a + b, 0) / r.length;
  const v = r.reduce((a, b) => a + Math.pow(b - m, 2), 0) / (r.length - 1);
  return Math.sqrt(v) * Math.sqrt(per) * 100;
}
function maxDD(bars) {
  let peak = -Infinity, dd = 0;
  for (const b of bars) {
    if (b.c > peak) peak = b.c;
    const d = b.c / peak - 1;
    if (d < dd) dd = d;
  }
  return dd * 100;
}
function sharpe(bars, rf) {
  rf = rf == null ? 6.7 : rf;
  const r = returns(bars);
  if (!r.length) return 0;
  const m = r.reduce((a, b) => a + b, 0) / r.length;
  const sd = Math.sqrt(r.reduce((a, b) => a + Math.pow(b - m, 2), 0) / Math.max(1, r.length - 1));
  if (!sd) return 0;
  return (m * 252 - rf / 100) / (sd * Math.sqrt(252));
}

/* --------------------------------------------------------- fundamentals -- */
/* Live rows come from screener.in in ₹ crore (see api.buildFundamentals);
   the synthetic generator below answers in the same ₹ crore unit. */
const _fundCache = {};
function qLabel(back) {
  const d = new Date();
  d.setMonth(d.getMonth() - back * 3);
  const mo = d.getMonth(), yr = d.getFullYear();
  const q = mo <= 2 ? 4 : mo <= 5 ? 1 : mo <= 8 ? 2 : 3;
  const fy = mo <= 2 ? yr : yr + 1;
  return 'Q' + q + ' FY' + String(fy).slice(2);
}
function yLabel(i) {
  const d = new Date();
  d.setFullYear(d.getFullYear() - i);
  return 'FY' + String(d.getFullYear()).slice(2);
}
function fyLabel(y) {
  return y == null ? '—' : 'FY' + String(y).slice(2);
}
function fundamentals(sym) {
  if (LIVE.fund[sym]) return LIVE.fund[sym];
  if (_fundCache[sym]) return _fundCache[sym];
  const u = UNIVERSE[sym] || UNIVERSE.NIFTY;
  const rnd = mulberry32(hashStr(sym) ^ 0xbeef);
  const years = [];
  const y0 = new Date().getFullYear() - 1;
  const g = u.growth / 100;
  const rev = [], ni = [], gm = [], om = [], nm = [];
  for (let i = 5; i >= 0; i--) {
    const k = Math.pow(1 + g + (rnd() - 0.5) * 0.05, -i);
    const r = u.rev * 100 * k; // ₹B -> ₹ Cr
    rev.push(r);
    const m = clamp(u.net + (rnd() - 0.5) * 4 - i * 0.35, -30, 65);
    nm.push(m);
    ni.push(r * m / 100);
    gm.push(clamp(u.gross + (rnd() - 0.5) * 3.5 - i * 0.4, 5, 92));
    om.push(clamp(u.op + (rnd() - 0.5) * 3 - i * 0.45, -40, 75));
    years.push(y0 - i + 1);
  }
  const assets = rev[0] * (0.9 + rnd() * 1.4);
  const liab = assets * (u.debt / (1 + u.debt));
  const equity = assets - liab;
  const intDebt = assets * (0.14 + rnd() * 0.12);
  const debt = liab;
  const cashV = u.cash * 100; // ₹B -> ₹ Cr
  const shares = u.shares;
  const quarters = [];
  for (let i = 0; i < 8; i++) {
    const k = 1 + (7 - i) * (g / 4 + (rnd() - 0.5) * 0.02);
    const r = u.rev * 100 / 4 * k;
    quarters.push({ label: qLabel(i), rev: r, ni: r * clamp(u.net + (rnd() - 0.5) * 5, -35, 65) / 100 });
  }
  const fcf = ni.map(v => v * (0.72 + rnd() * 0.45));
  const opCF = ni.map(v => v * (1.35 + rnd() * 0.5));
  const capex = opCF.map((v, i) => Math.max(0, v - fcf[i]));
  const res = {
    years: years, rev: rev, ni: ni, gm: gm, om: om, nm: nm,
    quarters: quarters, shares: shares, eps: u.eps,
    assets: assets, liab: liab, equity: equity, debt: debt, cash: cashV,
    netDebt: intDebt - cashV, opCF: opCF, capex: capex, fcf: fcf,
    live: false
  };
  _fundCache[sym] = res;
  return res;
}

/* ---------------------------------------------------------------- state -- */
const state = {
  sym: 'RELIANCE',
  tf: '1M',
  type: 'candle',
  log: false,
  overlays: { sma20: true, sma50: true, ema120: false, bb: false, vwap: false, pivot: false },
  panes: { vol: true, rsi: true, macd: true, stoch: false, atr: false },
  view: { start: 0, count: 22 },
  hover: null,
  tab: 'overview',
  peer: 'pe',
  watch: new Set(DEFAULT_WATCH),
  theme: 'dark'
};

function bars() { return seriesFor(state.sym, state.tf); }
function benchDaily() { return genDaily('NIFTY'); }
function retOver(b, n) {
  if (b.length <= n) return 0;
  return (b[b.length - 1].c / b[b.length - 1 - n].c - 1) * 100;
}

/* --------------------------------------------------------- IST market day - */
/* NSE regular session: Mon-Fri 09:15-15:30 IST. */
function istNow() {
  const p = new Date().toLocaleString('en-US', {
    timeZone: 'Asia/Kolkata', hour12: false,
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit'
  });
  const parts = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata', hour12: false }).split(', ');
  const d = new Date(p);
  const wdMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const wdStr = new Date().toLocaleDateString('en-US', { timeZone: 'Asia/Kolkata', weekday: 'short' });
  const time = new Date().toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour12: false });
  return { wd: wdMap[wdStr] != null ? wdMap[wdStr] : d.getDay(), time: time, raw: parts };
}
function nseOpen(ist) {
  const wd = ist.wd;
  const t = ist.time || '';
  const hh = +t.slice(0, 2), mm = +t.slice(3, 5);
  const mins = hh * 60 + mm;
  return wd >= 1 && wd <= 5 && mins >= 555 && mins < 930;
}
