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
NODE_BIN=""
setopt nonomatch
for candidate in /opt/homebrew/bin/node /usr/local/bin/node "$HOME"/.nvm/versions/node/*/bin/node "$HOME"/.volta/bin/node "$HOME"/.asdf/shims/node "$HOME"/.local/share/mise/shims/node; do
  [[ -x "$candidate" ]] || continue
  NODE_MAJOR="$("$candidate" -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || print 0)"
  if [[ "$NODE_MAJOR" == <-> ]] && (( NODE_MAJOR >= 18 )); then NODE_BIN="$candidate"; break; fi
done
if [[ -z "$NODE_BIN" ]]; then
  osascript -e 'display alert "Node.js 18+ não encontrado" message "Instale uma versão compatível do Node.js e tente novamente."'
  exit 1
fi
nohup "$NODE_BIN" "$APP_DIR/server.js" >"$LOG_FILE" 2>&1 </dev/null &
echo "$!|$APP_DIR/server.js" > "$PID_FILE"
IFS='|' read -r PID SERVER_PATH < "$PID_FILE"
READY=false
for attempt in {1..10}; do
  if lsof -n -a -p "$PID" -iTCP:4173 -sTCP:LISTEN >/dev/null 2>&1 && lsof -n -a -p "$PID" -iTCP:8080 -sTCP:LISTEN >/dev/null 2>&1; then READY=true; break; fi
  sleep 0.3
done
if [[ "$READY" != true ]]; then
  osascript -e 'display alert "Não foi possível iniciar" message "Confira ~/Library/Application Support/PS4 Package Assistant/server.log. As portas 4173 e 8080 precisam estar livres."'
  exit 1
fi
open "http://localhost:4173"
exit 0
