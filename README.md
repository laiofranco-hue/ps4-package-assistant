# PS4 Package Assistant

A small macOS helper for sending a local `.pkg` file to the PS4 Remote Package Installer over a home network. It provides a browser interface, serves the selected package with HTTP byte-range support, and submits the install request to the PS4 API.

The application does not include package files or game content.

## Requirements

- macOS on Apple silicon or Intel
- Node.js 18 or later
- PS4 Remote Package Installer running on the console
- Mac and PS4 connected to the same local network

## Use the macOS app

1. Open `PS4-Package-Assistant.dmg` from the GitHub Releases page.
2. Drag `PS4-Package-Assistant.app` into Applications.
3. Open `PS4-Package-Assistant.app`; the interface opens in its own window. Choose the `.pkg` file.
4. Check the local IP addresses and click **Enviar ao PS4**. To swap the file mid-transfer, click **Interromper upload**.
5. Keep the Mac awake and connected until the PS4 download finishes.
6. To stop the local servers, use **Parar servidor de pacotes** in the app menu. Quitting the app also stops them.

The app serves its interface on <http://127.0.0.1:4173> inside its own window. The package server listens on port `8080`; the PS4 API uses port `12800`. While a transfer is prepared, port `8080` serves only the selected package and requires a random access token plus the PS4 IP entered in the interface. The macOS firewall may ask to allow incoming connections.

If macOS blocks the unsigned, non-notarized app, control-click it, choose **Open**, and confirm. Node.js 18 or later must be installed; the app searches Homebrew, NVM, Volta, asdf, and mise locations.

## Run from source

```sh
node server.js
```

Then open <http://localhost:4173>. Stop with `Ctrl+C`.

## Build the DMG

On a Mac with Node.js and the macOS command-line tools installed:

```sh
./packaging/build-dmg.sh
```

The resulting image is written to `dist/PS4-Package-Assistant.dmg`.

## Portuguese

Ferramenta local para macOS que seleciona um arquivo `.pkg`, hospeda-o com suporte a leitura por intervalos HTTP e envia o pedido de instalação ao Remote Package Installer do PS4. O aplicativo não inclui jogos nem arquivos PKG. Para instruções em português, consulte [LEIA-ME.txt](LEIA-ME.txt).
