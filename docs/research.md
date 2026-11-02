# Indicator research

These are recorded historical experiments, not a profitability claim or a
substitute for untouched-data evaluation. Original raw provider snapshots and
price-bearing research outputs are not redistributed with the source.

## EMA and MACD

A frozen 24-combination daily AMZN screen selected EMA7/32 + MACD20/50/9 using
2004–2015 training and 2016–2020 validation. The later 2021–October 30, 2026 period
matched 15 / 25 major 15% reversals from 43 warnings, with 28 unmatched warnings and
a median delay of 10 trading bars. Only one matched warning preceded its extreme.
That period was untouched by this first selection, then became exposed history.

The matching window was ten bars before through 20 after a hindsight extreme.
The existing **AMZN research** preset displays these indicator curves; it does
not execute the research signal rule or generate indicator alarms.

## Divergence

A second frozen 45-case screen tested RSI14/MACD12/26/9 divergence with EMA20
context, ATR20 significance and relative-volume filters. Development/validation
selected 20-day rolling MACD divergence with volume at least 1.25× the preceding
20-bar mean, a minimum five-bar anchor separation and ten-bar same-direction
cooldown.

The 2021–October 30, 2026 comparison reused exposed history. The primary window was
strictly 1–20 bars before each major 15% extreme:

| Rule | Warnings | Early reversals / 25 | Unmatched early warnings |
| --- | ---: | ---: | ---: |
| Existing EMA7/32 + MACD20/50/9 | 43 | 2 | 41 |
| RSI divergence | 35 | 8 | 27 |
| MACD divergence | 33 | 10 | 23 |
| RSI and MACD divergence | 24 | 7 | 17 |
| Selected MACD divergence + volume | 10 | 5 | 5 |
| RSI and MACD + volume | 7 | 3 | 4 |

Adding the tested EMA20 stretch filter did not change the 20-day results. The
selected candidate missed 20/25 reversals. Median lead was two bars across its
five early matches; one bullish warning preceded another 16.7% decline before
the eventual trough. With 20% reversal labels it matched only 1/10 early.
No new divergence preset was added.

Its prospective gate starts November 3, 2026. A single planned decision uses the
first 1,260 completed daily bars, with minimum event counts and frozen requirements
for early coverage, precision, unmatched-warning rate and secondary timing. At
release there are zero prospective observations. No monitor is scheduled.

## Source and reproduction

- [EMA/MACD protocol](../research/protocols/amzn-indicator-study.json)
- [Divergence protocol](../research/protocols/amzn-divergence-study.json)
- Research entrypoints: `research/research-amzn-study.mjs`,
  `research/research-amzn-divergence.mjs`, `research/research-divergence-engine.mjs`.
- Fixtures: `tests/verify-amzn-study.mjs`, `tests/verify-amzn-divergence.mjs`,
  `tests/verify-divergence-engine.mjs`. They use synthetic data and need no market feed.

The historical runners pin the exact original dataset SHA. A fresh checkout
contains no such dataset and cannot reproduce those measured runs without that
separately retained snapshot. A new provider download is a new identified run,
not automatically the same evidence. Keep provider terms and data provenance
separate from the MIT-0 code license.

Run commands from the repository root, with the retained exact dataset and a
fresh output directory, for example:

```sh
node research/research-amzn-study.mjs --input local-data/amzn-bars.json --protocol research/protocols/amzn-indicator-study.json --out local-runs/ema-study-001
node research/research-amzn-divergence.mjs --input local-data/amzn-bars.json --out local-runs/divergence-study-001
```

The divergence runner resolves its default private snapshot against the original
evidence location recorded by the frozen protocol. Use `--admitted` to supply the
same exact snapshot elsewhere when evaluating a later full-history input with
`--forward`. Its data and source-identity checks still apply.

The protocol bytes remain frozen through the folder move. Existing locked runs
require their matching pinned source bundle; the relocated source does not
silently accept an old source identity. A new recorded run is distinct from the
original evidence and does not create a new untouched evaluation period.

Optional plots use `research/plot-amzn-study.py`, Python with Matplotlib and an
explicitly writable `MPLCONFIGDIR`; plotting dependencies are not needed by the
HTML application.

Definitions and limitations: [Fidelity RSI](https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/rsi),
[MACD divergence](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/macd-moving-average-convergence-divergence-oscillator),
[EMA](https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/ema),
[ATR](https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/atr).
