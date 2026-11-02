#!/usr/bin/env python3
"""Render the normalized AMZN study payload as standalone PNG/SVG figures.

This helper does no calculation, tuning, data acquisition or application editing.
Example:
  MPLCONFIGDIR=/path/to/writable-cache \
    python3 research/plot-amzn-study.py --input plot-payload.json --out figures

Rates in the payload are fractions, not percentages. Positive matched lag means
the warning came after the hindsight extreme. Null indicator warmups are gaps.
"""

import argparse
import datetime as dt
import json
import math
import os
from pathlib import Path
import textwrap


COLORS = {
    "price": "#263443",
    "fast": "#b58200",
    "slow": "#3469a5",
    "bull": "#00856a",
    "bear": "#b23e4d",
    "muted": "#7d8792",
    "grid": "#d9e0e6",
    "precision": "#3469a5",
    "recall": "#b58200",
    "pre": "#00856a",
}


def number(value, name, nullable=False, positive=False):
    if value is None and nullable:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError("{} must be a finite number{}".format(
            name, " or null" if nullable else ""))
    value = float(value)
    if not math.isfinite(value) or (positive and value <= 0):
        raise ValueError("{} must be {}finite".format(
            name, "positive and " if positive else ""))
    return value


def rate(value, name):
    value = number(value, name, nullable=True)
    if value is not None and not 0 <= value <= 1:
        raise ValueError("{} must be a fraction between zero and one".format(name))
    return value


def date(value, name):
    if not isinstance(value, str):
        raise ValueError("{} must be an ISO date".format(name))
    try:
        return dt.datetime.combine(dt.date.fromisoformat(value), dt.time())
    except ValueError as exc:
        raise ValueError("{} must be YYYY-MM-DD".format(name)) from exc


def validate(payload):
    if not isinstance(payload, dict):
        raise ValueError("The plot payload must be a JSON object")
    dates = [date(value, "dates") for value in payload.get("dates", [])]
    if len(dates) < 2 or any(a >= b for a, b in zip(dates, dates[1:])):
        raise ValueError("dates must contain at least two increasing, unique dates")
    date_set = set(dates)
    series = {}
    for key in ("close", "emaFast", "emaSlow", "macdLine", "macdSignal", "macdHistogram"):
        values = payload.get(key)
        if not isinstance(values, list) or len(values) != len(dates):
            raise ValueError("{} must have the same length as dates".format(key))
        series[key] = [number(value, key, nullable=key != "close",
                              positive=key in ("close", "emaFast", "emaSlow"))
                       for value in values]
    config = payload.get("config", {})
    if not isinstance(config, dict):
        raise ValueError("config must be an object")
    for key, size in (("ema", 2), ("macd", 3)):
        values = config.get(key)
        if not isinstance(values, list) or len(values) != size or any(
                isinstance(value, bool) or not isinstance(value, int) or value <= 0
                for value in values):
            raise ValueError("config.{} must contain {} positive integer periods".format(key, size))
    if config["ema"][0] >= config["ema"][1] or config["macd"][0] >= config["macd"][1]:
        raise ValueError("Fast EMA/MACD periods must be smaller than slow periods")
    threshold = rate(payload.get("threshold"), "threshold")
    if threshold is None or threshold == 0:
        raise ValueError("threshold must be positive")
    events = {}
    for key in ("signals", "pivots"):
        values = payload.get(key)
        if not isinstance(values, list):
            raise ValueError("{} must be an array".format(key))
        events[key] = []
        for value in values:
            if not isinstance(value, dict) or value.get("direction") not in ("bull", "bear"):
                raise ValueError("{} need bull/bear directions".format(key))
            event_date = date(value.get("date"), key + ".date")
            if event_date not in date_set or not isinstance(value.get("matched"), bool):
                raise ValueError("{} need an in-range trading date and Boolean matched flag".format(key))
            event = dict(value, parsedDate=event_date)
            if key == "pivots":
                event["price"] = number(value.get("price"), "pivot.price", positive=True)
                confirmed = date(value.get("confirmedDate"), "pivot.confirmedDate")
                if confirmed < event_date or confirmed > dates[-1]:
                    raise ValueError("Pivot confirmation must be between the extreme and plot end")
            events[key].append(event)
    summary = payload.get("summary")
    if not isinstance(summary, dict):
        raise ValueError("summary must be an object")
    for key in ("signals", "matched", "pivots", "signalsPerYear", "falsePerYear"):
        if number(summary.get(key), "summary." + key) < 0:
            raise ValueError("Summary counts/frequencies cannot be negative")
    for key in ("precision", "recall", "prePivotRecall"):
        rate(summary.get(key), "summary." + key)
    number(summary.get("medianLagBars"), "summary.medianLagBars", nullable=True)
    comparisons = payload.get("comparisons")
    if not isinstance(comparisons, list) or not comparisons:
        raise ValueError("comparisons must be a nonempty array")
    for row in comparisons:
        if not isinstance(row, dict) or not isinstance(row.get("label"), str):
            raise ValueError("Each comparison needs a label")
        for key in ("precision", "recall", "prePivotRecall"):
            rate(row.get(key), "comparison." + key)
        for key in ("signalsPerYear", "falsePerYear"):
            if number(row.get(key), "comparison." + key) < 0:
                raise ValueError("Comparison frequencies cannot be negative")
    return dates, series, events


def pct(value):
    return "n/a" if value is None else "{:.1f}%".format(value * 100)


def count(value):
    return "{:g}".format(float(value))


def save(fig, root, name):
    # Fixed SVG hash salt and no SVG timestamp make rerenders easier to compare.
    fig.savefig(root / (name + ".png"), dpi=200, facecolor="white")
    fig.savefig(root / (name + ".svg"), facecolor="white", metadata={"Date": None})


def render_holdout(payload, dates, series, events, root, plt, mdates, Line2D, HandlerTuple):
    fig = plt.figure(figsize=(16, 9))
    grid = fig.add_gridspec(2, 1, height_ratios=(2.7, 1), hspace=0.10,
                           left=0.075, right=0.98, top=0.77, bottom=0.13)
    price_ax = fig.add_subplot(grid[0])
    macd_ax = fig.add_subplot(grid[1], sharex=price_ax)
    fast, slow = payload["config"]["ema"]
    mf, ms, signal = payload["config"]["macd"]
    period = payload.get("periodLabel", "Held-out period")
    symbol = payload.get("symbol", "AMZN")
    fig.suptitle("{} — held-out EMA/MACD reversal study".format(symbol),
                 x=0.075, y=0.97, ha="left", fontsize=20, fontweight="bold")
    fig.text(0.075, 0.925,
             "{}  |  Daily EMA {} / {}  |  MACD {} / {} / {}  |  {:.0f}% hindsight swing benchmark".format(
                 period, fast, slow, mf, ms, signal, payload["threshold"] * 100),
             ha="left", fontsize=12, color=COLORS["price"])
    summary = payload["summary"]
    lag = summary["medianLagBars"]
    lag_label = "n/a" if lag is None else "{:+.1f}".format(lag)
    fig.text(0.075, 0.885,
             "Matched {}/{} reversals  |  precision {}  |  recall {}  |  pre-extreme recall {}  |  median matched lag {} bars".format(
                 count(summary["matched"]), count(summary["pivots"]), pct(summary["precision"]),
                 pct(summary["recall"]), pct(summary["prePivotRecall"]), lag_label),
             ha="left", fontsize=11.5)

    def values(key):
        return [math.nan if value is None else value for value in series[key]]

    price_ax.plot(dates, series["close"], color=COLORS["price"], linewidth=1.25,
                  label="Split-adjusted close", zorder=2)
    price_ax.plot(dates, values("emaFast"), color=COLORS["fast"], linewidth=1.6,
                  label="EMA {}".format(fast), zorder=3)
    price_ax.plot(dates, values("emaSlow"), color=COLORS["slow"], linewidth=1.6,
                  label="EMA {}".format(slow), zorder=3)
    price_ax.set_yscale("log")
    price_ax.set_ylabel("Price (USD, log scale)")
    close_by_date = dict(zip(dates, series["close"]))
    for direction, marker in (("bull", "^"), ("bear", "v")):
        pivots = [event for event in events["pivots"] if event["direction"] == direction]
        price_ax.scatter([event["parsedDate"] for event in pivots],
                         [event["price"] for event in pivots], marker="o", s=72,
                         facecolors="none", edgecolors=COLORS[direction], linewidths=1.5,
                         zorder=5)
        matched = [event for event in events["signals"]
                   if event["direction"] == direction and event["matched"]]
        price_ax.scatter([event["parsedDate"] for event in matched],
                         [close_by_date[event["parsedDate"]] for event in matched],
                         marker=marker, s=56, color=COLORS[direction],
                         edgecolors="white", linewidths=0.5, zorder=6)
    unmatched = [event for event in events["signals"] if not event["matched"]]
    price_ax.scatter([event["parsedDate"] for event in unmatched],
                     [close_by_date[event["parsedDate"]] for event in unmatched],
                     marker="x", s=30, color=COLORS["muted"], linewidths=1.0, zorder=4)
    handles = [
        Line2D([], [], color=COLORS["price"], linewidth=1.25),
        (Line2D([], [], color=COLORS["fast"], linewidth=1.6),
         Line2D([], [], color=COLORS["slow"], linewidth=1.6)),
        (Line2D([], [], marker="^", linestyle="none", color=COLORS["bull"], markersize=7),
         Line2D([], [], marker="v", linestyle="none", color=COLORS["bear"], markersize=7),
         Line2D([], [], marker="x", linestyle="none", color=COLORS["muted"], markersize=7)),
        (Line2D([], [], marker="o", linestyle="none", color=COLORS["bull"],
                markerfacecolor="none", markersize=7),
         Line2D([], [], marker="o", linestyle="none", color=COLORS["bear"],
                markerfacecolor="none", markersize=7)),
    ]
    labels = ["Split-adjusted close", "EMA {} / {}".format(fast, slow),
              "Warnings: matched ▲/▼; unmatched ×", "Hindsight trough / peak"]
    fig.legend(handles, labels, loc="upper left", bbox_to_anchor=(0.07, 0.855),
               ncol=2, frameon=False, fontsize=10.5, columnspacing=2.2,
               handlelength=3.0, handler_map={tuple: HandlerTuple(ndivide=None)})
    histogram = values("macdHistogram")
    macd_ax.bar(dates, histogram, width=0.95,
                color=[COLORS["bull"] if math.isfinite(value) and value >= 0 else COLORS["bear"]
                       for value in histogram], alpha=0.35, linewidth=0, zorder=1)
    macd_ax.plot(dates, values("macdLine"), color=COLORS["slow"], linewidth=1.1, label="MACD")
    macd_ax.plot(dates, values("macdSignal"), color=COLORS["fast"], linewidth=1.1,
                 label="Signal EMA {}".format(signal))
    macd_ax.axhline(0, linewidth=0.7, color=COLORS["muted"])
    macd_ax.set_ylabel("MACD (USD)")
    macd_ax.legend(loc="upper left", frameon=False, fontsize=10, ncol=2)
    for ax in (price_ax, macd_ax):
        ax.grid(True, color=COLORS["grid"], linewidth=0.65, alpha=0.65)
        ax.set_axisbelow(True)
        ax.spines["top"].set_visible(False)
        ax.spines["right"].set_visible(False)
        ax.tick_params(labelsize=11)
    price_ax.tick_params(labelbottom=False)
    macd_ax.xaxis.set_major_locator(mdates.YearLocator())
    macd_ax.xaxis.set_major_formatter(mdates.DateFormatter("%Y"))
    macd_ax.xaxis.set_minor_locator(mdates.MonthLocator(bymonth=(4, 7, 10)))
    price_ax.set_xlim(dates[0], dates[-1])
    fig.text(0.075, 0.065,
             "Hollow markers are hindsight extrema, known only at later confirmation. Solid warnings use that day's completed close; green = bull, red = bear.",
             fontsize=10.2, ha="left", color=COLORS["price"])
    fig.text(0.075, 0.035,
             "Negative matched lag is before an extreme. {:.2f} warnings/year; {:.2f} unmatched/year. Source: Yahoo split-adjusted data. No execution or returns simulated.".format(
                 summary["signalsPerYear"], summary["falsePerYear"]),
             fontsize=10.2, ha="left", color=COLORS["price"])
    save(fig, root, "holdout")
    plt.close(fig)


def render_comparison(payload, root, plt):
    rows = payload["comparisons"]
    fig = plt.figure(figsize=(16, 9))
    ax = fig.add_axes([0.235, 0.19, 0.55, 0.62])
    fig.suptitle("{} — held-out warning comparison".format(payload.get("symbol", "AMZN")),
                 x=0.04, y=0.96, ha="left", fontsize=20, fontweight="bold")
    fig.text(0.04, 0.91, "{}  |  {:.0f}% swing benchmark  |  Settings selected before holdout evaluation".format(
        payload.get("periodLabel", "Held-out period"), payload["threshold"] * 100),
        fontsize=12, ha="left", color=COLORS["price"])
    positions = list(range(len(rows)))
    measures = [("precision", -0.22, "Timely precision", COLORS["precision"]),
                ("recall", 0, "Reversal recall", COLORS["recall"]),
                ("prePivotRecall", 0.22, "Pre-extreme recall", COLORS["pre"])]
    for key, offset, label, color in measures:
        values = [row.get(key) for row in rows]
        bars = ax.barh([y + offset for y in positions],
                       [0 if value is None else value * 100 for value in values],
                       height=0.18, color=color, label=label)
        for bar, value in zip(bars, values):
            amount = 0 if value is None else value * 100
            inside = amount > 91
            ax.text(amount - 1.2 if inside else amount + 1.1,
                    bar.get_y() + bar.get_height() / 2,
                    "n/a" if value is None else "{:.0f}%".format(amount),
                    va="center", ha="right" if inside else "left",
                    fontsize=10, color="white" if inside else COLORS["price"])
    ax.set_yticks(positions)
    ax.set_yticklabels([textwrap.fill(row["label"], width=29) for row in rows], fontsize=11)
    ax.invert_yaxis()
    ax.set_xlim(0, 100)
    ax.set_xticks([0, 20, 40, 60, 80, 100])
    ax.set_xlabel("Percent", fontsize=12)
    ax.grid(axis="x", color=COLORS["grid"], alpha=0.7)
    ax.set_axisbelow(True)
    for side in ("top", "right", "left"):
        ax.spines[side].set_visible(False)
    ax.tick_params(axis="y", length=0, pad=12)
    ax.legend(loc="lower left", bbox_to_anchor=(-0.005, 1.035), ncol=3,
              frameon=False, fontsize=11)
    for index, row in enumerate(rows):
        ax.text(1.035, index, "{:.2f} warnings/year\n{:.2f} unmatched/year".format(
            row["signalsPerYear"], row["falsePerYear"]),
            transform=ax.get_yaxis_transform(), va="center", ha="left", fontsize=10.5,
            color=COLORS["price"], clip_on=False)
    fig.text(0.04, 0.095,
             "Timely association: one warning per same-direction pivot within −10 to +20 trading bars. Pre-extreme recall counts only warnings before the turning point.",
             fontsize=10.5, ha="left", color=COLORS["price"])
    fig.text(0.04, 0.055,
             "Pivots are hindsight labels, not signals available at the extreme. Unmatched warnings are not proven bad trades; execution and returns are outside this study.",
             fontsize=10.5, ha="left", color=COLORS["price"])
    save(fig, root, "comparison")
    plt.close(fig)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--input", type=Path, required=True, help="Normalized study plot payload JSON")
    parser.add_argument("--out", type=Path, required=True, help="Output directory; existing figures are not overwritten")
    args = parser.parse_args()
    payload = json.loads(args.input.read_text())
    dates, series, events = validate(payload)
    targets = [args.out / (name + suffix) for name in ("holdout", "comparison") for suffix in (".png", ".svg")]
    if any(path.exists() for path in targets):
        parser.error("Output figures already exist; use a fresh output directory")
    if not os.environ.get("MPLCONFIGDIR"):
        parser.error("Set MPLCONFIGDIR to an existing writable cache directory")
    cache = Path(os.environ["MPLCONFIGDIR"])
    probe = cache / (".write-check-{}".format(os.getpid()))
    try:
        probe.write_text("")
        probe.unlink()
    except OSError as exc:
        parser.error("Task cache is not writable; stop before Matplotlib can choose a system-temp fallback: {}".format(exc))
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import matplotlib.dates as mdates
    from matplotlib.lines import Line2D
    from matplotlib.legend_handler import HandlerTuple
    matplotlib.rcParams.update({"font.family": "DejaVu Sans", "font.size": 12,
                                "axes.labelsize": 12, "svg.hashsalt": "amzn-study-v1"})
    args.out.mkdir(parents=True, exist_ok=True)
    render_holdout(payload, dates, series, events, args.out, plt, mdates, Line2D, HandlerTuple)
    render_comparison(payload, args.out, plt)
    print("Saved " + ", ".join(str(path) for path in targets))


if __name__ == "__main__":
    main()
