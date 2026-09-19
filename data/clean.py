#!/usr/bin/env python3
"""Turn the raw 'Infinite Hipster Eclectic CDs' sheet export into albums.csv,
ready for Supabase's CSV importer.

Source columns (0-indexed) that matter:
  0 Artist   1 Album   3 Year   4 Score   8 RSP (random selection pool)
Everything else in the sheet (Fixed Score / Weight / CumWeight) is derived
from Score, and the app recomputes it at roll time -- see db/schema.sql.
"""
import csv, sys, pathlib

HERE = pathlib.Path(__file__).parent
SRC = HERE / "raw_sheet.csv"
OUT = HERE / "albums.csv"

# Two rows lost their artist somewhere in the sheet's history. Both albums are
# unambiguous, so they're filled in here rather than dropped.
ARTIST_FIXES = {
    "冀西南林路行 (Inside The Cable Temple)": "惘闻 [Wang Wen]",
    "The Year of Hibernation": "Youth Lagoon",
}

# Three albums appear twice, each time with one right year and one wrong one.
# Keyed by (artist, title) lowercased -> the year to keep.
DUPE_KEEP_YEAR = {
    ("lil peep", "lil peep; part one"): "2016",
    ("tropical fuck storm", "fairyland codex"): "2025",
    ("yellow magic orchestra", "yellow magic orchestra"): "1978",
}

VALID_SCORES = {70, 75, 80, 85, 90, 95, 100}


def main():
    rows = list(csv.reader(SRC.open(encoding="utf-8")))[1:]
    rows = [r for r in rows if len(r) > 8 and (r[0].strip() or r[1].strip())]

    out, seen, dropped, fixed = [], {}, [], 0
    for r in rows:
        artist, title, year, score, rsp = (
            r[0].strip(), r[1].strip(), r[3].strip(), r[4].strip(), r[8].strip()
        )
        if not artist:
            artist = ARTIST_FIXES.get(title, "")
            if artist:
                fixed += 1
            else:
                dropped.append(("no artist", title))
                continue

        key = (artist.lower(), title.lower())
        if key in DUPE_KEEP_YEAR and year != DUPE_KEEP_YEAR[key]:
            dropped.append(("dupe/wrong year", f"{artist} — {title} ({year})"))
            continue
        if key in seen:
            dropped.append(("dupe", f"{artist} — {title}"))
            continue
        seen[key] = True

        if score:
            n = int(float(score))
            if n not in VALID_SCORES:
                dropped.append(("bad score", f"{artist} — {title}: {score}"))
                n = None
        else:
            n = None

        out.append({
            "artist": artist,
            "title": title,
            "year": year if year.isdigit() else "",
            # blank -> NULL -> "not scored yet", which the roller treats as its
            # own bucket instead of lumping it in with the real 100s.
            "score": n if n is not None else "",
            # Blank RSP means yes; only an explicit "No" pulls it from the pool.
            "in_pool": "false" if rsp.lower() == "no" else "true",
        })

    with OUT.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["artist", "title", "year", "score", "in_pool"], lineterminator="\n")
        w.writeheader()
        w.writerows(out)

    scored = sum(1 for r in out if r["score"] != "")
    pooled = sum(1 for r in out if r["in_pool"] == "true")
    print(f"wrote {OUT} — {len(out)} albums")
    print(f"  scored:   {scored}  ({scored / len(out):.1%})")
    print(f"  in pool:  {pooled}")
    print(f"  artists:  {len({r['artist'] for r in out})}")
    print(f"  artist filled in: {fixed}")
    print(f"  dropped:  {len(dropped)}")
    for why, what in dropped:
        print(f"    - [{why}] {what}")


if __name__ == "__main__":
    sys.exit(main())
