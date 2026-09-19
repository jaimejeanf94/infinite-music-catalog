#!/usr/bin/env python3
"""Collapse multi-disc releases into one album.

The spreadsheet tracked physical CDs, so a double album was two rows. This
catalogue is about albums, so it should be one.

Only *physical* divisions are merged -- "Disc 2", "CD1", "(Second Half)". A
numbered sequel is a different record and is left alone: Celestial Voyage
Pt. 1 and Pt. 2 are two albums, as are Tana Talk 3 and 4, and Black Sabbath's
Vol. 4. Getting that distinction wrong would silently destroy real entries.

Safe to run twice: a collection with nothing left to merge is unchanged.
"""
import csv, re, sys, unicodedata, pathlib
from collections import Counter, defaultdict

HERE = pathlib.Path(__file__).parent
SRC = HERE / "albums.csv"

DISC = re.compile(r"\(?\s*\b(?:disc|disk|cd)\s*\d+\b\s*\)?|\b(?:first|second|third)\s+half\b|\bcd\d+\b", re.I)
norm = lambda s: re.sub(r"[^a-z0-9]+", "", unicodedata.normalize("NFKD", s.lower()))

def base_title(title):
    t = DISC.sub(" ", title)
    t = re.sub(r"\(\s*\)|\[\s*\]", " ", t)          # emptied brackets
    t = re.sub(r"\s+", " ", t).strip()
    t = re.sub(r"[\s,;:\-–—+&/]+$", "", t).strip()   # trailing joiners: "1992-2012 - ", "KID A MNESIA +"
    return t or title

def main():
    rows = list(csv.DictReader(SRC.open(encoding="utf-8")))
    fields = list(rows[0].keys())

    groups = defaultdict(list)
    order = []
    for r in rows:
        key = (norm(r["artist"]), norm(base_title(r["title"])))
        if key not in groups:
            order.append(key)
        groups[key].append(r)

    out, merged = [], []
    for key in order:
        members = groups[key]
        if len(members) == 1 or not any(DISC.search(m["title"]) for m in members):
            out.extend(members)
            continue

        first = members[0]
        title = base_title(first["title"])
        # Scores never disagreed across discs in this collection, but take the
        # highest if they ever do: the better opinion of a record you own once.
        scores = [int(m["score"]) for m in members if m["score"]]
        years = [m["year"] for m in members if m["year"]]
        notes = [m.get("notes", "") for m in members if m.get("notes")]

        row = dict(first)
        row["title"] = title
        row["score"] = str(max(scores)) if scores else ""
        row["year"] = Counter(years).most_common(1)[0][0] if years else ""
        row["in_pool"] = "true" if any(m["in_pool"] != "false" for m in members) else "false"
        if "notes" in row:
            row["notes"] = " / ".join(notes)
        # The old artwork and ids belong to a disc, not to the album; clearing
        # them lets enrichment match the real release, which it does far better.
        for f in ("genres", "mbid", "cover_url"):
            if f in row:
                row[f] = ""
        out.append(row)
        merged.append((first["artist"], title, [m["title"] for m in members]))

    with SRC.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields, lineterminator="\n")
        w.writeheader()
        w.writerows(out)

    print(f"{len(rows)} albums -> {len(out)} ({len(rows) - len(out)} rows merged away)")
    print(f"{len(merged)} releases collapsed:\n")
    for artist, title, parts in merged:
        print(f"  {artist[:26]:26} {title[:44]:44} ({len(parts)} discs)")

if __name__ == "__main__":
    sys.exit(main())
