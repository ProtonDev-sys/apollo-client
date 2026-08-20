from pathlib import Path

path = Path("src/renderer/settings.js")
source = path.read_text(encoding="utf-8")
old = "      liveSearchDelayMs: 220\n"
new = "      liveSearchDelayMs: 160\n"
if source.count(old) != 1:
    raise SystemExit(f"search delay: expected one match, found {source.count(old)}")
path.write_text(source.replace(old, new, 1), encoding="utf-8")
