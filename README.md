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

## Plano de evolução

Veja [Plano e passagem de trabalho](docs/PLANO-E-CONTINUACAO.md) para o estado entregue, decisões, propostas de biblioteca/sincronização, novas plataformas e estratégia de implementação. As funções futuras ainda não estão implementadas.

## Biblioteca local — primeira etapa

Use **Adicionar jogos** para escolher arquivos ou **Adicionar pasta** para importar pastas e subpastas do Mac/HD externo. **Incluir convertidos** adiciona a pasta de resultados do conversor. Nenhuma origem é pesquisada antes de você a escolher.

**Sincronizar biblioteca** atualiza o catálogo manualmente; pesquisa e filtros permitem localizar arquivos por nome, plataforma e disponibilidade. A primeira leitura calcula SHA-256 completo; as próximas reutilizam hashes quando os atributos do arquivo não mudam. Você pode cancelar a sincronização, preservando o catálogo anterior. Links simbólicos e diretórios internos ocultos não são percorridos. Origens muito grandes precisam ser divididas em pastas menores.

Arquivos ausentes e HDs desconectados continuam no catálogo. Cópias idênticas são sinalizadas, sem excluir arquivos. Uma mudança de caminho só é associada automaticamente quando existe uma correspondência única pelo hash completo, sem ambiguidade e com a origem anterior disponível. **Retirar origem** remove apenas suas referências do catálogo; não apaga jogos no disco.

**Preparar PS2** seleciona a ISO na conversão existente; **Usar PKG no envio** seleciona o pacote. Nenhuma ação da biblioteca inicia conversão, envio ou exclusão no PS4 automaticamente. ISOs sem identificação pedem confirmação explícita de PS2; PS1, PSP e ROMs retrô ficam somente no catálogo nesta etapa. Formato/identificação não comprovam compatibilidade no console.

O catálogo fica em `~/Library/Application Support/PS4 Package Assistant/library/library.json`, fora do iCloud Drive e do Git. Os caminhos e os arquivos dos jogos permanecem locais. Um catálogo inválido é preservado e sua edição fica bloqueada, sem impedir as funções existentes do app.

Testes: `node --test test-library.cjs test-library-api.cjs test-conversion.cjs test-transfer.cjs`. Para testes isolados do servidor, `LIBRARY_DATA_DIR` define outra pasta de catálogo.

## Fila de conversão e envio

Prepare a ISO e suas opções e use **Adicionar conversão à fila**, ou selecione um PKG, confira os IPs e use **Adicionar envio à fila**. Repita para os próximos arquivos e clique em **Iniciar fila**. Há uma tarefa por vez e até 100 pendentes. A fila guarda o arquivo, título, emulador, resolução, capa e IPs de cada tarefa; mudar a seleção depois não altera tarefas já adicionadas. Originais e resultados anteriores são preservados.

**Pausar após a tarefa atual** segura as próximas. Você pode retirar uma tarefa pendente ou cancelar a conversão atual. **Parar acompanhamento** de um envio não cancela o download no console; o pacote continua servido enquanto o app estiver aberto. O controle anterior **Interromper upload** interrompe a leitura dos pacotes no Mac, sem excluir tarefas/jogos no PS4.

Conversões mostram o registro real do conversor, sem percentual estimado. Envios consultam os bytes de `get_task_progress` do [Remote Package Installer](https://github.com/flatz/ps4_remote_pkg_installer). Pedido aceito não significa transferência concluída: o app exige total positivo, todos os bytes recebidos e erro zero. A instalação e a abertura do jogo devem ser conferidas no console.

Em falhas, a fila pausa. Se a resposta da instalação se perder, a situação fica **Conferir no PS4**, sem reenvio automático. Com o número da tarefa disponível, **Consultar progresso** acompanha a mesma tarefa. **Criar nova tentativa** preserva o registro anterior; um envio incerto exige conferir Downloads e confirmar antes de repetir, pois pode duplicá-lo.

Após reabrir o app, tarefas pendentes aguardam **Iniciar fila**; conversões interrompidas não reiniciam automaticamente e envios precisam ser conferidos. O acesso de um download já solicitado é recuperado apenas para o arquivo original inalterado, com o mesmo token e restrição ao IP do PS4. Isso não inicia um novo pedido de instalação. Alterações no arquivo bloqueiam execução/leitura. O Mac precisa permanecer acordado e o instalador deve estar em primeiro plano para responder às consultas.

Conversão e envio continuam separados: no histórico, **Usar PKG no envio** seleciona um resultado para adicioná-lo à fila de envios. Nenhum resultado convertido é enviado automaticamente. O histórico e os tokens ficam somente em `~/Library/Application Support/PS4 Package Assistant/queue/queue.json`, com acesso local restrito, fora do Git e do iCloud. Histórico ilegível é preservado em modo de leitura. Não há integração PS1/SNES nesta etapa.

Verificação completa, com console/conversor de teste e sem jogos reais:

```sh
node --test --test-concurrency=1 test-queue.cjs test-queue-api.cjs test-library.cjs test-library-api.cjs test-conversion.cjs test-transfer.cjs
```

Os testes de API usam a porta local 12800 e são executados em sequência. `QUEUE_DATA_DIR` isola fila/histórico em testes, assim como `LIBRARY_DATA_DIR` isola o catálogo.

### ISO sem identificador de inicialização de PS2

Se o conversor informar que não encontrou o serial de inicialização (por exemplo, `SLUS_209.32`), o app mostra essa causa e preserva o registro original. Algumas imagens caseiras iniciam um ELF de emulador sem esse identificador; não são aceitas pelo conversor atual. Isso não comprova corrupção da ISO. Trocar título, capa ou resolução não fornece o identificador ausente. A biblioteca de SNES/retrôs depende de uma integração própria, ainda pendente, e não é implementada pela conversão PS2 existente.

## Prova de SNES em preparação

O [teste de pSNES no PS4](docs/TESTE-SNES-PS4.md) prepara a próxima integração com biblioteca de vários jogos. O pacote do emulador foi conferido localmente; execução, controles e salvamento no console ainda estão pendentes. `scripts/prepare-snes-test.py` copia até três ROMs explicitamente escolhidas para uma pasta local nova e registra hashes, sem instalar ou enviar nada. Essa ferramenta não acrescenta suporte SNES ao conversor PS2 nem ao app instalado.

## Coleção SNES e capas

O [procedimento de biblioteca SNES com capas](docs/BIBLIOTECA-SNES-CAPAS.md) descreve importação da ISO fornecida, identificação por conteúdo, capas do Libretro e cópia FTP que preserva arquivos existentes e saves. Versões não identificadas usam arte do jogo-base explicitamente sinalizada ou cartões neutros. Os componentes são ferramentas locais; ainda não há novo painel SNES no app. Conteúdo dos jogos e imagens permanecem fora do Git e do DMG.
