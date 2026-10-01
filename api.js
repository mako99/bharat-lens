'use strict';

/* ==========================================================================
   BharatLens — live data layer: cached proxy client + front-end shaping
   ========================================================================== */

/* ------------------------------------------------------------- transport -- */

/* '' for any http(s) origin — the page is served by the proxy itself, so
   relative paths reach the API whether it is opened on :8790, over the LAN or
   through a tunnel. Only file:// (no origin) needs the absolute local address. */
const API_BASE = (typeof location !== 'undefined' && location.protocol === 'file:')
  ? 'http://localhost:8790'
  : '';

const TTL = {
  quotes: 20e3,
  chartIntraday: 45e3,
  chartDurable: 6 * 3600e3,
  company: 10 * 60e3,
  financials: 60 * 60e3,
  shareholding: 60 * 60e3,
  news: 10 * 60e3,
  market: 60e3,
  dividends: 60 * 60e3,
  search: 10 * 60e3
};

const _store = new Map();
const _inflight = new Map();

function timeoutSignal() {
  return (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function')
    ? AbortSignal.timeout(15000)
    : undefined;
}

/* Fetch + TTL cache + in-flight dedupe. Resolves to the payload or null. */
function req(path, ttl) {
  const hit = _store.get(path);
  if (hit && hit.exp > Date.now()) return Promise.resolve(hit.v);
  const pending = _inflight.get(path);
  if (pending) return pending;
  const job = attempt(path, ttl, 0).finally(() => { _inflight.delete(path); });
  _inflight.set(path, job);
  return job;
}

function isTimeout(e) {
  return !!e && (e.name === 'TimeoutError' || e.name === 'AbortError' || /abort|timeout/i.test(e.message || ''));
}

/*
 * Only a timeout is worth retrying: /api/market rebuilds synchronously on the proxy
 * and routinely outruns the 15s budget, so it gets two long cool-offs — the first lands
 * after the rebuild already in flight has finished and cached. Every other endpoint
 * gets one short pause. HTTP errors, dead sockets and empty payloads never retry.
 */
const RETRY_WAIT = (path) => (path.indexOf('/api/market') === 0 ? [20000, 30000] : [10000]);

function attempt(path, ttl, step) {
  return fetch(API_BASE + path, { signal: timeoutSignal() })
    .then((res) => (res && res.ok ? res.json() : null))
    .then((data) => {
      if (!data || typeof data !== 'object' || data.error || !Object.keys(data).length) return null;
      _store.set(path, { v: data, exp: Date.now() + ttl });
      return data;
    })
    .catch((err) => {
      const waits = RETRY_WAIT(path);
      if (step < waits.length && isTimeout(err)) {
        return new Promise((r) => setTimeout(r, waits[step])).then(() => attempt(path, ttl, step + 1));
      }
      return null;
    });
}

/* No public method may ever reject: sync throws and rejections collapse to null. */
function method(fn) {
  return function () {
    try {
      const out = fn.apply(null, arguments);
      if (out && typeof out.then === 'function') {
        return Promise.resolve(out).then((v) => (v === undefined ? null : v)).catch(() => null);
      }
      return Promise.resolve(out === undefined ? null : out);
    } catch (e) {
      return Promise.resolve(null);
    }
  };
}

function normSymbol(sym) {
  const s = String(sym == null ? '' : sym).trim().toUpperCase();
  return /^[A-Z0-9^][A-Z0-9.^=_-]{0,14}$/.test(s) ? s : '';
}

/* ------------------------------------------------------------- endpoints -- */

const api = {

  quotes: method(function (symbols) {
    const list = (Array.isArray(symbols) ? symbols : String(symbols == null ? '' : symbols).split(','))
      .map(normSymbol).filter(Boolean);
    if (!list.length) return Promise.resolve(null);
    return req('/api/quotes?symbols=' + encodeURIComponent(list.join(',')), TTL.quotes)
      .then((d) => (d && Array.isArray(d.quotes) && d.quotes.length ? d : null));
  }),

  chart: method(function (sym, range) {
    const s = normSymbol(sym);
    if (!s) return Promise.resolve(null);
    const r = String(range == null ? '1M' : range).toUpperCase();
    const ttl = (r === '1D' || r === '5D') ? TTL.chartIntraday : TTL.chartDurable;
    return req('/api/chart?symbol=' + encodeURIComponent(s) + '&range=' + encodeURIComponent(r), ttl)
      .then((d) => {
        if (!d || !Array.isArray(d.bars)) return null;
        const bars = [];
        for (let i = 0; i < d.bars.length; i++) {
          const b = d.bars[i];
          if (!b || typeof b !== 'object') continue;
          const t = Number(b.t), c = Number(b.c);
          if (!isFinite(t) || !isFinite(c)) continue;
          bars.push({ t: t, o: b.o, h: b.h, l: b.l, c: c, v: b.v });
        }
        return bars.length ? Object.assign({}, d, { bars: bars }) : null;
      });
  }),

  /* screener.in key ratios: { mcapCr, price, high52, low52, pe, bookValue, divYield, roce, roe, faceValue, de } */
  company: method(function (sym) {
    const s = normSymbol(sym);
    if (!s) return Promise.resolve(null);
    return req('/api/company?symbol=' + encodeURIComponent(s), TTL.company)
      .then((d) => {
        if (!d || !d.symbol || !d.ratios || d.ratios.price == null) return null;
        return d;
      });
  }),

  financials: method(function (sym, freq) {
    const s = normSymbol(sym);
    if (!s) return Promise.resolve(null);
    const f = String(freq == null ? 'annual' : freq).toLowerCase() === 'quarterly' ? 'quarterly' : 'annual';
    return req('/api/financials?symbol=' + encodeURIComponent(s) + '&freq=' + f, TTL.financials)
      .then((d) => (d && Array.isArray(d.statements) && d.statements.length ? d : null));
  }),

  /* { quarters: [...], rows: [{ key, label, values }] } — newest period first */
  shareholding: method(function (sym) {
    const s = normSymbol(sym);
    if (!s) return Promise.resolve(null);
    return req('/api/shareholding?symbol=' + encodeURIComponent(s), TTL.shareholding)
      .then((d) => (d && Array.isArray(d.rows) && d.rows.length && Array.isArray(d.quarters) ? d : null));
  }),

  dividends: method(function (sym) {
    const s = normSymbol(sym);
    if (!s) return Promise.resolve(null);
    return req('/api/dividends?symbol=' + encodeURIComponent(s), TTL.dividends)
      .then((d) => (d && (d.summary || (Array.isArray(d.rows) && d.rows.length)) ? d : null));
  }),

  news: method(function (sym, limit) {
    const s = normSymbol(sym);
    if (!s) return Promise.resolve(null);
    const n = Math.max(1, Math.min(30, Number(limit) || 12));
    return req('/api/news?symbol=' + encodeURIComponent(s) + '&limit=' + n, TTL.news)
      .then((d) => (d && Array.isArray(d.news) && d.news.length ? d : null));
  }),

  search: method(function (q) {
    const term = String(q == null ? '' : q).trim();
    if (!term) return Promise.resolve(null);
    return req('/api/search?q=' + encodeURIComponent(term), TTL.search)
      .then((d) => (d && Array.isArray(d.quotes) ? d : null));
  }),

  /* NSE snapshot: { status, indices, breadth, gainers, losers } */
  market: method(function () {
    return req('/api/market', TTL.market).then((d) => {
      if (!d || !Array.isArray(d.indices)) return null;
      if (!d.indices.length && !Array.isArray(d.gainers)) return null;
      return d;
    });
  }),

  /* Drops every cached response whose query string names this symbol. */
  reset: method(function (sym) {
    const s = normSymbol(sym);
    if (!s) return Promise.resolve(null);
    for (const key of Array.from(_store.keys())) if (keyHasSymbol(key, s)) _store.delete(key);
    return Promise.resolve(true);
  }),

  fundamentals: method(function (sym) {
    return buildFundamentals(normSymbol(sym));
  })
};

function keyHasSymbol(key, sym) {
  const qs = key.split('?')[1];
  if (!qs) return false;
  const pairs = qs.split('&');
  for (let i = 0; i < pairs.length; i++) {
    const eq = pairs[i].indexOf('=');
    if (eq < 0) continue;
    const val = decodeURIComponent(pairs[i].slice(eq + 1)).toUpperCase();
    if (val === sym || val.split(',').indexOf(sym) >= 0) return true;
  }
  return false;
}

/* ---------------------------------------------------------- fundamentals -- */

/*
 * screener.in statements come in ₹ crore, newest period first, with an extra
 * TTM column on the P&L. The fund object every chart and table consumes keeps
 * that ₹ crore unit — no scaling — so tables read exactly like the source.
 */
const ROW = {
  rev: {
    exact: ['sales', 'revenue', 'total income'],
    fuzzy: (l) => /^(sales|revenue)/.test(l) && !/per share|growth/.test(l)
  },
  ni: {
    exact: ['net profit', 'profit for the period', 'profit after tax'],
    fuzzy: (l) => /net profit|profit for the (year|period)|profit after tax/.test(l) && !/per share|margin|growth/.test(l)
  },
  expenses: { exact: ['expenses'] },
  opm: { exact: ['opm %', 'operating margin %'] },
  eps: { exact: ['eps in rs', 'eps'] },
  assets: { exact: ['total assets'] },
  liab: { exact: ['total liabilities'] },
  equityCap: { exact: ['equity capital'] },
  reserves: { exact: ['reserves'] },
  borrowings: { exact: ['borrowings'] },
  opCF: { exact: ['cash from operating activity', 'net cash flow from operating activities'] },
  invCF: { exact: ['cash from investing activity'] },
  fcf: { exact: ['free cash flow'] },
  shares: { exact: ['shares outstanding', 'weighted average diluted shares'] }
};

function findRow(rows, spec) {
  const exact = spec.exact || [];
  for (let i = 0; i < exact.length; i++) {
    for (let j = 0; j < rows.length; j++) if (rows[j].low === exact[i]) return rows[j];
  }
  if (spec.fuzzy) for (let j = 0; j < rows.length; j++) if (spec.fuzzy(rows[j].low)) return rows[j];
  return null;
}

function flatRows(fin) {
  const out = [];
  const groups = (fin && fin.statements) || [];
  for (let i = 0; i < groups.length; i++) {
    const rows = (groups[i] && groups[i].rows) || [];
    for (let j = 0; j < rows.length; j++) {
      const r = rows[j];
      if (!r || !Array.isArray(r.values)) continue;
      const label = String(r.label != null ? r.label : r.key != null ? r.key : '');
      out.push({ label: label, low: label.toLowerCase().trim(), values: r.values });
    }
  }
  return out;
}

function groupOf(fin, prefix) {
  const groups = (fin && fin.statements) || [];
  for (let i = 0; i < groups.length; i++) if (String(groups[i].group || '').indexOf(prefix) === 0) return groups[i];
  return null;
}

/** Drop the TTM column so the remaining series align with FY periods. */
function dropTTM(group) {
  const periods = group && group.periods ? group.periods : [];
  const keep = [];
  periods.forEach((p, i) => { if (String(p).toUpperCase() !== 'TTM') keep.push(i); });
  if (keep.length === periods.length) return { periods: periods, rows: (group && group.rows) || [] };
  return {
    periods: keep.map((i) => periods[i]),
    rows: ((group && group.rows) || []).map((r) => ({
      label: r.label,
      values: keep.map((i) => (Array.isArray(r.values) ? r.values[i] : null))
    }))
  };
}

/* Newest-first source arrays -> a length-n series, oldest first (index n-1 = latest). */
function series(row, n) {
  if (!row) return null;
  const v = row.values;
  if (!Array.isArray(v) || v.length < n) return null;
  const out = v.slice(0, n).reverse();
  for (let i = 0; i < out.length; i++) if (typeof out[i] !== 'number' || !isFinite(out[i])) return null;
  return out;
}

/** Shared annual span for the required statement rows: 4..6 periods, else 0. */
function spanLen(rows) {
  let k = Infinity;
  for (let i = 0; i < rows.length; i++) {
    const v = rows[i] && rows[i].values;
    if (!Array.isArray(v) || v.length < 4) return 0;
    if (v.length < k) k = v.length;
  }
  return k === Infinity ? 0 : Math.min(k, 6);
}

function latestValue(row) {
  const v = row && row.values && row.values[0];
  return typeof v === 'number' && isFinite(v) ? v : null;
}

function derive(a, b, fn) {
  const out = [];
  for (let i = 0; i < a.length; i++) {
    const v = fn(a[i], b[i]);
    if (typeof v !== 'number' || !isFinite(v)) return null;
    out.push(v);
  }
  return out;
}

function periodYear(p) {
  const m = /(\d{4})\s*$/.exec(String(p == null ? '' : p).trim());
  return m ? +m[1] : null;
}

async function buildFundamentals(sym) {
  if (!sym) return null;
  const res = await Promise.all([
    api.financials(sym, 'annual'),
    api.financials(sym, 'quarterly'),
    api.company(sym)
  ]);
  const ann = res[0], qtr = res[1], co = res[2];
  if (!ann) return null;

  const inc = dropTTM(groupOf(ann, 'Income'));
  const cfG = dropTTM(groupOf(ann, 'Cash'));
  const bsG = groupOf(ann, 'Balance');
  const aRows = flatRows({ statements: [inc] });
  const cRows = flatRows({ statements: [cfG] });
  const bRows = flatRows({ statements: [bsG] });

  /* --- yearly income (up to 6 FYs, oldest first; >=4 required) --- */
  const revRow = findRow(aRows, ROW.rev);
  const niRow = findRow(aRows, ROW.ni);
  const K = spanLen([revRow, niRow]);
  if (!K) return null;
  const rev = series(revRow, K);
  const ni = series(niRow, K);
  if (!rev || !ni) return null;

  const exp = series(findRow(aRows, ROW.expenses), K);
  const opm = series(findRow(aRows, ROW.opm), K);
  const gm = exp ? derive(rev, exp, (r, e) => (r ? (r - e) / r * 100 : null)) : null;
  const om = opm;
  const nm = derive(ni, rev, (n, r) => (r ? n / r * 100 : null));
  if (!nm) return null;
  const gmF = gm || rev.map(() => 0);
  const omF = om || derive(ni, rev, () => 0) || rev.map(() => 0);

  /* --- cash flow: real FCF row when screener reports it --- */
  const opCF = series(findRow(cRows, ROW.opCF), K);
  let fcf = series(findRow(cRows, ROW.fcf), K);
  let capex = null;
  if (opCF) {
    if (fcf) capex = opCF.map((o, i) => Math.max(0, o - fcf[i]));
    else {
      const inv = series(findRow(cRows, ROW.invCF), K);
      if (inv) { capex = inv.map(Math.abs); fcf = derive(opCF, capex, (o, c) => o - c); }
    }
  }
  if (!opCF || !fcf || !capex) return null;

  /* --- balance sheet scalars: latest year --- */
  const assets = latestValue(findRow(bRows, ROW.assets));
  const liab = latestValue(findRow(bRows, ROW.liab));
  const eqCap = latestValue(findRow(bRows, ROW.equityCap));
  const resv = latestValue(findRow(bRows, ROW.reserves));
  const borrow = latestValue(findRow(bRows, ROW.borrowings));
  const equity = (eqCap != null || resv != null) ? (eqCap || 0) + (resv || 0) : null;
  if (assets == null || equity == null) return null;
  const liabV = liab != null ? liab : assets - equity;
  const debt = borrow != null ? borrow : liabV * 0.3;
  const cash = 0; // screener balance sheets carry no cash line; treat debt as gross
  const netDebt = debt - cash;

  /* --- shares (millions) from live ratios: ₹Cr of mcap / price --- */
  const r = co && co.ratios ? co.ratios : null;
  let shares = null;
  if (r && r.mcapCr > 0 && r.price > 0) shares = r.mcapCr * 10 / r.price;
  if (!(shares > 0)) return null;

  let eps = latestValue(findRow(aRows, ROW.eps));
  if (eps == null) eps = ni[K - 1] * 10 / shares;
  if (!isFinite(eps)) return null;

  /* --- years, oldest last --- */
  const periods = inc.periods || [];
  const years = [];
  for (let i = 0; i < K; i++) {
    const p = periods[i];
    years.push(p == null ? null : periodYear(p));
  }
  years.reverse();
  if (years.some((y) => y == null)) {
    const now = new Date().getFullYear();
    for (let i = 0; i < K; i++) if (years[i] == null) years[i] = now - (K - 1 - i);
  }

  /* --- quarters, newest first, up to 8 --- */
  const quarters = [];
  if (qtr) {
    const q = dropTTM(groupOf(qtr, 'Income'));
    const qRows = flatRows({ statements: [q] });
    const qRevRow = findRow(qRows, ROW.rev);
    const qNiRow = findRow(qRows, ROW.ni);
    const labels = q.periods || [];
    if (qRevRow && qNiRow && labels.length) {
      for (let i = 0; i < Math.min(qRevRow.values.length, qNiRow.values.length, labels.length, 8); i++) {
        const rr = qRevRow.values[i], nn = qNiRow.values[i];
        if (typeof rr === 'number' && isFinite(rr) && typeof nn === 'number' && isFinite(nn)) {
          quarters.push({ label: fmtFYLabel(labels[i]), rev: rr, ni: nn });
        }
      }
    }
  }
  if (!quarters.length) {
    for (let i = 0; i < 8; i++) quarters.push({ label: qtrLabel(i), rev: rev[K - 1] / 4, ni: ni[K - 1] / 4 });
  }

  return {
    years: years, rev: rev, ni: ni, gm: gmF, om: omF, nm: nm,
    quarters: quarters, shares: shares, eps: eps,
    assets: assets, liab: liabV, equity: equity, debt: debt, cash: cash,
    netDebt: netDebt, opCF: opCF, capex: capex, fcf: fcf,
    live: true
  };
}

/** "Jun 2026" -> "Q1 FY27" (server sends raw periods on the quarterly call). */
function fmtFYLabel(p) {
  const s = String(p == null ? '' : p).trim();
  const m = /^([A-Z][a-z]{2}) (\d{4})$/.exec(s);
  if (m) {
    const q = { Mar: 4, Jun: 1, Sep: 2, Dec: 3 }[m[1]];
    if (q) {
      const year = +m[2];
      const fy = m[1] === 'Mar' ? year : year + 1;
      return 'Q' + q + ' FY' + String(fy % 100).padStart(2, '0');
    }
  }
  return s;
}

function qtrLabel(back) {
  const d = new Date();
  d.setMonth(d.getMonth() - back * 3);
  const mo = d.getMonth(), yr = d.getFullYear();
  const q = mo <= 2 ? 4 : mo <= 5 ? 1 : mo <= 8 ? 2 : 3;
  const fy = mo <= 2 ? yr : yr + 1;
  return 'Q' + q + ' FY' + String(fy).slice(2);
}
