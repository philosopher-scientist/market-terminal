"""Authoring helper: embed chart sources into the portable HTML, without dependencies."""
from pathlib import Path
import re

root = Path(__file__).resolve().parents[1]
path = root / "market-terminal.html"
html = path.read_text()
for marker, filename in [("NATIVE_ENGINE", "native-chart.js"), ("CHART_DATA", "chart-data.js"), ("CHART_CONTROLLER", "chart-controller.js"), ("ALERT_ENGINE", "alerts-engine.js"), ("ALERT_CONTROLLER", "alerts-controller.js")]:
    pattern = rf"/\* {marker}_START \*/[\s\S]*?/\* {marker}_END \*/"
    source = (root / "src" / filename).read_text().rstrip()
    replacement = f"/* {marker}_START */\n{source}\n/* {marker}_END */"
    html, count = re.subn(pattern, lambda _: replacement, html)
    if count != 1:
        raise RuntimeError(f"Expected exactly one {marker} block, found {count}")
path.write_text(html)
print("Embedded native chart, data adapter and controller into market-terminal.html")
