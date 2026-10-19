# Análise profunda do Bling — base para o MEU BLING

Data: 19/10/2026 · Fonte: conta Bling do Balão da Informática (API v3 via MCP), documentação `developer.bling.com.br`, central de ajuda e blog do Bling.

## 1. Como a conta do Balão usa o Bling hoje (dados reais)

| Item | Situação encontrada | Impacto no novo sistema |
|---|---|---|
| Empresa | BALAO DA INFORMATICA MORALES LTDA, CNPJ 34.397.947/0001-08, contrato desde 02/07/2020, **Simples Nacional** (`optanteSimplesNacional: true`) | Emissão com **CRT 1 / CSOSN** (102 padrão). Alíquota aproximada do Simples usada no DRE (configurável). |
| Pedidos de venda | **~24.837** pedidos (nº 24837 em 19/10/2026). Campos usados: contato, vendedor, itens (descrição, qtd, valor, desconto por item, comissão por item), desconto global em R$, parcelas com forma de pagamento e observação ("RECEBIDO, OK"), observações padrão longas, categoria financeira, loja/unidade = 0 | Sequência de vendas inicia em **24838**. Modelo `Venda` replica exatamente esses campos. |
| Situações de venda (módulo 98310) | 9 situações: Em digitação, Em aberto, Em andamento, Verificado, Atendido, Cancelado, Venda Agenciada e **2 customizadas**: "Aguardando Estorno" e "Estornado OK". 40 transições cadastradas. Ações nas transições: `lancarEstoque`+`lancarContas` em Em aberto→Atendido; `estornarEstoque`+`estornarContas` em Atendido→Cancelado | Motor de situações do MEU BLING = tabela `Situacao` + `SituacaoTransicao` + ações (`lancarEstoque, estornarEstoque, lancarContas, estornarContas, reservarEstoque, liberarReserva, gerarNfe, notificarCliente`). Seed carrega as 9 situações e as transições reais. |
| Ações disponíveis no Bling (vendas) | estornarEstoque(6), estornarContas(9), lancarEstoque(12), lancarContas(15), gerarNfe(44), incluirNaRemessaPostagem(45), gerarNfce(47) | Todas replicadas, exceto remessa de postagem (Correios) — roadmap. |
| Pedidos de compra (módulo 575904) | 4 situações: Em aberto, Em andamento, Atendido, Cancelado (12 transições). Itens com `codigoFornecedor`, `aliquotaIPI`, vínculo com NF de entrada | Replicado 1:1 (`Compra`, `CompraItem`, `CompraParcela`). Importação de XML de NF-e de entrada incluída. |
| Depósitos | 12 depósitos: LOJA CASTELO (padrão), LOJA BALÃO CENTRO e **10 "DISTRIBUIDOR …"** (AGIS, Fagundez, Info+, Marquinhos, Paulo Noteweb, Renato Salva Cell, Rodrigo SP, TOB…) | Depósitos com flag `desconsiderarSaldo` para estoque virtual de distribuidor (não entra no disponível). Seed cria os 12. |
| NF-e | Série **4**, última nota nº **002205** (16/10/2026). CFOP 5102, NCM (ex.: 8518.30.00), ICMS CSOSN, `valorAproximadoTotalTributos` (IBPT) e texto "Total aproximado de tributos: R$ … Fonte IBPT" nas informações adicionais, `fretePorConta`, parcelas com forma de pagamento | Numeração continua em **2206 / série 4**. XML 4.00 montado com os mesmos campos; tributos aproximados calculados por capítulo NCM (tabela simplificada, ajustável). |
| Contas a receber | Conta contábil "Caixa", forma de pagamento com `codigoFiscal` (tPag), origem = venda com nº do pedido, situações 1..5 | `ContaReceber` com `origemTipo/origemId`, `FormaPagamento.codigoFiscal`, conciliação por conta financeira. |
| Vendedores | Vendas e NF-e vinculadas a `vendedor.id`; comissão por item (`comissao.aliquota/base/valor`) | `Vendedor.comissaoPadraoPct`, `VendaItem.comissaoPct/comissaoValor`, tabela `Comissao` com apuração por competência e pagamento. |
| Ordem de serviço | Módulo "Serviços > Ordem de Serviço": cliente, vendedor/técnico, loja, dados gerais (equipamento, nº de série, defeito), observações internas/externas, anexos, aba **Comissões** (% por item e por serviço), detalhes (nº OS, data de entrada, término previsto, conclusão, saída, total serviços, total peças, total), **Orçar / Orçado**, parcelas, ações (lançar contas e estoque, imprimir OS / etiqueta / via do técnico, enviar por e-mail ou WhatsApp) | Replicado e ampliado: `OrdemServico` com técnico separado do vendedor, prioridade, `estadoFisico`, `acessorios`, `senhaEquipamento`, `diagnostico`, `servicoExecutado`, `garantiaDias`, itens PECA/SERVICO com **controle de estoque das peças** (`estoqueBaixado`, reserva), aprovação de orçamento pelo cliente (link público/WhatsApp "APROVAR"), kanban por situação, 3 impressões (cliente, técnico, etiqueta). |

## 2. Mapa funcional Bling → MEU BLING

| Módulo Bling | MEU BLING | Status |
|---|---|---|
| Cadastros (clientes/fornecedores/transportadoras, produtos, serviços, vendedores, depósitos, formas de pagamento, categorias) | `contatos`, `produtos`, `cadastros/*` | ✅ |
| Vendas (pedidos, situações, ações, parcelas, comissão, NF-e/NFC-e a partir do pedido, impressão, e-mail/WhatsApp) | `vendas` + motor de situações + `fiscal` + `notificacoes` | ✅ |
| Compras (pedidos, situações, entrada de estoque, contas a pagar, importar XML) | `compras` | ✅ |
| Serviços (OS) | `ordens-servico` (kanban, peças, técnicos, orçamento, anexos, impressões) | ✅ |
| Estoque (saldos por depósito, movimentações, ajustes, transferências, estoque mínimo) | `produtos` + `estoque` | ✅ |
| Financeiro (contas a receber/pagar, baixas, caixas e bancos, fluxo de caixa, categorias, DRE) | `financeiro`, `relatorios/dre` | ✅ |
| **Bling Conta / extrato bancário** | **Open Finance via Pluggy** (saldo ao vivo + transações) + importação OFX + conciliação automática | ✅ (requer conta Pluggy) |
| Nota fiscal (NF-e, NFC-e, cancelamento, CC-e, inutilização, DANFE, XML, envio por e-mail) | `integracoes/fiscal` — **emissão direta na SEFAZ com certificado A1**, sem intermediário | ✅ (homologar com certificado real) |
| Relatórios e painéis | `dashboard/geral`, `dashboard/vendas`, `dashboard/os`, DRE competência/caixa, relatórios CSV | ✅ |
| Comunicação (e-mail e WhatsApp) | SMTP próprio + **WhatsApp via QR Code (sessão própria, Baileys)** com templates por situação | ✅ |
| Usuários e permissões | perfis ADMIN/GERENTE/VENDEDOR/TECNICO/FINANCEIRO + auditoria | ✅ |
| API pública / integrações | REST `/api/v1` (contrato em `docs/API.md`) — serve para o site balao.info, CRM WhatsApp e agentes | ✅ |
| Migração | importador Bling API v3 (OAuth) + CSV, idempotente por `blingId` | ✅ |
| Marketplaces (Mercado Livre, Shopee, Amazon…) | — | roadmap |
| Bling Envios / etiquetas Correios / Melhor Envio | — | roadmap |
| PDV (frente de caixa) com NFC-e | venda balcão + NFC-e já atendem; tela PDV dedicada | roadmap |
| Loja virtual Bling | site/portal próprio (balao2026) consome a API | roadmap |
| Multiempresas | 1 empresa (Castelo + Centro via depósitos) | roadmap |

## 3. Regras do Bling que foram preservadas

1. **Mudança de situação dispara ações** (estoque/contas) — nunca o contrário. Ações são idempotentes e reversíveis (estornos).
2. **Transições controladas**: só situações permitidas aparecem; ADMIN pode forçar.
3. **Parcelas → contas a receber** uma a uma (descrição "Venda nº X (i/n)"), com forma de pagamento e vencimento.
4. **Comissão por item** (vendas) e **por item/serviço** (OS), apurada por competência mensal e paga via contas a pagar.
5. **Depósito por venda/compra/OS**, com saldo por depósito e flag de distribuidor.
6. **NF-e a partir do pedido**, com natureza/CFOP por UF do destinatário, CSOSN do produto ou padrão da empresa, tributos aproximados (IBPT) e DANFE.
7. **Numeração contínua** (vendas, compras, OS, NF-e por série) — configurável em Configurações → Fiscal.

## 4. O que o MEU BLING faz melhor que o Bling (para o Balão)

- WhatsApp **próprio** (QR Code) com mensagens automáticas em cada mudança de situação de venda, compra e OS, orçamento aprovado respondendo "APROVAR", lembrete de contas.
- Saldo bancário **ao vivo** e conciliação automática (Open Finance), sem exportar extrato.
- Histórico completo do cliente em uma tela (vendas, OS, financeiro, mensagens).
- Dados **na sua máquina** (SQLite, backup = copiar 1 arquivo) ou PostgreSQL; sem mensalidade e sem limite de usuários/notas.
- API aberta para o site, CRM e agentes de IA locais.

## 5. Riscos e o que precisa ser feito com você

| Risco | Ação |
|---|---|
| Homologação da NF-e | Testar em ambiente de homologação com o certificado A1 real (Configurações → Fiscal → ambiente 2), emitir 2–3 notas, depois mudar para produção. Precisa do **CSC** para NFC-e (gerado no site da SEFAZ-SP). |
| Open Finance | Caminho gratuito: conectar o banco em meu.pluggy.ai + aplicação *Development* no dashboard da Pluggy (ver `docs/OPEN-FINANCE.md`); plano pago só se precisar de atualização mais frequente. Sem Pluggy, use importação OFX (gratuita). |
| Migração | Conectar o Bling (Client ID/Secret de um app em developer.bling.com.br) e rodar a importação por entidade. Faça **em paralelo** por 1–2 semanas antes de cancelar. |
| Backup | Agendar cópia diária de `apps/api/data/meubling.db` e da pasta `apps/api/storage` (XMLs das notas = obrigação fiscal por 5 anos). |
| Certificado A1 | Vence anualmente; o sistema avisa quando faltar 30 dias. |
