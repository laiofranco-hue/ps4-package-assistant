#!/bin/zsh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
APP="$STAGE/PS4-Package-Assistant.app"
STOP="$STAGE/Stop-PS4-Package-Assistant.app"
mkdir -p "$ROOT/dist"
osacompile -o "$APP" "$ROOT/packaging/start.applescript"
osacompile -o "$STOP" "$ROOT/packaging/stop.applescript"
mkdir -p "$APP/Contents/Resources" "$STOP/Contents/Resources"
cp "$ROOT/server.js" "$ROOT/index.html" "$APP/Contents/Resources/"
cp "$ROOT/packaging/start.sh" "$APP/Contents/Resources/start.sh"
cp "$ROOT/packaging/stop.sh" "$STOP/Contents/Resources/stop.sh"
chmod +x "$APP/Contents/Resources/start.sh" "$STOP/Contents/Resources/stop.sh"
python3 - "$APP" "$STOP" <<'PY'
import shutil, sys
from pathlib import Path
for app in map(Path, sys.argv[1:]):
    shutil.rmtree(app / 'Contents' / '_CodeSignature', ignore_errors=True)
PY
cat > "$STAGE/INSTALL.txt" <<'TXT'
PS4 Package Assistant para Mac

1. Arraste PS4-Package-Assistant.app e Stop-PS4-Package-Assistant.app para Aplicativos.
2. Abra PS4-Package-Assistant.app. A interface local abre no navegador.
3. Selecione o PKG, confira os IPs e envie ao PS4.
4. Mantenha o Mac ligado e sem repouso até o download terminar.
5. Abra Stop-PS4-Package-Assistant.app para desligar os servidores locais.

Requer macOS, Node.js 18 ou posterior e o Remote Package Installer em execução no PS4.
O app não inclui jogos nem arquivos PKG. Portas: 4173 (interface local), 8080 (arquivo) e 12800 (API do PS4). O servidor de pacotes limita os pedidos ao IP informado do PS4 e exige um token aleatório por execução.
TXT
ln -s /Applications "$STAGE/Applications"
hdiutil create -volname 'PS4 Package Assistant' -srcfolder "$STAGE" -ov -format UDZO "$ROOT/dist/PS4-Package-Assistant.dmg"
