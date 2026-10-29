# Robô da Saúde (28/10/2026)

Robô ligado 24h na API que confere a **Saúde do sistema** (`/configuracoes/saude`) para tudo ficar 100%,
conciliando logo depois de cada movimento. Só o **ADMIN** vê.

## Quando roda
- A cada **5 minutos**.
- **~45 s depois** de qualquer venda criada/alterada, mudança de situação, compra, OS criada/alterada, NF autorizada/cancelada,
  conta recebida ou paga (vários movimentos seguidos viram uma rodada só).
- Na hora, pelo botão **Conferir agora** (dashboard, sino ou Saúde do sistema).
- Desliga com `ROBO_SAUDE=off` (os testes usam isso e chamam `POST /robo-saude/rodar`).

## O que ele corrige sozinho (correção = histórico "O que eu corrigi sozinho")
| Problema | O que o robô faz |
|---|---|
| Vendedor com login sem cadastro de vendedor | cria/vincula o cadastro (mesma regra do login) |
| Venda "Fechada"/"NF emitida" sem contas ou estoque | lança as contas (com baixa do que foi pago na hora: dinheiro/PIX/cartão) e baixa o estoque |
| Venda cancelada ainda com estoque/contas | devolve o estoque e estorna contas/comissões (se tiver recebimento manual, vira sugestão) |
| Comissão a pagar de venda cancelada | cancela a comissão |
| Compra registrada ao finalizar uma venda que foi cancelada ou excluída (`compra-de-venda-cancelada`) | desfaz a compra: o pagamento automático volta para o banco, contas a pagar canceladas, mercadoria fora do estoque, compra "Cancelado" (apagada se a venda não existe mais). Se a compra foi paga à mão ou a mercadoria já saiu em outra venda, vira ALERTA com o motivo |
| Conta a receber em aberto de venda cancelada (sem nada recebido) | cancela a conta |
| Produto vendido sem NCM | preenche pelo histórico/tipo do produto (o "sugerido" continua pedindo confirmação no Robô de NF) |
| Histórico do estoque diferente do saldo | grava um ajuste que realinha o histórico **sem mudar a quantidade** |
| NF "processando" sem resposta | consulta a SEFAZ e atualiza |

Regra: o robô **nunca muda dinheiro de lugar por decisão própria** — tudo o que ele faz sozinho é o que a própria
situação do registro já mandava fazer, ou é só leitura/realinhamento.

## Sugestões de 1 clique (botão pronto)
| Problema | Botões |
|---|---|
| Saldo do banco ≠ saldo inicial + lançamentos | "Usar os lançamentos" (recalcula) · "Manter o saldo mostrado" (corrige o saldo inicial) |
| Venda do mês sem vendedor | "Atribuir a {quem lançou}" — entra no **Resolver tudo** |
| Parcelas ≠ total (contas ainda não lançadas) | "Acertar a última parcela" — entra no **Resolver tudo** |
| Venda fechada que o robô não conseguiu lançar | "Lançar contas e estoque" — entra no **Resolver tudo** |
| NF gerada e não transmitida | "Transmitir à SEFAZ" (pede confirmação) |
| Venda parada em aberto há mais de 7 dias | se veio do Bling: "Marcar como Fechada" (regra da migração, sem lançar caixa/estoque; entra no **Resolver tudo**); senão "Cancelar venda" (pede confirmação) ou Abrir para finalizar |
| Estoque negativo | "Zerar estoque" (pede confirmação) ou Abrir o produto |

O resto da Saúde do sistema (NF rejeitada, OS atrasada, certificado…) vira **alerta** com o link de onde resolver.
Toda pendência tem **Ignorar** (não volta por 7 dias). Problema resolvido em qualquer tela some sozinho na rodada seguinte.

## Lembretes para a equipe (29/10/2026) — custos das OS e das vendas
O robô monitora os **custos** (o DRE e os dashboards precisam do custo real de cada OS e de cada venda) e manda o
lembrete para quem precisa agir. O lembrete tem destinatário (`tecnicoId` / `vendedorId`) e aparece no painel dessa
pessoa, além do painel do ADMIN; some sozinho assim que o custo é preenchido.

| Lembrete | Para quem | Onde preencher |
|---|---|---|
| OS com peça sem custo (`os-sem-custo`) — OS do MEU BLING, não cancelada, últimos 120 dias | o **técnico** da OS | OS → Editar → coluna "Custo un." das peças (ou "Custo total das peças"). Pode mesmo com a OS já baixada/lançada |
| Venda com produto sem custo (`venda-sem-custo`) — pedidos do MEU BLING, não cancelados, últimos 120 dias | o **vendedor** da venda | Venda → Editar → coluna "Custo un." |

OS com peça sem custo e **sem técnico** não tem dono: a gerência vê a contagem ("N OS sem técnico") para atribuir.

A OS passou a ter os **mesmos campos de despesa da venda** (`comum/custos-os.ts`, mesma regra do DRE, do dashboard
de assistência, do panorama e do "Pagar técnico"): custo de cada peça + imposto (alíquota) + taxa de cartão (pela forma
das parcelas) + logística + mão de obra de terceiro. E o sistema **lembra de preencher o custo** em três momentos:
- **abertura / lançamento de peças**: ao salvar a OS com peça sem custo, pergunta "Preencher agora" ou "Salvar assim mesmo";
- **fechamento**: ao mover para situação final com peça sem custo, `POST /ordens-servico/:id/situacao` devolve
  `422 OS_CUSTO_PENDENTE` com a lista; a tela mostra "Preencher agora" / "Fechar assim mesmo" (`confirmarCusto: true`).
  Nunca trava: fechou sem custo, o robô continua lembrando o técnico.

Onde o funcionário vê: **sino** no topo (perfis que não são ADMIN), card **"Lembretes para você"** na tela de
Ordens de serviço (início do técnico) e no Painel do vendedor; a gerente vê **"Lembretes da equipe"** no início dela,
com o primeiro nome de quem precisa agir. O ADMIN continua vendo tudo no sino e no card do robô.

## Onde aparece
- **Sino** no topo (só ADMIN): número de pendências (vermelho se tiver erro), lista com os botões.
- **Card "Robô da Saúde"** no Dashboard: % de saúde, o que precisa de você, "Resolver N de uma vez", e um aviso
  (toast) quando ele corrigiu algo desde a última vez.
- **Configurações → Saúde do sistema**: liga/desliga, "corrigir sozinho" on/off, todas as pendências, histórico de
  correções e do que foi resolvido com um clique, e a conferência detalhada.
- Alerta no quadro de alertas do dashboard ("Robô da Saúde: N para resolver").

## API (só ADMIN logado; fechada para chave de API)
`GET /robo-saude` · `GET /robo-saude/contagem` · `POST /robo-saude/rodar` · `POST /robo-saude/avisos/:id/executar {acao}` ·
`POST /robo-saude/avisos/:id/ignorar` · `POST /robo-saude/resolver-tudo` · `POST /robo-saude/marcar-lidas` · `PUT /robo-saude/config {ligado, autoCorrigir}`

`GET /robo-saude/lembretes` (qualquer perfil logado; `/lembretes` são os lembretes que as pessoas escrevem no Meu Dashboard) → `{ meus: [avisos abertos para o meu técnico/vendedor], equipe: [só ADMIN/GERENTE, com "quem"], semDono }`.

Dados: tabela `RoboSaudeAviso` (tipo CORRECAO | SUGESTAO | ALERTA; status ABERTA | RESOLVIDA | IGNORADA | FEITA;
`tecnicoId`/`vendedorId` = destinatário do lembrete); config e último estado em `Configuracao` (`roboSaude.config`,
`roboSaude.estado`). Código: `apps/api/src/modules/robo-saude/`.
Testes: `apps/api/testes/robo-saude.ts` e `apps/api/testes/lembretes-custo.ts`.
