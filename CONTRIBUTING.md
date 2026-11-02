# Contributing

The runtime deliverable is `market-terminal.html`. It contains its CSS, JavaScript
and icons; external calls fetch market data only.

Edit the JavaScript authoring modules in `src/`, then rebuild the single file:

```sh
python3 scripts/sync-chart-source.py
```

Use Node.js 24 or later for checks. No npm packages are required:

```sh
node tests/verify-regressions.mjs
node tests/verify-native-chart.mjs
node tests/verify-chart-data.mjs
node tests/verify-alerts.mjs
node tests/verify-amzn-study.mjs
node tests/verify-divergence-engine.mjs
node tests/verify-amzn-divergence.mjs
```

For browser checks, serve the project on loopback:

```sh
python3 -m http.server 8766 --bind 127.0.0.1
```

Open `http://127.0.0.1:8766/market-terminal.html`. Check the affected real browser
flow, relevant responsive layouts, saved preferences and provider failures.
Offline fixtures do not prove live provider access. Reproduce behavior changes
before fixing them and preserve existing indicator, drawing and export behavior.

`python3 tests/verify-preview.py` starts the optional preview helper, including responsive and provider-blocked routes. Reuse an existing
preview service when one is already running. Keep local datasets and run outputs
in the ignored `local-data/` and `local-runs/` paths, or a location you configure.

Research runners, the plotting helper and frozen protocols live in `research/`.
Research fixtures run without provider data. Frozen historical measurements need
the separately retained exact dataset and matching source identity; see
[research notes](docs/research.md).
Do not retune a strategy on its claimed untouched evaluation period.

Changes and contributions to original project code are accepted under MIT-0.
