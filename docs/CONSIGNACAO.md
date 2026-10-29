# Consignação (28/10/2026)

Tela: **Compras › Consignação** (`/sistema/consignacoes`). Todos os funcionários criam e acompanham contratos;
pagar e quitar: ADMIN, GERENTE e FINANCEIRO; cancelar, iniciar diárias e dispensar taxa: gestão; regras: só ADMIN.
Link do consignante (sem login): `/sistema/p/consignacao/<token>`. Vitrine do site: `GET /api/v1/publico/consignados`.

## Regras (Configurações em Consignação → Regras)

| Regra | Padrão |
|---|---|
| Consignante fica com | **80%** do preço (configurável em cada contrato) — valor **travado** no contrato |
| Prazo | **10 dias corridos** a partir da entrada |
| Vendeu | a loja paga o consignante **na hora** (conta a pagar vencendo hoje) |
| Não vendeu no prazo | **5% do valor por dia útil**, mínimo **R$ 100**, máximo **R$ 1.000**, até quitar (R$ 3.000 → 20 × R$ 150) |
| Vendeu durante as diárias | o painel sugere **quitar o saldo** ou seguir nas diárias (decisão do ADM) |
| Retirada antes do prazo | taxa de **R$ 100** (a gestão pode dispensar); depois do prazo, sem taxa; diárias já recebidas são devolvidas |
| Desconto | só com autorização do consignante: o robô pede **5%** no 3º e no 7º dia (pelo WhatsApp, ele autoriza no link) |
| Quitou todas as diárias | o equipamento vira **estoque próprio** (pedido de compra passa para "Fechado") |

Dias úteis: segunda a sexta, sem feriados nacionais (inclusive Carnaval, Sexta-feira Santa, Corpus Christi e
Consciência Negra), 9/7 (SP) e 8/12 (Campinas). Outros dias sem expediente entram nas regras.

## O que o sistema faz sozinho
- **Ao criar**: produto `CONS-<nº>` com 1 no estoque (categoria Consignados), pedido de compra "Consignado" (sem contas
  a pagar: quem lança o pagamento é a consignação) e WhatsApp ao consignante com o link para assinar.
- **Robô (a cada 30 min)**: pede o desconto nos dias combinados e, no fim do prazo, lança as diárias no contas a pagar
  e avisa o consignante (com a opção de retirar sem taxa).
- **Venda**: a compra vira "Vendido", as diárias futuras sem pagamento são canceladas e o valor que falta vai para pagar hoje.
  O fechamento da venda não pergunta da compra do item consignado. Estorno da venda devolve a consignação ao prazo.
- **Pagamento** (pela tela da consignação ou pelo contas a pagar): o consignante recebe um WhatsApp com quanto já recebeu
  e quanto falta (pagamentos seguidos viram uma mensagem só).
- **Avisos do gestor**: consignado vendido a pagar, diárias do dia, perto do prazo, decidir quitação.

## Contrato
HTML pronto para imprimir/salvar PDF (logo, fotos, valores, cláusulas, assinatura e versículo no rodapé), na loja
(`/consignacoes/:id/contrato`) e no link do consignante. A assinatura pelo celular registra nome, CPF (tem que conferir
com o do cadastro), data, hora, IP e a imagem da assinatura. A minuta foi montada com as regras da loja: **vale passar
por um advogado** antes de usar em escala.

## Contas e DRE
Pagamentos ao consignante: categoria *Compra de mercadorias (CMV)* — ficam no informativo do DRE porque o custo entra
pela venda (custo do produto = valor do consignante). Taxa de retirada: *Taxa de retirada (consignação)*;
devolução de diárias na retirada: *Devolução de diárias (consignação)*.

## Código e testes
`apps/api/src/modules/consignacoes/` (`nucleo.ts` regras e ganchos da venda/compra, `service.ts` operações e robô,
`calendario.ts` dias úteis, `contrato.ts`, `routes.ts`). Telas em `apps/web/src/pages/consignacoes/` e
`pages/publico/ConsignacaoPublica.tsx`. Teste: `apps/api/testes/consignacao.ts` (roda no `npm test`).
