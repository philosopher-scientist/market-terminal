# Verification summary

Initial public release: November 2, 2026.

Verification suites and the loopback preview helper live in `tests/`. The
JavaScript authoring sources are in `src/`, the embedding helper is in `scripts/`,
and research runners/protocols are in `research/`. Run the commands in
[Contributing](../CONTRIBUTING.md) from the repository root. The generated
`market-terminal.html` remains at the root and embeds all runtime code.

| Automated check | Recorded result |
| --- | --- |
| Application regressions | 63 passed |
| Native calculations and chart lifecycle | Passed |
| Data adapter checks | 11 passed |
| Alert engine checks | 15 passed |
| Original AMZN study fixtures | 14 passed |
| Causal divergence engine fixtures | 13 passed |
| Divergence study/admission fixtures | 10 passed |

These checks cover data validation, stale/failed requests, symbol races, native
indicator calculations, settings/presets, local persistence, drawing anchors,
undo, future whitespace, export content and local alert behavior. Research
fixtures cover causality, actual detection dates, matching and selection.

Prior real-browser checks over loopback HTTP exercised all 35 starters,
16 stock/crypto interval combinations, custom symbols, indicator presets,
alerts, drawings, desktop/mobile/tablet layouts and an exported HTML copy.
The public CI runs fixtures and embedding consistency; it does not repeat that
live-provider/browser matrix.

Direct `file://` execution and completion of a fresh OS download were not
automatically verified. Market data requires remote services and may be delayed,
rate-limited or unavailable. Alarm delivery needs an open page and can be delayed
by browser throttling or sleep.

Private run logs, browser state, old exports and raw provider snapshots remain
outside the public repository. The source, fixtures, aggregate research notes and
frozen protocol definitions are included.
