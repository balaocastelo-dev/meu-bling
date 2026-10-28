# Robô da Saúde (28/10/2026)

Robô ligado 24h na API que confere a **Saúde do sistema** (`/configuracoes/saude`) para tudo ficar 100%,
conciliando logo depois de cada movimento. Só o **ADMIN** vê.

## Quando roda
- A cada **5 minutos**.
- **~45 s depois** de qualquer venda criada/alterada, mudança de situação, compra, OS, NF autorizada/cancelada,
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
| Venda parada em aberto há mais de 7 dias | "Cancelar venda" (pede confirmação) ou Abrir para finalizar |
| Estoque negativo | "Zerar estoque" (pede confirmação) ou Abrir o produto |

O resto da Saúde do sistema (NF rejeitada, OS atrasada, certificado…) vira **alerta** com o link de onde resolver.
Toda pendência tem **Ignorar** (não volta por 7 dias). Problema resolvido em qualquer tela some sozinho na rodada seguinte.

## Onde aparece
- **Sino** no topo (só ADMIN): número de pendências (vermelho se tiver erro), lista com os botões.
- **Card "Robô da Saúde"** no Dashboard: % de saúde, o que precisa de você, "Resolver N de uma vez", e um aviso
  (toast) quando ele corrigiu algo desde a última vez.
- **Configurações → Saúde do sistema**: liga/desliga, "corrigir sozinho" on/off, todas as pendências, histórico de
  correções e do que foi resolvido com um clique, e a conferência detalhada.
- Alerta no quadro de alertas do dashboard ("Robô da Saúde: N para resolver").

## API (só ADMIN; chave de API só lê)
`GET /robo-saude` · `GET /robo-saude/contagem` · `POST /robo-saude/rodar` · `POST /robo-saude/avisos/:id/executar {acao}` ·
`POST /robo-saude/avisos/:id/ignorar` · `POST /robo-saude/resolver-tudo` · `POST /robo-saude/marcar-lidas` · `PUT /robo-saude/config {ligado, autoCorrigir}`

Dados: tabela `RoboSaudeAviso` (tipo CORRECAO | SUGESTAO | ALERTA; status ABERTA | RESOLVIDA | IGNORADA | FEITA);
config e último estado em `Configuracao` (`roboSaude.config`, `roboSaude.estado`). Código: `apps/api/src/modules/robo-saude/`.
Teste: `apps/api/testes/robo-saude.ts`.
