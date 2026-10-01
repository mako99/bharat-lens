/* ==========================================================================
   BharatLens — analysis, UI rendering, interactions
   ========================================================================== */
'use strict';

/* ============================================================ ANALYSIS === */
function computeAnalysis(sym) {
  const b = genDaily(sym);
  const closes = b.map(x => x.c);
  const last = b[b.length - 1];
  const prev = b[b.length - 2];
  const r = rsi(closes);
  const m = macd(closes);
  const st = stochastic(b);
  const a = atr(b);
  const cciV = cci(b);
  const wV = williams(b);
  const sm = {
    5: sma(closes, 5), 10: sma(closes, 10), 20: sma(closes, 20),
    50: sma(closes, 50), 100: sma(closes, 100), 200: sma(closes, 200)
  };
  const em = { 10: ema(closes, 10), 20: ema(closes, 20), 50: ema(closes, 50), 100: ema(closes, 100), 200: ema(closes, 200) };
  const i = closes.length - 1;
  const price = last.c;
  const chg = price - prev.c;

  const cut = n => b.length > n ? b[b.length - 1 - n].c : b[0].c;
  const thisYear = new Date().getFullYear();
  let ytdBase = b[0].c;
  for (const x of b) if (x.t.getFullYear() === thisYear) { ytdBase = x.c; break; }
  const ret = {
    '1D': (price / prev.c - 1) * 100,
    '1W': (price / cut(5) - 1) * 100,
    '1M': (price / cut(21) - 1) * 100,
    '3M': (price / cut(63) - 1) * 100,
    '6M': (price / cut(126) - 1) * 100,
    'YTD': (price / ytdBase - 1) * 100,
    '1Y': (price / cut(252) - 1) * 100,
    '3Y': (price / cut(756) - 1) * 100,
    '5Y': (price / cut(1260) - 1) * 100
  };

  let hi52 = -Infinity, lo52 = Infinity;
  for (let k = Math.max(0, b.length - 252); k < b.length; k++) {
    if (b[k].h > hi52) hi52 = b[k].h;
    if (b[k].l < lo52) lo52 = b[k].l;
  }
  const H = last.h, L = last.l, C = last.c;
  const P0 = (H + L + C) / 3;
  const piv = {
    P: P0, R1: 2 * P0 - L, S1: 2 * P0 - H,
    R2: P0 + (H - L), S2: P0 - (H - L),
    R3: H + 2 * (P0 - L), S3: L - 2 * (H - P0)
  };

  const rsiV = r[i];
  const macdV = m.line[i], sigV = m.signal[i];
  const stK = st.k[i], stD = st.d[i];
  const cc = cciV[i];
  const wR = wV[i];
  const mom = (C / b[i - 10].c - 1) * 100;

  const signals = [
    { n: 'RSI (14)', v: rsiV, t: rsiV > 70 ? 'Overbought' : rsiV < 30 ? 'Oversold' : rsiV > 55 ? 'Bullish' : rsiV < 45 ? 'Bearish' : 'Neutral', s: rsiV > 70 ? -1 : rsiV < 30 ? 1 : rsiV > 55 ? 1 : rsiV < 45 ? -1 : 0 },
    { n: 'MACD (12,26)', v: macdV, t: macdV > sigV ? 'Bullish cross' : 'Bearish cross', s: macdV > sigV ? 1 : -1 },
    { n: 'Stochastic', v: stK, t: stK > 80 ? 'Overbought' : stK < 20 ? 'Oversold' : stK > stD ? 'Bullish' : 'Bearish', s: stK > 80 ? -1 : stK < 20 ? 1 : stK > stD ? 1 : -1 },
    { n: 'CCI (20)', v: cc, t: cc > 100 ? 'Strong +ve' : cc < -100 ? 'Strong −ve' : 'Neutral', s: cc > 100 ? 1 : cc < -100 ? -1 : 0 },
    { n: 'Williams %R', v: wR, t: wR > -20 ? 'Overbought' : wR < -80 ? 'Oversold' : 'Neutral', s: wR > -20 ? -1 : wR < -80 ? 1 : 0 },
    { n: 'Momentum (10)', v: mom, t: mom > 0 ? 'Bullish' : 'Bearish', s: mom > 0 ? 1 : -1 }
  ];

  const maRows = [];
  for (const p of [5, 10, 20, 50, 100, 200]) {
    const v = sm[p][i];
    maRows.push({ p: p, type: 'SMA', v: v, sig: v == null ? 0 : C > v ? 1 : -1 });
  }
  for (const p of [10, 20, 50, 100, 200]) {
    const v = em[p][i];
    maRows.push({ p: p, type: 'EMA', v: v, sig: v == null ? 0 : C > v ? 1 : -1 });
  }

  const bull = signals.filter(x => x.s > 0).length + maRows.filter(x => x.sig > 0).length;
  const bear = signals.filter(x => x.s < 0).length + maRows.filter(x => x.sig < 0).length;
  const total = signals.length + maRows.length;
  const score = Math.round(((bull - bear) / total) * 100);

  const sl = b.slice(-756);
  const lastVol = last.v;
  let avgVol = 0;
  for (const x of b.slice(-30)) avgVol += x.v;
  avgVol /= 30;

  return {
    b: b, closes: closes, price: price, prevClose: prev.c, chg: chg,
    chgPct: chg / prev.c * 100, dayH: H, dayL: L,
    rsi: rsiV, macd: { line: macdV, signal: sigV, hist: m.hist[i] },
    stoch: { k: stK, d: stD }, atr: a[i], sma: sm, ema: em, ret: ret,
    hi52: hi52, lo52: lo52, piv: piv, signals: signals, maRows: maRows,
    score: score, bull: bull, bear: bear, total: total,
    vol1y: annVol(b.slice(-252)), maxDD: maxDD(sl), sharpe: sharpe(sl),
    volume: lastVol, avgVol: avgVol, atrPct: (a[i] / C) * 100
  };
}

function radarScores(sym) {
  const u = liveMeta(sym) || { pe: 22, growth: 10, net: 10, debt: 1, cash: 10, div: 1, eps: 10 };
  const A = computeAnalysis(sym);
  const cl = v => clamp(Math.round(v), 5, 100);
  return {
    v: [
      cl(100 - (u.pe > 0 ? clamp(u.pe * 1.4, 0, 94) : 94)),
      cl(u.growth * 2.4 + 24),
      cl(u.net * 2.6 + 18),
      cl(50 + A.ret['6M'] * 1.6),
      cl(74 - u.debt * 13 + (u.cash || 0) * 0.1),
      cl(u.div * 12 + (u.eps > 0 ? 24 : 0))
    ],
    ref: [58, 54, 52, 50, 56, 46]
  };
}

function newsItems(sym) {
  if (LIVE.news[sym] && LIVE.news[sym].length) return LIVE.news[sym];
  const u = liveMeta(sym) || UNIVERSE.NIFTY;
  if (!u) return [];
  const rnd = mulberry32(hashStr(sym) ^ 0x77aa);
  const A = computeAnalysis(sym);
  const heads = [
    ['{S} beats quarterly expectations as {SEG} demand stays firm', 0.72],
    ['Analysts lift {S} price targets after upbeat guidance', 0.64],
    ['{S} expands {SEG} capacity with new multi-year investment', 0.48],
    ['Institutional ownership in {S} rises for third straight quarter', 0.41],
    ['{S} board approves fresh share repurchase authorisation', 0.35],
    ['Regulators open routine review into {S} market practices', -0.46],
    ['{S} slips as {SEG} margins compress amid cost pressure', -0.58],
    ['Supply-chain delays push {S} deliveries into next quarter', -0.52],
    ['{S} to present at upcoming global investor conference', 0.18],
    ['Short interest in {S} climbs to highest level this year', -0.40],
    ['{S} announces dividend of ₹' + (u.div / 100 * u.price / 4).toFixed(2) + ' per share', 0.26],
    ['Currency headwinds trim {S} full-year revenue outlook', -0.34],
    ['{S} unveils refreshed product lineup at annual event', 0.55],
    ['Options traders position for elevated {S} volatility', 0.08]
  ];
  const sources = ['Economic Times', 'Mint', 'Business Standard', 'Moneycontrol', 'NDTV Profit', 'Reuters', 'Bloomberg', 'Financial Express'];
  const out = [];
  const bag = heads.map((_, i) => i);
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = bag[i]; bag[i] = bag[j]; bag[j] = t;
  }
  const tails = [
    'Options markets imply a muted move into the next print.',
    'Street desks remain split on how durable the trend proves.',
    'Volume ran above the 20-day average through the session.',
    'The move leaves the shares inside their recent trading range.',
    'Positioning data show little change from the prior week.',
    'F&O implied volatility drifts lower into month-end.',
    'Desk activity concentrated in index heavyweights through the session.',
    'Institutional flows steadied after the weekly expiry churn.'
  ];
  for (let i = 0; i < 9; i++) {
    const pick = heads[bag[i]];
    let title = pick[0].replace('{S}', u.name.split(' ')[0]).replace('{SEG}', u.industry.split('—')[0].trim());
    const base = pick[1];
    const score = clamp(base + (rnd() - 0.5) * 0.3, -1, 1);
    const hrs = Math.floor(rnd() * 200) + i * 6;
    const days = Math.floor(hrs / 24);
    out.push({
      title: title,
      score: score,
      src: sources[Math.floor(rnd() * sources.length)],
      time: days === 0 ? (hrs === 0 ? 'just now' : hrs + 'h ago') : days + 'd ago',
      sum: 'Coverage highlights ' + (score > 0.2 ? 'constructive momentum' : score < -0.2 ? 'near-term risk factors' : 'a balanced risk-reward setup') +
        ' around ' + u.name + ', with traders focused on ' + (u.growth > 8 ? 'growth durability' : 'valuation support') +
        ' and ' + (A.rsi > 60 ? 'extended technicals' : A.rsi < 40 ? 'oversold conditions' : 'neutral momentum') +
        '. ' + tails[Math.floor(rnd() * tails.length)]
    });
  }
  return out.sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
}

/* ============================================================== QUOTE ==== */
/* Provenance line under the quote header: where the price came from and when. */
function setNote(sym) {
  const note = $('#dataNote');
  if (!note) return;
  /* the header price comes from the quotes feed — prefer that over the
     history/profile source, which /api/company (screener) would otherwise win */
  const src = LIVE.qsrc[sym] || LIVE.src[sym];
  note.hidden = false;
  note.textContent = src
    ? 'Live data for ' + sym + ' from ' + String(src).toUpperCase() + ' · refreshed ' + new Date(LIVE.qts[sym] || LIVE.ts[sym] || Date.now()).toLocaleTimeString('en-US', { hour12: false })
    : 'Showing built-in sample data for ' + sym + ' — the live proxy has not answered yet.';
}

function renderQuote() {
  const u = currentMeta();
  const A = computeAnalysis(state.sym);
  const q = LIVE.quotes[state.sym];
  const price = q && q.price != null ? q.price : A.price;
  const chg = q && q.change != null ? q.change : A.chg;
  const chgPct = q && q.changePct != null ? q.changePct : A.chgPct;
  const prev = q && q.prevClose != null ? q.prevClose : A.prevClose;
  const dLo = q && q.low != null ? q.low : A.dayL;
  const dHi = q && q.high != null ? q.high : A.dayH;
  const live = !!q && q.live !== false;

  $('#qSym').textContent = state.sym;
  $('#qExch').textContent = exchLabel(q && q.exchange ? q.exchange : u.exch) + ' · ' + (q && q.currency ? q.currency : 'INR') +
    ' · ' + (q && q.marketStatus ? q.marketStatus : 'Regular Session');
  $('#qName').textContent = (q && q.name) || u.name;
  $('#qTags').innerHTML =
    '<span class="tag sec">' + esc(u.sector) + '</span>' +
    '<span class="tag">' + esc(u.industry) + '</span>' +
    (u.div > 0 ? '<span class="tag">Div ' + nf(u.div, 2) + '%</span>' : '<span class="tag">No Dividend</span>') +
    '<span class="tag">Beta ' + nf(u.beta, 2) + '</span>' +
    (live ? '<span class="tag live">Live</span>' : '');
  $('#qPrice').textContent = fmtPrice(price);
  const chgEl = $('#qChg');
  chgEl.className = 'qh-chg ' + signCls(chgPct);
  chgEl.textContent = (chg >= 0 ? '+' : '') + fmtPrice(chg) + ' (' + fmtPct(chgPct) + ')';
  $('#qSub').textContent = 'Prev close ' + fmtPrice(prev) + ' · Day range ' + fmtPrice(dLo) + ' – ' + fmtPrice(dHi) +
    (q && q.marketTime ? ' · As of ' + fmtTime(q.marketTime) : '');

  const star = $('#starBtn');
  const inWl = state.watch.has(state.sym);
  star.textContent = inWl ? '★' : '☆';
  star.classList.toggle('on', inWl);

  const co52 = LIVE.company[state.sym] && LIVE.company[state.sym].ratios || null;
  const hi52 = (q && q.high52 != null) ? q.high52 : (co52 && co52.high52 != null) ? co52.high52 : A.hi52;
  const lo52 = (q && q.low52 != null) ? q.low52 : (co52 && co52.low52 != null) ? co52.low52 : A.lo52;
  const vol = q && q.volume != null ? q.volume : A.volume;
  const avgVol = q && q.avgVolume ? q.avgVolume : A.avgVol;
  const d52 = (price / hi52 - 1) * 100;
  const qk = [
    { k: 'Market Cap', v: fmtCap(u.mcap), s: u.mcap > 1e13 ? 'Mega cap' : u.mcap > 5e11 ? 'Large cap' : 'Mid cap' },
    { k: 'P/E (TTM)', v: nf(u.pe, 1), s: u.pe == null ? '—' : u.pe < 0 ? 'Loss-making' : 'Trailing' },
    { k: 'EPS (TTM)', v: '₹' + nf(u.eps, 2), s: 'Diluted' },
    { k: 'Div Yield', v: nf(u.div, 2) + '%', s: u.div > 2 ? 'High yield' : u.div > 0 ? 'Paying' : 'None' },
    { k: '52W High', v: fmtPrice(hi52), s: nf(d52, 1) + '% from high' },
    { k: '52W Low', v: fmtPrice(lo52), s: '+' + nf((price / lo52 - 1) * 100, 1) + '% from low' },
    { k: 'Volume', v: fmtBig(vol), s: 'Avg ' + fmtBig(avgVol) },
    { k: 'Beta', v: nf(u.beta, 2), s: 'vs NIFTY 50' }
  ];
  $('#qhQuick').innerHTML = qk.map(x =>
    '<div class="qk"><div class="k">' + x.k + '</div><div class="v">' + x.v + '</div><div class="s">' + x.s + '</div></div>'
  ).join('');

  const navChg = $('#navSymChg');
  if (navChg) {
    navChg.textContent = fmtPct(chgPct);
    navChg.className = 'nav-sym-chg ' + signCls(chgPct);
  }

  setNote(state.sym);
}

function currentMeta() { return liveMeta(state.sym) || UNIVERSE[state.sym] || UNIVERSE.NIFTY; }

/* Yahoo reports long exchange names; keep the compact NSE/BSE form on the header. */
function exchLabel(e) {
  return String(e || '')
    .replace(/National Stock Exchange of India.*/i, 'NSE')
    .replace(/Bombay Stock Exchange.*/i, 'BSE')
    .replace(/^NSI$/, 'NSE') || e || '—';
}

function renderStats() {
  const u = currentMeta();
  const A = computeAnalysis(state.sym);
  const f = fundamentals(state.sym);
  const open = A.b[A.b.length - 1].o;
  const payout = u.eps <= 0 ? '—' : nf((u.div > 0 ? (u.div / 100 * u.price) / u.eps : 0) * 100, 1) + '%';
  const items = [
    { k: 'Open', v: fmtPrice(open), s: 'Session' },
    { k: 'Day Range', v: fmtPrice(A.dayL) + '–' + fmtPrice(A.dayH), s: nf((A.dayH - A.dayL) / A.price * 100, 2) + '% width' },
    { k: 'Volume', v: fmtBig(A.volume), s: 'vs avg ' + nf(A.volume / A.avgVol, 2) + '×', pct: clamp(A.volume / A.avgVol * 30, 4, 100) },
    { k: 'RSI (14)', v: nf(A.rsi, 1), s: A.rsi > 70 ? 'Overbought' : A.rsi < 30 ? 'Oversold' : 'Neutral', pct: A.rsi },
    { k: 'ATR (14)', v: nf(A.atr, 2), s: nf(A.atrPct, 2) + '% of price', pct: clamp(A.atrPct * 12, 4, 100) },
    { k: 'Volatility 1Y', v: nf(A.vol1y, 1) + '%', s: 'Annualised', pct: clamp(A.vol1y, 4, 100) },
    { k: 'Max Drawdown', v: nf(A.maxDD, 1) + '%', s: '3-year window', pct: clamp(Math.abs(A.maxDD), 4, 100) },
    { k: 'Sharpe Ratio', v: nf(A.sharpe, 2), s: '3Y · rf 6.7%', pct: clamp((A.sharpe + 1) * 33, 4, 100) },
    { k: 'Return 1Y', v: fmtPct(A.ret['1Y']), s: 'Total', cls: signCls(A.ret['1Y']) },
    { k: 'Return 1M', v: fmtPct(A.ret['1M']), s: 'Total', cls: signCls(A.ret['1M']) },
    { k: 'ROE', v: nf(u.roe, 1) + '%', s: 'Return on equity', pct: clamp(u.roe / 2, 4, 100) },
    { k: 'Net Margin', v: nf(u.net, 1) + '%', s: 'TTM', pct: clamp(u.net * 2, 4, 100) },
    { k: 'Debt / Equity', v: nf(u.debt, 2), s: u.debt > 2 ? 'Levered' : 'Conservative', pct: clamp(u.debt * 25, 4, 100) },
    { k: 'Payout Ratio', v: payout, s: 'Of earnings' },
    { k: 'Shares Out', v: fmtBig(f.shares * 1e6), s: 'Diluted' },
    { k: 'Free Float', v: fmtCap(u.mcap * 0.94), s: 'Est. tradable' }
  ];
  $('#statsGrid').innerHTML = items.map(x =>
    '<div class="stat"><div class="k">' + x.k + '</div><div class="v ' + (x.cls || '') + '">' + x.v +
    '</div><div class="s">' + x.s + '</div>' +
    (x.pct != null ? '<div class="meter"><i style="width:' + clamp(x.pct, 2, 100) + '%"></i></div>' : '') +
    '</div>').join('');
}

function renderWatchlist() {
  const el = $('#watchlist');
  const rows = [];
  state.watch.forEach(sym => {
    const q = LIVE.quotes[sym];
    const u = liveMeta(sym);
    let price = null, chg = null;
    if (q && q.price != null) { price = q.price; chg = q.changePct; }
    else {
      try { const A = computeAnalysis(sym); price = A.price; chg = A.chgPct; } catch (e) { return; }
    }
    rows.push({ s: sym, price: price, chg: chg, name: (u && u.name) || sym });
  });
  el.innerHTML = rows.length ? rows.map(r =>
    '<div class="wl-item ' + (r.s === state.sym ? 'active' : '') + '" data-sym="' + r.s + '">' +
    '<div class="wl-sym"><b>' + r.s + '</b><span>' + esc(String(r.name).split(' ')[0]) + '</span></div>' +
    '<div class="wl-price">' + fmtPrice(r.price) + '</div>' +
    '<div class="wl-chg ' + (r.chg >= 0 ? 'chip-up' : 'chip-down') + '">' + fmtPct(r.chg) + '</div>' +
    '</div>').join('') : '<div style="color:var(--txt-3);font-size:11.5px;padding:8px 4px">Watchlist empty — hit ★ on a symbol.</div>';
  $$('.wl-item', el).forEach(n => { n.onclick = () => selectSymbol(n.dataset.sym); });
}

/* =========================================================== OVERVIEW ==== */
function renderOverview() {
  const A = computeAnalysis(state.sym);
  const u = currentMeta();
  const f = fundamentals(state.sym);
  const P = pal();

  const n = 252;
  const mine = A.b.slice(-n);
  const bench = benchDaily().slice(-n);
  const b1 = mine[0].c, b2 = bench[0].c;
  drawLineChart($('#cmpChart'), [
    { name: state.sym, color: P.acc, data: mine.map(x => (x.c / b1 - 1) * 100), fill: true },
    { name: 'NIFTY 50', color: P.warn, data: bench.map(x => (x.c / b2 - 1) * 100) }
  ], {
    fmtY: t => nf(t, 0) + '%',
    labels: mine.map(x => x.t.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })),
    baseZero: true
  });

  const sp = { '1W': retOver(benchDaily(), 5), '1M': retOver(benchDaily(), 22), '3M': retOver(benchDaily(), 63), '6M': retOver(benchDaily(), 126), 'YTD': 0, '1Y': retOver(benchDaily(), 252) };
  sp['YTD'] = retOver(benchDaily(), 190);
  $('#perfRow').innerHTML = ['1W', '1M', '3M', '6M', 'YTD', '1Y'].map(k => {
    const v = A.ret[k];
    const d = v - sp[k];
    return '<div class="perf"><div class="k">' + k + '</div><div class="v ' + signCls(v) + '">' + fmtPct(v, 1) +
      '</div><div class="k" style="margin-top:3px;color:' + (d >= 0 ? 'var(--up)' : 'var(--down)') + '">α ' + fmtPct(d, 1) + '</div></div>';
  }).join('');

  const q = f.quarters.slice().reverse();
  drawGroupedBars($('#finChart'), q.map(x => x.label), [
    { name: 'Revenue', color: P.acc, data: q.map(x => x.rev) },
    { name: 'Net Income', color: P.up, data: q.map(x => x.ni) }
  ], { fmtY: mCr });

  drawLineChart($('#marginChart'), [
    { name: 'Gross', color: P.acc, data: f.gm },
    { name: 'Operating', color: P.acc2, data: f.om },
    { name: 'Net', color: P.up, data: f.nm }
  ], { labels: f.years.map(fyLabel), fmtY: t => nf(t, 0) + '%' });

  const sc = radarScores(state.sym);
  drawRadar($('#radarChart'), ['Valuation', 'Growth', 'Profit', 'Momentum', 'Health', 'Income'], sc.v, sc.ref);

  $('#profileMeta').textContent = u.exch + ' · ' + u.hq + ' · Founded ' + u.born;
  $('#profile').innerHTML = '<p>' + esc(u.desc) + '</p>';
  $('#profileStats').innerHTML = [
    ['Sector', u.sector], ['Industry', u.industry],
    ['Employees', u.emp ? fmtBig(u.emp) : '—'], ['Headquarters', u.hq],
    ['Founded', String(u.born)], ['Exchange', u.exch],
    ['Revenue (TTM)', u.rev ? '₹' + fmtBig(u.rev * 1e9) : '—'],
    ['Net Income', u.ni ? '₹' + fmtBig(u.ni * 1e9) : '—']
  ].map(x => '<div class="ps"><div class="k">' + x[0] + '</div><div class="v">' + esc(String(x[1])) + '</div></div>').join('');
}

/* ========================================================= TECHNICALS ==== */
function renderTechnicals() {
  const A = computeAnalysis(state.sym);
  const u = currentMeta();

  const osc = A.signals.map(s => {
    const badge = s.s > 0 ? 'buy' : s.s < 0 ? 'sell' : 'hold';
    const label = s.s > 0 ? 'Buy' : s.s < 0 ? 'Sell' : 'Neutral';
    const v = Math.abs(s.v) > 999 ? fmtBig(s.v) : nf(s.v, 2);
    return '<tr><td>' + s.n + '</td><td>' + v + '</td><td>' + s.t +
      '</td><td><span class="badge ' + badge + '">' + label + '</span></td></tr>';
  }).join('');
  $('#oscTable').innerHTML =
    '<thead><tr><th>Indicator</th><th>Value</th><th>Signal</th><th>Action</th></tr></thead><tbody>' + osc + '</tbody>';

  const ma = A.maRows.map(r => {
    const badge = r.sig > 0 ? 'buy' : r.sig < 0 ? 'sell' : 'hold';
    const label = r.sig > 0 ? 'Buy' : r.sig < 0 ? 'Sell' : 'Neutral';
    const diff = r.v ? (A.price / r.v - 1) * 100 : 0;
    return '<tr><td>' + r.type + ' (' + r.p + ')</td><td>' + (r.v ? fmtPrice(r.v) : '—') +
      '</td><td class="' + signCls(diff) + '">' + (r.v ? fmtPct(diff) : '—') +
      '</td><td><span class="badge ' + badge + '">' + label + '</span></td></tr>';
  }).join('');
  const buyN = A.maRows.filter(r => r.sig > 0).length;
  const sellN = A.maRows.filter(r => r.sig < 0).length;
  $('#maTable').innerHTML =
    '<thead><tr><th>Moving Avg</th><th>Value</th><th>Δ vs Price</th><th>Action</th></tr></thead><tbody>' + ma +
    '<tr class="section"><td colspan="4">Summary: ' + buyN + ' buy · ' + sellN + ' sell · ' +
    (A.maRows.length - buyN - sellN) + ' neutral</td></tr></tbody>';

  const p = A.piv;
  const pRows = [['R3', p.R3], ['R2', p.R2], ['R1', p.R1], ['Pivot', p.P], ['S1', p.S1], ['S2', p.S2], ['S3', p.S3]]
    .map(x => '<tr' + (x[0] === 'Pivot' ? ' class="section"' : '') + '><td>' + x[0] + '</td><td>' + fmtPrice(x[1]) +
      '</td><td class="' + signCls(x[1] - A.price) + '">' + fmtPct((x[1] / A.price - 1) * 100) +
      '</td><td>' + (x[0] === 'Pivot' ? 'Pivot' : x[1] > A.price ? 'Resistance' : 'Support') + '</td></tr>').join('');
  $('#pivotTable').innerHTML = '<thead><tr><th>Level</th><th>Price</th><th>Distance</th><th>Type</th></tr></thead><tbody>' + pRows + '</tbody>';

  const risk = [
    ['ATR (14)', nf(A.atr, 2), nf(A.atrPct, 2) + '% of price'],
    ['Historical Vol (1Y)', nf(A.vol1y, 1) + '%', '252 sessions, annualised'],
    ['Max Drawdown (3Y)', nf(A.maxDD, 1) + '%', 'Peak to trough'],
    ['Sharpe Ratio', nf(A.sharpe, 2), 'Risk-adjusted return'],
    ['Beta', nf(u.beta, 2), 'vs NIFTY 50'],
    ['Day Range Width', nf((A.dayH - A.dayL) / A.price * 100, 2) + '%', 'Intraday spread'],
    ['52W Range Position', nf((A.price - A.lo52) / (A.hi52 - A.lo52) * 100, 1) + '%', '0 = low · 100 = high'],
    ['ATR Percentile', nf(pctRankLocal(A), 1) + '%', 'vs 1Y distribution']
  ].map(x => '<tr><td>' + x[0] + '</td><td>' + x[1] + '</td><td style="color:var(--txt-3)">' + x[2] + '</td></tr>').join('');
  $('#riskTable').innerHTML = '<thead><tr><th>Metric</th><th>Value</th><th>Note</th></tr></thead><tbody>' + risk + '</tbody>';

  $('#signalStrip').innerHTML = A.signals.map(s =>
    '<div class="sig ' + (s.s > 0 ? 'buy' : s.s < 0 ? 'sell' : 'neutral') + '">' +
    '<span class="n">' + s.n + '</span>' +
    '<span class="r">' + (Math.abs(s.v) > 999 ? fmtBig(s.v) : nf(s.v, 2)) + '</span>' +
    '<span class="t ' + (s.s > 0 ? 'up' : s.s < 0 ? 'down' : 'flat') + '">' + s.t + '</span></div>').join('');

  const neutral = A.total - A.bull - A.bear;
  const verdict = A.score > 25 ? 'Strong Buy' : A.score > 8 ? 'Buy' : A.score < -25 ? 'Strong Sell' : A.score < -8 ? 'Sell' : 'Hold';
  const vcol = A.score > 8 ? 'up' : A.score < -8 ? 'down' : 'flat';
  const sma200 = A.sma[200][A.b.length - 1];
  $('#signalSummary').innerHTML =
    '<div class="ss-score ' + vcol + '">' + (A.score > 0 ? '+' : '') + A.score + '</div>' +
    '<div class="ss-bars">' +
    '<div class="ss-b"><div class="lab"><span>Buy</span><span>' + A.bull + '</span></div><div class="ss-track"><i style="width:' +
    (A.bull / A.total * 100) + '%;background:var(--up)"></i></div></div>' +
    '<div class="ss-b"><div class="lab"><span>Neutral</span><span>' + neutral + '</span></div><div class="ss-track"><i style="width:' +
    (neutral / A.total * 100) + '%;background:var(--warn)"></i></div></div>' +
    '<div class="ss-b"><div class="lab"><span>Sell</span><span>' + A.bear + '</span></div><div class="ss-track"><i style="width:' +
    (A.bear / A.total * 100) + '%;background:var(--down)"></i></div></div></div>' +
    '<div class="ss-note">Composite read: <b class="' + vcol + '">' + verdict + '</b>. ' + A.bull +
    ' of ' + A.total + ' tracked signals lean bullish, ' + A.bear +
    ' bearish. Price is ' + (sma200 && A.price > sma200 ? 'above' : 'below') + ' the 200-day SMA.</div>';
  /* ---- indicator history: RSI and stochastic share the 0-100 scale ---- */
  const P = pal();
  const win = Math.min(180, A.b.length);
  const rsiAll = rsi(A.b.map(x => x.c));
  const stAll = stochastic(A.b);
  const startIdx = A.b.length - win;
  const rsiWin = rsiAll.slice(startIdx);
  const stKWin = stAll.k.slice(startIdx);
  drawLineChart($('#techChart'), [
    { name: 'RSI 14', color: P.acc, data: rsiWin },
    { name: 'Stoch %K', color: P.warn, data: stKWin, fill: true }
  ], {
    fmtY: t => nf(t, 0),
    labels: A.b.slice(startIdx).map((x, i) => i % Math.ceil(win / 6) === 0 ? x.t.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''),
    yMin: 0, yMax: 100, baseZero: false, grid: true
  });

  /* ---- trend & momentum readout ---- */
  const roc = (n) => A.b.length > n ? (A.price / A.b[A.b.length - 1 - n].c - 1) * 100 : 0;
  const smaV = (n) => { const arr = A.sma[n]; return arr && arr[A.b.length - 1] != null && isFinite(arr[A.b.length - 1]) ? arr[A.b.length - 1] : null; };
  const slope = (n) => {
    const arr = A.sma[n];
    if (!arr || A.b.length < n + 10) return null;
    const a = arr[A.b.length - 11], b = arr[A.b.length - 1];
    if (a == null || b == null || !isFinite(a) || !isFinite(b) || !a) return null;
    return (b / a - 1) * 100;
  };
  const relToBench = (n) => {
    try {
      const mine = A.b[A.b.length - 1].c / A.b[A.b.length - 1 - n].c;
      const sp = benchDaily();
      const s = sp[sp.length - 1].c / sp[sp.length - 1 - n].c;
      return (mine / s - 1) * 100;
    } catch (e) { return null; }
  };
  const pos200 = smaV(200) ? (A.price / smaV(200) - 1) * 100 : null;
  const tRows = [
    ['Price vs SMA 50', pos200 == null ? '—' : fmtPct((A.price / (smaV(50) || A.price) - 1) * 100), (A.price >= (smaV(50) || A.price) ? 'bull' : 'bear'), 'Trend'],
    ['Price vs SMA 200', pos200 == null ? '—' : fmtPct(pos200), (A.price >= (smaV(200) || A.price) ? 'bull' : 'bear'), 'Long-term trend'],
    ['SMA 50 slope (10d)', slope(50) == null ? '—' : fmtPct(slope(50)), (slope(50) || 0) >= 0 ? 'bull' : 'bear', 'Rising / falling'],
    ['MACD histogram', nf(A.macd.hist[A.b.length - 1], 3), A.macd.hist[A.b.length - 1] >= 0 ? 'bull' : 'bear', 'Momentum'],
    ['ROC 10d', fmtPct(roc(10)), roc(10) >= 0 ? 'bull' : 'bear', 'Rate of change'],
    ['ROC 30d', fmtPct(roc(30)), roc(30) >= 0 ? 'bull' : 'bear', 'Rate of change'],
    ['Relative to NIFTY (1M)', relToBench(21) == null ? '—' : fmtPct(relToBench(21)), (relToBench(21) || 0) >= 0 ? 'bull' : 'bear', 'Outperformance'],
    ['Relative to NIFTY (3M)', relToBench(63) == null ? '—' : fmtPct(relToBench(63)), (relToBench(63) || 0) >= 0 ? 'bull' : 'bear', 'Outperformance'],
    ['52W range position', nf((A.price - A.lo52) / (A.hi52 - A.lo52) * 100, 1) + '%', 'flat', '0 = low · 100 = high'],
    ['ATR percentile', nf(pctRankLocal(A), 1) + '%', 'flat', 'Volatility vs 1Y']
  ].map(r => '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td><td><span class="badge ' +
    (r[2] === 'bull' ? 'buy' : r[2] === 'bear' ? 'sell' : 'hold') + '">' +
    (r[2] === 'bull' ? 'Bullish' : r[2] === 'bear' ? 'Bearish' : 'Neutral') + '</span></td>' +
    '<td style="color:var(--txt-3)">' + r[3] + '</td></tr>').join('');
  $('#trendTable').innerHTML = '<thead><tr><th>Metric</th><th>Value</th><th>Bias</th><th>Note</th></tr></thead><tbody>' + tRows + '</tbody>';
}

function pctRankLocal(A) {
  const arr = A.b.slice(-252).map(x => x.h - x.l);
  const cur = A.b[A.b.length - 1].h - A.b[A.b.length - 1].l;
  let c = 0;
  for (const v of arr) if (v < cur) c++;
  return c / arr.length * 100;
}

/* ========================================================= FINANCIALS ==== */
function finTable(el, head, body) {
  if (!el) return;
  const th = '<thead><tr><th>Line item</th>' + head.map(h => '<th>' + h + '</th>').join('') + '</tr></thead>';
  const tb = body.map(r => {
    if (r.section) return '<tr class="section"><td colspan="' + (head.length + 1) + '">' + r.section + '</td></tr>';
    return '<tr><td>' + r.k + '</td>' + r.v.map(v => '<td class="' + (v.cls || '') + '">' + v.t + '</td>').join('') + '</tr>';
  }).join('');
  el.innerHTML = th + '<tbody>' + tb + '</tbody>';
}
function V(n, d) { d = d == null ? 0 : d; return { t: nf(n, d), cls: n < 0 ? 'neg' : '' }; }
function mCr(t) {
  const a = Math.abs(t);
  if (a >= 1e5) return nf(t / 1e5, 2) + ' L Cr';
  if (a >= 1e3) return nf(t / 1e3, 1) + ' K Cr';
  return nf(t, 0) + ' Cr';
}
function Pc(n, d) { d = d == null ? 1 : d; return { t: nf(n, d) + '%', cls: n < 0 ? 'neg' : '' }; }
function Dl(n) { return { t: '₹' + nf(n, 2), cls: n < 0 ? 'neg' : '' }; }

function renderFinancials() {
  const f = fundamentals(state.sym);
  const u = currentMeta();
  const n = f.years.length;
  const head = [];
  for (let i = 0; i < n; i++) head.push(fyLabel(f.years[i]));

  /* Live statements straight from screener.in via the proxy (₹ crore, newest first). */
  const raw = LIVE.finRaw[state.sym] && LIVE.finRaw[state.sym].annual;
  if (raw && raw.statements && raw.statements.length) {
    const grp = (pre) => (raw.statements || []).find(g => String(g.group || '').indexOf(pre) === 0) || null;
    const headOf = (g) => (g && g.periods ? g.periods : []).map(pr =>
      String(pr).toUpperCase() === 'TTM' ? 'TTM' : fyLabel(periodYear(pr)));
    const cell = (label, v) => {
      if (v == null || !isFinite(v)) return { t: '—' };
      if (/%$/.test(label)) return { t: nf(v, 1) + '%' };
      if (/^EPS/i.test(label)) return { t: nf(v, 2), cls: v < 0 ? 'neg' : '' };
      return V(v);
    };
    const rowsOf = (g, section) => {
      if (!g) return [];
      const out = [{ section: section + ' (₹ Cr)' }];
      (g.rows || []).forEach(r => out.push({ k: r.label, v: r.values.map(x => cell(r.label, x)) }));
      return out;
    };
    const inc = grp('Income'), bs = grp('Balance'), cf = grp('Cash');
    finTable($('#incomeTable'), headOf(inc), rowsOf(inc, 'Income statement'));
    finTable($('#balanceTable'), headOf(bs), rowsOf(bs, 'Balance sheet'));
    finTable($('#cashTable'), headOf(cf), rowsOf(cf, 'Cash flow'));

    const rowOf = (g, re) => g && (g.rows || []).find(r => re.test(String(r.label)));
    const ocfR = rowOf(cf, /Cash from Operating Activity/i);
    const fcfR = rowOf(cf, /Free Cash Flow/i);
    const yl = headOf(cf);
    const P = pal();
    if (ocfR && fcfR) {
      const m = Math.min(ocfR.values.length, fcfR.values.length);
      const ocf = ocfR.values.slice(0, m).map(v => (v == null || !isFinite(v)) ? 0 : v);
      const fcfv = fcfR.values.slice(0, m).map(v => (v == null || !isFinite(v)) ? 0 : v);
      const capex = ocf.map((v, i) => v - fcfv[i]);
      const chLabels = yl.slice(0, m).slice().reverse();
      const rOcf = ocf.slice().reverse(), rFcf = fcfv.slice().reverse(), rCap = capex.slice().reverse();
      drawGroupedBars($('#fcfChart'), chLabels, [
        { name: 'Operating CF', color: P.acc, data: rOcf },
        { name: 'Capex', color: P.down, data: rCap.map(x => -x) },
        { name: 'Free Cash Flow', color: P.up, data: rFcf }
      ], { fmtY: mCr });
      finTable($('#fcfTable'), yl.slice(0, m), [
        { section: 'FCF build (₹ Cr)' },
        { k: 'Operating Cash Flow', v: ocf.map(x => V(x)) },
        { k: 'Capital Expenditure', v: capex.map(x => V(-x)) },
        { k: 'Free Cash Flow', v: fcfv.map(x => V(x)) },
        { k: 'FCF Margin', v: fcfv.map((x, i) => Pc(f.rev[i] ? x / f.rev[i] * 100 : 0)) },
        { k: 'FCF per Share', v: fcfv.map(x => Dl(x * 10 / f.shares)) }
      ]);
    }
    return;
  }

  const rev = f.rev, ni = f.ni;
  finTable($('#incomeTable'), head, [
    { section: 'Revenue' },
    { k: 'Total Revenue', v: rev.map(x => V(x)) },
    { k: 'Cost of Goods Sold', v: rev.map((x, i) => V(-x * (1 - f.gm[i] / 100))) },
    { k: 'Gross Profit', v: rev.map((x, i) => V(x * f.gm[i] / 100)) },
    { section: 'Profitability' },
    { k: 'Operating Income', v: rev.map((x, i) => V(x * f.om[i] / 100)) },
    { k: 'Interest Expense', v: rev.map(x => V(-x * 0.021)) },
    { k: 'Pre-tax Income', v: rev.map((x, i) => V(x * (f.om[i] / 100 - 0.021))) },
    { k: 'Net Income', v: ni.map(x => V(x)) },
    { section: 'Per Share & Margins' },
    { k: 'Diluted EPS', v: ni.map(x => Dl(x * 10 / f.shares)) },
    { k: 'Gross Margin', v: f.gm.map(x => Pc(x)) },
    { k: 'Operating Margin', v: f.om.map(x => Pc(x)) },
    { k: 'Net Margin', v: f.nm.map(x => Pc(x)) }
  ]);

  const aI = i => f.assets * (1 + i * 0.045);
  const lI = i => f.liab * (1 + i * 0.04);
  const eI = i => aI(i) - lI(i);
  const nRow = (fn) => { const o = []; for (let i = 0; i < n; i++) o.push(V(fn(i))); return o; };
  const ratioRow = () => { const o = []; for (let i = 0; i < n; i++) o.push({ t: nf(lI(i) / eI(i), 2) }); return o; };
  finTable($('#balanceTable'), head, [
    { section: 'Assets' },
    { k: 'Cash & Equivalents', v: nRow(i => f.cash * (1 + i * 0.03)) },
    { k: 'Receivables', v: nRow(i => aI(i) * 0.11) },
    { k: 'Inventory', v: nRow(i => aI(i) * 0.06) },
    { k: 'Total Current Assets', v: nRow(i => aI(i) * 0.33) },
    { k: 'Property & Equipment', v: nRow(i => aI(i) * 0.19) },
    { k: 'Goodwill & Intangibles', v: nRow(i => aI(i) * 0.24) },
    { k: 'Total Assets', v: nRow(aI) },
    { section: 'Liabilities & Equity' },
    { k: 'Total Current Liabilities', v: nRow(i => lI(i) * 0.42) },
    { k: 'Long-term Debt', v: nRow(i => lI(i) * 0.34) },
    { k: 'Total Liabilities', v: nRow(lI) },
    { k: "Shareholders' Equity", v: nRow(eI) },
    { k: 'Liabilities / Equity', v: ratioRow() }
  ]);

  const paysDiv = u.div > 0 ? 0.45 : 0;
  finTable($('#cashTable'), head, [
    { section: 'Operating' },
    { k: 'Net Income', v: ni.map(x => V(x)) },
    { k: 'Depreciation & Amortisation', v: ni.map(x => V(Math.abs(x) * 0.14)) },
    { k: 'Stock-based Compensation', v: ni.map(x => V(Math.abs(x) * 0.09)) },
    { k: 'Change in Working Capital', v: ni.map(x => V(-Math.abs(x) * 0.05)) },
    { k: 'Cash from Operations', v: f.opCF.map(x => V(x)) },
    { section: 'Investing & Financing' },
    { k: 'Capital Expenditure', v: f.capex.map(x => V(-x)) },
    { k: 'Acquisitions & Investing', v: f.capex.map(x => V(-x * 1.35)) },
    { k: 'Dividends Paid', v: f.ni.map(x => V(-Math.max(0, x) * paysDiv)) },
    { k: 'Share Repurchase', v: f.ni.map(x => V(-Math.max(0, x) * 0.55)) },
    { k: 'Free Cash Flow', v: f.fcf.map(x => V(x)) }
  ]);

  const yl = [];
  for (let i = 0; i < n; i++) yl.push(fyLabel(f.years[i]));
  const P = pal();
  drawGroupedBars($('#fcfChart'), yl, [
    { name: 'Operating CF', color: P.acc, data: f.opCF },
    { name: 'Capex', color: P.down, data: f.capex.map(x => -x) },
    { name: 'Free Cash Flow', color: P.up, data: f.fcf }
  ], { fmtY: mCr });

  finTable($('#fcfTable'), yl, [
    { k: 'Operating Cash Flow', v: f.opCF.map(x => V(x)) },
    { k: 'Capital Expenditure', v: f.capex.map(x => V(-x)) },
    { k: 'Free Cash Flow', v: f.fcf.map(x => V(x)) },
    { k: 'FCF Margin', v: f.fcf.map((x, i) => Pc(x / f.rev[i] * 100)) },
    { k: 'FCF per Share', v: f.fcf.map(x => Dl(x * 10 / f.shares)) }
  ]);
}

/* ========================================================== VALUATION ==== */
function renderValuation() {
  const u = currentMeta();
  const A = computeAnalysis(state.sym);
  const P = pal();

  const mults = [
    { k: 'P/E (Trailing)', v: u.pe, lo: Math.min(0, u.pe * 0.5), hi: u.pe * 1.5, med: u.pe * 0.95, peer: u.pe * 0.92 },
    { k: 'Forward P/E', v: u.pe * 0.86, lo: Math.min(0, u.pe * 0.45), hi: u.pe * 1.3, med: u.pe * 0.8, peer: u.pe * 0.78 },
    { k: 'PEG Ratio', v: u.growth > 0 ? u.pe / u.growth : 99, lo: 0.5, hi: 4, med: 1.6, peer: 1.8 },
    { k: 'Price / Sales', v: u.ps, lo: 0, hi: Math.max(1, u.ps * 1.7), med: u.ps * 0.95, peer: u.ps * 0.88 },
    { k: 'Price / Book', v: Math.max(0.4, u.roe > 0 ? Math.abs(u.pe) * 0.16 : 1.4), lo: 0.4, hi: 14, med: 4.2, peer: 4.6 },
    { k: 'EV / EBITDA', v: Math.abs(u.pe) * 0.68, lo: 0, hi: Math.abs(u.pe) * 1.3, med: Math.abs(u.pe) * 0.62, peer: Math.abs(u.pe) * 0.6 },
    { k: 'Price / FCF', v: Math.abs(u.pe) * 1.18, lo: 0, hi: Math.abs(u.pe) * 2, med: Math.abs(u.pe) * 1.1, peer: Math.abs(u.pe) * 1.05 },
    { k: 'Dividend Yield %', v: u.div, lo: 0, hi: Math.max(7, u.div * 1.6), med: 1.4, peer: 1.7, invert: true }
  ];
  const rows = mults.map(m => {
    const span = (m.hi - m.lo) || 1;
    const pct = clamp((m.v - m.lo) / span * 100, 2, 100);
    const medPct = clamp((m.med - m.lo) / span * 100, 1, 99);
    const peerPct = clamp((m.peer - m.lo) / span * 100, 1, 99);
    const cheap = m.invert ? m.v > m.med : m.v < m.med;
    return '<tr><td>' + m.k + '</td><td><b>' + nf(m.v, 2) + '</b></td><td>' + nf(m.med, 2) + '</td><td>' + nf(m.peer, 2) +
      '</td><td><div class="val-bar"><i style="width:' + pct + '%"></i><u style="left:' + medPct +
      '%"></u><em style="left:' + peerPct + '%"></em></div></td>' +
      '<td><span class="badge ' + (cheap ? 'buy' : 'sell') + '">' + (cheap ? 'Cheap' : 'Rich') + '</span></td></tr>';
  }).join('');
  $('#valTable').innerHTML =
    '<thead><tr><th>Metric</th><th>Current</th><th>5Y Median</th><th>Sector</th><th>Range</th><th>Verdict</th></tr></thead><tbody>' + rows + '</tbody>';

  const all = genDaily(state.sym);
  const seg = all.slice(-130);
  const peSeries = seg.map((x, i) => {
    const eps = Math.max(0.2, u.eps * (0.78 + 0.22 * (i / seg.length)));
    return x.c / eps;
  });
  const mean = peSeries.reduce((a, b) => a + b, 0) / peSeries.length;
  const sd = Math.sqrt(peSeries.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / peSeries.length);
  drawLineChart($('#peChart'), [
    { name: 'P/E', color: P.acc, data: peSeries, fill: true },
    { name: 'Mean', color: P.warn, data: peSeries.map(() => mean) },
    { name: '+1σ', color: hexA(P.down, 0.75), data: peSeries.map(() => mean + sd) },
    { name: '−1σ', color: hexA(P.up, 0.75), data: peSeries.map(() => mean - sd) }
  ], {
    fmtY: t => nf(t, 0) + '×',
    labels: seg.map(x => x.t.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }))
  });

  renderDCF();
  renderPeers();
}

function renderDCF() {
  const u = currentMeta();
  const f = fundamentals(state.sym);
  const A = computeAnalysis(state.sym);
  const host = $('#dcf');
  if (!host) return;
  if (!host.dataset.built) {
    host.dataset.built = '1';
    host.innerHTML =
      '<div class="dcf-grid">' +
      '<div class="dcf-in"><label>Revenue growth (Y1-5)</label><input id="dcfG" type="number" value="' + clamp(u.growth, -5, 45).toFixed(1) + '" step="0.5"></div>' +
      '<div class="dcf-in"><label>FCF margin</label><input id="dcfM" type="number" value="' + clamp(f.fcf[f.years.length - 1] / f.rev[f.years.length - 1] * 100, 2, 60).toFixed(1) + '" step="0.5"></div>' +
      '<div class="dcf-in"><label>WACC / discount rate</label><input id="dcfW" type="number" value="9.0" step="0.25"></div>' +
      '<div class="dcf-in"><label>Terminal growth</label><input id="dcfT" type="number" value="2.5" step="0.25"></div>' +
      '</div><div class="dcf-out" id="dcfOut"></div>';
    $$('#dcf input').forEach(i => i.addEventListener('input', runDCF));
  }
  runDCF();

  function runDCF() {
    const g = parseFloat($('#dcfG').value) / 100;
    const m = parseFloat($('#dcfM').value) / 100;
    const w = parseFloat($('#dcfW').value) / 100;
    const tg = parseFloat($('#dcfT').value) / 100;
    const rev0 = f.rev[f.years.length - 1];
    let pv = 0;
    let lastFcf = rev0 * m;
    for (let y = 1; y <= 5; y++) {
      const gr = g * (1 - (y - 1) * 0.14);
      const fcf = rev0 * Math.pow(1 + gr, y) * m;
      pv += fcf / Math.pow(1 + w, y);
      lastFcf = fcf;
    }
    const tv = w > tg ? (lastFcf * (1 + tg)) / (w - tg) : NaN;
    const ev = pv + (isFinite(tv) ? tv / Math.pow(1 + w, 5) : pv * 2);
    const equity = ev - f.netDebt;
    const perShare = equity * 10 / f.shares;
    const upside = (perShare / A.price - 1) * 100;
    const exitMult = tv / lastFcf;
    const curEVm = u.mcap / 1e7 + f.netDebt;
    const curMult = curEVm / Math.max(1, rev0 * m);
    $('#dcfOut').innerHTML =
      '<div class="dcf-o"><div class="k">Enterprise Value</div><div class="v">' + fmtCap(ev * 1e7) +
      '</div><div class="s">PV of 5Y FCF + terminal</div></div>' +
      '<div class="dcf-o"><div class="k">Equity Value</div><div class="v">' + fmtCap(equity * 1e7) +
      '</div><div class="s">Less net debt ' + fmtCap(f.netDebt * 1e7) + '</div></div>' +
      '<div class="dcf-o fair"><div class="k">Fair Value / Share</div><div class="v ' + signCls(upside) + '">₹' + nf(perShare, 2) +
      '</div><div class="s">' + fmtPct(upside, 1) + ' vs market</div></div>' +
      '<div class="dcf-note" style="grid-column:1/-1">Implied exit multiple <b>' + nf(exitMult, 1) +
      '×</b> FCF vs <b>' + nf(curMult, 1) + '×</b> in the market today — the gap is the growth and discount-rate assumption you have not modelled. Margin held flat; no extrapolation past year 5.</div>';
  }
}

function renderPeers() {
  const metric = state.peer;
  const defs = {
    pe: { f: s => UNIVERSE[s].pe, label: 'P/E', fmt: t => nf(t, 0) + '×' },
    ps: { f: s => UNIVERSE[s].ps, label: 'P/S', fmt: t => nf(t, 0) + '×' },
    roe: { f: s => UNIVERSE[s].roe, label: 'ROE %', fmt: t => nf(t, 0) + '%' },
    growth: { f: s => UNIVERSE[s].growth, label: 'Growth %', fmt: t => nf(t, 0) + '%' },
    margin: { f: s => UNIVERSE[s].net, label: 'Net Margin %', fmt: t => nf(t, 0) + '%' }
  };
  const d = defs[metric];
  const u = currentMeta();
  const sectorPeers = SYMBOLS.filter(s => UNIVERSE[s].sector === u.sector);
  let set = sectorPeers.slice();
  if (set.length < 6) {
    const rest = SYMBOLS.filter(s => set.indexOf(s) < 0)
      .sort((a, b) => Math.abs(UNIVERSE[a].mcap - u.mcap) - Math.abs(UNIVERSE[b].mcap - u.mcap));
    set = set.concat(rest.slice(0, 6 - set.length));
  }
  set = set.slice(0, 7);
  if (set.indexOf(state.sym) < 0) set = [state.sym].concat(set).slice(0, 8);

  const P = pal();
  drawGroupedBars($('#peerChart'), set, [
    {
      name: d.label, color: P.acc,
      colors: set.map(s => s === state.sym ? P.acc2 : hexA(P.acc, 0.38)),
      data: set.map(s => d.f(s))
    }
  ], {
    fmtY: t => d.fmt(t), legend: false, barValues: t => d.fmt(t),
    labelColors: set.map(s => s === state.sym ? P.txt : P.txt3),
    labelWeights: set.map(s => s === state.sym)
  });
}

/* ============================================================== FLOW ===== */
/* Fetches the quarterly shareholding pattern, then repaints Ownership. */
function loadOwnership(sym) {
  if (!sym) return Promise.resolve(null);
  if (LIVE.loading['own:' + sym]) return LIVE.loading['own:' + sym];
  const job = api.shareholding(sym).then(sh => {
    if (sh) LIVE.shareholding[sym] = sh;
    if (state.sym === sym && state.page === 'holdings') renderOwnership();
    return sym;
  }).catch(() => null).finally(() => { delete LIVE.loading['own:' + sym]; });
  LIVE.loading['own:' + sym] = job;
  return job;
}

/* Shareholding pattern normalised to oldest-first arrays — live via the proxy,
   otherwise a modelled sample seeded from the symbol so it stays stable. */
function ownershipData(sym) {
  const sh = LIVE.shareholding[sym] || null;
  const CATS = ['promoters', 'fiis', 'diis', 'government', 'public'];
  if (sh && sh.quarters && sh.quarters.length >= 3 && sh.rows && sh.rows.length) {
    const quarters = sh.quarters.slice().reverse().map(fmtFYLabel);
    const by = {};
    sh.rows.forEach(r => { by[r.key] = r.values.slice().reverse(); });
    CATS.forEach(k => { if (!by[k]) by[k] = quarters.map(() => 0); });
    return { quarters: quarters, by: by, source: sh.source || 'screener', modelled: false };
  }
  const rnd = mulberry32(hashStr(sym) ^ 0x5177);
  const n = 12;
  const quarters = [];
  for (let i = n - 1; i >= 0; i--) quarters.push(qtrLabel(i));
  const by = { promoters: [], fiis: [], diis: [], government: [], public: [] };
  let prom = 52 + rnd() * 14, fii = 13 + rnd() * 8, dii = 12 + rnd() * 7, gov = 0.4 + rnd() * 1.4;
  for (let i = 0; i < n; i++) {
    prom += (rnd() - 0.5) * 1.1;
    fii += (rnd() - 0.5) * 1.7;
    dii += (rnd() - 0.45) * 1.1;
    gov += (rnd() - 0.5) * 0.12;
    by.promoters.push(Math.max(0, prom));
    by.fiis.push(Math.max(0, fii));
    by.diis.push(Math.max(0, dii));
    by.government.push(Math.max(0, gov));
    const sum = prom + fii + dii + gov;
    by.public.push(Math.max(2, 100 - sum));
  }
  return { quarters: quarters, by: by, source: 'modelled sample', modelled: true };
}

function renderOwnership() {
  const P = pal();
  const sub = (id, txt) => { const el = $(id); if (el) el.textContent = txt; };
  const od = ownershipData(state.sym);
  const qs = od.quarters, last = qs.length - 1;
  const val = (k, i) => (i >= 0 && od.by[k] && od.by[k][i] != null && isFinite(od.by[k][i])) ? od.by[k][i] : 0;
  const latest = k => val(k, last);
  const prev = k => val(k, last - 1);

  const CAT = [
    { k: 'promoters', n: 'Promoters', c: P.acc },
    { k: 'fiis', n: 'FIIs', c: P.acc2 },
    { k: 'diis', n: 'DIIs', c: P.warn },
    { k: 'government', n: 'Government', c: P.txt2 },
    { k: 'public', n: 'Public', c: P.up }
  ];
  const shown = CAT.filter(c => latest(c.k) > 0.05);

  /* ---- donut: latest quarter split ---- */
  drawDonut($('#ownChart'), shown.map(c => ({ n: c.n, v: latest(c.k), c: c.c })), qs[last], 'holding %');
  $('#ownLegend').innerHTML = shown.map(c => {
    const d = latest(c.k) - prev(c.k);
    return '<div class="lg-row"><span class="sw" style="background:' + c.c + '"></span><span class="nm">' +
      c.n + '</span><span class="pc">' + nf(latest(c.k), 2) + '%</span><span class="sh ' + signCls(d) + '">' +
      (d === 0 ? '0.00' : (d > 0 ? '+' : '') + nf(d, 2)) + '</span></div>';
  }).join('') + '<div class="lg-note">QoQ change in pp · ' + esc(od.source) + '</div>';

  sub('#ownSub', 'Promoter ' + nf(latest('promoters'), 1) + '% · FII ' + nf(latest('fiis'), 1) +
    '% · DII ' + nf(latest('diis'), 1) + '% · ' + qs[last]);
  sub('#ownStamp', qs[last] + ' · ' + od.source);
  sub('#ownSub2', 'Latest quarter (' + qs[last] + ') · ' + od.source);
  sub('#flowSub', 'Quarter-end pattern · last ' + qs.length + ' quarters');
  sub('#shortSub', 'QoQ change · last 8 quarters · percentage points');
  sub('#holdersSub', 'Shareholding pattern · % of equity · ' + od.source);

  /* ---- 12-quarter holding trend ---- */
  const lab = qs.map((q, i) => (i % 3 === 0 || i === last) ? q.replace(' FY', ' ') : '');
  drawLineChart($('#flowChart'), CAT.map(c => ({
    name: c.n, color: c.c, data: qs.map((q, i) => val(c.k, i)), fill: c.k === 'promoters' ? false : false
  })), { labels: lab, fmtY: t => nf(t, 1) + '%', dots: false });

  /* ---- QoQ change bars ---- */
  const m = Math.min(8, qs.length - 1);
  const qLab = [], dF = [], dD = [], dP = [];
  for (let i = qs.length - m; i < qs.length; i++) {
    qLab.push(qs[i].replace(' FY', ' '));
    dF.push(val('fiis', i) - val('fiis', i - 1));
    dD.push(val('diis', i) - val('diis', i - 1));
    dP.push(val('promoters', i) - val('promoters', i - 1));
  }
  drawGroupedBars($('#shortChart'), qLab, [
    { name: 'Promoter Δ', color: P.acc, data: dP },
    { name: 'FII Δ', color: P.acc2, data: dF },
    { name: 'DII Δ', color: P.warn, data: dD }
  ], { fmtY: t => (t === 0 ? '0' : (t > 0 ? '+' : '') + nf(t, 2) + 'pp'), legend: true });

  /* ---- history table ---- */
  const pctCell = v => ({ t: nf(v, 2) + '%' });
  const rows = [{ section: 'Shareholding % (of equity)' }];
  for (let i = last; i >= 0; i--) {
    const dFq = val('fiis', i) - val('fiis', i - 1);
    rows.push({
      k: qs[i],
      v: [pctCell(val('promoters', i)), pctCell(val('fiis', i)), pctCell(val('diis', i)),
        pctCell(val('government', i)), pctCell(val('public', i)),
        { t: (dFq === 0 ? '0.00' : (dFq > 0 ? '+' : '') + nf(dFq, 2)), cls: signCls(dFq) }]
    });
  }
  finTable($('#holdersTable'), ['Quarter', 'Promoters', 'FIIs', 'DIIs', 'Government', 'Public', 'QoQ FII'], rows);

  /* warm the live feed on first visit; repaints once it lands */
  if (!LIVE.shareholding[state.sym]) loadOwnership(state.sym);
}

/* ============================================================== NEWS ===== */
/* Shared news-card markup. Mainline financial feeds lead with a thumbnail and a
   compact source line, and tag sentiment instead of printing a blocky score. */
const NEWS_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M4 5h13a1 1 0 0 1 1 1v11a2 2 0 0 0 2 2H5a2 2 0 0 1-2-2V6a1 1 0 0 1 1-1Z"/>' +
  '<path d="M18 8h2a1 1 0 0 1 1 1v9a2 2 0 0 1-2 2"/><path d="M7 9h7M7 13h7M7 17h4"/></svg>';

function newsHead(x) {
  const t = esc(x.title);
  return x.link
    ? '<a href="' + esc(x.link) + '" target="_blank" rel="noopener">' + t + '</a>'
    : t;
}

function newsThumbFail(el) {
  const p = el.parentNode;
  if (p) { p.classList.add('ph'); p.innerHTML = NEWS_ICON; }
}

function newsThumb(x) {
  return '<span class="nthumb' + (x.thumb ? '' : ' ph') + '">' +
    (x.thumb
      ? '<img src="' + esc(x.thumb) + '" alt="" decoding="async" referrerpolicy="no-referrer" onerror="newsThumbFail(this)">'
      : NEWS_ICON) +
    '</span>';
}

function newsChip(x) {
  const cls = x.score > 0.15 ? 'p' : x.score < -0.15 ? 'n' : 'm';
  const word = cls === 'p' ? 'Positive' : cls === 'n' ? 'Negative' : 'Neutral';
  return '<span class="nchip ' + cls + '"><i></i>' + word + '</span>';
}

function newsMeta(x, withSym) {
  return '<div class="nmeta"><span class="nsrc">' + esc(x.src) + '</span>' +
    '<span class="ntime">' + esc(x.time) + '</span>' +
    (withSym ? '<span class="nsym">' + esc(state.sym) + '</span>' : '') +
    newsChip(x) + '</div>';
}

/* whole card is the hit target, but a real link keeps its own behaviour */
function bindCardOpens(root) {
  if (!root) return;
  $$('.nlead,.ncard,.news', root).forEach(n => {
    const a = n.querySelector('a');
    if (!a) { n.style.cursor = 'default'; return; }
    n.onclick = (e) => { if (e.target.closest('a')) return; window.open(a.href, '_blank', 'noopener'); };
  });
}

function renderNews() {
  const P = pal();
  const items = newsItems(state.sym);
  $('#newsList').innerHTML = items.map(x =>
    '<article class="news">' + newsThumb(x) +
      '<div class="nbody">' + newsMeta(x, true) +
        '<div class="ntitle">' + newsHead(x) + '</div>' +
        (x.sum ? '<div class="nsum">' + esc(x.sum) + '</div>' : '') +
      '</div></article>').join('');
  bindCardOpens($('#newsList'));

  /*30-day polarity: real article scores when timestamps exist, synthetic otherwise */
  const now = Date.now();
  const buckets = [];
  for (let i = 0; i < 30; i++) buckets.push([]);
  let dated = 0;
  items.forEach(x => {
    const t = typeof x.ts === 'number' ? x.ts : (x.ts ? Date.parse(x.ts) : NaN);
    if (!isFinite(t)) return;
    const age = Math.floor((now - t) / 86400000);
    if (age >= 0 && age < 30) { buckets[29 - age].push(x.score); dated++; }
  });
  let series = null;
  if (dated >= 5) {
    series = [];
    let last = 0, seen = false;
    for (let i = 0; i < 30; i++) {
      if (buckets[i].length) {
        last = buckets[i].reduce((a, c) => a + c, 0) / buckets[i].length;
        seen = true;
      }
      series.push(seen ? last : null);
    }
  } else {
    const rnd = mulberry32(hashStr(state.sym) ^ 0x5e77);
    series = [];
    for (let i = 0; i < 30; i++) series.push((rnd() - 0.45) * 1.6);
  }
  const sub = $('#sentSub');
  if (sub) sub.textContent = dated >= 5
    ? '30-day polarity · ' + dated + ' dated headlines'
    : '30-day article polarity';
  drawLineChart($('#sentChart'), [
    { name: 'Sentiment', color: P.acc, data: series, fill: true, dots: true }
  ], { fmtY: t => nf(t, 1), labels: series.map((_, i) => i % 6 === 0 ? 'D-' + (30 - i) : ''), baseZero: true });

  $('#events').innerHTML = eventList().map(ev =>
    '<div class="ev"><span class="d">' + ev.d + '</span><div><div class="t">' + ev.t + '</div><div class="s">' + ev.s + '</div></div></div>').join('');
}

function eventList() {
  const u = currentMeta();
  const now = new Date();
  const fmt = d => ({ m: d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase(), d: String(d.getDate()).padStart(2, '0') });
  const mk = (daysFromNow) => fmt(new Date(now.getTime() + daysFromNow * 86400000));
  const dateOf = (v) => {
    if (!v) return null;
    const t = typeof v === 'number' ? v : Date.parse(v);
    if (!isFinite(t)) return null;
    const d = new Date(t);
    return now - d > 90 * 86400000 ? null : d;
  };
  const co = LIVE.company[state.sym] || {};
  const earn = co.earnings || {};
  const liveNext = dateOf(earn.next);
  const liveEx = dateOf(earn.exDividendDate);

  const e1 = liveNext ? fmt(liveNext) : mk(11 + (hashStr(state.sym) % 25));
  const e2 = liveEx ? fmt(liveEx) : mk(24 + (hashStr(state.sym + 'd') % 30));
  const e3 = mk(45 + (hashStr(state.sym + 'm') % 40));
  const e4 = mk(68 + (hashStr(state.sym + 'c') % 45));
  const cons = earn.consensus || (earn.quarterly && earn.quarterly[0] && earn.quarterly[0].estimate);
  return [
    { d: e1.m + ' ' + e1.d, t: 'Quarterly Earnings', s: (liveNext ? 'Scheduled' : 'Estimated') + ' after the closing bell' + (cons ? ' · consensus ₹' + nf(cons, 2) + ' EPS' : '') },
    { d: e2.m + ' ' + e2.d, t: 'Ex-Dividend Date', s: u.div > 0 ? 'Payout ₹' + nf(u.div / 100 * u.price / 4, 2) + ' per share' : 'No dividend declared' },
    { d: e3.m + ' ' + e3.d, t: 'Investor Day / Conference', s: 'Management presentation and Q&A' },
    { d: e4.m + ' ' + e4.d, t: 'Index Rebalance Review', s: 'Quarterly weighting adjustment window' }
  ];
}

/* ============================================================== RAIL ===== */
function renderRail() {
  const u = currentMeta();
  const A = computeAnalysis(state.sym);
  const f = fundamentals(state.sym);
  const P = pal();

  /* ownership summary — quarterly shareholding pattern via the proxy */
  const od = ownershipData(state.sym);
  const oLast = od.quarters.length - 1;
  const ovl = k => (od.by[k] && od.by[k][oLast] != null) ? od.by[k][oLast] : 0;
  const ovlPrev = k => (od.by[k] && od.by[k][oLast - 1] != null) ? od.by[k][oLast - 1] : 0;
  const prom = ovl('promoters'), fii = ovl('fiis'), dii = ovl('diis'), pub = ovl('public'), gov = ovl('government');
  const promCls = prom >= 55 ? 'buy' : prom >= 25 ? 'hold' : 'sell';
  const promD = prom - ovlPrev('promoters');
  const pp = d => (d === 0 ? '0.00' : (d > 0 ? '+' : '') + nf(d, 2));
  $('#consensus').innerHTML =
    '<div class="cons-badge ' + promCls + '">' + nf(prom, 2) + '% Promoters</div>' +
    '<div class="cons-meta">Holding as of <b>' + esc(od.quarters[oLast]) + '</b> · ' + esc(od.source) +
    '<br>QoQ promoter change <b class="' + signCls(promD) + '">' + pp(promD) + ' pp</b></div>';

  $('#ratingBars').innerHTML = [
    { n: 'Promoters', v: prom, c: 'var(--acc)' },
    { n: 'FIIs', v: fii, c: 'var(--acc-2)' },
    { n: 'DIIs', v: dii, c: 'var(--warn)' },
    { n: 'Government', v: gov, c: 'var(--txt-2)' },
    { n: 'Public', v: pub, c: 'var(--up)' }
  ].map(x => '<div class="rb"><span class="lab">' + x.n + '</span><span class="tr"><i style="width:' +
    clamp(x.v, 0, 100) + '%;background:' + x.c + '"></i></span><span class="num">' + nf(x.v, 1) + '</span></div>').join('');

  const oTile = (k, v, c) => '<div class="pt"><div class="k">' + k + '</div><div class="v ' + (c || '') + '">' + v + '</div></div>';
  $('#priceTarget').innerHTML =
    oTile('Promoters', nf(prom, 1) + '%') +
    oTile('FIIs', nf(fii, 1) + '%') +
    oTile('DIIs', nf(dii, 1) + '%') +
    oTile('QoQ FII', pp(fii - ovlPrev('fiis')) + ' pp', signCls(fii - ovlPrev('fiis')));

  const gaugeVal = clamp(A.score + 50, 2, 98);
  drawGauge($('#gaugeChart'), gaugeVal);
  const gLabel = gaugeVal > 70 ? 'Strong Buy' : gaugeVal > 55 ? 'Buy' : gaugeVal < 30 ? 'Strong Sell' : gaugeVal < 45 ? 'Sell' : 'Hold';
  const gCol = gaugeVal > 55 ? 'up' : gaugeVal < 45 ? 'down' : 'flat';
  $('#gaugeLabel').innerHTML = '<div class="big ' + gCol + '">' + gLabel + '</div>' +
    '<div class="sub">Technical score ' + Math.round(gaugeVal) + ' / 100</div>';

  const levels = [
    { cls: 'res', n: 'Resistance R2', v: A.piv.R2 },
    { cls: 'res', n: 'Resistance R1', v: A.piv.R1 },
    { cls: 'piv', n: 'Classic Pivot', v: A.piv.P },
    { cls: 'now', n: 'Last Price', v: A.price },
    { cls: 'sup', n: 'Support S1', v: A.piv.S1 },
    { cls: 'sup', n: 'Support S2', v: A.piv.S2 },
    { cls: 'sup', n: '52W Low', v: A.lo52 },
    { cls: 'res', n: '52W High', v: A.hi52 }
  ];
  $('#levels').innerHTML = levels.map(x =>
    '<div class="lv ' + x.cls + '"><span class="n">' + x.n + '</span><span class="v">' + fmtPrice(x.v) + '</span></div>').join('');

  $('#railEvents').innerHTML = eventList().slice(0, 3).map(ev =>
    '<div class="ev"><span class="d">' + ev.d + '</span><div><div class="t">' + ev.t + '</div><div class="s">' + ev.s + '</div></div></div>').join('');

  renderDepth(A.price);
  $('#footStats').textContent = SYMBOLS.length + ' instruments · 1,560 sessions · ' + A.signals.length + ' oscillators + ' + A.maRows.length + ' moving averages tracked';
}

function renderDepth(price) {
  const rnd = mulberry32(hashStr(state.sym + 'book'));
  const tick = Math.max(0.01, price * 0.0004);
  const rows = [];
  let cumA = 0, cumB = 0;
  const asks = [], bids = [];
  for (let i = 1; i <= 7; i++) {
    const sz = Math.round(200 + rnd() * 3800);
    cumA += sz;
    asks.push({ p: price + tick * i, sz: sz, cum: cumA });
    const sz2 = Math.round(200 + rnd() * 3800);
    cumB += sz2;
    bids.push({ p: price - tick * i, sz: sz2, cum: cumB });
  }
  const mxCum = Math.max(cumA, cumB);
  const row = (x, side) => '<div class="dp ' + side + '"><i style="width:' + (x.cum / mxCum * 100) + '%"></i>' +
    '<span class="pr">' + fmtPrice(x.p) + '</span><span class="sz">' + x.sz.toLocaleString('en-US') +
    '</span><span class="tot">' + x.cum.toLocaleString('en-US') + '</span></div>';
  asks.slice().reverse().forEach(x => rows.push(row(x, 'ask')));
  rows.push('<div class="dp-spread"><span>SPREAD</span><span>' + fmtPrice(tick * 2) + ' · ' + nf(tick * 2 / price * 10000, 1) + ' bps</span></div>');
  bids.forEach(x => rows.push(row(x, 'bid')));
  $('#depth').innerHTML = rows.join('');
}

/* ============================================================= TABS ====== */
const TAB_RENDER = {
  market: renderMarket,
  overview: renderOverview,
  technicals: renderTechnicals,
  financials: renderFinancials,
  valuation: renderValuation,
  flow: renderOwnership,
  news: renderNews
};
const tabDone = {};

function renderTab(tab) {
  try {
    TAB_RENDER[tab]();
    tabDone[tab] = true;
  } catch (err) {
    console.error('render ' + tab, err);
  }
}

function setTab(tab) {
  const key = String(tab || '').replace(/^#\/?/, '').split('/')[0];
  const page = TAB_PAGE[key] || (PAGES.indexOf(key) >= 0 ? key : 'stock');
  setView(page);
}

/* ============================================================ CHART UI ==== */
function setTF(tf) {
  tf = String(tf || '').toUpperCase();
  if (!TF_DEFAULT[tf]) tf = TF_DEFAULT[state.tf] ? state.tf : '1M';
  state.tf = tf;
  $$('#tfSeg button').forEach(b => b.classList.toggle('on', b.dataset.tf === tf));
  const apply = () => {
    const data = bars();
    const want = Math.min(tfCount(state.tf, data), data.length);
    state.view = { start: Math.max(0, data.length - want), count: want, n: data.length };
    state.hover = null;
    drawMain();
  };
  apply();
  if (tf === '1D' || tf === '5D') {
    const sym = state.sym;
    loadIntraday(sym, tf).then(() => {
      if (state.tf !== tf || state.sym !== sym) return;
      apply();
    });
  }
}

/* The window is anchored to the tail of the series and remembers how many bars it
   was computed for. When a live feed lands and changes that count the anchor must
   be recomputed, otherwise the chart keeps pointing at stale indices. */
function reanchorView() {
  const data = bars();
  if (!data.length || (state.view.n != null && state.view.n === data.length)) return false;
  const want = Math.min(tfCount(state.tf, data), data.length);
  state.view = { start: Math.max(0, data.length - want), count: want, n: data.length };
  state.hover = null;
  drawMain();
  return true;
}

function redrawAll() {
  renderQuote();
  renderStats();
  renderWatchlist();
  drawMain();
  renderRail();
  Object.keys(tabDone).forEach(k => { if (tabDone[k]) renderTab(k); });
}

function selectSymbol(sym) {
  if (!sym) return;
  sym = String(sym).toUpperCase();
  if (!UNIVERSE[sym] && !LIVE.quotes[sym] && !LIVE.meta[sym]) {
    /* symbol outside the built-in universe: ask the proxy for its quote first */
    api.quotes([sym]).then(r => {
      if (r && r.quotes && r.quotes[0]) { applyQuote(sym, r.quotes[0], r.source, r.fetchedAt); selectSymbol(sym); }
      else toast(sym + ' not found');
    });
    return;
  }
  state.sym = sym;
  $$('#searchResults .sr-item').forEach(n => n.classList.remove('sel'));
  const nav = $('#navSym');
  if (nav) nav.childNodes[0].nodeValue = sym + ' ';
  /* The market dashboard does not follow the selected symbol and its view hides
     #navSym, so picking a result while sitting there gives no visible feedback —
     open the stock page instead. Sub-pages (Financials, News, …) keep their tab. */
  if (state.page === 'market') setView('stock');
  setTF(state.tf);
  redrawAll();
  const u = liveMeta(sym);
  toast('Loaded ' + sym + (u && u.name && u.name !== sym ? ' · ' + u.name : ''));
  loadSymbol(sym).then(() => {
    if (state.sym !== sym) return;
    setTF(state.tf);
    redrawAll();
    renderPage(state.page);
    setNote(sym);
  });
}

function fitChart() {
  const wrap = $('#chartWrap');
  if (!wrap) return;
  drawMain();
}

/* ========================================================== INTERACTION === */
function bindChart() {
  const cv = $('#mainChart');
  const wrap = $('#chartWrap');
  let dragging = false, lastX = 0;

  const idxFromX = (clientX) => {
    const r = cv.getBoundingClientRect();
    const x = clientX - r.left;
    const plotW = r.width - PAD.l - PAD.r;
    const bw = plotW / state.view.count;
    return Math.round((x - PAD.l) / bw - 0.5 + state.view.start);
  };

  cv.addEventListener('mousemove', e => {
    const r = cv.getBoundingClientRect();
    if (dragging) {
      const plotW = r.width - PAD.l - PAD.r;
      const bw = plotW / state.view.count;
      const dx = e.clientX - lastX;
      lastX = e.clientX;
      const shift = -dx / bw;
      const data = bars();
      const maxStart = Math.max(0, data.length - Math.round(state.view.count));
      state.view.start = clamp(state.view.start + shift, 0, maxStart);
      drawMain();
      return;
    }
    const i = clamp(idxFromX(e.clientX), 0, bars().length - 1);
    if (i !== state.hover) { state.hover = i; drawMain(); }
  });

  cv.addEventListener('mousedown', e => { dragging = true; lastX = e.clientX; cv.style.cursor = 'grabbing'; });
  window.addEventListener('mouseup', () => { if (dragging) { dragging = false; cv.style.cursor = 'crosshair'; } });
  cv.addEventListener('mouseleave', () => { state.hover = null; drawMain(); });

  cv.addEventListener('wheel', e => {
    e.preventDefault();
    const data = bars();
    const anchor = state.hover == null ? state.view.start + state.view.count / 2 : state.hover;
    const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
    const newCount = clamp(Math.round(state.view.count * factor), 12, data.length);
    const rel = (anchor - state.view.start) / state.view.count;
    let start = anchor - rel * newCount;
    state.view.count = newCount;
    state.view.start = clamp(start, 0, Math.max(0, data.length - newCount));
    drawMain();
  }, { passive: false });

  /* touch pan */
  let touchX = null;
  cv.addEventListener('touchstart', e => { touchX = e.touches[0].clientX; }, { passive: true });
  cv.addEventListener('touchmove', e => {
    if (touchX == null) return;
    const plotW = cv.getBoundingClientRect().width - PAD.l - PAD.r;
    const bw = plotW / state.view.count;
    const dx = e.touches[0].clientX - touchX;
    touchX = e.touches[0].clientX;
    const data = bars();
    state.view.start = clamp(state.view.start - dx / bw, 0, Math.max(0, data.length - state.view.count));
    drawMain();
  }, { passive: true });
  cv.addEventListener('touchend', () => { touchX = null; });

  wrap.addEventListener('mouseleave', () => { state.hover = null; drawMain(); });
}

const CHART_TYPES = ['area', 'line', 'candle', 'hollow'];

function setType(t) {
  state.type = CHART_TYPES.indexOf(t) >= 0 ? t : 'area';
  $$('#typeSeg button').forEach(x => x.classList.toggle('on', x.dataset.type === state.type));
  try { localStorage.setItem('sl-type', state.type); } catch (e) {}
}

function bindToolbar() {
  $$('#tfSeg button').forEach(b => { b.onclick = () => setTF(b.dataset.tf); });

  $$('#typeSeg button').forEach(b => {
    b.onclick = () => {
      setType(b.dataset.type);
      drawMain();
    };
  });

  $$('#ovChips .chip').forEach(ch => {
    ch.onclick = () => {
      const k = ch.dataset.ov;
      state.overlays[k] = !state.overlays[k];
      ch.classList.toggle('on', state.overlays[k]);
      drawMain();
    };
  });

  $$('#paneChips .chip').forEach(ch => {
    ch.onclick = () => {
      const k = ch.dataset.pane;
      state.panes[k] = !state.panes[k];
      ch.classList.toggle('on', state.panes[k]);
      drawMain();
    };
  });

  $$('#logSeg button').forEach(b => {
    b.onclick = () => {
      state.log = b.dataset.scale === 'log';
      $$('#logSeg button').forEach(x => x.classList.toggle('on', x === b));
      drawMain();
    };
  });

  $('#resetZoom').onclick = () => setTF(state.tf);

  $$('#peerSeg button').forEach(b => {
    b.onclick = () => {
      state.peer = b.dataset.peer;
      $$('#peerSeg button').forEach(x => x.classList.toggle('on', x === b));
      renderPeers();
    };
  });

  $$('#tabs .tab').forEach(b => { b.onclick = () => setTab(b.dataset.tab); });
}

function bindSearch() {
  const input = $('#searchInput');
  const box = $('#searchResults');
  let sel = -1;
  let matches = [];

  const close = () => { box.hidden = true; sel = -1; };

  let remote = [];
  let remoteQ = null;

  const pull = (q) => {
    if (!q || remoteQ === q) return;
    remoteQ = q;
    api.search(q).then(res => {
      const list = (res && res.quotes) || [];
      remote = list.filter(x => x && x.symbol && SYMBOLS.indexOf(x.symbol) < 0).slice(0, 5);
      if (input.value.trim().toUpperCase() === q) draw();
    });
  };

  const draw = () => {
    const q = input.value.trim().toUpperCase();
    const rows = SYMBOLS.filter(s => !q || s.indexOf(q) === 0 || UNIVERSE[s].name.toUpperCase().indexOf(q) >= 0)
      .slice(0, 9)
      .map(s => ({ sym: s, name: UNIVERSE[s].name, sector: UNIVERSE[s].sector, kind: 'local' }));
    if (q && rows.length < 9) {
      remote.forEach(r => {
        if (rows.some(x => x.sym === r.symbol)) return;
        rows.push({ sym: r.symbol, name: r.name || r.symbol, sector: r.exchange || '', kind: 'remote' });
      });
    }
    matches = rows.map(r => r.sym);
    if (!rows.length) { close(); return; }
    box.hidden = false;
    box.innerHTML = rows.map((r, i) => {
      let price = null;
      if (LIVE.quotes[r.sym] && LIVE.quotes[r.sym].price != null) price = LIVE.quotes[r.sym].price;
      else if (r.kind === 'local') { try { price = computeAnalysis(r.sym).price; } catch (e) { price = null; } }
      const sector = r.kind === 'local'
        ? (liveMeta(r.sym) || UNIVERSE[r.sym]).sector
        : r.sector;
      return '<div class="sr-item ' + (i === sel ? 'sel' : '') + '" data-sym="' + r.sym + '">' +
        '<span class="sr-sym">' + r.sym + '</span><span class="sr-name">' + esc(r.name) + '</span>' +
        '<span class="sr-name" style="flex:0 0 auto;font-family:var(--mono)">' + (price != null ? fmtPrice(price) : '—') + '</span>' +
        '<span class="sr-sec">' + esc(sector || '') + '</span></div>';
    }).join('');
    $$('.sr-item', box).forEach(n => { n.onclick = () => { selectSymbol(n.dataset.sym); input.value = ''; close(); }; });
  };

  input.addEventListener('input', () => { draw(); pull(input.value.trim().toUpperCase()); });
  input.addEventListener('focus', draw);
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, matches.length - 1); draw(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); draw(); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const s = matches[sel < 0 ? 0 : sel];
      if (s) { selectSymbol(s); input.value = ''; close(); input.blur(); }
    } else if (e.key === 'Escape') { close(); input.blur(); }
  });
  document.addEventListener('click', e => { if (!$('#search').contains(e.target)) close(); });

  document.addEventListener('keydown', e => {
    if (e.key === '/' && document.activeElement !== input) { e.preventDefault(); input.focus(); input.select(); }
  });
}

function bindMisc() {
  $('#starBtn').onclick = () => {
    if (state.watch.has(state.sym)) { state.watch.delete(state.sym); toast(state.sym + ' removed from watchlist'); }
    else { state.watch.add(state.sym); toast(state.sym + ' added to watchlist'); }
    renderQuote();
    renderWatchlist();
  };

  $('#addWatch').onclick = () => {
    state.watch.add(state.sym);
    renderWatchlist();
    renderQuote();
    toast(state.sym + ' pinned to watchlist');
  };

  $('#collapseSide').onclick = () => {
    const side = $('#sidebar');
    side.style.display = side.style.display === 'none' ? '' : 'none';
  };

  $('#themeBtn').onclick = () => {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', state.theme);
    try { localStorage.setItem('sl-theme', state.theme); } catch (e) {}
    redrawAll();
    toast(state.theme === 'dark' ? 'Dark theme' : 'Light theme');
  };

  $('#exportBtn').onclick = () => {
    const A = computeAnalysis(state.sym);
    const u = currentMeta();
    const snap = {
      symbol: state.sym, company: u.name, exchange: u.exch,
      price: A.price, changePct: +A.chgPct.toFixed(2),
      technicalScore: A.score, rsi14: +A.rsi.toFixed(2),
      macd: +A.macd.line.toFixed(3), sma20: +A.sma[20][A.b.length - 1].toFixed(2),
      sma50: +A.sma[50][A.b.length - 1].toFixed(2), sma200: +A.sma[200][A.b.length - 1].toFixed(2),
      returns: A.ret, volatility1Y: +A.vol1y.toFixed(2), maxDrawdown: +A.maxDD.toFixed(2),
      valuation: { pe: u.pe, ps: u.ps, roe: u.roe, dividendYield: u.div },
      dataSources: {
        chart: LIVE.src[state.sym] || null,
        profile: LIVE.csrc[state.sym] || null,
        fundamentals: LIVE.fund[state.sym] ? 'live' : 'demo',
        shareholding: LIVE.shareholding[state.sym] ? LIVE.shareholding[state.sym].source : null,
        news: LIVE.news[state.sym] ? 'live' : null
      },
      generatedAt: new Date().toISOString(),
      note: 'BharatLens research snapshot generated from live NSE/BSE feeds where available; technical indicators are computed client-side from the exported price history.'
    };
    const blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = state.sym + '-bharatlens-snapshot.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast('Snapshot exported for ' + state.sym);
  };

  let rt = null;
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => {
      drawMain();
      if (state.tab) renderTab(state.tab);
      renderRail();
    }, 120);
  });

  if (window.ResizeObserver) {
    const ro = new ResizeObserver(() => { clearTimeout(rt); rt = setTimeout(drawMain, 60); });
    ro.observe($('#chartWrap'));
  }
}

function tickClock() {
  const ist = istNow();
  $('#clock').textContent = ist.time + ' IST';
  let open = nseOpen(ist);
  const st = LIVE.market && LIVE.market.status;
  if (st && st.state) open = st.state === 'open';
  const pill = $('#mktStatus');
  pill.classList.toggle('closed', !open);
  $('#mktText').textContent = st && st.state === 'preopen' ? 'PRE-OPEN' : open ? 'NSE OPEN' : 'MARKET CLOSED';
}

/* ============================================================ LIVE DATA ==== */
const POS_WORDS = ['beat', 'beats', 'rise', 'rises', 'rising', 'jump', 'jumps', 'surge', 'record',
  'upgrade', 'upgraded', 'raise', 'raises', 'lift', 'boost', 'strong', 'growth', 'win', 'wins',
  'deal', 'deal$', 'buy', 'buyback', 'bullish', 'outperform', 'approve', 'approved', 'soar',
  'rally', 'higher', 'tops', 'exceeds', 'expands', 'optimistic', 'rebound', 'gain'];
const NEG_WORDS = ['miss', 'misses', 'fall', 'falls', 'falling', 'drop', 'drops', 'slump', 'warn',
  'warns', 'cuts', 'cuts$', 'delay', 'probe', 'sues', 'lawsuit', 'recall', 'weak', 'decline',
  'bearish', 'downgrade', 'downgraded', 'risk', 'loss', 'losses', 'fraud', 'investigation',
  'halt', 'plunge', 'tumbles', 'lower', 'concern', 'slashes', 'misses'];

function scoreHeadline(t) {
  const w = String(t || '').toLowerCase().split(/[^a-z]+/);
  let s = 0;
  for (const x of w) { if (POS_WORDS.indexOf(x) >= 0) s++; else if (NEG_WORDS.indexOf(x) >= 0) s--; }
  return clamp(s / 4, -1, 1);
}

function relTime(ts) {
  if (!ts) return 'recently';
  const ms = Date.now() - ts;
  if (ms < 0) return 'just now';
  const h = Math.floor(ms / 3600000);
  if (h < 1) return Math.max(1, Math.floor(ms / 60000)) + 'm ago';
  if (h < 24) return h + 'h ago';
  return Math.floor(h / 24) + 'd ago';
}

/* Google News titles end in " - publisher"; the publisher has its own field. */
function cleanTitle(title, publisher) {
  let t = String(title || '');
  if (publisher) {
    const tail = ' - ' + publisher;
    if (t.length > tail.length && t.slice(-tail.length).toLowerCase() === tail.toLowerCase()) t = t.slice(0, -tail.length);
  }
  const m = t.match(/\s+-\s+[A-Za-z0-9.\s&]{3,40}$/);
  if (m && publisher && t.slice(-m[0].length).toLowerCase().indexOf(String(publisher).toLowerCase().slice(0, 12)) >= 0) {
    t = t.slice(0, -m[0].length);
  }
  return t.trim();
}

function mapNews(payload) {
  const rows = (payload && payload.news) || [];
  return rows.map(n => ({
    id: n.id || n.link,
    title: cleanTitle(n.title, n.publisher),
    score: scoreHeadline(n.title),
    src: n.publisher || (payload.source === 'google-news' ? 'Google News' : 'Wire'),
    time: relTime(n.time),
    sum: n.summary || '',
    link: n.link,
    thumb: n.thumbnail || null,
    ts: n.time || null
  })).filter(x => x.title);
}

function applyQuote(sym, q, src, ts) {
  if (!q) return;
  LIVE.quotes[sym] = q;
  if (src) { LIVE.qsrc[sym] = src; LIVE.qts[sym] = ts || Date.now(); }
  livePut(sym, 'price', q.price);
  livePut(sym, 'mcap', q.marketCap);
  livePut(sym, 'name', q.name);
  if (q.exchange) livePut(sym, 'exch', exchLabel(String(q.exchange).replace(/-GS$/, '')));
  if (q.volume != null) livePut(sym, 'vol', q.volume);
}

function applyCompany(sym, c) {
  if (!c) return;
  LIVE.company[sym] = c;
  /* profile numbers come from screener, not from the price history — keep them apart
     so LIVE.src stays the source of the exported chart */
  LIVE.csrc[sym] = c.source || LIVE.csrc[sym];
  const r = c.ratios || {};
  livePut(sym, 'name', c.name);
  if (r.price != null) livePut(sym, 'price', r.price);
  if (r.mcapCr != null) livePut(sym, 'mcap', r.mcapCr * 1e7);
  if (r.pe != null) livePut(sym, 'pe', r.pe);
  if (r.roe != null) livePut(sym, 'roe', r.roe);
  if (r.roce != null) livePut(sym, 'roce', r.roce);
  if (r.divYield != null) livePut(sym, 'div', r.divYield);
  if (r.high52 != null) livePut(sym, 'high52', r.high52);
  if (r.low52 != null) livePut(sym, 'low52', r.low52);
  if (r.bookValue != null) livePut(sym, 'bookValue', r.bookValue);
  if (r.faceValue != null) livePut(sym, 'faceValue', r.faceValue);
  if (r.price && r.mcapCr) livePut(sym, 'shares', r.mcapCr * 10 / r.price); /* M shares */
  if (c.sector) livePut(sym, 'sector', c.sector);
  if (c.industry) livePut(sym, 'industry', c.industry);
}

function seedFundamentals(sym, f) {
  if (!f) return;
  LIVE.fund[sym] = f;
  const last = f.years ? f.years.length - 1 : -1;
  if (last >= 0) {
    livePut(sym, 'rev', f.rev[last] / 100);
    livePut(sym, 'ni', f.ni[last] / 100);
  }
  if (f.eps != null) livePut(sym, 'eps', f.eps);
}

function loadDaily(sym, range) {
  if (!sym) return Promise.resolve(null);
  const k = 'spark:' + sym + ':' + range;
  if (LIVE.loading[k] || LIVE.spark[sym + ':' + range]) return Promise.resolve(LIVE.spark[sym + ':' + range]);
  const job = api.chart(sym, range).then(ch => {
    if (!ch || !ch.bars || !ch.bars.length) return null;
    const bars = ch.bars.map(b => ({ t: new Date(b.t), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }));
    LIVE.spark[sym + ':' + range] = bars;
    return bars;
  }).catch(() => null).finally(() => { delete LIVE.loading[k]; });
  LIVE.loading[k] = job;
  return job;
}

/* Pulls everything one symbol needs: history, profile, model, news, quote. */
function loadSymbol(sym) {
  if (!sym) return Promise.resolve(null);
  if (LIVE.loading['sym:' + sym]) return LIVE.loading['sym:' + sym];
  const job = Promise.all([
    api.chart(sym, 'MAX'),
    api.company(sym),
    api.fundamentals(sym),
    api.financials(sym, 'annual'),
    api.news(sym, 12),
    api.quotes([sym])
  ]).then(rs => {
    const ch = rs[0], co = rs[1], fu = rs[2], fin = rs[3], nw = rs[4], qs = rs[5];
    if (ch && ch.bars && ch.bars.length > 120) {
      LIVE.daily[sym] = ch.bars.map(b => ({ t: new Date(b.t), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }));
      LIVE.src[sym] = ch.source || LIVE.src[sym];
      LIVE.ts[sym] = Date.now();
      delete _dailyCache[sym];
    }
    if (co) applyCompany(sym, co);
    if (fu) seedFundamentals(sym, fu);
    if (fin) LIVE.finRaw[sym] = { annual: fin };
    if (nw) LIVE.news[sym] = mapNews(nw);
    if (qs && qs.quotes && qs.quotes[0]) applyQuote(sym, qs.quotes[0], qs.source, qs.fetchedAt);
    loadOwnership(sym);
    return sym;
  }).catch(() => null).finally(() => { delete LIVE.loading['sym:' + sym]; });
  LIVE.loading['sym:' + sym] = job;
  return job;
}

/* 1D/5D intraday windows are fetched only when the toolbar asks for them. */
function loadIntraday(sym, tf) {
  const k = sym + ':' + tf;
  if (!sym || (tf !== '1D' && tf !== '5D')) return Promise.resolve(null);
  if (LIVE.intra[k] || LIVE.loading['intra:' + k]) return Promise.resolve(LIVE.intra[k] || null);
  const job = api.chart(sym, tf).then(ch => {
    if (!ch || !ch.bars || !ch.bars.length) return null;
    const bars = ch.bars.map(b => ({ t: new Date(b.t), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }));
    LIVE.intra[k] = bars;
    return bars;
  }).catch(() => null).finally(() => { delete LIVE.loading['intra:' + k]; });
  LIVE.loading['intra:' + k] = job;
  return job;
}

function loadWatchQuotes() {
  const syms = Array.from(state.watch);
  if (!syms.length) return Promise.resolve(null);
  const job = api.quotes(syms).then(res => {
    if (!res || !res.quotes) return null;
    res.quotes.forEach(q => { if (q && q.symbol) applyQuote(q.symbol, q, res.source, res.fetchedAt); });
    renderWatchlist();
    if (LIVE.quotes[state.sym]) renderQuote();
    if (state.page === 'market') renderMarket();
    return res;
  }).catch(() => null).finally(() => { delete LIVE.loading.watch; });
  if (!LIVE.loading.watch) LIVE.loading.watch = job;
  return job;
}


/* ================================================================ ROUTER == */
const PAGES = ['market', 'stock', 'technicals', 'financials', 'valuation', 'holdings', 'news'];
const PAGE_TAB = {
  market: 'market', stock: 'overview', technicals: 'technicals',
  financials: 'financials', valuation: 'valuation', holdings: 'flow', news: 'news'
};
const TAB_PAGE = {
  market: 'market', overview: 'stock', technicals: 'technicals',
  financials: 'financials', valuation: 'valuation', flow: 'holdings', news: 'news'
};

function pageFromHash() {
  const raw = String(location.hash || '').replace(/^#\/?/, '');
  const head = raw.split('/')[0].toLowerCase();
  const alias = { overview: 'stock', ownership: 'holdings', flow: 'holdings', 'valuation-ratios': 'valuation' };
  if (alias[head]) return alias[head];
  return PAGES.indexOf(head) >= 0 ? head : null;
}

function setView(page) {
  if (PAGES.indexOf(page) < 0) page = 'market';
  state.page = page;
  state.tab = PAGE_TAB[page] || 'overview';
  const view = page === 'market' ? 'market' : 'stock';
  document.body.dataset.view = view;
  $$('.page').forEach(p => p.classList.toggle('on', p.id === 'pg-' + page));
  $$('#pagenav a').forEach(a => {
    if (a.dataset.page === page) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  const navSym = $('#navSym');
  if (navSym) navSym.style.display = view === 'stock' ? '' : 'none';
  const want = '#/' + page;
  if (location.hash !== want) {
    try { history.replaceState(null, '', want); } catch (e) { location.hash = want; }
  }
  requestAnimationFrame(() => {
    renderPage(page);
    if (view === 'stock') { drawMain(); renderRail(); }
  });
}

function renderPage(page) {
  renderTab(PAGE_TAB[page] || page);
}

function bindNav() {
  $$('#pagenav a').forEach(a => {
    a.addEventListener('click', e => {
      e.preventDefault();
      setView(a.dataset.page);
    });
  });
  const navSym = $('#navSym');
  if (navSym) navSym.addEventListener('click', () => { $('#searchInput').focus(); });
  window.addEventListener('hashchange', () => {
    const p = pageFromHash();
    if (p && p !== state.page) setView(p);
  });
}

/* ============================================================== MARKET ==== */
const IDX_NAME = { NIFTY: 'NIFTY 50', SENSEX: 'SENSEX', BANKNIFTY: 'NIFTY BANK' };
const IDX_SYM = { 'NIFTY 50': 'NIFTY', 'SENSEX': 'SENSEX', 'NIFTY BANK': 'BANKNIFTY' };
const IDX_STRIP = ['NIFTY 50', 'SENSEX', 'NIFTY BANK', 'NIFTY IT', 'NIFTY FMCG'];

function idxLabel(sym) { return IDX_NAME[sym] || String(sym || ''); }
function idxSym(name) { return IDX_SYM[name] || null; }
function sparkBars(sym, range) { return LIVE.spark[sym + ':' + range] || null; }
function retBack(bars, n) {
  if (!bars || bars.length <= n) return null;
  const last = bars[bars.length - 1].c, base = bars[bars.length - 1 - n].c;
  if (!base) return null;
  return (last / base - 1) * 100;
}

/* Server rows are {name, value, change, ...}; normalise to the card shape. */
function normIdx(x) {
  const name = String(x.name || x.symbol || '');
  const price = x.value != null ? x.value : x.price;
  const change = x.change != null ? x.change
    : (price != null && x.prevClose != null ? price - x.prevClose : 0);
  const changePct = x.changePct != null ? x.changePct
    : (x.prevClose ? (price / x.prevClose - 1) * 100 : 0);
  return {
    name: name,
    price: price,
    change: change,
    changePct: changePct,
    prevClose: x.prevClose != null ? x.prevClose : (price != null ? price - change : null),
    pe: x.pe,
    exchange: /SENSEX/.test(name) ? 'BSE' : 'NSE',
    sym: idxSym(name) || x.symbol || null,
    adv: x.advances, dec: x.declines
  };
}

function fallbackIndices() {
  const g = (sym, name) => {
    try {
      const b = genDaily(sym);
      const prev = b[b.length - 2].c, last = b[b.length - 1].c;
      return normIdx({ name: name, value: last, change: last - prev,
        changePct: (last / prev - 1) * 100, prevClose: prev, pe: null });
    } catch (e) { return null; }
  };
  return [
    g('NIFTY', 'NIFTY 50'), g('SENSEX', 'SENSEX'), g('BANKNIFTY', 'NIFTY BANK')
  ].filter(Boolean);
}

function fallbackSectorIdx() {
  return ['NIFTY IT', 'NIFTY FMCG', 'NIFTY PHARMA', 'NIFTY AUTO', 'NIFTY METAL',
    'NIFTY REALTY', 'NIFTY ENERGY', 'NIFTY BANK', 'NIFTY FINANCIAL SERVICES',
    'NIFTY MEDIA', 'NIFTY PSU BANK', 'NIFTY PRIVATE BANK', 'NIFTY HEALTHCARE',
    'NIFTY CONSUMER DURABLES', 'NIFTY OIL & GAS'].map(name => {
      try {
        const b = genDaily(name);
        const prev = b[b.length - 2].c, last = b[b.length - 1].c;
        return normIdx({ name: name, value: last, change: last - prev,
          changePct: (last / prev - 1) * 100, prevClose: prev });
      } catch (e) { return null; }
    }).filter(Boolean);
}

function fallbackMovers() {
  const all = SYMBOLS.filter(s => UNIVERSE[s].sector !== 'Index').map(s => {
    try { const A = computeAnalysis(s); return { symbol: s, name: UNIVERSE[s].name, price: A.price, changePct: A.chgPct, volume: A.volume }; }
    catch (e) { return null; }
  }).filter(Boolean);
  const byChg = all.slice().sort((a, b) => b.changePct - a.changePct);
  return {
    gainers: byChg.slice(0, 8),
    losers: byChg.slice(-8).reverse(),
    mostActive: all.slice().sort((a, b) => (b.volume || 0) - (a.volume || 0)).slice(0, 8)
  };
}

function moverRows(list) {
  if (!list || !list.length) return '<div class="mover"><span class="mv-n">No data</span></div>';
  return list.slice(0, 8).map(x => {
    const chg = x.changePct || 0;
    const rawName = String(x.name || '').trim();
    const dup = !rawName || rawName.toUpperCase() === String(x.symbol).toUpperCase();
    const nm = dup ? '' : rawName.replace(/ (Common Stock|Inc\.?|Corporation|Corp\.?|Ltd\.?)$/i, '');
    return '<div class="mover" data-sym="' + x.symbol + '">' +
      '<span class="mv-s">' + x.symbol + '</span>' +
      '<span class="mv-n">' + esc(nm) + '</span>' +
      '<span class="mv-p">' + fmtPrice(x.price) + '</span>' +
      '<span class="mv-c ' + signCls(chg) + '">' + fmtPct(chg) + '</span>' +
      '</div>';
  }).join('');
}

function renderMarket() {
  const m = LIVE.market;
  const live = !!m;

  /* ---- index strip ---- */
  const idxAll = (m && m.indices && m.indices.length) ? m.indices.map(normIdx) : fallbackIndices();
  const stripRows = IDX_STRIP.map(n => idxAll.filter(x => x.name === n)[0]).filter(Boolean)
    .concat(idxAll.filter(x => IDX_STRIP.indexOf(x.name) < 0).slice(0, 5 - IDX_STRIP.filter(n => idxAll.filter(y => y.name === n)[0]).length)).slice(0, 5);
  const strip = $('#idxStrip');
  if (strip) {
    strip.innerHTML = stripRows.map((x, i) => {
      const chg = x.changePct || 0;
      const target = x.sym || '';
      return '<div class="idx-card" data-sym="' + target + '" title="' + esc(x.name) + '">' +
        '<div class="idx-top"><span class="idx-name">' + esc(x.name) + '</span>' +
        '<span class="idx-tag">' + x.exchange + '</span></div>' +
        '<div class="idx-val">' + fmtPrice(x.price) + '</div>' +
        '<div class="idx-chg ' + signCls(chg) + '">' + fmtPct(chg) + '</div>' +
        '<div class="idx-spark"><canvas data-idx="' + i + '"></canvas></div>' +
        '<div class="idx-meta"><span>Prev ' + fmtPrice(x.prevClose) + '</span><span>' +
        (x.pe ? 'PE ' + nf(x.pe, 1) : '') + '</span></div>' +
        '</div>';
    }).join('');
    stripRows.forEach((x, i) => {
      const bars = x.sym ? sparkBars(x.sym, '1M') : null;
      if (bars && bars.length > 4) {
        drawLineChart(strip.querySelector('canvas[data-idx="' + i + '"]'), [
          { name: x.name, color: (x.changePct || 0) >= 0 ? pal().up : pal().down, data: bars.map(b => b.c), fill: true }
        ], { padL: 3, padR: 3, padT: 5, padB: 3, fmtY: () => '' });
      }
    });
    $$('.idx-card', strip).forEach(c => {
      if (c.dataset.sym) c.onclick = () => selectSymbol(c.dataset.sym);
    });
  }

  /* ---- sectoral indices ---- */
  const secAll = (m && m.indices && m.indices.length) ? m.indices.map(normIdx) : fallbackSectorIdx();
  const inStrip = stripRows.map(x => x.name);
  const sec = secAll.filter(x => x.name !== 'NIFTY 50' && x.name !== 'SENSEX' && inStrip.indexOf(x.name) < 0);
  const rows = sec.slice().map(x => {
    const b3m = x.sym ? sparkBars(x.sym, '3M') : null;
    return {
      symbol: x.name.replace(/\s+/g, ''),
      sym: x.sym,
      label: x.name,
      price: x.price,
      chg1d: x.changePct || 0,
      chg5d: retBack(b3m, 5),
      chg1m: retBack(b3m, 21),
      pe: x.pe
    };
  }).sort((a, b) => b.chg1d - a.chg1d);
  const tbl = $('#sectorTable');
  if (tbl) {
    tbl.innerHTML =
      '<thead><tr><th>Index</th><th>Code</th><th class="n">Last</th><th class="n">1D</th><th class="n">5D</th><th class="n">1M</th><th class="w">Day</th></tr></thead><tbody>' +
      rows.map(r => {
        const mx = Math.max(0.6, Math.abs(r.chg1d));
        const w = Math.min(100, Math.abs(r.chg1d) / mx * 100);
        return '<tr data-sym="' + (r.sym || '') + '">' +
          '<td>' + esc(r.label) + '</td>' +
          '<td class="mono dim">' + r.symbol + '</td>' +
          '<td class="n mono">' + fmtPrice(r.price) + '</td>' +
          '<td class="n mono ' + signCls(r.chg1d) + '">' + fmtPct(r.chg1d) + '</td>' +
          '<td class="n mono ' + signCls(r.chg5d) + '">' + (r.chg5d == null ? '—' : fmtPct(r.chg5d)) + '</td>' +
          '<td class="n mono ' + signCls(r.chg1m) + '">' + (r.chg1m == null ? '—' : fmtPct(r.chg1m)) + '</td>' +
          '<td class="w"><span class="mkt-bar"><i style="width:' + w + '%;background:' +
          (r.chg1d >= 0 ? 'var(--up)' : 'var(--down)') + ';' + (r.chg1d < 0 ? 'margin-left:auto' : '') + '"></i></span></td>' +
          '</tr>';
      }).join('') + '</tbody>';
    $$('tbody tr', tbl).forEach(tr => { if (tr.dataset.sym) tr.onclick = () => selectSymbol(tr.dataset.sym); });
  }

  /* ---- movers ---- */
  const fb = fallbackMovers();
  const gList = (m && m.gainers && m.gainers.length) ? m.gainers : fb.gainers;
  const lList0 = (m && m.losers && m.losers.length) ? m.losers : fb.losers;
  const lList = gList.length ? lList0.filter(x => !gList.some(g => g.symbol === x.symbol)) : lList0;
  const aList = (m && m.gainers && m.gainers.length)
    ? m.gainers.slice().sort((a, b) => (b.volume || 0) - (a.volume || 0)).slice(0, 8)
    : fb.mostActive;
  const set = (id, list) => { const el = $(id); if (el) el.innerHTML = moverRows(list); };
  set('#moversGainers', gList);
  set('#moversLosers', lList);
  set('#moversActive', aList);
  $$('.mover[data-sym]').forEach(n => {
    n.onclick = () => {
      const sym = n.dataset.sym;
      const row = [].concat(gList || [], lList || [], aList || []).filter(x => x.symbol === sym)[0];
      if (row) {
        /* attribute the price only when the row really came from the live payload */
        const live = !!m && [m.gainers, m.losers, m.mostActive].some(l => l && l.indexOf(row) >= 0);
        applyQuote(sym, row, live ? m.source : null, live ? m.fetchedAt : null);
      }
      selectSymbol(sym);
    };
  });

  /* ---- breadth ---- */
  const pool = [].concat(gList || [], lList || [])
    .filter(x => x && x.changePct != null && x.symbol);
  const br = m && m.breadth;
  const adv = br ? br.adv : pool.filter(x => x.changePct > 0.05).length;
  const dec = br ? br.dec : pool.filter(x => x.changePct < -0.05).length;
  const unc = br ? br.unch : Math.max(0, (br ? br.total : pool.length) - adv - dec);
  const total = br ? br.total : Math.max(1, adv + dec + unc);
  const avg = pool.length ? pool.reduce((a, x) => a + (x.changePct || 0), 0) / pool.length : 0;
  const sorted = pool.slice().sort((a, b) => (a.changePct || 0) - (b.changePct || 0));
  const med = sorted.length ? (sorted[Math.floor(sorted.length / 2)].changePct || 0) : 0;
  const best = sorted.length ? sorted[sorted.length - 1] : null;
  const worst = sorted.length ? sorted[0] : null;
  const hi = pool.filter(x => x.changePct > 1).length, lo = pool.filter(x => x.changePct < -1).length;
  const bEl = $('#breadth');
  if (bEl) {
    bEl.innerHTML =
      '<div class="breadth-bar">' +
      '<i class="adv" style="width:' + (adv / Math.max(1, total) * 100) + '%"></i>' +
      '<i class="unc" style="width:' + (unc / Math.max(1, total) * 100) + '%"></i>' +
      '<i class="dec" style="width:' + (dec / Math.max(1, total) * 100) + '%"></i>' +
      '</div>' +
      '<div class="breadth-key">' +
      '<span><i class="bk-dot" style="background:var(--up)"></i>Advancing <b>' + adv + '</b></span>' +
      '<span><i class="bk-dot" style="background:var(--stroke-2)"></i>Flat <b>' + unc + '</b></span>' +
      '<span><i class="bk-dot" style="background:var(--down)"></i>Declining <b>' + dec + '</b></span>' +
      '</div>' +
      '<div class="breadth-stats">' +
      '<div class="breadth-stat"><div class="bs-l">Avg move</div><div class="bs-v ' + signCls(avg) + '">' + fmtPct(avg) + '</div></div>' +
      '<div class="breadth-stat"><div class="bs-l">Median</div><div class="bs-v ' + signCls(med) + '">' + fmtPct(med) + '</div></div>' +
      '<div class="breadth-stat"><div class="bs-l">&gt; +1%</div><div class="bs-v up">' + hi + '</div></div>' +
      '<div class="breadth-stat"><div class="bs-l">&gt; −1%</div><div class="bs-v down">' + lo + '</div></div>' +
      '</div>' +
      '<div class="breadth-stats">' +
      '<div class="breadth-stat"><div class="bs-l">Best</div><div class="bs-v ' + signCls(best ? best.changePct : 0) + '">' +
      (best ? best.symbol + ' ' + fmtPct(best.changePct) : '—') + '</div></div>' +
      '<div class="breadth-stat"><div class="bs-l">Worst</div><div class="bs-v ' + signCls(worst ? worst.changePct : 0) + '">' +
      (worst ? worst.symbol + ' ' + fmtPct(worst.changePct) : '—') + '</div></div>' +
      '<div class="breadth-stat"><div class="bs-l">Unchanged</div><div class="bs-v">' + unc + '</div></div>' +
      '<div class="breadth-stat"><div class="bs-l">Universe</div><div class="bs-v">' + total + '</div></div>' +
      '</div>';
    const sub = $('#breadthSub');
    if (sub) sub.textContent = live ? 'NIFTY 50 constituents · ' + (m.source ? String(m.source).toUpperCase() : 'live') : 'Simulated breadth — proxy offline';
  }

  /* ---- watchlist detail ---- */
  const wt = $('#mktWatch');
  if (wt) {
    const syms = Array.from(state.watch).filter(s => liveMeta(s) || LIVE.quotes[s]);
    wt.innerHTML =
      '<thead><tr><th>Symbol</th><th>Name</th><th class="n">Last</th><th class="n">Chg%</th>' +
      '<th class="n">Mkt Cap</th><th class="n">Volume</th><th class="n">52W Range</th></tr></thead><tbody>' +
      (syms.length ? syms.map(s => {
        const q = LIVE.quotes[s], u = liveMeta(s);
        let price, chg;
        if (q && q.price != null) { price = q.price; chg = q.changePct; }
        else { try { const A = computeAnalysis(s); price = A.price; chg = A.chgPct; } catch (e) { price = 0; chg = 0; } }
        const co52 = LIVE.company[s] && LIVE.company[s].ratios || null;
        const hi52 = q && q.high52 != null ? q.high52 : (co52 && co52.high52 != null ? co52.high52 : (u ? price * 1.12 : null));
        const lo52 = q && q.low52 != null ? q.low52 : (co52 && co52.low52 != null ? co52.low52 : (u ? price * 0.86 : null));
        const pos = hi52 > lo52 ? clamp((price - lo52) / (hi52 - lo52) * 100, 0, 100) : 50;
        return '<tr data-sym="' + s + '">' +
          '<td class="mono"><b>' + s + '</b></td>' +
          '<td class="dim">' + esc((u && u.name) || s) + '</td>' +
          '<td class="n mono">' + fmtPrice(price) + '</td>' +
          '<td class="n mono ' + signCls(chg) + '">' + fmtPct(chg) + '</td>' +
          '<td class="n mono">' + (u ? fmtCap(u.mcap) : '—') + '</td>' +
          '<td class="n mono dim">' + (q && q.volume ? fmtBig(q.volume) : '—') + '</td>' +
          '<td class="n mono dim">' + (hi52 ? fmtPrice(lo52) + ' – ' + fmtPrice(hi52) : '—') + '</td>' +
          '</tr>';
      }).join('') : '<tr><td colspan="7" class="dim">Watchlist empty</td></tr>') + '</tbody>';
    $$('tbody tr[data-sym]', wt).forEach(tr => { tr.onclick = () => selectSymbol(tr.dataset.sym); });
  }

  /* ---- market news ---- */
  const nl = $('#mktNews');
  if (nl) {
    const items = LIVE.marketNews && LIVE.marketNews.length ? LIVE.marketNews : newsItems('NIFTY').slice(0, 8);
    const rows = items.slice(0, 9);
    /* quote refreshes re-run renderMarket every minute — only touch the feed when
       the headlines actually change, otherwise the stagger animation replays */
    const sig = rows.map(x => x.id || x.title).join('|');
    if (nl.dataset.sig !== sig) {
      nl.dataset.sig = sig;
      const lead = rows[0];
      const rest = rows.slice(1);
      nl.innerHTML =
        (lead
          ? '<article class="nlead">' + newsThumb(lead) +
              '<div class="nbody">' + newsMeta(lead, false) +
                '<div class="ntitle big">' + newsHead(lead) + '</div>' +
                (lead.sum ? '<div class="nsum">' + esc(lead.sum) + '</div>' : '') +
              '</div></article>'
          : '') +
        '<div class="ngrid">' + rest.map(x =>
          '<article class="ncard">' + newsThumb(x) +
            '<div class="nbody">' + newsMeta(x, false) +
              '<div class="ntitle">' + newsHead(x) + '</div>' +
            '</div></article>').join('') + '</div>';
      bindCardOpens(nl);
    }
  }

  /* ---- badges ---- */
  const badge = $('#mktSrc');
  if (badge) {
    badge.textContent = live ? 'Live · ' + String(m.source || 'NSE').toUpperCase() : 'Simulated';
    badge.classList.toggle('sim', !live);
  }
  const stamp = $('#mktStamp');
  if (stamp) stamp.textContent = live && m.fetchedAt
    ? 'Updated ' + new Date(m.fetchedAt).toLocaleTimeString('en-IN', { hour12: false, timeZone: 'Asia/Kolkata' }) + ' IST'
    : 'Offline — demo figures';
  const sub = $('#mktSub');
  if (sub) sub.textContent = live
    ? 'Indian equities · indices, sectoral indices and large-cap movers'
    : 'Indian equities · running on built-in sample data (start the BharatLens proxy for live quotes)';
  const mvSub = $('#moversSub');
  if (mvSub) mvSub.textContent = live ? 'Top movers across NSE large caps' : 'Simulated screen';
}

/* Loads the market snapshot plus the small histories its tables need. */
function loadMarket() {
  if (LIVE.loading.market) return LIVE.loading.market;
  const job = Promise.all([api.market(), api.news('NIFTY', 10)]).then(rs => {
    const m = rs[0], nw = rs[1];
    if (m) { LIVE.market = m; LIVE.marketTs = Date.now(); }
    if (nw) LIVE.marketNews = mapNews(nw);
    const warm = [];
    if (m && m.indices) m.indices.forEach(x => {
      const sym = idxSym(String(x.name || ''));
      if (sym) { warm.push(loadDaily(sym, '1M')); warm.push(loadDaily(sym, '3M')); }
    });
    return Promise.all(warm);
  }).then(() => {
    if (state.page === 'market') renderMarket();
    return LIVE.market;
  }).catch(() => null).finally(() => { delete LIVE.loading.market; });
  LIVE.loading.market = job;
  return job;
}

/* ================================================================ INIT ==== */
function init() {
  try {
    const saved = localStorage.getItem('sl-theme');
    if (saved) { state.theme = saved; document.documentElement.setAttribute('data-theme', saved); }
  } catch (e) {}
  try {
    const savedType = localStorage.getItem('sl-type');
    if (savedType) setType(savedType);
  } catch (e) {}

  bindChart();
  bindToolbar();
  bindSearch();
  bindMisc();
  bindNav();
  tickClock();
  setInterval(tickClock, 1000);

  setTF(state.tf);
  setView(pageFromHash() || 'market');
  redrawAll();

  loadMarket();
  loadWatchQuotes();
  loadSymbol(state.sym).then(() => {
    /* fundamentals/profile/quotes land async — repaint the visible page once ready */
    reanchorView();
    renderQuote();
    renderStats();
    if (state.page === 'market') return;
    renderPage(state.page);
    drawMain();
    renderRail();
  });
  if (state.page === 'market') loadMarket();

  /* keep the tape fresh without hammering the proxy */
  setInterval(loadWatchQuotes, 60000);
  setInterval(() => {
    if (state.page === 'market') { loadMarket(); return; }
    loadSymbol(state.sym).then(reanchorView);
  }, 180000);

  setTimeout(() => { drawMain(); renderRail(); }, 60);
  document.fonts && document.fonts.ready.then(() => { drawMain(); renderPage(state.page); renderRail(); });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
