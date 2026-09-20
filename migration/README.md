# Migration (historical)

Nothing in here runs any more. It is kept because it documents how 4,400
albums got from a Google Sheet into Postgres, and because the shape of the
original data explains some of the oddities still in the catalogue.

**The source of truth is now the `albums` table in Supabase.** The spreadsheet
is not read by anything, `data/albums.csv` is a backup written *out* of the
database each night, and none of these files are referenced by the app, the
scripts, or the nightly workflow.

| File | What it did, once |
|---|---|
| `raw_sheet.csv` | Untouched export of the "Infinite Hipster Eclectic CDs" tab |
| `clean.py` | Trimmed it into `data/albums.csv` — whitespace, blank rows, the `RSP` column becoming `in_pool` |
| `merge-discs.py` | Collapsed albums split across physical discs: 96 rows into 42, leaving numbered sequels alone |
| `after-backfill.sh` | Waited for the first 4,400-album enrichment run, then swept the gaps. The nightly workflow does this on a schedule now |

`merge-discs.py` is worth knowing about: it renumbered every row below the
first merge, which is what put cached covers on the wrong albums back when
local edits were keyed by row position. Nothing is keyed that way any more —
see "What overwrites what" in the README.
