# Plano e passagem de trabalho

Atualizado em 21/10/2026. Trabalho pausado a pedido do usuário para continuar depois.

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
- Nesta pausa, salvar o plano e as prévias; não começar novas funcionalidades.

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

## Próxima retomada

1. Ler esta passagem, as instruções locais e a nota compartilhada do projeto.
2. Conferir Git e mudanças de outros agentes; preservar o envio, conversão e Finder que já funcionam.
3. Confirmar escopo inicial e a estrutura visual com o usuário. Não interpretar o pedido de commit como autorização para implementar toda a lista.
4. Começar pela biblioteca/sincronização somente após essa confirmação; testar com diretórios pequenos e arquivos de teste antes de indexar coleções reais.
