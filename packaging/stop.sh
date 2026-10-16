#!/bin/zsh
STATE_DIR="$HOME/Library/Application Support/PS4 Package Assistant"
PID_FILE="$STATE_DIR/server.pid"
if [[ -f "$PID_FILE" ]]; then
  IFS='|' read -r PID SERVER_PATH < "$PID_FILE"
  COMMAND="$(ps -p "$PID" -o command= 2>/dev/null)"
  if [[ -n "$COMMAND" && "$COMMAND" == *"$SERVER_PATH"* ]] && lsof -n -a -p "$PID" -iTCP:4173 -sTCP:LISTEN >/dev/null 2>&1; then kill "$PID"; fi
  rm -f "$PID_FILE"
fi
osascript -e 'display notification "Local server stopped." with title "PS4 Package Assistant"'
