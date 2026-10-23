"""Збирає історію світла з публічного каналу @power_po2 у power.json.

Запускає GitHub Actions (.github/workflows/power.yml) раз на 10 хв. Читає веб-версію
каналу t.me/s/power_po2, дописує нові події до наявного power.json і зберігає.

  python3 tools/power_fetch.py out/power.json            # з мережі
  python3 tools/power_fetch.py out/power.json page.html  # з локального файлу (для тестів)

Формат power.json:
  events:    [{"id": 123, "t": "2026-10-23T16:32:43+03:00", "on": true, "prev": 14280}, ...]
             — зникло/з'явилось; prev — скільки тривав попередній стан, с («Відключення тривало»)
  schedules: {"2026-10-23": {"id": 120, "slots": [["03:00", "06:30"], ...], "emergency": false}}
"""
import html
import json
import os
import re
import sys
import urllib.request
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

CHANNEL = "power_po2"
KYIV = ZoneInfo("Europe/Kyiv")
KEEP_DAYS = 60       # скільки днів історії подій зберігати
BACKFILL_PAGES = 15  # скільки сторінок назад гортати при першому запуску


def fetch(before=None):
    url = f"https://t.me/s/{CHANNEL}" + (f"?before={before}" if before else "")
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (po2.kyiv.ua power page)"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8")


def to_text(fragment):
    fragment = re.sub(r"<br\s*/?>", "\n", fragment)
    return html.unescape(re.sub(r"<[^>]+>", "", fragment)).strip()


def posts(page):
    """[(id, текст, час публікації)] з однієї сторінки t.me/s/."""
    out = []
    for chunk in page.split(f'data-post="{CHANNEL}/')[1:]:
        m = re.match(r"(\d+)", chunk)
        text = re.search(r'class="tgme_widget_message_text[^"]*"[^>]*>(.*?)</div>', chunk, re.S)
        when = re.search(r'<time[^>]*datetime="([^"]+)"', chunk)
        if m and text:
            posted = datetime.fromisoformat(when.group(1)).astimezone(KYIV) if when else None
            out.append((int(m.group(1)), to_text(text.group(1)), posted))
    return out


def duration(text):
    """«3 години 58 хвилин» → секунди (або None)."""
    m = re.search(r"(?:тривал\w*|було)\s*:\s*(.+)", text, re.I)
    if not m:
        return None
    h = re.search(r"(\d+)\s*(?:год|г\b)", m[1])
    mi = re.search(r"(\d+)\s*хв", m[1])
    d = re.search(r"(\d+)\s*(?:дн|доб)", m[1])
    if not (h or mi or d):
        return None
    return (int(d[1]) if d else 0) * 86400 + (int(h[1]) if h else 0) * 3600 + (int(mi[1]) if mi else 0) * 60


def parse(pid, text, posted):
    """Повертає ("event", {...}) / ("schedule", дата, {...}) / None."""
    low = text.lower()
    t = re.search(r"(\d{2})\.(\d{2})\.(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?", text)
    when = datetime(int(t[3]), int(t[2]), int(t[1]), int(t[4]), int(t[5]), int(t[6] or 0), tzinfo=KYIV) if t else posted

    if "графік" not in low and "група" not in low:
        if re.search(r"світло\s+(з'|з’|з)явил", low):
            return ("event", {"id": pid, "t": when.isoformat(), "on": True, "prev": duration(text)})
        if re.search(r"світло\s+(зникл|відсутн|вимкн|пропал)", low):
            return ("event", {"id": pid, "t": when.isoformat(), "on": False, "prev": duration(text)})
        return None

    d = re.search(r"(\d{2})\.(\d{2})\.(\d{4})", text)
    if not d:
        return None
    day = f"{d[3]}-{d[2]}-{d[1]}"
    # Слоти — лише з блоку «Планові відключення:». Перший рядок «Графік змінився: скасували
    # 12:00–15:30…» теж містить інтервали, але це опис змін, а не графік.
    plan = re.split(r"планові\s+відключення\s*:", text, flags=re.I)
    slots = re.findall(r"(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2})", plan[1]) if len(plan) > 1 else []
    first = text.split("\n", 1)[0]
    note = re.sub(r"^\W+", "", first).strip() if "змінив" in first.lower() else None
    return ("schedule", day, {
        "id": pid,
        "slots": [[a.zfill(5), b.zfill(5)] for a, b in slots],
        "emergency": "екстрен" in low and "скасов" not in low,
        "noOutages": not slots and ("без відключ" in low or "відключень не" in low),
        "note": note,  # «скасували відключення 12:00–15:30…»
    })


def main(path, local=None):
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        data = {"events": [], "schedules": {}, "lastId": 0}

    found = []
    if local:
        with open(local, encoding="utf-8") as f:
            found = posts(f.read())
    else:
        before = None
        full = not data["lastId"] or os.environ.get("FULL") == "1"  # FULL=1 — перезібрати історію
        for _ in range(BACKFILL_PAGES if full else 3):
            page = posts(fetch(before))
            if not page:
                break
            found += page
            before = min(p[0] for p in page)
            if not full and before <= data["lastId"]:
                break

    events = {e["id"]: e for e in data["events"]}
    for pid, text, posted in sorted(found):
        r = parse(pid, text, posted)
        if not r:
            continue
        if r[0] == "event":
            events[pid] = r[1]
        else:
            old = data["schedules"].get(r[1])
            if not old or old["id"] <= pid:  # пізніший пост про той самий день — актуальніший
                if old and r[2]["emergency"] and not r[2]["slots"]:  # «екстрені, графіки не діють» — плановий лишаємо
                    r[2]["slots"] = old["slots"]
                data["schedules"][r[1]] = r[2]

    now = datetime.now(KYIV)
    cutoff = (now - timedelta(days=KEEP_DAYS)).isoformat()
    data["events"] = sorted((e for e in events.values() if e["t"] >= cutoff), key=lambda e: e["t"])
    keep = (now - timedelta(days=14)).strftime("%Y-%m-%d")
    data["schedules"] = {k: v for k, v in sorted(data["schedules"].items()) if k >= keep}
    data["lastId"] = max([data["lastId"]] + [p[0] for p in found])
    data["updatedAt"] = now.isoformat(timespec="seconds")
    data["channel"] = CHANNEL

    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    print(f"Постів: {len(found)}, подій: {len(data['events'])}, графіків: {len(data['schedules'])}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
