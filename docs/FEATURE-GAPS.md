# Feature gaps

Updated November 2, 2026 for the native chart replacement. The core stock/crypto workflow is implemented; the advanced capabilities below remain open. The [roadmap](roadmap.md) tracks deferred scope; [current verification](verification.md) separates implementation from exercised behavior.

| Area | Current limit |
| --- | --- |
| Indicators and analysis | SMA, EMA, Bollinger Bands, RSI, MACD, ATR, Turtle channels and volume are included, with Trend/Turtle/AMZN research/Momentum/Volatility profiles. Separate [EMA/MACD](research.md#ema-and-macd) and [divergence/filter](research.md#divergence) studies test reversal timing; the app does not run their signal rules. The divergence candidate has not met its untouched-data admission gate. An 80-indicator catalog, provider pattern tools, symbol-comparison overlays, custom scripts, strategy execution and in-app backtesting are absent. |
| Drawing tools | Trend/horizontal lines and 50-change session undo are included. Fibonacci, pitchfork and other advanced drawings, redo and named drawing/layout workspaces are absent. |
| Saved analysis | Indicator inputs and basic preferences persist locally. Per-symbol lines survive interval/symbol changes and reloads, including JSON backup. Full edit history is session-only; zoom resets on interval/symbol changes. No cloud sync or shared layouts. |
| Alerts | Local price and 1h/24h swing rules, optional sound/desktop notifications and saved history are included. No closed-page monitoring, server push, email/SMS, webhook delivery or guaranteed timing. Swing baselines use hourly closes. |
| Liquidity and streaming | Starter Kraken quotes poll every 20s; book/trades every 10s. No continuous stream, aggregated exchange books, liquidity heatmaps or liquidation views. |
| Markets and quotes | 35 curated starters and editable lists. Expansion toward 100 names/category, automatic rankings, universal adapters, stock watchlist quote columns and stock book/tape are deferred. Added markets are chart-only. |
| Layouts and research | One chart. No synchronized multi-chart layouts, webhooks, screeners, fundamentals, news, calendars or portfolio analytics. |
| Trading and export | No broker connections, order execution, paper trading or position management. HTML, PNG and market-list JSON exports exist; raw OHLC/indicator CSV export does not. |

Native charts replace the embedded provider toolbar, so its additional studies, comparison and advanced pattern/drawing tools are no longer available. Future space holds no synthetic values; projected dates use fixed interval seconds rather than an exchange calendar. Source history is bounded, weekly boundaries differ, latency can be undisclosed, and the public Yahoo/cors.dev path has no application-controlled availability guarantee. HTTP verification does not establish direct-file execution. See [README.md](../README.md) for current controls, sources and persistence limits.
