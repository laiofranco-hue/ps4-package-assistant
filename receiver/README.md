# PS4 Package Assistant Receiver — prova funcional

Escopo aprovado: primeiro comprovar instalação/recepção no console. Tela simples com IP, tarefas recebidas, bytes/progresso e taxa observada em MB/s. Layout final, capas, carrossel e instalação de emuladores ficam para depois.

A fila do Mac continua responsável por iniciar os envios em ordem. O receptor observa as tarefas registradas no BGFT do PS4; não cria uma segunda fila nem repete instalações sozinho. A taxa é calculada pela diferença entre contadores de bytes e tempo monotônico. Não representa velocidade contratada de internet ou um diagnóstico isolado do Wi-Fi. Não declarar conclusão quando o total for zero.

Primeira versão limitada a um PKG completo de aplicativo/jogo por pedido. Pacotes divididos, patches e DLC são recusados explicitamente. API e ABI do serviço precisam ser verificadas em hardware antes de chamar este protótipo de estável. O instalador anterior deve ser fechado para liberar a porta 12800. Nosso aplicativo tem outro Title ID; não substitui o anterior.

Referências: [API do RPI](https://github.com/flatz/ps4_remote_pkg_installer), [OpenOrbis](https://github.com/OpenOrbis/OpenOrbis-PS4-Toolchain), [ABI BGFT publicada](https://github.com/flatz/ps4_stub_lib_maker_v2/blob/master/include/bgft.h). Implementação própria, sem copiar o código do RPI. Os contadores de BGFT são de 64 bits; não usar a definição de 32 bits do cabeçalho histórico OpenOrbis para esta interface.

Dependência de parsing: cJSON v1.7.19 (MIT), licença em vendor/LICENSE. SDK, ferramentas e PKGs construídos permanecem fora do Git. A análise REA do instalador fornecido e os resultados de hardware estão documentados em REFERENCE-ANALYSIS.md.

## Construção no Mac

SDK fixado em dependencies.json. Compilação verificada com LLVM/lld 23.1.3 em Mac Apple Silicon; utilitários macOS x86-64 do SDK executados por Rosetta. Requer Python 3 e Pillow para o ícone gerado por código. Não usa SDK oficial da Sony.

```sh
python3 receiver/build.py --sdk "$OO_PS4_TOOLCHAIN"
python3 receiver/build.py --sdk "$OO_PS4_TOOLCHAIN" --probe
# Identidade separada usada na prova 0.17 (PKGA00006):
python3 receiver/build.py --sdk "$OO_PS4_TOOLCHAIN" --alternate-receiver
```

`PS4_CC` e `PS4_LD` permitem informar caminhos de clang/ld.lld. Por padrão os arquivos são gerados na área local ps4-package-assistant-local/outputs/receiver/ps4. O relatório build.json informa hash, tamanho e verificações de integridade. O pacote receptor padrão usa Title ID **PKGA00001**; `--alternate-receiver` gera o teste 0.17 **PKGA00006**, nome **PS4 Package Assistant - Teste 0.17**; a prova de envio usa **PKGA00002**, mostra OK ao abrir e não acessa jogos, saves ou rede. O build rejeita saídas em pastas de nuvem usuais. Verificação de PKG não comprova execução no aparelho.

## Teste no console

1. Com GoldHEN ativo, abra o Remote Package Installer anterior. Confira que PKGA00001 ainda não está instalado antes de enviar nosso receptor. Não remover o instalador anterior.
2. Espere o download/instalação terminar. Feche completamente o anterior por OPTIONS → Fechar aplicativo, liberando a porta 12800.
3. Abra **PS4 Package Assistant - Teste**. Confira IP e estado pronto, ou registre exatamente o código de erro mostrado. Um erro antes da tela exige diagnóstico separado; não repetir instalações cegamente.
4. Pelo cliente Mac atualizado, envie o pacote **PS4 Assistant - Prova de envio** (PKGA00002). Confira primeiro que esse ID não existe. O receptor deve mostrar tarefa/progresso e o cliente deve obter seu task_id. Por ser pequeno, o pacote pode terminar antes da primeira amostra útil de MB/s.
5. Confira o download no PS4 e abra a prova de envio: deve aparecer OK. Isso testa nosso software, sem reinstalar jogos existentes. Um teste com pacote maior será necessário para observar a taxa por vários segundos.

A medição usa bytes decimais: MB/s = diferença de bytes / segundos / 1.000.000. Wi-Fi/cabo, leitura do Mac, gravação no PS4 e processamento podem limitar a taxa; ela não identifica sozinha qual é o gargalo.

## Testes e limites desta prova

```sh
node --test --test-concurrency=1 test-*.cjs
node --test receiver/test-protocol.cjs
```

O segundo comando compila o código C no Mac com adaptador simulado e roda também as asserções de contadores/MB/s. O adaptador simulado nunca instala PKGs; seus dados não são evidência de execução no PS4. Testes cobrem JSON inválido, requisições fragmentadas, limites de tamanho/profundidade, origem externa recusada, erros BGFT e tarefa registrada com início incerto. Contadores acima de 4 GB, total zero, reset de contador e amostras muito próximas são verificados.

O Mac serve o manifesto e o PKG sob o mesmo token aleatório e restrição ao IP selecionado. O manifesto é derivado do cabeçalho do arquivo escolhido; se ele mudar, o servidor recusa acesso. A rota original de PKGs e o RPI anterior continuam suportados. Tarefa registrada mas não iniciada fica em atenção, preservando o ID para consultar sem reinstalar.

O receptor ainda é um protótipo para teste local: não tem pareamento, fila persistente no console, capas ou carrossel. Guarda até 24 tarefas recebidas durante sua execução e mostra as cinco mais recentes; tarefas futuras ainda não enviadas permanecem na fila do Mac. Não retoma/reenvia nada ao reiniciar. Consultas nativas rodam fora do bloqueio usado pelo desenho da tela. Manter o Mac e o receptor abertos durante a prova. A validação abaixo comprova uma transferência pequena; estabilidade, fila de vários pacotes e taxa sustentada ainda precisam de testes próprios.

Validação no PS4 em 22/10/2026: receptor 0.17/API0.1.7 respondeu `ready:true` e instalou a prova PKGA00002 (6.619.136 bytes), tarefa363, sem erro. Progresso total e preparação/cópia chegaram a100%; is_exists confirmou o título, e leitura do app.pkg instalado confirmou hash igual ao arquivo enviado. O usuário confirmou a tarefa na tela e a abertura da prova com OK. Teste básico concluído; não valida ainda jogos grandes, fila longa, MB/s sustentado ou retomada. Nenhum jogo fornecido pelo usuário foi empacotado para esta prova. Versões anteriores foram preservadas; usar o ícone que termina em0.17 para este teste.

### Console validation: launch correction (0.11)

The first 0.10 package installed fully, but the console refused to launch it.
A read-only copy of the installed PKG matched the local SHA-256 exactly.
The console kernel log reported `0xa0020102 (PRX_SCE_MODULE_LOAD_ERROR)`
and a missing PRX at startup. This is a launch failure, not transfer validation.

Version 0.11 removes BGFT and AppInstUtil from startup dependencies and
resolves their functions only after loading the internal services. Module or
symbol failures become diagnostic initialization errors. Package integrity
and host protocol tests do not establish console compatibility; a new launch
and harmless probe installation are still required. Never automatically
delete/reinstall an application in response to this generic corruption dialog.
