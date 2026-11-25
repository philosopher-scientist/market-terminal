# Verification summary

Initial public release: November 2, 2026.

Latest feed-resilience pass: November 25, 2026. Ten suites passed, including 191
numbered behavior checks and the native chart vector/lifecycle suite.

Verification suites and the loopback preview helper live in `tests/`. The
JavaScript authoring sources are in `src/`, the embedding helper is in `scripts/`,
and research runners/protocols are in `research/`. Run the commands in
[Contributing](../CONTRIBUTING.md) from the repository root. The generated
`market-terminal.html` remains at the root and embeds all runtime code.

| Automated check | Recorded result |
| --- | --- |
| Application regressions | 67 passed |
| Native calculations and chart lifecycle | Passed |
| Data adapter checks | 14 passed |
| Crypto provider adapters | 11 passed |
| Shared fallback routing | 36 passed |
| Source settings / persistence | 11 passed |
| Alert engine checks | 15 passed |
| Original AMZN study fixtures | 14 passed |
| Causal divergence engine fixtures | 13 passed |
| Divergence study/admission fixtures | 10 passed |

These checks cover data validation, stale/failed requests, symbol races, native
indicator calculations, settings/presets, local persistence, drawing anchors,
undo, future whitespace, export content and local alert behavior. Research
fixtures cover causality, actual detection dates, matching and selection.

The latest browser pass loaded all 35 starter charts and all eight intervals on
BTC and AMZN. Custom SOL/USDT, SOL/USD and SOL/BNB retained their real quote
currencies. Selectively blocking Kraken recovered through Coinbase; blocking
Kraken and Coinbase recovered through Bitstamp/Binance.US. Blocking the first
Yahoo mirror recovered through query2. A price alarm triggered through Coinbase
with Kraken blocked. Settings apply/cancel/reload/reset and N persistence passed.

Desktop, 390px mobile and 820px tablet checks passed; the new source dialog had
no horizontal overflow. A compact-height grid overflow that obscured the market
manager was reproduced and corrected. Actual HTML and PNG files downloaded;
the exported HTML script matched the captured source and loaded AMZN/BTC over
HTTP. The final unsupported-market cancellation cleanup was subsequently
verified by focused routing and application regressions.

An all-provider-blocked page displayed actionable errors without invented data.
Twelve Data's own-key/plan access was not available for live testing; its protocol,
timestamp requirements and fallback behavior were checked with fixtures, and a
documented provider demo response was inspected. AllOrigins/cors.lol were
unavailable or rate-limited in direct probes. A configured candidate count is not
a guarantee of that many independent available providers. See [coverage and
provider terms](DATA-SOURCES.md).

Earlier real-browser checks over loopback HTTP exercised all 35 starters,
16 stock/crypto interval combinations, custom symbols, indicator presets,
alerts, drawings, desktop/mobile/tablet layouts and an exported HTML copy.
The public CI runs fixtures and embedding consistency; it does not repeat that
live-provider/browser matrix.

Direct `file://` execution remains unverified. Fresh OS downloads were verified
in the latest pass. Market data requires remote services and may be delayed,
rate-limited or unavailable. Alarm delivery needs an open page and can be delayed
by browser throttling or sleep.

Private run logs, browser state, old exports and raw provider snapshots remain
outside the public repository. The source, fixtures, aggregate research notes and
frozen protocol definitions are included.
