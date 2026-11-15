#!/bin/zsh
# Daily snapshot of an Apple Music playlist as "Artist - Song" lines (same format
# TuneMyMusic imports). Keeps the newest $KEEP snapshots, unless the playlist
# size jumped sharply either way (a sync wipe, or a sync loop duplicating songs):
# then nothing is deleted, so the bad day can't push the good copies out.
#
# Its last step mirrors the playlist into the catalogue's database, for the
# Playlist screen (scripts/sync-playlist.mjs). That step sits after the size
# check on purpose: a suspicious night is saved here as a snapshot and goes no
# further. And it sits after the snapshot is on disk, so a failed sync can
# never cost a backup.
#
# Runs at 21:00 from launchd; scripts/install-playlist-backup.sh sets that up.
# Snapshots and the log live in data/playlist-backups/, which git ignores.

# The playlist is found by its persistent ID, so renaming it doesn't break this.
# Get it with: osascript -e 'tell application "Music" to get persistent ID of user playlist "NAME"'
PLAYLIST_ID="394006C178D52AD2"
LABEL="Überplaylist"   # backup file prefix
KEEP=7
CHANGE_LIMIT=20   # % change from the previous snapshot that counts as suspicious

REPO="${0:A:h:h}"
DIR="$REPO/data/playlist-backups"
NODE="/opt/homebrew/bin/node"   # launchd's PATH does not include Homebrew
mkdir -p "$DIR"
LOG="$DIR/backup.log"
TODAY=$(date +%Y-%m-%d)
OUT="$DIR/$LABEL $TODAY.txt"

log() { echo "$(date '+%F %T')  $*" >> "$LOG" }
# Notifications from this background job never showed up, so use an alert that stays
# on screen until dismissed. It gives up after 20h so it can't block the next run.
notify() { osascript -e 'on run argv' -e 'display alert "Playlist backup" message (item 1 of argv) as critical giving up after 72000' -e 'end run' "$1" >/dev/null 2>&1 }

list=$(osascript - "$PLAYLIST_ID" <<'EOF' 2>>"$LOG"
on run argv
	set pid to item 1 of argv
	tell application "Music"
		set p to first user playlist whose persistent ID is pid
		set ars to artist of every track of p
		set nms to name of every track of p
	end tell
	set out to {}
	repeat with i from 1 to count of nms
		set end of out to (item i of ars) & " - " & (item i of nms)
	end repeat
	set AppleScript's text item delimiters to linefeed
	return out as text
end run
EOF
)

if [[ -z "$list" ]]; then
	log "FAILED: could not read playlist $PLAYLIST_ID (see error above)"
	notify "Could not back up $LABEL. Was the playlist deleted?"
	exit 1
fi

count=$(print -r -- "$list" | wc -l | tr -d ' ')
prev=$(ls -1 "$DIR/$LABEL "*.txt 2>/dev/null | grep -v " $TODAY.txt$" | sort | tail -1)
prev_count=$([[ -n "$prev" ]] && wc -l < "$prev" | tr -d ' ' || echo 0)

print -r -- "$list" > "$OUT"

if (( prev_count > 0 && (count * 100 < prev_count * (100 - CHANGE_LIMIT) || count * 100 > prev_count * (100 + CHANGE_LIMIT)) )); then
	log "WARNING: $count songs, was $prev_count in $(basename "$prev"). Saved, but NOT deleting old backups."
	notify "$LABEL went from $prev_count to $count songs. Old backups kept."
	exit 0
fi

ls -1 "$DIR/$LABEL "*.txt | sort -r | tail -n +$((KEEP + 1)) | while read -r old; do
	rm -- "$old" && log "pruned $(basename "$old")"
done
log "saved $count songs to $(basename "$OUT")"

# The same playlist, into Postgres. The credentials are the ones every other
# script here uses, read inside a subshell so they never outlive this step.
if ( set -a; source "$REPO/.env"; set +a
     "$NODE" "$REPO/scripts/sync-playlist.mjs" --playlist-id="$PLAYLIST_ID" ) >> "$LOG" 2>&1; then
	log "synced $count songs to the catalogue"
else
	log "FAILED: catalogue sync (see error above)"
	notify "$LABEL was backed up, but the catalogue sync failed."
fi
