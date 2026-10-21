# Biblioteca SNES com capas no pSNES

Escopo autorizado em 21/10/2026: importar os jogos já fornecidos pelo usuário e associar capas. Não significa baixar todos os jogos existentes de SNES. O pSNES já foi validado pelo usuário com um jogo de Mario, incluindo controles, som e estado salvo após reabrir. Isso não estende a validação a todos os jogos da coleção.

## Preparação da coleção

A ISO indicada contém 1.039 arquivos: 892 ROMs soltas e 147 ZIPs. Um ZIP contém quatro partes de um jogo e foi aberto em cópias independentes, resultando em **1.042 entradas**. A ISO original é somente lida. Arquivos antigos do pSNES mantêm o nome-base, para preservar associação com estados e SRAM. Nenhum save é convertido ou apagado. Como o pSNES usa o nome sem extensão para estados e configurações, novos arquivos de 25 grupos com nomes-base repetidos são diferenciados (26 renomeações), mantendo os três nomes já utilizados. A preparação aceita uma lista de nomes existentes a preservar.

As extensões das cópias são normalizadas para minúsculas, conforme o filtro do pSNES. Cada arquivo recebe SHA-256 e a biblioteca gera `gamelist.xml`. Jogos em ZIP com uma ROM permanecem compactados; ZIPs com múltiplas ROMs viram entradas separadas, sem executar ou extrair caminhos arbitrários do arquivo.

## Capas e identificação

A identificação usa SHA-1 do conteúdo da ROM contra o banco [No-Intro distribuído pelo Libretro](https://github.com/libretro/libretro-database/tree/master/metadat/no-intro). Um cabeçalho de copiador de 512 bytes é desconsiderado somente para identificação quando o tamanho corresponde ao formato; a ROM copiada permanece byte a byte igual à origem.

As imagens vêm do [repositório de miniaturas SNES do Libretro](https://github.com/libretro-thumbnails/Nintendo_-_Super_Nintendo_Entertainment_System). Fontes e revisão são registradas no manifesto local. Não há ROMs ou capas redistribuídas no Git ou no DMG do app.

Na coleção preparada:

| Categoria | Entradas |
|---|---:|
| Capas de títulos identificados pelo hash da ROM | 773 |
| Arte do jogo-base de versão modificada/não identificada | 68 |
| Cartões neutros, rotulados como capa original não identificada | 201 |
| Total | 1.042 |

Uma edição diferente do mesmo título pode fornecer a arte quando não existe imagem da edição exata. Versões associadas por cabeçalho recebem marcação de jogo-base no nome e no manifesto; isso não comprova a identidade exata da ROM. Famílias ambíguas não são associadas por aproximação. Ausência de correspondência ou falha no download gera um cartão neutro com o nome; não se usa a capa de outro jogo para esconder a falta de identificação.

O pSNES lê `<image type="mixrbv2">` no XML. As imagens são publicadas em `roms/media/mixrbv2/` com nomes derivados do conteúdo. Arquivos iguais podem compartilhar uma imagem. A opção de exibir nomes curtos dos ZIPs pode ser desativada para mostrar os títulos cadastrados.

## Cópia conservadora para o PS4

O destino de ROMs é `/data/psnes/roms/`. Cada arquivo novo é enviado com nome temporário, relido para conferir SHA-256 e então renomeado. Um arquivo existente só é reutilizado se o hash for idêntico; diferenças interrompem a cópia, preservando o existente. Saves, configurações por jogo e arquivos desconhecidos não são removidos.

A lista e a opção de nomes do emulador só são atualizadas após cópias e imagens estarem prontas, com pSNES fechado. XML e configuração anteriores ficam em backup. Entradas desconhecidas da lista existente devem ser preservadas. Após a atualização, reabrir o pSNES para reconstruir a biblioteca. Conferir um jogo previamente usado e seu estado salvo.

Preparação e transferência verificadas não comprovam jogabilidade de todas as entradas. Um jogo com tradução, hack ou requisitos especiais pode precisar de teste individual.

## Componentes locais

- `scripts/snes_library.py`: inventário da ISO, cópias, ZIPs, identificação e XML.
- `scripts/snes_art.py`: correspondência das capas, cache, cartões neutros e manifesto. Usa Pillow e uma fonte do macOS para os cartões.
- `scripts/snes_upload.py`: cópia FTP sem sobrescrever arquivos diferentes, com conferência remota.
- `scripts/test_snes_library.py`: regressões de identificação, cabeçalhos, ZIPs, capas, XML e FTP simulado.

Esses componentes ainda não constituem um novo painel do app. Não houve reformulação visual ou mudança no conversor PS2. A integração desses controles à interface é uma etapa própria.

```sh
python3 -m unittest discover -s scripts -p 'test*.py' -v
```

Os testes usam arquivos fictícios e FTP simulado. ISO, ROMs, imagens, recibos, backups e manifestos da coleção real permanecem somente na área local `ps4-package-assistant-local`, fora do iCloud e do repositório.

## Estado de entrega

Biblioteca e imagens preparadas localmente. A cópia para o PS4 e a atualização final da lista ainda estão em andamento; confirmar o recibo final e o teste visual antes de registrar conclusão.
