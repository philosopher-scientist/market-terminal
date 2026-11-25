# Data sources, fallbacks and limits

Updated November 25, 2026. The standalone HTML needs no key for its default feeds.

Open **Data sources** to set N, source timeouts, total time budget and enabled providers/relays. Defaults allow up to five compatible candidate attempts, four seconds per attempt and eighteen seconds overall. Quote/book/trade work has an additional eleven-second caller budget; alerts retain their bounded polling timeout. N counts source candidates, not individual HTTP calls: Coinbase quotes use ticker and statistics requests, and Twelve Data hourly alarm snapshots request candles plus a timestamped quote.

The requested crypto venue is preferred when enabled. Backups must match the exact base and quote currencies. A complete snapshot comes from one venue; histories and order-book sides are never combined. A fallback can change price, volume, available history and candle boundaries. Chart, quote, book and tape labels identify their own actual provider. Quote percentage changes identify a UTC-open or rolling-24h baseline.

## Implemented coverage

| Data | Candidates and limits |
| --- | --- |
| BTC/ETH/BNB USD candles, quotes, book/depth and trades | Kraken → Coinbase Exchange → Bitstamp → Binance.US when enabled and available. These are four compatible providers, not a guarantee every endpoint works in every region. |
| Other exchange-qualified crypto | Requested Kraken/Binance venue, then compatible enabled venues. Exact pair availability is checked by the remote provider; unsupported pairs fail rather than changing currency. |
| Stock, supported international and FX candles/associated price | Yahoo query1/query2, through cors.dev, AllOrigins and cors.lol paths. Six configured routes remain one underlying provider. |
| Optional independent US-stock/FX candles and hourly quotes | Twelve Data with a user-provided key and suitable plan. Tried before exhausting the Yahoo mirror routes. International stock mappings are not generalized to it. |
| Stock order books/trades | Not implemented. A chart provider does not create these panels. |

Kraken supplies roughly 720 candles including its forming-bar behavior; Binance adapters request up to 1,000. Coinbase history is capped at 300 source bars; 30m and 4h aggregate real smaller bars, and weekly history aggregates daily bars into Monday UTC weeks. Bitstamp requests up to 1,000 source bars and aggregates weekly history from daily bars. Missing internal intervals and truncated leading buckets are omitted; missing prices are never fabricated. This can shorten fallback history enough to leave long indicators warming up.

Yahoo requests 5d for 1m, 1mo for 5–30m, 3mo for 1h/4h, 2y for daily and 5y for weekly. Twelve Data requests up to 1,000 candles; its actual plan/symbol coverage applies. Intraday Twelve Data timestamps request UTC; daily/weekly timestamps are interpreted at exchange-local midnight because its API ignores the timezone parameter for those intervals. Hourly alarms require a matching timestamped quote from the same provider; if absent or invalid, the request continues to another source. If none qualifies, alarms wait. Missing exact latency metadata remains **delay unspecified**.

## Failure and storage behavior

Network failures, unusable responses and timeouts advance to the next eligible source. N and a total deadline bound the chain even if a fetch ignores cancellation. Explicit user cancellation stops all candidates. HTTP `Retry-After` is honored; other failures use cooldowns and later recovery attempts. Symbol-specific failures do not disable unrelated markets. A relay's explicit upstream-owner opt-out blocks that provider's relay routes for the current configuration instead of routing around it.

Old candles, quotes, books and trades retain their original receipt times and stale/failure labels when refreshes fail. Changing source settings cancels old requests and clears source caches/snapshots while retaining market lists, drawings and indicator preferences. Optional keys stay in a separate browser storage entry and go directly to their provider. They are omitted from portable HTML and market-list JSON. Browser storage is local convenience, not a secret vault; use only a key intended for your own browser use.

## Current verification and remaining limits

On November 25 the original Yahoo/cors.dev and Kraken/Binance endpoints responded; a universal live outage was not reproduced. The old crypto path had one attempt and the old stock paths shared one relay. Regression tests reproduce those resilience/correctness gaps, including accepting the wrong stock symbol.

Live HTTP adapter checks covered all three starter USD cryptos across the four data capabilities on Kraken, Coinbase and Bitstamp, selected aggregated intervals, Binance SOL/USDT and Binance.US BNB/USD. Browser checks separately exercise controlled primary failures with live alternatives; see [verification](verification.md). HTTP success alone does not establish browser CORS behavior. AllOrigins timed out/returned 522 and cors.lol returned 429 in current probes; they remain best-effort configured routes. Twelve Data's documented demo protocol was checked, but a user's own-key/plan integration has not been verified. Regional restrictions, remote listing changes, rate limits and provider outages remain explicit failures.

## Primary documentation and data rights

- [Kraken exchange APIs](https://docs.kraken.com/exchange/guides/overview), [historical data](https://docs.kraken.com/exchange/guides/general/historical-data).
- [Coinbase candle API](https://docs.cdp.coinbase.com/exchange/reference/exchangerestapi_getproductcandles), [market-data terms](https://www.coinbase.com/legal/market_data). Personal/research access does not establish permission to display data to the public outside the permitted scope.
- [Bitstamp API](https://www.bitstamp.net/api/). Commercial data use requires appropriate licensing.
- [Binance market-data-only API](https://developers.binance.com/en/docs/products/spot/faqs/market_data_only), [Binance.US API](https://docs.binance.us/).
- [Twelve Data time series](https://twelvedata.com/docs/market-data/time-series), [quote](https://twelvedata.com/docs/market-data/quote).
- [cors.dev](https://cors.dev/docs), [AllOrigins](https://allorigins.win/), [cors.lol](https://cors.lol/).
- [Yahoo terms](https://legal.yahoo.com/us/en/yahoo/terms/otos/index.html), [Finance data policy](https://help.yahoo.com/kb/SLN2310.html). Automated-access/redistribution restrictions remain relevant, including for local use.

MIT-0 covers the project's original software, not market-data rights. Additional fallbacks do not clear the earlier public-hosting restriction; GitHub Pages has not been enabled. A public service needs permissions covering its actual providers and audience.
