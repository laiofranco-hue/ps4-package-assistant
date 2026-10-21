# Plano e passagem de trabalho

Atualizado em 21/10/2026. Etapas autorizadas: biblioteca funcional e, após aprovação do usuário, fila de conversão/envio com progresso e histórico. Acabamento visual depois.

## Estado entregue

O app instalado oferece envio remoto de PKG, conversão de ISO de PS2, nome opcional, seleção Jak v2/Rogue v1 e resolução, registro e cancelamento. O resultado fica selecionado para envio, com acesso pelo Finder e lembrança local do último arquivo. A capa personalizada aceita PNG/JPG, gera cópia de 512×512 sem deformar e mostra prévia.

O envio usa token no caminho da URL, leitura por intervalos e isolamento por transferência. O parser reconhece erros hexadecimais retornados pelo console. As portas atuais são 4173 para a interface e 8081 para arquivos.

Quatro testes automatizados passaram na última alteração funcional. O usuário confirmou a execução no PS4 de uma nova ISO de Bomba Patch; a ISO anterior falhou com CE-34878-0 em várias configurações. Não concluir que todo jogo é compatível a partir da validação do pacote. A troca efetiva da miniatura no console ainda não foi confirmada.

## Decisões e limites confirmados

- Planejar antes de alterar o app; apresentar a estrutura e o visual para aprovação antes da implementação da reformulação.
- Para retrôs: um emulador no PS4 com uma biblioteca de vários jogos.
- Arquivos de trabalho e saídas locais fora do iCloud Drive.
- Manter código e documentação revisados no GitHub e passagem de trabalho compartilhada entre Codex e Claude.
- Nunca publicar ISO, ROM, PKG de jogo, capas pessoais, BIOS, credenciais, bancos locais ou histórico bruto.
- Na pausa anterior, salvar o plano e as prévias. Na retomada, o usuário confirmou somente a etapa de biblioteca funcional.

## Experiência proposta

Biblioteca com capas como direção preferida em avaliação. A alternativa é um assistente guiado. A escolha final do layout ainda deve ser confirmada. As [prévias comparativas](previews/propostas-biblioteca-assistente.html) são um fragmento de demonstração da conversa: conteúdo ilustrativo e ações simuladas, sem acesso a arquivos, conversão ou PS4. Não são parte do app nem um protótipo funcional de novas plataformas.

Áreas propostas: Biblioteca, Preparar jogo, Transferências e Meu PS4. Controles avançados recolhidos; arquivos e resultados sempre localizáveis; estados claros de espera, conversão, falha e conclusão.

## Biblioteca e sincronização propostas

- Adicionar arquivos individualmente ou escolher uma ou mais pastas do Mac/HD externo.
- Importar subpastas das origens escolhidas; não procurar no computador inteiro automaticamente.
- Sincronização manual e opção de sincronizar ao abrir; monitoramento contínuo fica para outra versão.
- Detectar novos arquivos, sinalizar duplicados e marcar arquivos ausentes. HD desconectado não deve apagar entradas.
- Preservar títulos, capas, configurações e resultados existentes.
- Não mover originais ou excluir arquivos automaticamente. Relocalização automática exige evidência de identidade, não apenas o mesmo nome.
- Sincronização do catálogo local não é sincronização com PS4, nem autorização para converter/enviar automaticamente.

## Ordem de implementação proposta

1. Biblioteca, importação de pastas e sincronização manual.
2. Filas de conversão/envio, progresso e diagnóstico.
3. Prova de conversão e execução de PS1; depois integrar ao fluxo.
4. Prova de um emulador e biblioteca SNES no PS4; expandir por sistemas testados.
5. Avaliar PSP e outros sistemas separadamente.

PS3 não é escopo de conversão para execução local no PS4. Mudar o formato do pacote não cria compatibilidade de execução. Não apresentar um conversor universal.

Referências de pesquisa, ainda sem integração aprovada:
- [PS Classics fPKG Builder: PS1, PS2 e PSP](https://github.com/SvenGDK/PS-Classics-fPKG-Builder) — repositório arquivado; validar dependências e alternativa mantida.
- [Núcleo Snes9x](https://docs.libretro.com/library/snes9x/) — não prova disponibilidade ou compatibilidade de uma distribuição específica para PS4.

## Estratégia recomendada para economizar tokens

Definir navegação e limites antes de programar, manter visual simples durante a implementação, entregar um módulo por vez e usar testes/logs objetivos. Fazer o acabamento visual em uma etapa posterior, após estabilizar os fluxos. Evitar mudanças de direção e longas rodadas de ajustes visuais durante integrações. PSP, capas automáticas, monitoramento contínuo e efeitos visuais podem esperar.

Essa estratégia foi recomendada; não foi iniciada nenhuma reformulação. Não existe estimativa confiável de economia percentual.

## Etapa entregue após a retomada

O usuário confirmou a implementação da biblioteca funcional com visual simples. Foram adicionados importação de arquivos/pastas, inclusão da pasta de convertidos, sincronização manual, cancelamento, pesquisa, filtros e seleção para conversão de PS2/envio de PKG. O catálogo é persistido localmente, sem mover originais. Duplicados são sinalizados por SHA-256 completo; relocalização exige correspondência única. Indisponibilidade de HD não apaga entradas.

Foram verificadas importação recursiva limitada às origens, persistência, preservação de metadados, origens sobrepostas, links simbólicos, arquivos ausentes/volumes desconectados, cancelamento, catálogo inválido e integração com as funções existentes. A interface foi exercitada com arquivos fictícios, sem conversão real ou envio ao PS4.

Ficam pendentes: acabamento visual e biblioteca por capas, sincronização ao abrir, perfis por jogo e integrações PS1/SNES. O catálogo de outras plataformas não significa suporte à execução ou conversão.

## Próxima retomada

1. Ler esta passagem, as instruções locais e a nota compartilhada do projeto.
2. Conferir Git e mudanças de outros agentes; preservar o envio, conversão e Finder que já funcionam.
3. Usar a biblioteca funcional com pastas escolhidas pelo usuário e observar eventuais ajustes. Não interpretar a aprovação dessa etapa como autorização para toda a lista.
4. A etapa de filas foi autorizada pelo usuário e entregue abaixo. Confirmar a próxima etapa antes de integrar novas plataformas; manter o acabamento visual para depois dos fluxos principais.

## Fila entregue — 21/10/2026

Autorização confirmada: “ok siga” após a proposta de fila de conversão/envio, progresso e histórico. Adicionados controles à interface existente, mantendo o visual simples. Cada tarefa captura arquivo e opções; execução sequencial, início explícito, pausa após tarefa atual, cancelamento de conversão e retirada de pendentes. Conversão usa registro por etapas; envio consulta bytes reais do Remote Package Installer. Histórico local permite selecionar resultados, repetir falhas e consultar a mesma tarefa do PS4.

Falhas pausam a fila. Resposta perdida ou progresso indisponível exige conferência, sem reenvio automático. Reinício preserva pendentes e histórico, sinaliza tarefas interrompidas e recupera acesso ao arquivo exato de envios já solicitados. Tokens privados nunca são expostos pela API da fila. Catálogo, arquivos e resultados anteriores não são removidos. Conversão e envio continuam ações separadas. Completar os bytes confirma a transferência, não a abertura/compatibilidade do jogo.

Validação: 22 testes automatizados de conversor, catálogo, transferência, fila e API; fixture de PS4 com respostas hexadecimais, persistência/reinício, proteção de token, detecção de arquivo alterado e recuperação sem novo pedido. Interface exercitada com arquivos fictícios em 1000 e 520 px, incluindo inclusão, duplicados, cancelamento, nova tentativa, histórico, persistência e foco durante consultas. Sem conversão de jogo real ou novo envio ao console nesta entrega.

Próximo passo: usuário experimentar a fila no app com arquivos escolhidos e validar uma transferência no próprio PS4. PS1/SNES, perfis por jogo, sincronização ao abrir e acabamento visual continuam pendentes; não há autorização implícita para implementar todas as propostas.

## Prova de SNES autorizada e preparada — 21/10/2026

Após confirmar novo envio bem-sucedido do Bomba Patch, o usuário autorizou o próximo passo: selecionar/testar emulador SNES com pequena biblioteca, antes de integrá-lo ao app. Candidato escolhido para prova: pSNES v7.2 do desenvolvedor Cpasjuste, com PKG nativo de PS4 e pasta de ROMs separada. Pacote baixado somente na área local e conferido por tamanho, cabeçalho, content ID e SHA-256 publicado na release.

[Procedimento e critérios de aceitação](TESTE-SNES-PS4.md) documentam fonte, pacote, preparo da biblioteca, instalação, controles e duas formas de salvamento. A ferramenta `scripts/prepare-snes-test.py` prepara cópias de 1–3 arquivos explicitamente escolhidos com manifesto de hashes e verificações pendentes. Não faz rede, não converte jogos em PKG e não altera o app instalado. Dois testes locais passaram com arquivos fictícios.

Pendências reais: console não respondeu nos serviços conhecidos durante a inspeção; o usuário foi solicitado a abrir o Remote Package Installer e disponibilizar FTP do GoldHEN. A ISO SNES Station não está mais no caminho anterior de Downloads; solicitada a pasta atual da ISO/ROMs. Sem arquivos reais selecionados e sem acesso ao console, instalação, jogabilidade, controles e salvamento permanecem **não validados**. Não iniciar integração automática ou afirmar suporte até concluir essa prova com o usuário.


### Prova real em andamento — 21/10/2026

Com acesso disponibilizado pelo usuário, pSNES foi instalado no PS4: transferência completa, erro zero e presença do título confirmadas. Três ROMs da ISO indicada foram preparadas em cópias, enviadas para a pasta do emulador e verificadas por SHA-256 remoto, sem sobrescrever arquivos. Os impedimentos anteriores de acesso/caminho foram resolvidos. Aguardam-se testes pelo usuário de abertura, biblioteca, imagem, som, controles e salvamento. Não confundir instalação/cópia confirmadas com suporte SNES integrado ao app ou jogabilidade validada.


## Coleção SNES com capas entregue ao console — 21/10/2026

O usuário confirmou Mario, controles, som e estado salvo após reabrir e autorizou importar sua coleção SNES com capas. A coleção completa fornecida contém 1.041 arquivos de ROMs/arquivos compactados; ZIP e 7z com várias versões resultaram em 1.046 entradas. Cópia FTP concluída e conferida por SHA-256, incluindo 1.015 imagens únicas. Metadados finais publicados, arquivos existentes preservados e saves/configuração em backup. Nomes-base de novas entradas foram diferenciados para evitar conflitos de saves, mantendo os três nomes já usados.

Há 773 artes de títulos identificados, 72 artes de jogo-base sinalizadas e 201 capas neutras para casos sem correspondência segura. [Detalhes e limites](BIBLIOTECA-SNES-CAPAS.md). Nove testes Python passaram. O usuário foi solicitado a conferir a coleção e as capas na TV e recarregar seu estado de Mario. Isso ainda não comprova compatibilidade de todas as ROMs.

O app de Mac e o DMG não foram alterados: as ferramentas desta etapa preparam a biblioteca e o pSNES instalado a consome. Um novo painel SNES e sincronização pela interface continuam como próxima integração, sem reformulação visual automática. Não iniciar outras plataformas ou grande mudança de layout apenas por esta entrega.
