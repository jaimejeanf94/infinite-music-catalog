#!/bin/zsh
# install-playlist-backup.sh — schedule scripts/playlist-backup.sh on this Mac.
#
#   zsh scripts/install-playlist-backup.sh
#
# Writes the launchd agent that runs the backup at 21:00 every night and loads
# it, replacing any agent of the same name -- which is how the job was moved
# here from ~/playlist-backups without changing its label or its hour. Safe to
# run again: after moving this folder, say, since the agent holds the script's
# full path.
#
# The agent file is written from where this repo actually is rather than
# committed, so no machine's path sits in a public repo.
#
# If the Mac is asleep at 21:00, launchd runs the job when it wakes. If it is
# switched off, that night is skipped; the next run brings the snapshot and the
# database fully up to date, because both are written whole every time.
#
# To stop it:  launchctl bootout gui/$UID/com.jaimejean.uberplaylist-backup

LABEL="com.jaimejean.uberplaylist-backup"
REPO="${0:A:h:h}"
SCRIPT="$REPO/scripts/playlist-backup.sh"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

[[ -f "$SCRIPT" ]] || { echo "Cannot find $SCRIPT"; exit 1 }

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>$LABEL</string>
	<key>ProgramArguments</key>
	<array>
		<string>/bin/zsh</string>
		<string>$SCRIPT</string>
	</array>
	<key>StartCalendarInterval</key>
	<dict>
		<key>Hour</key>
		<integer>21</integer>
		<key>Minute</key>
		<integer>0</integer>
	</dict>
</dict>
</plist>
EOF

# bootout fails when nothing is loaded yet, which is fine on a first install.
launchctl bootout "gui/$UID/$LABEL" 2>/dev/null
launchctl bootstrap "gui/$UID" "$PLIST" || { echo "launchd refused $PLIST"; exit 1 }

echo "Scheduled: $SCRIPT"
echo "           every night at 21:00, as $LABEL"
echo "Run it now: launchctl kickstart gui/$UID/$LABEL"
echo "Its log:    $REPO/data/playlist-backups/backup.log"
