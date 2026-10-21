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

The app serves its interface on <http://127.0.0.1:4173> inside its own window. The package server listens on port `8081`; the PS4 API uses port `12800`. While a transfer is prepared, port `8081` serves only the selected package and requires a random access token plus the PS4 IP entered in the interface. The macOS firewall may ask to allow incoming connections.

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

## Compatibilidade com downloads do PS4

O token de acesso vai no caminho da URL, antes do nome do pacote. O download em segundo plano do PS4 pode omitir parâmetros de consulta; colocar o token após `?` fazia a leitura inicial funcionar e o download seguinte receber HTTP 403. O acesso continua restrito ao IP selecionado e ao token aleatório.

Para uso pelo Terminal, `PKG_FILE` pode indicar o caminho local do pacote antes de iniciar `node server.js`. Não feche o servidor durante o download.

Teste de regressão: `node --test test-transfer.cjs`.

## Converter ISO de PS2

No primeiro passo, abra **Converter ISO de PS2 em PKG**, selecione a ISO e escolha nome, emulador (Jak v2 ou Rogue v1) e resolução (1× ou 2×). Clique em **Converter em PKG**. O registro mostra as etapas; o botão de cancelar interrompe a conversão e preserva a ISO. O PKG concluído fica selecionado no envio, que continua sendo uma ação separada.

A integração usa [easy-ps2-fpkg v1.2.0](https://github.com/spiral009/easy-ps2-fpkg/releases/tag/v1.2.0). No primeiro uso em Mac Apple Silicon, baixa o executável oficial, verifica seu SHA-256 fixado antes de executar e aplica assinatura local. O executável fica em Application Support/PS4 Package Assistant/converter. Os arquivos de emulador são obtidos pela própria ferramenta. Não há jogos ou emuladores no repositório ou no DMG. A conversão integrada está disponível em Mac Apple Silicon; o envio de PKG continua independente.

Os resultados vão para `~/.codex/.chatgpt-projects/ps4-package-assistant-local/outputs/PS2-PKG/`, em uma subpasta exclusiva por conversão. Isso evita iCloud Drive e sobrescrita de pacotes anteriores. Fechar o app interrompe conversões em andamento. Nenhum pacote é enviado automaticamente e nenhum conteúdo é publicado no GitHub. A validação do pacote não comprova compatibilidade do jogo no PS4.

Validação: `node --test test-conversion.cjs test-transfer.cjs`. `ISO_FILE` permite selecionar a ISO ao iniciar pelo Terminal, sem mudar o seletor do app.

Depois de converter, use **Mostrar PKG no Finder** para revelar o arquivo ou **Abrir pasta de convertidos** para localizar resultados anteriores. O último resultado é lembrado localmente mesmo depois de reabrir o app; nenhum caminho pessoal é publicado no repositório.

### Capa personalizada

Na conversão, use **Escolher capa** para selecionar PNG ou JPG. O app mostra uma prévia e gera uma cópia PNG de 512 × 512 pixels, mantendo a proporção e completando com bordas pretas. A imagem original permanece intacta. **Remover capa** volta à capa padrão. A escolha vale para as conversões da sessão e não altera pacotes já instalados; para atualizar o ícone no PS4 é necessário gerar e instalar o novo PKG.
