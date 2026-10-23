"""Збирає votes.js для сайту з реєстру власників (registry_*.xlsx).

На сайт потрапляють ЛИШЕ агрегати: скільки квартир у ДАХ по кожній секції
і загальна площа. Номери квартир, поверхи, імена й телефони не публікуються
(сайт підсвічує вікна випадково).

Запуск:  python3 tools/build_votes.py шлях/до/registry.xlsx
"""
import json
import re
import sys
from datetime import datetime
from statistics import median

import openpyxl

SHEET = "Реєстр мешканців"
COL_APT, COL_AREA, COL_DAH = 0, 1, 6  # A, B, G
IN_DAH = "✅ У ДАХ"
BASE_AREA = 50258.3  # квартири + нежитлові, з листа «Лічильник»


def section_starts():
    """Перші квартири секцій беремо з data.js (`first: N`), щоб не дублювати розкладку."""
    with open("data.js", encoding="utf-8") as f:
        return sorted(int(n) for n in re.findall(r"first:\s*(\d+)", f.read()))


def area(v):
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        try:
            return float(v.replace(",", ".").strip())
        except ValueError:
            return None
    return None


def apt_id(v):
    """1.0 -> 1, "337-1" -> "337-1", інше -> None."""
    if isinstance(v, (int, float)):
        return int(v)
    if isinstance(v, str) and re.fullmatch(r"\d+-\d+", v.strip()):
        return v.strip()
    return None


def main(path):
    ws = openpyxl.load_workbook(path, data_only=True, read_only=True)[SHEET]
    rows = [r for r in ws.iter_rows(values_only=True) if r and apt_id(r[COL_APT]) is not None]

    known = [a for a in (area(r[COL_AREA]) for r in rows) if a]
    fill = median(known)  # для квартир без площі в реєстрі
    starts = section_starts()
    sections = [{"total": 0, "inDah": 0} for _ in starts]
    dah_area, estimated = 0.0, 0
    for r in rows:
        in_dah = r[COL_DAH] == IN_DAH
        n = int(str(apt_id(r[COL_APT])).split("-")[0])
        sec = sections[max(i for i, f in enumerate(starts) if n >= f)]
        sec["total"] += 1
        sec["inDah"] += in_dah
        if in_dah:
            a = area(r[COL_AREA])
            if a is None:
                a, estimated = fill, estimated + 1
            dah_area += a

    out = {
        "updatedAt": datetime.now().strftime("%Y-%m-%dT%H:%M"),
        "baseArea": BASE_AREA,
        "dahArea": round(dah_area, 1),
        "areaEstimated": estimated,
        "sections": sections,
    }
    with open("votes.js", "w", encoding="utf-8") as f:
        f.write("// Згенеровано tools/build_votes.py — не редагуйте вручну.\n")
        f.write("window.VOTES = " + json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";\n")
    total, n = sum(x["total"] for x in sections), sum(x["inDah"] for x in sections)
    print(f"Квартир: {total}, у ДАХ: {n}, по секціях: {[x['inDah'] for x in sections]}, площа в ДАХ: {dah_area:.1f} м² "
          f"({dah_area / BASE_AREA:.1%} від {BASE_AREA} м²), площу оцінено для {estimated} кв.")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "registry.xlsx")
