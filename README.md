# Market Terminal

[MIT-0 license](LICENSE) · [Contributing](CONTRIBUTING.md) · [Roadmap](docs/roadmap.md)

**[market-terminal.html](market-terminal.html) is the primary application file.** Download it and open it in a modern browser with an internet connection. It contains its CSS, JavaScript, native Canvas chart and icons, with no installation, account, API key or local server required. Public market-data services remain external dependencies. The interface draws inspiration from the former Cryptowatch terminal.

## Charts and controls

- Candlestick and line charts; crosshair; mouse-wheel zoom and drag pan; trend and horizontal lines; linear/log price scales; PNG snapshots.
- Eight intervals: **1m, 5m, 15m, 30m, 1h, 4h, 1D and 1W**. Chart and drawing times use UTC.
- SMA, up to five EMAs, Bollinger Bands, RSI, MACD, ATR, Turtle channels and volume. **Indicator settings** edits and saves their inputs locally.
- The initial analysis view uses **daily EMA 20/50/100/200, RSI 14 with 30/70 guides, MACD 12/26/9 and volume**. SMA defaults to 200 and Bollinger Bands to 20 × 2; their overlays remain optional. The four EMAs use distinct colors. EMA 1 is optional and equals close. **Use trend defaults (daily)** reapplies this profile. Untouched prior defaults migrate; custom saved inputs remain intact. They are viewing defaults; no backtest, profitability or annual trade-count claim is made. [Analysis research](research/ANALYSIS-DEFAULTS.md) records the supporting discussion and separate alternatives.
- **Future space** offers 0%, 15%, 20%, 30% or 50%, with 20% as the default. Pan, zoom and extend trend lines into the projected region. It contains no fabricated candles, volume or indicator values. Projected timestamps add the selected interval's seconds; they do not follow exchange sessions, holidays or trading calendars.

**Esc** closes an open dialog, market drawer or expanded chart first. Otherwise it cancels an unfinished trend, then undoes the last drawing change. **Undo**, **Ctrl/Cmd+Z** and undoable **Clear lines** share a history of up to 50 committed drawing changes. Text fields retain normal keyboard undo. Committed lines are saved per exchange-qualified symbol and keep their UTC time/price anchors when switching intervals or reloading. Lines outside a shorter feed window remain saved offscreen. Undo history survives in-session symbol and interval changes; after reload, Undo removes restored lines individually. Zoom resets on symbol or interval changes. Style and indicator changes preserve the current view.

## Strategy / indicator presets

**Indicator settings → Strategy / indicator preset** offers **Trend**, **Turtle**, **AMZN research**, **Momentum**, **Volatility** and **Custom**. Select a profile and click **Apply inputs**; Esc cancels an unapplied draft. Presets set daily candles, inputs and indicator visibility together. Manual interval, visibility or input changes label the view Custom. Chart style, zoom and drawings preserve the preset. Your chosen profile persists across reloads.

| Preset | Indicators |
| --- | --- |
| Trend | Daily EMA20/50/100/200, RSI14, MACD12/26/9 + volume |
| Turtle | Daily preceding 20/55-bar breakout channels, preceding 10/20-bar exit levels, Wilder ATR 20 + volume |
| AMZN research | Daily EMA7/32, MACD20/50/9 + volume; tested on AMZN only |
| Momentum | Daily EMA12/26, MACD12/26/9, RSI14 + volume |
| Volatility | Daily Bollinger20×2, Wilder ATR 20 + volume |
| Custom | Edited inputs and current study mix |

Turtle's gold 20 channel serves System 1 entry and System 2 exit; blue 55 marks System 2 entry, dashed violet 10 System 1 exit. Long exits use the low; short exits use the high. Channels exclude the current candle. ATR 20 uses an SMA true-range seed followed by Wilder smoothing and appears in a separate pane in price units. The first loaded bar uses H−L because its previous close is unavailable. The current ATR can change while its candle forms. Warmup values remain dashes; the 55-bar channel requires56 loaded bars. Switching to another interval makes these bar-based lookbacks; select 1D for days.

The AMZN research profile comes from a frozen 24-combination study. On the 2021–October 30, 2026 holdout it matched 15/25 major reversals, with 28 unmatched warnings and a median 10-trading-bar delay. Only one matched warning preceded the extreme. It supports a research view for trend detection, not a reliable advance forecast. [Study and reproducible evidence](docs/research.md#ema-and-macd).

A later [RSI/MACD divergence, EMA, ATR and volume study](docs/research.md#divergence) tested earlier warnings. It selected MACD divergence + relative volume for prospective research, but the available historical period was already exposed. No additional preset was admitted; the fresh-data test remains pending.

These are indicator views. Signal-rule execution, indicator alarms, prior-winner filtering, positions, sizing, stops, pyramiding and in-app backtests are not implemented. [Turtle preset verification](docs/verification.md), [AMZN preset verification](docs/verification.md).

## Alarms and major swings

Open **Alerts** in the chart toolbar. Add a price at/above or at/below level, or a percentage rise/fall/either-direction swing over **1 hour or 24 hours**. The **5% / 24h** preset fills a repeating swing rule; adjust it and click Add alarm. Edit, pause, rearm or remove individual rules, or pause all. Up to 50 rules across 20 saved markets are supported, including markets other than the selected chart.

Rules run once or repeat after the condition clears, with a 30-minute minimum between alarms. A condition already met can trigger on the first valid check. Checks run every 60 seconds, with two concurrent requests at most and a shared short-lived snapshot per symbol. Closed/removed markets, missing baseline history and feed failures are explicit. Swing baselines use completed hourly closes near the requested lookback, so comparisons are approximate; exchange session gaps can leave no valid baseline.

In-page banners and the latest 100 history entries always work. Optional **Chime/Bell/Pulse** sound needs **Enable / test sound** in each tab. Desktop notifications require **Enable notifications** and browser permission; unsupported/blocked delivery keeps the in-page alert. Rules, trigger latches and history persist locally and transfer in market-list JSON. Older JSON backups preserve existing alerts; included alerts replace the current alert configuration/history after full validation.

**Keep the page open.** Browser throttling, sleep, connectivity and delayed sources can postpone or miss checks. There is no closed-page/background service, email, SMS or guaranteed real-time delivery. Source timestamps and reported/unspecified latency accompany events. [Alert verification](docs/verification.md).

## Markets and local storage

Search, collapse categories and star favorites. **Manage markets** adds/removes symbols and categories, moves markets between categories, and exports/imports JSON lists. Category removal requires a destination; the final market and category remain protected. Import validates the entire list and all lines before replacement. Included per-symbol lines are merged; older backups preserve existing lines. Removing and re-adding a symbol restores its saved lines.

The 35 curated starters comprise:

| Group | Instruments |
| --- | --- |
| Crypto | BTC, ETH, BNB against USD on Kraken |
| Magnificent 7 | AAPL, MSFT, GOOGL, AMZN, NVDA, META, TSLA |
| Artificial intelligence | AVGO, AMD, PLTR |
| Robotics | ROK, TER, SYM |
| Quantum computing | IONQ, RGTI, QBTS |
| Space | SPCX, RKLB, ASTS, RDW |
| Energy Innovation | GFUZ, OKLO, SMR |
| Biotechnology | VRTX, REGN, AMGN |
| Longevity / health | LLY, ISRG, CRSP |
| Natural resources | BHP, RIO, FCX |

Added exchange-qualified symbols need a supported data adapter and an available remote feed. Adapters cover US stocks, selected international exchanges/FX, Kraken and Binance; they do not provide universal symbol coverage. Added markets are chart-only. Only starter BTC, ETH and BNB have surrounding Kraken quote, order-book, depth and trade panels, regardless of category placement.

Browser storage retains the market list, favorites, selection, interval, chart style, indicators, edited inputs, future-space setting and committed lines. **Save HTML** downloads the clean application. Use **Export JSON** separately to transfer categories, markets, selection, favorites, saved lines, alarm rules and event history (maximum 5 MB). It does not transfer all analysis preferences. Clearing browser storage removes saved preferences; direct-file storage varies by browser.

## Data sources and limits

| Data | Source | Polling / history |
| --- | --- | --- |
| Crypto candles | Direct Kraken or Binance public API | Every 20s; Kraken up to 720 bars, Binance up to 1,000 |
| Stock / supported international / FX candles | Yahoo Finance through the public cors.dev relay | Every 60s; 1m: 5d, 5–30m: 1mo, 1h/4h: 3mo, daily: 2y, weekly: 5y requested |
| Starter crypto quotes / book / trades | Kraken public APIs | Quotes 20s; book/trades 10s |

These are snapshots. Source latency is **unspecified unless metadata supplies an exact delay**. Fetch time and candle opening time do not guarantee last-trade freshness. Weekly candle boundaries can differ by source. Available history may be shorter than requested; indicators show a dash until enough bars exist for their lookback. General Fusion predecessor bars before July 13, 2026 are excluded; SpaceX's real IPO weekly candle is preserved despite its earlier week-start label. Providers and the relay can fail or rate-limit; failures and stale retained snapshots are labeled.

## Project layout

| Path | Purpose |
| --- | --- |
| `market-terminal.html` | Primary, portable application; the only file needed at runtime |
| `src/` | JavaScript authoring modules embedded into the HTML |
| `scripts/` | Build helper for the portable HTML |
| `tests/` | Application/research checks and the loopback browser preview helper |
| `research/` | Experiment runners, plotting helper, analysis defaults and frozen protocols |
| `docs/` | Research summaries, feature gaps, roadmap and verification notes |

## Development and verification

The five JavaScript authoring modules in `src/` are embedded by `python3 scripts/sync-chart-source.py`. They are not runtime dependencies: `market-terminal.html` remains the only application file to distribute. Relevant checks:

```sh
node tests/verify-regressions.mjs
node tests/verify-chart-data.mjs
node tests/verify-native-chart.mjs
node tests/verify-alerts.mjs
node tests/verify-amzn-study.mjs
node tests/verify-divergence-engine.mjs
node tests/verify-amzn-divergence.mjs
```

Current evidence includes 63 application regressions, 11 data checks and 15 alert-engine checks, native calculation/event checks, and live HTTP checks of all 35 starters, 16 stock/crypto interval combinations, custom INTC/Binance SOL/Kraken SOL, keyboard undo, future space, defaults and per-symbol drawing persistence. Read [current verification](docs/verification.md) for responsive/export results and evidence limits. The alerts pass adds 18 browser checks plus its exported-copy smoke test. The [Turtle preset pass](docs/verification.md) adds 17 browser checks. The [AMZN research pass](docs/verification.md) adds 14 research checks and verifies the new dropdown on live, mobile and exported views. The [four-EMA defaults pass](docs/verification.md) verifies migration, persistence, reset and rendered curves. Direct-file execution has not been agent-verified. [Feature gaps](docs/FEATURE-GAPS.md) and [the backlog](docs/roadmap.md) record remaining scope and limits.

## License and public source package

Original software and documentation use **MIT No Attribution (MIT-0)**. See [LICENSE](LICENSE) and [source/data boundaries](NOTICE.md). Provider data and trademarks retain their separate terms. Raw market snapshots, browser state, private run logs and local workflow history are excluded. Research fixtures and frozen protocols are included; historical measured runs require their separately retained exact dataset.
