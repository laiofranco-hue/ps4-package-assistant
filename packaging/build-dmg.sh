#!/bin/zsh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
APP="$STAGE/PS4-Package-Assistant.app"
mkdir -p "$ROOT/dist" "$APP/Contents/MacOS" "$APP/Contents/Resources"
swiftc -O -swift-version 5 -target "$(uname -m)-apple-macos11.0" -framework Cocoa -framework WebKit \
  -o "$APP/Contents/MacOS/PS4-Package-Assistant" "$ROOT/packaging/app/main.swift"
cp "$ROOT/packaging/app/Info.plist" "$APP/Contents/Info.plist"
cp "$ROOT/packaging/app/AppIcon.icns" "$APP/Contents/Resources/"
cp "$ROOT/server.js" "$ROOT/index.html" "$APP/Contents/Resources/"
cp "$ROOT/packaging/start.sh" "$ROOT/packaging/stop.sh" "$APP/Contents/Resources/"
chmod +x "$APP/Contents/MacOS/PS4-Package-Assistant" "$APP/Contents/Resources/start.sh" "$APP/Contents/Resources/stop.sh"
codesign --force --sign - "$APP"
cat > "$STAGE/INSTALL.txt" <<'TXT'
PS4 Package Assistant para Mac

1. Arraste PS4-Package-Assistant.app para Aplicativos.
2. Abra o app. A interface abre em uma janela do próprio app.
3. Selecione o PKG, confira os IPs e envie ao PS4. Use "Interromper upload" para trocar o arquivo.
4. Mantenha o Mac ligado e sem repouso até o download terminar.
5. Para parar o servidor, use o menu "Parar servidor de pacotes" ou feche o app.

Requer macOS, Node.js 18 ou posterior e o Remote Package Installer em execução no PS4.
O app não inclui jogos nem arquivos PKG. Portas: 4173 (interface local), 8081 (arquivo) e 12800 (API do PS4). O servidor de pacotes limita os pedidos ao IP informado do PS4 e exige um token aleatório por execução.
TXT
ln -s /Applications "$STAGE/Applications"
hdiutil create -volname 'PS4 Package Assistant' -srcfolder "$STAGE" -ov -format UDZO "$ROOT/dist/PS4-Package-Assistant.dmg"
