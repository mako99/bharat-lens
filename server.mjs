#!/usr/bin/env node
/**
 * BharatLens data proxy + static host (Indian markets).
 *
 * Serves the site files and a small JSON API that aggregates live market data:
 *   - NSE India's public APIs : indices + sectorals, market status, top gainers/losers
 *   - screener.in             : key ratios, quarterly/annual P&L, balance sheet,
 *                               cash flows, quarterly shareholding pattern
 *   - Yahoo Finance           : OHLCV charts for NSE symbols (.NS), quotes (spark),
 *                               dividends, search/news
 *
 * Design notes
 *   - Zero dependencies, Node >= 18.
 *   - Every upstream call is paced, retried and cached (memory + disk). On failure we
 *     serve the last good copy ("stale-if-error") so the UI degrades instead of breaking.
 *   - Yahoo rate-limits the crumb endpoint hardest, so the crumb is fetched lazily and
 *     only renewed when Yahoo actually rejects a call.
 *   - If a source is unreachable the endpoint still answers, flagged with `source` and
 *     `degraded:true`, and the frontend falls back to its demo dataset.
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = process.env.BHARAT_CACHE || path.join(ROOT, ".cache");
const PORT = Number(process.env.PORT || 8790);
const HOST = process.env.HOST || "0.0.0.0";

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const JSON_HEADERS = {
  "User-Agent": UA,
  Accept: "application/json,text/plain,*/*",
  "Accept-Language": "en-US,en;q=0.9",
};

/**
 * Yahoo rejects a request that *claims* to be a browser while the TLS handshake
 * does not match one: a Chrome User-Agent gets 429'd even on a fresh IP, while the
 * same call with a generic `Mozilla/5.0` goes through. NSE and screener.in want the
 * opposite (a full browser UA), so the Yahoo header set is kept separate.
 */
const YH = {
  "User-Agent": "Mozilla/5.0",
  Accept: "application/json,text/plain,*/*",
  "Accept-Language": "en-US,en;q=0.9",
};
const isYahoo = (host) => host.includes("yahoo.com");

/* ------------------------------------------------------------------ cache */

const CV = 8; // bump when a cached payload changes shape
const mem = new Map(); // key -> { v, exp, staleExp }
fs.mkdirSync(CACHE_DIR, { recursive: true });

const readDisk = (key) => {
  const f = path.join(CACHE_DIR, key.replace(/[^a-zA-Z0-9._:-]/g, "_") + ".json");
  try {
    const st = fs.statSync(f);
    return { raw: fs.readFileSync(f, "utf8"), mtime: st.mtimeMs };
  } catch {
    return null;
  }
};
const writeDisk = (key, raw) => {
  const f = path.join(CACHE_DIR, key.replace(/[^a-zA-Z0-9._:-]/g, "_") + ".json");
  fs.writeFile(f, raw, () => {});
};

const ck = (key) => `v${CV}:${key}`;

function cacheGet(rawKey) {
  const key = ck(rawKey);
  const e = mem.get(key);
  if (e && e.exp > Date.now()) return { value: e.v, fresh: true };
  const d = readDisk(key);
  if (d) {
    try {
      const v = JSON.parse(d.raw);
      const ttl = e?.staleExp || Infinity;
      if (e ? d.mtime < ttl : true) {
        if (!e) mem.set(key, { v, exp: 0, staleExp: Infinity });
        return { value: v, fresh: !e || e.exp > Date.now() };
      }
    } catch {
      /* corrupted cache entry */
    }
  }
  if (e) return { value: e.v, fresh: false, stale: true }; // stale-if-error
  return null;
}

function cacheSet(rawKey, value, ttlMs, staleMs = ttlMs * 6) {
  const key = ck(rawKey);
  const now = Date.now();
  mem.set(key, { v: value, exp: now + ttlMs, staleExp: now + ttlMs + staleMs });
  try {
    writeDisk(key, JSON.stringify(value));
  } catch {
    /* disk optional */
  }
}

/* ------------------------------------------------------- pacing + upstream */

const gates = new Map(); // host -> { next, coolUntil, minGap }

function gate(host) {
  if (!gates.has(host)) {
    const yahoo = host.includes("yahoo");
    // Yahoo hands out a small, bursty per-IP budget, so the gap is deliberately
    // wide and a 429 buys a long cool-down instead of an immediate retry.
    gates.set(host, { next: 0, coolUntil: 0, minGap: yahoo ? 900 : 80 });
  }
  return gates.get(host);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Waits for a slot on `host`. Throws `busy` instead of queueing indefinitely when the
 * required wait is longer than `maxWait` — callers can then fail over to another host
 * (or to cache) rather than leaving the browser hanging.
 */
async function acquire(host, maxWait = 6000) {
  const g = gate(host);
  for (let i = 0; i < 200; i++) {
    const now = Date.now();
    // Only ever move `g.next` forward when we actually win the slot, otherwise the
    // deadline recedes as fast as we approach it and the wait never terminates.
    const start = Math.max(g.next, g.coolUntil);
    if (start <= now) {
      g.next = now + g.minGap;
      return;
    }
    if (start - now > maxWait) {
      throw Object.assign(new Error(`host ${host} cooling down`), { code: 429, busy: true });
    }
    await wait(Math.min(start - now, 1000));
  }
  throw Object.assign(new Error("upstream gate timeout"), { code: 503 });
}

function penalize(host, ms) {
  const g = gate(host);
  g.coolUntil = Math.max(g.coolUntil, Date.now() + ms);
}

const stats = { requests: 0, hits: 0, upstream: 0, rateLimited: 0, errors: 0, stale: 0 };

async function jget(url, { host, retries = 1, headers = {}, maxWait = 6000 } = {}) {
  const h = host || new URL(url).host;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await acquire(h, maxWait);
    stats.upstream++;
    try {
      const res = await fetch(url, {
        headers: { ...JSON_HEADERS, ...headers },
        redirect: "follow",
        signal: AbortSignal.timeout(20000),
      });

      if (res.status === 429) {
        stats.rateLimited++;
        const ra = Number(res.headers.get("retry-after")) || 0;
        penalize(h, Math.max(ra * 1000, 45000));
        throw Object.assign(new Error("upstream rate limited"), { code: 429, fatal: true });
      }
      if (res.status >= 500) {
        penalize(h, 5000);
        throw Object.assign(new Error(`upstream ${res.status}`), { code: res.status, retryable: true });
      }

      const text = await res.text();
      if (!res.ok) {
        throw Object.assign(new Error(`HTTP ${res.status}`), { code: res.status, body: text.slice(0, 200) });
      }
      try {
        return JSON.parse(text);
      } catch {
        throw Object.assign(new Error("invalid JSON from upstream"), { code: 502, retryable: true });
      }
    } catch (e) {
      lastErr = e;
      // Retrying a 429 on the same host only burns more of the (already exhausted)
      // budget: fail over or serve cache instead.
      if (e.fatal || e.busy) break;
      if (e.code === 401) break;
      if (e.retryable && attempt < retries) {
        await wait(350 * (attempt + 1));
        continue;
      }
      break;
    }
  }
  stats.errors++;
  throw lastErr || new Error("upstream failed");
}

/**
 * Yahoo throttles per-host rather than per-IP: when query1 starts 429ing, query2 often
 * still answers. Every Yahoo call therefore alternates hosts (each has its own pacing
 * gate), skips a host that is already known to be cooling, and only gives up once both
 * refuse — at which point the caller falls back to its cache.
 */
async function yget(path, opts = {}) {
  const first = Math.random() < 0.5 ? "query1" : "query2";
  const order = [first, first === "query1" ? "query2" : "query1"];
  const h = { ...YH, ...(opts.headers || {}) };
  let lastErr;
  for (const host of order) {
    try {
      return await jget(`https://${host}.finance.yahoo.com${path}`, {
        ...opts,
        headers: h,
        host: `${host}.finance.yahoo.com`,
        retries: opts.retries ?? 1,
      });
    } catch (e) {
      lastErr = e;
      if (e.code !== 429) break;
    }
  }
  throw lastErr || new Error("yahoo failed");
}

/** Plain-text GET with the same pacing/caching discipline as `jget`. */
async function tget(url, { host, ttl = 300_000, cacheKey } = {}) {
  const h = host || new URL(url).host;
  if (cacheKey) {
    const hit = cacheGet(cacheKey);
    if (hit?.fresh) {
      stats.hits++;
      return hit.value;
    }
  }
  try {
    await acquire(h, 6000);
    stats.upstream++;
    const res = await fetch(url, {
      headers: {
        "User-Agent": isYahoo(h) ? YH["User-Agent"] : UA,
        Accept: "application/rss+xml,application/xml,text/xml,*/*",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 429) {
      stats.rateLimited++;
      penalize(h, 45000);
      throw Object.assign(new Error("rate limited"), { code: 429 });
    }
    const text = await res.text();
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { code: res.status });
    if (cacheKey) cacheSet(cacheKey, text, ttl);
    return text;
  } catch (e) {
    if (cacheKey) {
      const hit = cacheGet(cacheKey);
      if (hit) return hit.value;
    }
    stats.errors++;
    throw e;
  }
}

const decodeXml = (v) =>
  String(v || "")
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .trim();

function parseRssItems(xml, limit) {
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml)) && items.length < limit) {
    const blk = m[1];
    const tag = (name) => {
      const t = new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\/${name}>`).exec(blk);
      return t ? decodeXml(t[1].replace(/<[^>]+>/g, "")) : "";
    };
    const title = tag("title");
    if (!title) continue;
    const link = tag("link");
    const pub = tag("pubDate");
    const srcMatch = /<source[^>]*>([\s\S]*?)<\/source>/.exec(blk);
    const t = pub ? Date.parse(pub) : null;
    items.push({
      id: tag("guid") || link || title,
      title,
      publisher: srcMatch ? decodeXml(srcMatch[1]) : linkHost(link),
      link,
      time: Number.isFinite(t) ? t : null,
      type: "STORY",
      related: [],
      thumbnail: null,
    });
  }
  return items;
}

const linkHost = (link) => {
  try {
    const h = new URL(link).hostname.replace(/^www\./, "");
    return h.includes("yahoo") ? "Yahoo Finance" : h;
  } catch {
    return "Yahoo Finance";
  }
};

/* -------------------------------------------------------------- yahoo core */

const RANGES = {
  "1D": { range: "1d", interval: "5m", axis: "time" },
  "5D": { range: "5d", interval: "15m", axis: "time" },
  "1M": { range: "1mo", interval: "1d", axis: "date" },
  "3M": { range: "3mo", interval: "1d", axis: "date" },
  "6M": { range: "6mo", interval: "1d", axis: "date" },
  YTD: { range: "ytd", interval: "1d", axis: "date" },
  "1Y": { range: "1y", interval: "1d", axis: "date" },
  "5Y": { range: "5y", interval: "1d", axis: "date" },
  /* MAX must stay daily: the client's windows count *bars* (6M = 126 bars), so
     monthly bars would stretch a 6-month request into a decade. Yahoo downsamples
     `range=max&interval=1d` to 1mo anyway, so MAX is expressed as explicit epochs. */
  MAX: { range: "max", interval: "1d", axis: "date", epoch: true },
  "2Y": { range: "2y", interval: "1d", axis: "date" }, // internal: MA50/MA200 warm-up
};

/** Ranges Nasdaq's ~9-month daily feed can satisfy on its own. */
const NASDAQ_RANGES = new Set(["1M", "3M", "6M", "YTD"]);
const TRIM_DAYS = { "1M": 31, "3M": 92, "6M": 184, "1Y": 366 };

function trimToRange(bars, rangeKey) {
  if (!bars?.length) return bars || [];
  if (rangeKey === "YTD") {
    const start = Date.UTC(new Date().getFullYear(), 0, 1);
    const kept = bars.filter((b) => b.t >= start);
    return kept.length > 10 ? kept : bars;
  }
  const days = TRIM_DAYS[rangeKey];
  if (!days) return bars;
  const cutoff = Date.now() - days * 86400_000;
  const kept = bars.filter((b) => b.t >= cutoff);
  return kept.length > 5 ? kept : bars;
}

async function yahooChart(symbol, rangeKey) {
  const cfg = RANGES[rangeKey] || RANGES["1M"];
  const key = `chart:${symbol}:${cfg.range}:${cfg.interval}${cfg.epoch ? ":ep" : ""}`;
  const hit = cacheGet(key);
  const ttl = cfg.axis === "time" ? 45_000 : 6 * 3600_000;
  if (hit?.fresh) {
    stats.hits++;
    return hit.value;
  }
  try {
    const span = cfg.epoch
      ? `period1=0&period2=${Math.floor(Date.now() / 1000)}&interval=${cfg.interval}`
      : `range=${cfg.range}&interval=${cfg.interval}`;
    const path =
      `/v8/finance/chart/${encodeURIComponent(symbol)}` +
      `?${span}&includePrePost=${cfg.axis === "time"}` +
      `&events=div%2Csplit`;
    const raw = await yget(path, { retries: 2 });
    const r = raw?.chart?.result?.[0];
    if (!r) throw new Error(raw?.chart?.error?.description || "empty chart");
    const m = r.meta || {};
    const ts = r.timestamp || [];
    const q = r.indicators?.quote?.[0] || {};
    const bars = [];
    for (let i = 0; i < ts.length; i++) {
      const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i];
      if (c == null) continue;
      bars.push({ t: ts[i] * 1000, o: o ?? c, h: h ?? c, l: l ?? c, c, v: q.volume?.[i] || 0 });
    }
    const prev = m.chartPreviousClose ?? m.previousClose;
    const out = {
      source: "yahoo",
      symbol: m.symbol || symbol,
      name: m.longName || m.shortName || symbol,
      currency: m.currency || "USD",
      exchange: m.fullExchangeName || m.exchangeName || "",
      type: m.instrumentType || "EQUITY",
      granularity: cfg.interval,
      axis: cfg.axis,
      range: rangeKey,
      bars,
      prevClose: prev,
      price: m.regularMarketPrice ?? bars.at(-1)?.c ?? null,
      change: m.fulldayChange ?? (prev != null && m.regularMarketPrice != null ? m.regularMarketPrice - prev : null),
      changePct:
        m.fulldayChangePercent ??
        (prev && m.regularMarketPrice != null ? ((m.regularMarketPrice - prev) / prev) * 100 : null),
      dayHigh: m.regularMarketDayHigh ?? null,
      dayLow: m.regularMarketDayLow ?? null,
      open: bars.find((b) => b.o != null)?.o ?? m.regularMarketOpen ?? null,
      volume: m.regularMarketVolume ?? null,
      high52: m.fiftyTwoWeekHigh ?? null,
      low52: m.fiftyTwoWeekLow ?? null,
      marketTime: m.regularMarketTime ? m.regularMarketTime * 1000 : null,
      timezone: m.exchangeTimezoneName || "America/New_York",
      session: m.currentTradingPeriod || null,
      events: r.events || null,
    };
    cacheSet(key, out, ttl, 3 * 86400_000);
    return out;
  } catch (e) {
    if (hit) return { ...hit.value, stale: true };
    throw e;
  }
}

/**
 * Quotes come from Yahoo's `spark` endpoint, which caps a batch at 20 symbols and
 * answers 404 when a whole batch resolves to nothing. The request is therefore
 * chunked, and each chunk is allowed to fail on its own so one bad symbol (or one
 * refused batch) never blanks the panel. Symbols are accepted in display form
 * (RELIANCE) and echoed back in that same form so callers can match on what they
 * asked for.
 */
const SPARK_BATCH = 20;

async function yahooQuotes(symbols) {
  const want = symbols.map(String);
  const ys = want.map(ySym);
  const key = "spark:" + want.join(",");
  const hit = cacheGet(key);
  if (hit?.fresh && Date.now() - (hit.value?.fetchedAt || 0) < 40_000) {
    stats.hits++;
    return hit.value;
  }
  const label = new Map();
  ys.forEach((y, i) => { if (!label.has(y)) label.set(y, want[i]); });

  try {
    const chunks = [];
    for (let i = 0; i < ys.length; i += SPARK_BATCH) chunks.push(ys.slice(i, i + SPARK_BATCH));
    const settled = await Promise.all(
      chunks.map((c) =>
        yget(
          "/v7/finance/spark?symbols=" + encodeURIComponent(c.join(",")) + "&range=1d&interval=5m",
          { retries: 2 }
        ).catch(() => null)
      )
    );
    const list = settled.filter(Boolean).flatMap((raw) => raw?.spark?.result || []);
    if (!list.length) throw new Error("no quotes from yahoo");

    const quotes = list.map((item) => {
      const resp = Array.isArray(item.response) ? item.response : [item.response];
      const m = resp?.[0]?.meta || {};
      const ysym = m.symbol || item.symbol;
      return {
        symbol: label.get(ysym) || dSym(ysym),
        name: m.longName || m.shortName || item.symbol,
        price: m.regularMarketPrice ?? null,
        change: m.fulldayChange ?? null,
        changePct: m.fulldayChangePercent ?? m.regularMarketChangePercent ?? null,
        prevClose: m.previousClose ?? m.chartPreviousClose ?? null,
        open: m.regularMarketOpen ?? null,
        high: m.regularMarketDayHigh ?? null,
        low: m.regularMarketDayLow ?? null,
        volume: m.regularMarketVolume ?? null,
        currency: m.currency || "USD",
        exchange: m.fullExchangeName || m.exchangeName || "",
        type: m.instrumentType || "EQUITY",
        marketTime: m.regularMarketTime ? m.regularMarketTime * 1000 : null,
        high52: m.fiftyTwoWeekHigh ?? null,
        low52: m.fiftyTwoWeekLow ?? null,
      };
    });
    const out = { source: "yahoo", fetchedAt: Date.now(), quotes };
    cacheSet(key, out, 40_000, 86400_000);
    return out;
  } catch (e) {
    if (hit) return { ...hit.value, stale: true };
    throw e;
  }
}

async function pool(items, limit, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (i < items.length) {
      const k = i++;
      await fn(items[k], k);
    }
  });
  await Promise.all(workers);
}

function bad(msg) {
  const e = new Error(msg);
  e.status = 400;
  return e;
}

/**
 * Symbol lookup when Yahoo search is unavailable: the bulk screener carries name and
 * symbol for every listed US equity, so autocomplete keeps working offline.
 */
function shapeNews(list) {
  return list
    .filter((n) => n?.title)
    .map((n) => ({
      id: n.uuid || n.link,
      title: n.title,
      publisher: n.publisher,
      link: n.link,
      time: n.providerPublishTime ? n.providerPublishTime * 1000 : null,
      type: n.type || null,
      related: (n.relatedTickers || []).filter((t, i, a) => a.indexOf(t) === i).slice(0, 6),
      thumbnail: n.thumbnail?.resolutions?.[0]?.url || null,
    }));
}


/* ============================================================ India feeds == */

/* Display symbols (NIFTY/RELIANCE) <-> Yahoo symbols (^NSEI/RELIANCE.NS). */
const YMAP = {
  NIFTY: "^NSEI",
  SENSEX: "^BSESN",
  BANKNIFTY: "^NSEBANK",
  // Tata Motors' 2026 demerger retired TATAMOTORS on Yahoo; the passenger-vehicle
  // entity it became trades as TMPV.NS. Keep the old ticker resolving so the
  // watchlist and the movers feed do not lose the row.
  TATAMOTORS: "TMPV.NS",
};
const DMAP = { "^NSEI": "NIFTY", "^BSESN": "SENSEX", "^NSEBANK": "BANKNIFTY" };
const ySym = (s) => YMAP[s] || (/^[^A-Z]|\.(NS|BO)$/.test(s) ? s : s + ".NS");
const dSym = (ys) => DMAP[ys] || String(ys || "").replace(/\.NS$/, "");

/* NSE's public JSON APIs: cookie-gated at the edge, but they answer when the
 * request looks like a browser session (UA + Referer). Cached aggressively. */
const NSE_HOST = "www.nseindia.com";
const NSE_HEADERS = { Referer: "https://www.nseindia.com/", Accept: "application/json,text/plain,*/*" };

async function nseGet(apiPath, key, ttl) {
  const hit = cacheGet(key);
  if (hit?.fresh) {
    stats.hits++;
    return hit.value;
  }
  try {
    const out = await jget(`https://${NSE_HOST}${apiPath}`, { host: NSE_HOST, retries: 1, headers: NSE_HEADERS });
    cacheSet(key, out, ttl, ttl * 6);
    return out;
  } catch (e) {
    if (hit) return { ...hit.value, stale: true };
    throw e;
  }
}

/** Plain HTML GET with the same pacing/caching discipline as `jget` (screener.in). */
async function hget(url, key, ttl) {
  const hit = cacheGet(key);
  if (hit?.fresh) {
    stats.hits++;
    return hit.value;
  }
  const host = new URL(url).host;
  try {
    await acquire(host, 6000);
    stats.upstream++;
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,*/*",
        "Accept-Language": "en-IN,en;q=0.9",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
    });
    if (res.status === 429) {
      stats.rateLimited++;
      penalize(host, 45_000);
      throw Object.assign(new Error("rate limited"), { code: 429 });
    }
    const text = await res.text();
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { code: res.status, body: text.slice(0, 160) });
    cacheSet(key, text, ttl, ttl * 6);
    return text;
  } catch (e) {
    stats.errors++;
    if (hit) return hit.value;
    throw e;
  }
}

/* ------------------------------------------------------------ screener.in */
/*
 * screener.in is the one keyless Indian source that carries the full picture:
 * key ratios, the quarterly + annual P&L, balance sheet, cash flows and the
 * quarterly shareholding pattern (Promoters/FIIs/DIIs). All values are in ₹ Cr.
 */

const txt = (s) =>
  String(s || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;|&#34;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function tablesOf(html) {
  const out = [];
  for (const t of html.match(/<table[\s\S]*?<\/table>/g) || []) {
    const rows = [];
    for (const tr of t.match(/<tr[\s\S]*?<\/tr>/g) || []) {
      const cs = (tr.match(/<t[dh][\s\S]*?<\/t[dh]>/g) || []).map((c) => txt(c));
      if (cs.some((c) => c)) rows.push(cs);
    }
    if (rows.length > 1) out.push(rows);
  }
  return out;
}

const MON = "Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec";
const isMonYr = (s) => new RegExp(`^(?:${MON}) \\d{4}$`).test(String(s || ""));
const isMarYr = (s) => /^Mar \d{4}$/.test(String(s || ""));
const hasRow = (rows, label) => rows.some((r) => String(r[0] || "").startsWith(label));
const rowBy = (rows, label) => rows.find((r) => String(r[0] || "").startsWith(label));

function numCell(v) {
  if (v == null) return null;
  const s = String(v).replace(/[₹$,%\s]/g, "").replace(/^\((.*)\)$/, "-$1");
  if (!s || s === "-" || /n\.?a\.?$/i.test(s)) return null;
  const n = parseFloat(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Table -> { periods, rows }, newest period first (screener lists oldest first). */
function shapeStmt(rows) {
  const head = rows[0] || [];
  const keep = [];
  head.slice(1).forEach((p, i) => {
    if (p) keep.push(i);
  });
  const body = rows
    .slice(1)
    .map((r) => ({
      label: String(r[0] || "").replace(/\s*\+$/, ""),
      values: keep.map((i) => numCell(r[i + 1])),
    }))
    .filter((r) => r.label && !/^Raw PDF$/i.test(r.label) && r.values.some((v) => v != null));
  const periods = keep.map((i) => head[i + 1]);
  periods.reverse();
  body.forEach((r) => r.values.reverse());
  return { periods, rows: body };
}

const SHARE_KEYS = { promoters: "promoters", fiis: "fiis", diis: "diis", government: "government", public: "public" };

function shapeShareholding(rows) {
  const head = rows[0] || [];
  const keep = [];
  head.slice(1).forEach((p, i) => {
    if (p) keep.push(i);
  });
  const out = [];
  for (const r of rows.slice(1)) {
    const base = String(r[0] || "").replace(/\s*\+$/, "").toLowerCase();
    const key = Object.keys(SHARE_KEYS).find((k) => base.startsWith(k === "public" ? "public" : k.replace(/s$/, "")));
    if (!key) continue;
    out.push({
      key: SHARE_KEYS[key],
      label: String(r[0] || "").replace(/\s*\+$/, ""),
      values: keep.map((i) => numCell(r[i + 1])),
    });
  }
  const quarters = keep.map((i) => head[i + 1]);
  quarters.reverse();
  out.forEach((r) => r.values.reverse());
  return { quarters, rows: out };
}

function parseScreener(html) {
  const out = {
    name: null,
    ratios: {},
    quarterly: null,
    annual: null,
    balance: null,
    cashflow: null,
    ratiosTable: null,
    shareholding: null,
  };
  const tm = /<title>([\s\S]*?)<\/title>/.exec(html);
  if (tm) out.name = txt(tm[1]).replace(/\s*share price.*$/i, "").replace(/\s*stock price.*$/i, "");

  const ul = /id="top-ratios"[^>]*>([\s\S]*?)<\/ul>/.exec(html);
  if (ul) {
    const R = out.ratios;
    for (const li of ul[1].match(/<li[\s\S]*?<\/li>/g) || []) {
      const parts = li
        .replace(/<[^>]*>/g, "|")
        .replace(/&amp;/g, "&")
        .replace(/&nbsp;/g, " ")
        .split("|")
        .map((s) => s.replace(/\s+/g, " ").trim())
        .filter(Boolean);
      const nums = parts.slice(1).map(numCell).filter((v) => v != null);
      switch (parts[0]) {
        case "Market Cap":
          if (nums[0] != null) R.mcapCr = nums[0]; // screener reports ₹ Cr
          break;
        case "Current Price":
          if (nums[0] != null) R.price = nums[0];
          break;
        case "High / Low":
          R.high52 = nums[0] ?? null;
          R.low52 = nums[1] ?? null;
          break;
        case "Stock P/E":
          if (nums[0] != null) R.pe = nums[0];
          break;
        case "Book Value":
          if (nums[0] != null) R.bookValue = nums[0];
          break;
        case "Dividend Yield":
          if (nums[0] != null) R.divYield = nums[0];
          break;
        case "ROCE":
          if (nums[0] != null) R.roce = nums[0];
          break;
        case "ROE":
          if (nums[0] != null) R.roe = nums[0];
          break;
        case "Face Value":
          if (nums[0] != null) R.faceValue = nums[0];
          break;
        case "Debt / Equity":
          if (nums[0] != null) R.de = nums[0];
          break;
        default:
          break;
      }
    }
  }

  let quarterly = null;
  let annual = null;
  for (const rows of tablesOf(html)) {
    const head = rows[0] || [];
    const labels = head.slice(1).filter(Boolean);
    if (labels.length < 4 || !hasRow(rows, "EPS in Rs")) continue;
    const nonMar = labels.filter((l) => isMonYr(l) && !isMarYr(l)).length;
    if (nonMar > labels.length / 2) {
      if (!quarterly) quarterly = rows;
    } else if (!annual) annual = rows;
  }
  const T = tablesOf(html);
  const bs = T.find((r) => hasRow(r, "Equity Capital") && hasRow(r, "Reserves"));
  const cf = T.find((r) => hasRow(r, "Cash from Operating Activity"));
  const rt = T.find((r) => hasRow(r, "Debtor Days") && hasRow(r, "ROCE"));
  const sh = T.find((r) => hasRow(r, "Promoters") && hasRow(r, "FIIs"));

  out.quarterly = quarterly ? shapeStmt(quarterly) : null;
  out.annual = annual ? shapeStmt(annual) : null;
  out.balance = bs ? shapeStmt(bs) : null;
  out.cashflow = cf ? shapeStmt(cf) : null;
  out.ratiosTable = rt ? shapeStmt(rt) : null;
  out.shareholding = sh ? shapeShareholding(sh) : null;
  return out;
}

/** Slugs match NSE symbols for our universe (RELIANCE, TCS, HDFCBANK, ...). */
function screenerSlug(symbol) {
  return String(symbol || "")
    .replace(/\.NS$/, "")
    .replace(/[^A-Za-z0-9&-]/g, "");
}

async function screenerData(symbol) {
  const slug = screenerSlug(symbol);
  if (!slug) throw bad("symbol required");
  const key = `scr:${slug.toUpperCase()}`;
  const hit = cacheGet(key);
  if (hit?.fresh) {
    stats.hits++;
    return hit.value;
  }
  const html = await hget(`https://www.screener.in/company/${encodeURIComponent(slug)}/consolidated/`, `scrh:${slug}`, 12 * 3600_000);
  if (typeof html !== "string" || html.length < 5000) throw new Error("screener page unavailable");
  const parsed = parseScreener(html);
  if (!parsed.ratios || Object.keys(parsed.ratios).length < 4) throw new Error("screener parse failed");
  cacheSet(key, parsed, 6 * 3600_000, 24 * 3600_000);
  return parsed;
}

/* ------------------------------------------------------------- market day */

function deriveState(message) {
  const m = String(message || "").toLowerCase();
  if (m.includes("pre")) return "preopen";
  if (m.includes("open")) return "open";
  if (m.includes("close") || m.includes("closed")) return "closed";
  return "unknown";
}

const NSE_SECTOR_INDEX = [
  "NIFTY BANK",
  "NIFTY IT",
  "NIFTY FMCG",
  "NIFTY PHARMA",
  "NIFTY AUTO",
  "NIFTY METAL",
  "NIFTY REALTY",
  "NIFTY ENERGY",
  "NIFTY FINANCIAL SERVICES",
  "NIFTY MEDIA",
  "NIFTY PSU BANK",
  "NIFTY PRIVATE BANK",
  "NIFTY MIDCAP 100",
  "NIFTY SMALLCAP 100",
  "NIFTY NEXT 50",
];

function mapMovers(raw) {
  const data = Array.isArray(raw?.NIFTY?.data)
    ? raw.NIFTY.data
    : Array.isArray(raw?.data)
      ? raw.data
      : [];
  return data.map((r) => ({
    symbol: dSym(r.symbol),
    name: r.symbol || null,
    price: numCell(r.ltp),
    prevClose: numCell(r.prev_price),
    change: numCell(r.ltp) != null && numCell(r.prev_price) != null ? numCell(r.ltp) - numCell(r.prev_price) : null,
    changePct: numCell(r.net_price),
    volume: numCell(r.trade_quantity),
    high: numCell(r.high_price),
    low: numCell(r.low_price),
    open: numCell(r.open_price),
  }));
}

/* -------------------------------------------------------------- API router */

const API = {
  async "/api/health"() {
    return { ok: true, uptimeSec: Math.round(process.uptime()), cache: { mem: mem.size }, stats, cooling: [...gates].map(([host, g]) => ({ host, coolUntil: g.coolUntil })).filter((x) => x.coolUntil > Date.now()), time: new Date().toISOString() };
  },

  async "/api/quotes"(q) {
    const symbols = (q.get("symbols") || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean).slice(0, 30);
    if (!symbols.length) throw bad("symbols required");
    const out = await yahooQuotes(symbols);
    return { ...out, quotes: out.quotes.map((qt) => ({ ...qt, symbol: dSym(qt.symbol) })) };
  },

  async "/api/chart"(q) {
    const symbol = (q.get("symbol") || "").trim().toUpperCase();
    if (!symbol) throw bad("symbol required");
    const out = await yahooChart(ySym(symbol), (q.get("range") || "1M").toUpperCase());
    return { ...out, symbol, name: symbol };
  },

  async "/api/company"(q) {
    const symbol = (q.get("symbol") || "").trim().toUpperCase();
    if (!symbol) throw bad("symbol required");
    const s = await screenerData(symbol);
    return { source: "screener", symbol, name: s.name, ratios: s.ratios || {} };
  },

  async "/api/financials"(q) {
    const symbol = (q.get("symbol") || "").trim().toUpperCase();
    if (!symbol) throw bad("symbol required");
    const freq = q.get("freq") === "quarterly" ? "quarterly" : "annual";
    const s = await screenerData(symbol);
    const income = freq === "quarterly" ? s.quarterly : s.annual;
    if (!income) throw new Error("no " + freq + " statements for " + symbol);
    const statements = [{ group: "Income statement", periods: income.periods, rows: income.rows }];
    if (freq === "annual") {
      if (s.balance?.rows?.length) statements.push({ group: "Balance sheet", periods: s.balance.periods, rows: s.balance.rows });
      if (s.cashflow?.rows?.length) statements.push({ group: "Cash flow", periods: s.cashflow.periods, rows: s.cashflow.rows });
    }
    const periodLabels = income.periods.map((p) => fmtInPeriod(p, freq));
    return {
      source: "screener",
      symbol,
      freq,
      periods: income.periods,
      periodLabels,
      statements,
      ratios: s.ratiosTable ? { periods: s.ratiosTable.periods.map((p) => fmtInPeriod(p, "annual")), rows: s.ratiosTable.rows } : null,
      availableTypes: [],
    };
  },

  async "/api/shareholding"(q) {
    const symbol = (q.get("symbol") || "").trim().toUpperCase();
    if (!symbol) throw bad("symbol required");
    const s = await screenerData(symbol);
    if (!s.shareholding?.rows?.length) throw new Error("no shareholding pattern for " + symbol);
    return { source: "screener", symbol, ...s.shareholding };
  },

  async "/api/dividends"(q) {
    const symbol = (q.get("symbol") || "").trim().toUpperCase();
    if (!symbol) throw bad("symbol required");
    const ch = await yahooChart(ySym(symbol), "5Y");
    const ev = ch.events && ch.events.dividends ? ch.events.dividends : {};
    const rows = Object.values(ev)
      .map((d) => ({ date: d.date * 1000, amount: d.amount }))
      .sort((a, b) => b.date - a.date);
    const since = Date.now() - 365 * 86400_000;
    const lastYear = rows.filter((r) => r.date >= since).reduce((a, r) => a + (r.amount || 0), 0);
    const yieldPct = ch.price && lastYear > 0 ? (lastYear / ch.price) * 100 : null;
    let frequency = null;
    if (rows.length >= 3) {
      const gaps = [];
      for (let i = 0; i < rows.length - 1; i++) gaps.push((rows[i].date - rows[i + 1].date) / 86400_000);
      gaps.sort((a, b) => a - b);
      const med = gaps[Math.floor(gaps.length / 2)];
      frequency = med < 100 ? "Quarterly" : med < 220 ? "Semi-annual" : med < 400 ? "Annual" : "Irregular";
    }
    return {
      source: "yahoo",
      symbol,
      rows: rows.slice(0, 40),
      summary: { yield: yieldPct, payoutRatio: null, frequency, trailing12m: lastYear || null },
    };
  },

  async "/api/search"(q) {
    const term = (q.get("q") || "").trim();
    if (!term) return { quotes: [], news: [] };
    const key = "search:" + term.toLowerCase();
    const hit = cacheGet(key);
    if (hit?.fresh) return hit.value;
    try {
      const raw = await yget(
        `/v1/finance/search?q=${encodeURIComponent(term)}&quotesCount=10&newsCount=6&enableFuzzyQuery=false`,
        { retries: 0 }
      );
      const out = {
        source: "yahoo",
        quotes: (raw.quotes || [])
          .map((s) => ({
            symbol: dSym(s.symbol),
            name: s.shortname || s.longname || s.symbol,
            exchange: s.exchDisp || s.exchange || null,
            type: s.quoteType || null,
            sector: s.sectorDisp || null,
          }))
          .filter((s) => s.type === "EQUITY" || s.type === "INDEX" || s.type === "ETF"),
        news: shapeNews(raw.news || []),
      };
      cacheSet(key, out, 600_000);
      return out;
    } catch (e) {
      const local = fallbackSearch(term);
      if (local.quotes.length) return { source: "local", ...local };
      if (hit) return hit.value;
      throw e;
    }
  },

  async "/api/news"(q) {
    const symbol = (q.get("symbol") || "").trim().toUpperCase();
    const query = (q.get("q") || "").trim() || symbol || "";
    const limit = Math.min(Number(q.get("limit")) || 12, 30);
    if (!query) return { news: [] };
    const key = `news:${query}:${limit}`;
    const hit = cacheGet(key);
    if (hit?.fresh) {
      stats.hits++;
      return hit.value;
    }
    const cache = (out) => {
      cacheSet(key, out, 900_000);
      return out;
    };
    try {
      const raw = await yget(
        `/v1/finance/search?q=${encodeURIComponent(query)}&newsCount=${limit + 6}&quotesCount=1`,
        { retries: 0 }
      );
      const news = shapeNews(raw.news || []).slice(0, limit);
      if (news.length) return cache({ source: "yahoo-search", news });
    } catch {
      /* fall through to the RSS feeds, which are not crumb-gated */
    }
    try {
      const xml = await tget(
        `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(query + ".NS")}&region=IN&lang=en-IN`,
        { ttl: 900_000, cacheKey: `rss:${query}` }
      );
      const news = parseRssItems(xml, limit).filter((n) => n.link);
      if (news.length) return cache({ source: "yahoo-rss", news });
    } catch {
      /* rss unavailable */
    }
    try {
      const xml = await tget(
        `https://news.google.com/rss/search?q=${encodeURIComponent(query + " stock market India")}&hl=en-IN&gl=IN&ceid=IN:en`,
        { ttl: 900_000, cacheKey: `gn:${query}` }
      );
      const news = parseRssItems(xml, limit);
      if (news.length) return cache({ source: "google-news", news });
    } catch {
      /* give up */
    }
    if (hit) return hit.value;
    throw new Error("no news source available");
  },

  async "/api/market"() {
    const key = "market:in";
    const hit = cacheGet(key);
    if (hit?.fresh && Date.now() - (hit.value?.fetchedAt || 0) < 45_000) {
      stats.hits++;
      return hit.value;
    }
    try {
      const [idx, st, gain, sensexQ, moversQ] = await Promise.all([
        nseGet("/api/allIndices", "nse:idx", 300_000),
        nseGet("/api/marketStatus", "nse:status", 45_000),
        nseGet("/api/live-analysis-variations?index=gainers", "nse:gainers", 45_000),
        yahooQuotes(["SENSEX"]).catch(() => null),
        yahooQuotes(MOVER_LIST).catch(() => null),
      ]);
      const all = Array.isArray(idx?.data) ? idx.data : [];
      const byName = (n) => all.find((x) => x.index === n);
      const mapIdx = (x) =>
        x
          ? {
              name: x.index,
              value: numCell(x.last),
              change: numCell(x.variation),
              changePct: numCell(x.percentChange),
              open: numCell(x.open),
              high: numCell(x.high),
              low: numCell(x.low),
              pe: numCell(x.pe),
              advances: numCell(x.advances),
              declines: numCell(x.declines),
              yearHigh: numCell(x.yearHigh),
              yearLow: numCell(x.yearLow),
            }
          : null;
      const indices = [];
      const nifty50 = mapIdx(byName("NIFTY 50"));
      if (nifty50) indices.push(nifty50);
      const sx = sensexQ?.quotes?.[0];
      if (sx && sx.price != null) {
        indices.push({
          name: "SENSEX",
          value: sx.price,
          change: sx.change,
          changePct: sx.changePct,
          pe: null,
          advances: null,
          declines: null,
        });
      }
      for (const n of NSE_SECTOR_INDEX) {
        const m = mapIdx(byName(n));
        if (m) indices.push(m);
      }
      const cap = (st?.marketState || []).find((m) => m.market === "Capital Market") || (st?.marketState || [])[0];
      const out = {
        source: "nse",
        fetchedAt: Date.now(),
        status: cap
          ? { state: deriveState(cap.marketStatusMessage || cap.marketStatus), message: cap.marketStatusMessage || cap.marketStatus, tradeDate: cap.tradeDate || null, last: numCell(cap.last), changePct: numCell(cap.percentChange) }
          : { state: "unknown", message: null },
        indices,
        breadth: nifty50 && nifty50.advances != null
          ? { adv: nifty50.advances, dec: nifty50.declines, unch: Math.max(0, 50 - nifty50.advances - nifty50.declines), total: 50 }
          : null,
        gainers: mapMovers(gain),
        // NSE no longer answers index=losers, so decliners come from the live
        // quotes of the liquid large-cap set (Yahoo spark, one batched call).
        losers: (moversQ?.quotes || [])
          .filter((qt) => qt.price != null && qt.changePct != null)
          .map((qt) => ({
            symbol: qt.symbol,
            name: qt.name,
            price: qt.price,
            prevClose: qt.prevClose,
            change: qt.change,
            changePct: qt.changePct,
            volume: qt.volume,
            high: qt.high,
            low: qt.low,
            open: qt.open,
          }))
          .sort((a, b) => a.changePct - b.changePct)
          .slice(0, 10),
        mcap: st?.marketcap || null,
      };
      cacheSet(key, out, 45_000, 6 * 3600_000);
      return out;
    } catch (e) {
      if (hit) return { ...hit.value, stale: true };
      throw e;
    }
  },
};

/** "Mar 2026" -> FY26 · "Jun 2026" -> Q1 FY27 · "TTM" stays. */
function fmtInPeriod(p, freq) {
  const s = String(p || "");
  if (freq === "annual") {
    const m = /^Mar (\d{4})$/.exec(s);
    if (m) return "FY" + String(Number(m[1]) % 100).padStart(2, "0");
    return s === "TTM" ? "TTM" : s;
  }
  const m = /^([A-Z][a-z]{2}) (\d{4})$/.exec(s);
  if (!m) return s;
  const q = { Mar: 4, Jun: 1, Sep: 2, Dec: 3 }[m[1]] || "";
  const year = Number(m[2]);
  const fy = m[1] === "Mar" ? year : year + 1;
  return "Q" + q + " FY" + String(fy % 100).padStart(2, "0");
}

/** Symbol lookup when Yahoo search is unavailable: match against the built-in universe. */
function fallbackSearch(term) {
  const t = term.toLowerCase();
  const quotes = IN_UNIVERSE.filter((u) => u.sym.toLowerCase().includes(t) || u.name.toLowerCase().includes(t))
    .slice(0, 8)
    .map((u) => ({ symbol: u.sym, name: u.name, exchange: "NSE", type: "EQUITY", sector: u.sector }));
  return { quotes, news: [] };
}

const IN_UNIVERSE = [
  { sym: "RELIANCE", name: "Reliance Industries" },
  { sym: "TCS", name: "Tata Consultancy Services" },
  { sym: "HDFCBANK", name: "HDFC Bank" },
  { sym: "INFY", name: "Infosys" },
  { sym: "ICICIBANK", name: "ICICI Bank" },
  { sym: "BHARTIARTL", name: "Bharti Airtel" },
  { sym: "ITC", name: "ITC" },
  { sym: "SBIN", name: "State Bank of India" },
  { sym: "LT", name: "Larsen & Toubro" },
  { sym: "KOTAKBANK", name: "Kotak Mahindra Bank" },
  { sym: "HINDUNILVR", name: "Hindustan Unilever" },
  { sym: "MARUTI", name: "Maruti Suzuki" },
  { sym: "AXISBANK", name: "Axis Bank" },
  { sym: "BAJFINANCE", name: "Bajaj Finance" },
  { sym: "TITAN", name: "Titan Company" },
  { sym: "ASIANPAINT", name: "Asian Paints" },
  { sym: "SUNPHARMA", name: "Sun Pharmaceutical" },
  { sym: "TATASTEEL", name: "Tata Steel" },
  { sym: "WIPRO", name: "Wipro" },
  { sym: "POWERGRID", name: "Power Grid Corporation" },
  // extra liquid names: they double as the decliners feed for /api/market
  { sym: "HCLTECH", name: "HCL Technologies" },
  { sym: "TECHM", name: "Tech Mahindra" },
  { sym: "NTPC", name: "NTPC" },
  { sym: "ONGC", name: "Oil & Natural Gas Corp" },
  { sym: "TATAMOTORS", name: "Tata Motors" },
  { sym: "INDUSINDBK", name: "IndusInd Bank" },
  { sym: "ADANIENT", name: "Adani Enterprises" },
  { sym: "CIPLA", name: "Cipla" },
  { sym: "DRREDDY", name: "Dr Reddys Laboratories" },
  { sym: "DIVISLAB", name: "Divi's Laboratories" },
  { sym: "COALINDIA", name: "Coal India" },
  { sym: "HINDALCO", name: "Hindalco Industries" },
  { sym: "JSWSTEEL", name: "JSW Steel" },
  { sym: "EICHERMOT", name: "Eicher Motors" },
  { sym: "HEROMOTOCO", name: "Hero MotoCorp" },
  { sym: "BRITANNIA", name: "Britannia Industries" },
  { sym: "BEL", name: "Bharat Electronics" },
  { sym: "TRENT", name: "Trent" },
  { sym: "BPCL", name: "Bharat Petroleum" },
  { sym: "GRASIM", name: "Grasim Industries" },
];

const MOVER_LIST = IN_UNIVERSE.map((u) => u.sym);
/* --------------------------------------------------------- static + server */

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

function serveStatic(req, res, urlPath) {
  const rel = decodeURIComponent(urlPath === "/" ? "/index.html" : urlPath);
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT)) return sendText(res, 403, "forbidden");
  fs.readFile(file, (err, buf) => {
    if (err) return sendText(res, 404, "not found");
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=60",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(buf);
  });
}

function sendText(res, code, body, type = "text/plain; charset=utf-8") {
  res.writeHead(code, { "Content-Type": type, "Access-Control-Allow-Origin": "*" });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  const handler = API[url.pathname];
  if (handler) {
    stats.requests++;
    try {
      const payload = await handler(url.searchParams);
      const body = JSON.stringify(payload);
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Response-ms": Date.now() - started,
      });
      return res.end(body);
    } catch (e) {
      const code = e.status || (e.code === 400 ? 400 : 502);
      stats.errors++;
      res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify({ error: String(e.message || e), code: e.code || code }));
    }
  }

  if (req.method !== "GET" && req.method !== "HEAD") return sendText(res, 405, "method not allowed");
  serveStatic(req, res, url.pathname);
});

server.listen(PORT, HOST, () => {
  console.log(`BharatLens serving http://localhost:${PORT}  (root: ${ROOT})`);
  warm().catch(() => {});
});

/**
 * Pre-fetches the handful of calls a fresh page load needs, one at a time with a
 * polite gap. Without this the first visitor pays for every upstream round trip;
 * with it (and the disk cache) page loads are served locally.
 */


/**
 * Pre-fetches the handful of calls a fresh page load needs, one at a time with a
 * polite gap. Without this the first visitor pays for every upstream round trip;
 * with it (and the disk cache) page loads are served locally.
 */
async function warm() {
  const WARM_SYMBOLS = (process.env.WARM_SYMBOLS || "RELIANCE").split(",");
  const steps = [
    () => API["/api/market"](new URLSearchParams()),
    () => API["/api/quotes"](new URLSearchParams({ symbols: WARM_SYMBOLS.join(",") })),
    () => API["/api/chart"](new URLSearchParams({ symbol: WARM_SYMBOLS[0], range: "6M" })),
    () => API["/api/company"](new URLSearchParams({ symbol: WARM_SYMBOLS[0] })),
    () => API["/api/financials"](new URLSearchParams({ symbol: WARM_SYMBOLS[0], freq: "annual" })),
    () => API["/api/shareholding"](new URLSearchParams({ symbol: WARM_SYMBOLS[0] })),
    () => API["/api/news"](new URLSearchParams({ symbol: WARM_SYMBOLS[0] })),
  ];
  await wait(3000);
  let failures = 0;
  for (const step of steps) {
    if (failures >= 2) break;
    try { await step(); failures = 0; } catch (e) { if (e?.code === 429) failures++; }
    await wait(1500);
  }
  console.log(`warmup done (mem=${mem.size}, upstream=${stats.upstream}, 429=${stats.rateLimited})`);
}
