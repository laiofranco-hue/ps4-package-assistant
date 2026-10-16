#!/bin/zsh
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
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
nohup /usr/bin/env node "$APP_DIR/server.js" >"$LOG_FILE" 2>&1 </dev/null &
echo "$!|$APP_DIR/server.js" > "$PID_FILE"
sleep 1
IFS='|' read -r PID SERVER_PATH < "$PID_FILE"
if ! lsof -n -a -p "$PID" -iTCP:4173 -sTCP:LISTEN >/dev/null 2>&1 || ! lsof -n -a -p "$PID" -iTCP:8080 -sTCP:LISTEN >/dev/null 2>&1; then
  osascript -e 'display alert "Não foi possível iniciar" message "Confira ~/Library/Application Support/PS4 Package Assistant/server.log. As portas 4173 e 8080 precisam estar livres."'
  exit 1
fi
open "http://localhost:4173"
exit 0
