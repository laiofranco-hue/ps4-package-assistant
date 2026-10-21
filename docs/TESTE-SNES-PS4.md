# Prova de SNES no PS4

Preparação em 21/10/2026. Autorização do usuário: testar um emulador com pequena biblioteca antes da integração ao app. **Ainda não validado no console.** O app atual continua oferecendo catálogo de ROMs; esta etapa não adiciona conversão SNES → PKG nem sincronização remota.

## Candidato escolhido para o teste

[pSNES, do projeto pEMU](https://github.com/Cpasjuste/pemu/tree/v7.2/src/cores/psnes), baseado em Snes9x. O projeto oferece PKG nativo de PS4 e biblioteca com vários jogos. A [release v7.2](https://github.com/Cpasjuste/pemu/releases/tag/v7.2) inclui correção de tela preta no início do PS4 e correção de persistência de configurações. Isso é informação do desenvolvedor, não comprovação no console do usuário.

RetroArch continua como alternativa para outros sistemas. A [página de plataformas do RetroArch](https://www.retroarch.com/platforms.php) informa que os pacotes de PS4 disponíveis são não oficiais. Começar pelo pSNES reduz a prova inicial a um emulador e um sistema; não descarta integração multiplataforma posterior.

Pacote conferido a partir da release do desenvolvedor:

- Arquivo: `IV0001-PSNE00001_00-PSNE000017020000.pkg`
- Tamanho: `37814272` bytes
- Title ID: `PSNE00001`
- SHA-256: `55e3544a4f30f1cb49b8514771b6a173f0a3c852fb7155cda4751c60e228210b`
- [Download na release do desenvolvedor](https://github.com/Cpasjuste/pemu/releases/download/v7.2/IV0001-PSNE00001_00-PSNE000017020000.pkg)

A cópia local está em `~/.codex/.chatgpt-projects/ps4-package-assistant-local/emulators/psnes/v7.2/`, acompanhada de `verified.json`. Tamanho, magic do PKG, content ID e SHA-256 foram conferidos. O pacote não está no repositório nem no DMG do app. Nenhuma ROM é distribuída pelo projeto.

## Preparar a pequena biblioteca

Selecionar explicitamente de uma a três ROMs `.sfc`/`.smc` já disponíveis para o teste. A ISO SNES Station não é uma ROM de SNES; não usar o conversor de PS2 para prepará-la. Se os jogos estiverem numa ISO ou ZIP, primeiro localizar e selecionar os arquivos que serão extraídos em cópia, sem modificar a origem e sem importar toda a coleção automaticamente.

Ferramenta local, sem dependências adicionais:

```sh
python3 scripts/prepare-snes-test.py '/caminho/do/primeiro.sfc' '/caminho/do/segundo.smc'
```

Cada execução cria uma pasta `snes-teste-*` em `~/.codex/.chatgpt-projects/ps4-package-assistant-local/outputs/SNES-tests/`, contendo `roms/` e `manifest.json`. Copia apenas os arquivos escolhidos, verifica SHA-256 das cópias, rejeita nomes repetidos e não altera originais ou resultados anteriores. O manifesto não registra caminhos pessoais da origem. Todos os resultados de console ficam marcados como pendentes.

A ferramenta não verifica compatibilidade da ROM, não abre FTP, não instala nada e não prepara PKG de jogos. A opção `--output-root` permite testar outro diretório local; Desktop, Documents e raízes comuns de nuvem são recusados. Essa proteção não detecta todo provedor de nuvem personalizado: usar a raiz local padrão é a opção recomendada.

## Procedimento no console

1. PS4 ligado na mesma rede; abrir Remote Package Installer em primeiro plano. Conferir IP atual, versão do sistema/GoldHEN e se pSNES já está instalado. Se houver instalação anterior, preservar configurações, SRAM e estados antes de considerar atualização.
2. Instalar o PKG conferido pelo envio já existente. Acompanhar transferência e instalação; não confundir pedido aceito com conclusão. Não excluir jogos ou tarefas anteriores automaticamente.
3. Habilitar o servidor FTP no GoldHEN. A documentação do [GoldHEN](https://github.com/GoldHEN/GoldHEN) informa a porta `2121`; confirmar a porta e as opções do console real. A pasta de ROMs do pSNES no PS4 é `/data/psnes/roms/`, conforme o [README específico do emulador](https://github.com/Cpasjuste/pemu/blob/v7.2/src/cores/psnes/README.MD).
4. Copiar somente as ROMs selecionadas para essa pasta. Conferir arquivos existentes antes de enviar; não sobrescrever ROMs diferentes com o mesmo nome nem tocar em saves/configuração. Configurações e listas definitivas serão tratadas depois da prova.
5. Abrir pSNES e confirmar a biblioteca. Testar abertura, direcional, botões e áudio/vídeo de cada jogo. O usuário precisa validar a resposta no controle e na TV; acesso à API de instalação não prova isso.
6. No menu do emulador, salvar um estado, avançar no jogo, carregar o estado e confirmar retorno. Reabrir o emulador e repetir a carga. Para um jogo que oferece salvamento interno, salvar pelo próprio jogo, sair normalmente do emulador, reabrir e confirmar o progresso. A implementação distingue estados de SRAM; testar os dois separadamente.

## Registro de aceitação

| Verificação | Estado inicial |
|---|---|
| Integridade do PKG baixado | Conferida localmente |
| Ferramenta de preparação/cópia | Dois testes automatizados com fixtures passaram |
| ROMs reais selecionadas | Pendente de caminho fornecido pelo usuário |
| Transferência e instalação do pSNES | Pendente |
| Abertura do pSNES e biblioteca | Pendente |
| Abertura dos jogos, controle, áudio/vídeo | Pendente |
| Estado salvo e recarregado após reabrir | Pendente |
| Salvamento interno do jogo após reabrir | Pendente |

Em falhas: registrar versão, jogo, etapa e mensagem/código. Não marcar suporte geral a SNES a partir de uma instalação bem-sucedida. A integração no app só deve começar após a prova real e terá como proposta selecionar pasta, preparar/enviar cópias e atualizar a biblioteca sem apagar saves ou arquivos desconhecidos. O desenho definitivo desse fluxo ainda depende do resultado do teste.

## Verificação da ferramenta local

```sh
python3 -m unittest discover -s scripts -p 'test_prepare_snes.py' -v
```

Os testes usam arquivos fictícios temporários, sem ROMs comerciais, acesso ao console ou envio de rede.
