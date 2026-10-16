#!/bin/zsh
RESOURCES="$(cd "$(dirname "$0")" && pwd)"
STATE_DIR="$HOME/Library/Application Support/PS4 Package Assistant"
PID_FILE="$STATE_DIR/server.pid"
LOG_FILE="$STATE_DIR/server.log"
mkdir -p "$STATE_DIR"
if [[ -f "$PID_FILE" ]]; then
  IFS='|' read -r PID SERVER_PATH < "$PID_FILE"
  COMMAND="$(ps -p "$PID" -o command= 2>/dev/null)"
  if [[ -n "$COMMAND" && "$COMMAND" == *"$SERVER_PATH"* ]] && lsof -n -a -p "$PID" -iTCP:4173 -sTCP:LISTEN >/dev/null 2>&1 && lsof -n -a -p "$PID" -iTCP:8080 -sTCP:LISTEN >/dev/null 2>&1; then
    open "http://localhost:4173"
    exit 0
  fi
fi
NODE_BIN=""
for candidate in /opt/homebrew/bin/node /usr/local/bin/node; do
  if [[ -x "$candidate" ]]; then NODE_BIN="$candidate"; break; fi
done
if [[ -z "$NODE_BIN" ]]; then
  osascript -e 'display alert "Node.js not found" message "Install Node.js and open PS4 Package Assistant again."'
  exit 1
fi
nohup "$NODE_BIN" "$RESOURCES/server.js" >"$LOG_FILE" 2>&1 </dev/null &
echo "$!|$RESOURCES/server.js" > "$PID_FILE"
sleep 1
IFS='|' read -r PID SERVER_PATH < "$PID_FILE"
READY=false
for attempt in {1..10}; do
  if lsof -n -a -p "$PID" -iTCP:4173 -sTCP:LISTEN >/dev/null 2>&1 && lsof -n -a -p "$PID" -iTCP:8080 -sTCP:LISTEN >/dev/null 2>&1; then READY=true; break; fi
  sleep 0.3
done
if [[ "$READY" != true ]]; then
  osascript -e 'display alert "Could not start" message "Check ~/Library/Application Support/PS4 Package Assistant/server.log. Ports 4173 and 8080 must be free."'
  exit 1
fi
open "http://localhost:4173"
