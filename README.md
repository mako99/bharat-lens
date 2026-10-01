# BharatLens

A single-page research terminal for Indian equities (NSE/BSE): quotes, candlestick
charts with indicators, financials, valuation, shareholding and news — served by a
zero-dependency Node proxy that aggregates NSE, screener.in and Yahoo Finance.

## Quick start

Requires Node >= 18. No `npm install` — there are no dependencies.

```sh
node server.mjs
# BharatLens serving http://localhost:8790
```

Open <http://localhost:8790>.

| Env var           | Default            | Purpose                              |
| ----------------- | ------------------ | ------------------------------------ |
| `PORT`            | `8790`             | Listen port                          |
| `HOST`            | `0.0.0.0`          | Bind address                         |
| `BHARAT_CACHE`    | `.cache/`          | Disk cache directory (gitignored)    |
| `WARM_SYMBOLS`    | `RELIANCE`         | Symbols primed at startup            |

## API

Every response carries `source` and `fetchedAt`, so the UI can show where a number
came from. Upstream calls are paced, retried and cached (memory + disk); on failure
the last good copy is served (`stale: true`) rather than an error.

| Endpoint                  | Params                          | Source     |
| ------------------------- | ------------------------------- | ---------- |
| `/api/health`             | —                               | —          |
| `/api/quotes`             | `symbols=A,B,…` (≤30)           | Yahoo      |
| `/api/chart`              | `symbol`, `range=1M\|1Y\|MAX`   | Yahoo      |
| `/api/company`            | `symbol`                        | screener   |
| `/api/financials`         | `symbol`, `freq=annual\|quarterly` | screener |
| `/api/shareholding`       | `symbol`                        | screener   |
| `/api/dividends`          | `symbol`                        | Yahoo      |
| `/api/search`             | `q`                             | Yahoo      |
| `/api/news`               | `symbol` or `q`, `limit`        | Yahoo      |
| `/api/market`             | —                               | NSE        |

## Layout

| File         | Role                                                             |
| ------------ | ---------------------------------------------------------------- |
| `server.mjs` | Static host + JSON API, caching, retries, rate-limit handling     |
| `index.html` | Markup for all seven views                                        |
| `styles.css` | Theming and layout                                                |
| `app.js`     | State, router, search, rendering                                  |
| `api.js`     | Frontend fetch layer with a TTL cache                             |
| `data.js`    | Built-in universe, demo dataset, formatters                       |
| `charts.js`  | Canvas candlesticks, volume, RSI, indicators                      |
| `smoke.js`   | 46-step browser smoke test                                        |
| `shot.js`    | Screenshot helper (kills transitions, honours `#/?theme=dark`)    |

## Tests

`smoke.js` runs in the page and asserts every route renders, the search flow works
and no `render …` errors were logged. Build a harness, open it, read the summary:

```sh
node -e "const f=require('fs');f.writeFileSync('_smoke.html',
  f.readFileSync('index.html','utf8').replace('<head>','<head><script>'+
  f.readFileSync('smoke.js','utf8')+'</script>'))"
# open _smoke.html, then check #smokeSummary -> "SMOKE PASSED 46/46"
```

`_*.html` is gitignored, as is the `.cache/` directory.

## Notes

- Yahoo rate-limits aggressively: the proxy sends a generic `Mozilla/5.0` user agent
  to Yahoo (a browser UA trips its bot detection) while NSE and screener.in require
  the full browser UA. Quote batches are chunked at 20 symbols.
- Price history for NSE symbols uses Yahoo's `.NS` suffix; symbols are mapped both
  ways so the API accepts the display form (`TATAMOTORS`).
- If a source is unreachable the endpoint still answers, flagged `degraded: true`,
  and the frontend falls back to its built-in demo dataset.
