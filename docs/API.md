# MEU BLING — Contrato da API (v1)

Base: `http://localhost:3333/api/v1`. JSON. Autenticação: `Authorization: Bearer <token>` (JWT, 12h).
Todas as rotas em `/api/*` exigem token, exceto `POST /auth/login`, `GET /saude`, `/publico/*`, `/webhooks/*`.

## Convenções

- **Listagens** aceitam `?pagina=1&limite=50` + filtros e retornam `{ data: [...], meta: { total, pagina, limite, totalPaginas } }`.
- **Erros**: `{ erro: "mensagem em português", code: "CODIGO", detalhes?: any }` com status 400/401/403/404/409/422/500.
- **Datas**: enviar `YYYY-MM-DD` ou ISO; a API devolve ISO.
- **Valores**: números (reais). Percentuais em número (3 = 3%).
- **IDs**: inteiros.
- **Situações** (status) são registros da tabela `Situacao` (`id`, `modulo`, `nome`, `cor`, `acoes`). Entidades devolvem `situacao: { id, nome, cor }`.
- **Perfis**: `ADMIN | GERENTE | VENDEDOR | TECNICO | FINANCEIRO`. ADMIN tem tudo. Rotas de configuração exigem ADMIN/GERENTE; financeiro exige ADMIN/GERENTE/FINANCEIRO.
- Campos criptografados (senhas de certificado/SMTP, tokens) nunca são devolvidos; a API devolve `***` ou `temSenha: true`.

## Autenticação / usuários (pronto)
- `POST /auth/login` `{email, senha}` → `{ token, usuario: {id,nome,email,perfil,vendedorId,tecnicoId} }`
- `GET /auth/eu` → usuário atual
- `PUT /auth/senha` `{senhaAtual, novaSenha}`
- `GET/POST /usuarios`, `PUT/DELETE /usuarios/:id` (ADMIN) — body `{nome,email,senha?,perfil,ativo,vendedorId?,tecnicoId?}`
- `GET /auditoria?entidade=&entidadeId=&limite=`

## Configurações / empresa
- `GET /empresa` → dados da empresa (sem segredos; inclui `certificado: {nome, validade, temCertificado}`, `smtp: {..., temSenha}`, `whatsapp: {ativo}`, `openFinance: {ativo, clientId, temSecret}`, `bling: {temToken, expira}`)
- `PUT /empresa` — qualquer campo editável de `Empresa` (razaoSocial, cnpj, endereço, fiscal: `ambienteFiscal, serieNfe, proximoNumeroNfe, serieNfce, proximoNumeroNfce, cscId, cscToken, naturezaOperacaoPadrao, cfopPadraoDentroUf, cfopPadraoForaUf, csosnPadrao, aliquotaSimplesPct, provedorFiscal`; smtp: `smtpHost, smtpPort, smtpSecure, smtpUser, smtpPass, smtpFrom, smtpAtivo`; openFinance: `openFinanceClientId, openFinanceClientSecret, openFinanceAtivo`)
- `POST /empresa/certificado` multipart `{arquivo (.pfx), senha}` → valida, extrai validade/nome, salva criptografado → `{nome, validade}`
- `DELETE /empresa/certificado`
- `POST /empresa/logo` multipart → `{logoPath}`
- `POST /empresa/smtp/testar` `{para}` → envia e-mail de teste
- `GET /configuracoes` / `PUT /configuracoes` `{chave: valor}` (genérico)

## Cadastros auxiliares (CRUD simples: GET lista, GET /:id, POST, PUT /:id, DELETE /:id)
- `/vendedores` `{nome,email,telefone,comissaoPadraoPct,ativo}`
- `/tecnicos` `{nome,email,telefone,especialidade,comissaoPadraoPct,ativo}`
- `/depositos` `{nome,padrao,ativo,desconsiderarSaldo}`
- `/formas-pagamento` `{nome,tipo,codigoFiscal,taxaPct,diasRecebimento,maxParcelas,ativo}`
- `/categorias-financeiras` `{nome,tipo,grupoDre,paiId,ativo}`
- `/categorias-produto` `{nome,paiId}`
- `/contas-financeiras` `{nome,tipo,banco,agencia,conta,saldoInicial,padrao,ativo,cor}` → lista inclui `saldoAtual`, `saldoBanco`, `saldoBancoEm`, `openFinanceStatus`
- Listagens auxiliares aceitam `?ativo=true` e devolvem **array simples** (sem paginação) para preencher selects.

## Situações (motor de status)
- `GET /situacoes?modulo=VENDA|COMPRA|OS` → array `[{id,modulo,nome,cor,ordem,sistema,inicial,final,cancelamento,acoes:[...],ativo}]`
- `POST /situacoes` `{modulo,nome,cor,ordem,acoes:[],inicial,final,cancelamento}` / `PUT /situacoes/:id` / `DELETE /situacoes/:id` (não exclui `sistema`)
- `GET /situacoes/transicoes?modulo=` → `[{id,origemId,destinoId,ativo,acoes:[]}]`
- `PUT /situacoes/transicoes` `{modulo, transicoes:[{origemId,destinoId,ativo,acoes}]}` — substitui o conjunto do módulo
- `GET /situacoes/acoes` → ações disponíveis `[{nome,descricao,modulos}]`
- `GET /situacoes/:id/permitidas` → destinos permitidos a partir da situação

Situações padrão do Balão (seed; bancos antigos são migrados automaticamente — `Configuracao situacoes.versao = 2`):
- **VENDA**: Em aberto (inicial, reserva estoque) → Em andamento → **Fechada** (final: baixa estoque + lança contas) → **NF emitida** (final: idem + gera NF-e; a venda vai para cá sozinha quando a NF-e é autorizada e volta para Fechada se a NF-e for cancelada) · **Cancelada** (estorna tudo).
- **COMPRA**: Em aberto (inicial) → **Fechado** (entrada de estoque + contas a pagar) · **Consignado** (só entrada de estoque; o fornecedor é pago quando vender) → **Vendido** (final; automático: ao fechar uma venda, cada item é alocado FIFO nas compras daquele produto — `AlocacaoCompra`/`CompraItem.quantidadeVendida` — e a compra passa a Vendido quando toda a mercadoria dela saiu, lançando as contas a pagar se ainda não lançadas; o estorno da venda desfaz) · **Cancelado**.

## Contatos (clientes / fornecedores / transportadoras)
- `GET /contatos?pesquisa=&tipo=CLIENTE|FORNECEDOR|TRANSPORTADORA&ativo=&pagina=&limite=` (pesquisa por nome, fantasia, documento, e-mail, telefone)
- `GET /contatos/:id` → contato + `resumo: { totalVendas, qtdVendas, qtdOs, emAberto (a receber), ultimaCompra }`
- `POST /contatos`, `PUT /contatos/:id`, `DELETE /contatos/:id` (soft: ativo=false se tiver movimento)
- `GET /contatos/:id/historico` → **histórico do cliente**: `{ vendas:[{id,numero,data,total,situacao}], ordens:[{id,numero,dataEntrada,equipamento,total,situacao}], contasReceber:[...], notificacoes:[...], timeline:[{data,tipo,titulo,descricao,referencia:{tipo,id}}] }` (timeline ordenada desc)
- `GET /contatos/cep/:cep` → consulta ViaCEP `{logradouro,bairro,municipio,uf,codigoMunicipio}` (se sem internet devolve 404)

## Produtos e estoque
- `GET /produtos?pesquisa=&tipo=P|S&categoriaId=&ativo=&estoque=zerado|positivo|negativo|abaixoMinimo&pagina=&limite=` → cada item inclui `estoqueTotal` (soma dos depósitos que contam saldo) e `estoqueReservado`
- `GET /produtos/:id` → produto + `saldos:[{depositoId,deposito,saldo,reservado}]`
- `POST /produtos`, `PUT /produtos/:id`, `DELETE /produtos/:id`
- `GET /produtos/:id/movimentos?pagina=&limite=` → movimentos de estoque (com usuário, origem)
- `GET /estoque/saldos?depositoId=&pesquisa=&abaixoMinimo=true` → `[{produtoId,nome,codigo,deposito,saldo,reservado,estoqueMinimo,precoCusto}]`
- `POST /estoque/ajuste` `{produtoId, depositoId, quantidade (saldo novo OU), tipo:'ENTRADA'|'SAIDA'|'BALANCO', custoUnitario?, observacao}` → cria movimento
- `POST /estoque/transferencia` `{produtoId, origemId, destinoId, quantidade, observacao}`
- `GET /estoque/movimentos?produtoId=&depositoId=&dataInicial=&dataFinal=&origemTipo=&pagina=&limite=`

## Vendas e orçamentos
Orçamento = venda com `tipo: "ORCAMENTO"` (mesma tabela). Numeração própria (sequência `ORCAMENTO`), situações próprias (módulo `ORCAMENTO`: Em aberto, Enviado, Aprovado, Convertido em venda, Reprovado, Expirado), `validade` (padrão data + 7 dias), **nunca** lança estoque/contas nem emite nota (422 `ORCAMENTO`), não entra em dashboards/relatórios/DRE (todos filtram `tipo: PEDIDO`).

- `GET /vendas?tipo=PEDIDO|ORCAMENTO|TODOS&pesquisa=&situacaoId=&situacoes=1,2&contatoId=&vendedorId=&dataInicial=&dataFinal=&origem=&pagina=&limite=` → itens: `{id,numero,data,dataPrevista,contato:{id,nome},vendedor:{id,nome},situacao:{id,nome,cor},total,totalProdutos,notaId,nota:{id,numero,situacao}|null,estoqueLancado,contasLancadas}`
- `GET /vendas/:id` → venda completa: `itens[]`, `parcelas[]` (com `formaPagamento`, `contaReceber:{id,situacao,valorRecebido}`), `contato`, `vendedor`, `situacao`, `deposito`, `nota`, `comissoes[]`, `historico[]` (HistoricoSituacao), `situacoesPermitidas[]`
- `POST /vendas` body (`tipo` opcional, padrão `PEDIDO`; `validade` só no orçamento; item sem `valorUnitario` usa o preço do produto):
  ```json
  { "tipo":"PEDIDO", "validade":null, "contatoId":1, "vendedorId":1, "data":"2026-10-19", "dataPrevista":null, "depositoId":1, "situacaoId": null,
    "origem":"BALCAO", "categoriaFinanceiraId":1, "observacoes":"", "observacoesInternas":"",
    "descontoTipo":"REAL", "descontoValor":0, "frete":0, "outrasDespesas":0,
    "transportadoraId":null, "fretePorConta":9, "quantidadeVolumes":0, "pesoBruto":0,
    "itens":[{"produtoId":1,"descricao":"...","quantidade":1,"valorUnitario":100,"desconto":0,"comissaoPct":3}],
    "parcelas":[{"dataVencimento":"2026-10-19","valor":100,"formaPagamentoId":2,"observacoes":""}] }
  ```
  Regras: totais são **recalculados no servidor** (`total = totalProdutos - desconto + frete + outrasDespesas`); se `parcelas` vazio cria 1 parcela à vista; se `situacaoId` nulo usa situação inicial; `custoUnitario` = `precoCusto` do produto; `comissaoPct` default = `vendedor.comissaoPadraoPct`. Devolve a venda completa (201).
- `PUT /vendas/:id` — mesmo body; **bloqueado** se `estoqueLancado` ou `contasLancadas` (tem que estornar antes) exceto campos de observação/transporte.
- `DELETE /vendas/:id` — só se nada lançado e sem NF autorizada.
- `POST /vendas/:id/situacao` `{situacaoId, observacao?, forcar?}` → `{situacao, acoesExecutadas:[]}` (usa `mudarSituacao`; erro 422 `TRANSICAO_INVALIDA` com `detalhes.permitidas`)
- `POST /vendas/:id/acoes` `{acoes:["lancarEstoque","lancarContas","estornarEstoque","estornarContas"]}` → executa ações avulsas
- `POST /vendas/:id/gerar-nfe` `{modelo:55|65, informacoesComplementares?}` → cria NotaFiscal PENDENTE vinculada (não transmite) → `{notaId}`
- `POST /vendas/:id/notificar` `{canal:'EMAIL'|'WHATSAPP', templateId?, mensagem?, anexarPdf?}` → enfileira notificação; com `anexarPdf` (ou template com `anexarPdf`) gera `storage/pedidos/<Pedido|Orcamento>-<n>.pdf` — e-mail vai com anexo, WhatsApp manda o PDF como documento logo após o texto. Orçamento "Em aberto" enviado passa para "Enviado". Variáveis extras: `{{validade}}`, `{{tipoDocumento}}`, `{{link}}` (página pública com botão de aprovar)
- `GET /vendas/:id/imprimir` → HTML do pedido/orçamento (para impressão)
- `GET /vendas/:id/pdf?download=1` → PDF A4 do pedido/orçamento (pdfkit)
- `POST /vendas/:id/duplicar` → clona (mesmo tipo) em situação inicial, vencimentos a partir de hoje
- `POST /vendas/:id/transferir-vendedor` `{vendedorId|null, observacao?}` → troca o vendedor; se as contas já foram lançadas refaz a comissão pendente para o novo vendedor (comissão PAGA bloqueia) e atualiza o vendedor das contas a receber; VENDEDOR só transfere as próprias vendas
- `POST /vendas/:id/aprovar` `{aprovadoPor?, observacao?}` → orçamento aprovado (situação "Aprovado")
- `POST /vendas/:id/converter` `{situacaoId?}` → cria o pedido de venda com os mesmos itens/parcelas (`venda.orcamentoId` aponta o orçamento; `orcamento.vendaGerada`), orçamento vai para "Convertido em venda"; uma vez só (422 `JA_CONVERTIDO`) → 201 venda completa
- Cancelar venda = `POST /vendas/:id/situacao` com a situação de cancelamento ("Cancelado"; no orçamento, "Reprovado")
- `POST /vendas/:id/gerar-parcelas` `{quantidade, primeiroVencimento, formaPagamentoId, intervaloDias:30}` → devolve parcelas calculadas (não salva)

## Compras
- `GET /compras?pesquisa=&situacaoId=&fornecedorId=&dataInicial=&dataFinal=&pagina=&limite=`
- `GET /compras/:id` → completa (`itens`, `parcelas` com `contaPagar`, `fornecedor`, `situacao`, `historico`, `situacoesPermitidas`)
- `POST /compras` `{fornecedorId, data, dataPrevista, depositoId, situacaoId?, categoriaFinanceiraId, ordemCompra, nfeChave, nfeNumero, descontoValor, frete, outrasDespesas, observacoes, observacoesInternas, itens:[{produtoId,descricao,codigoFornecedor,quantidade,valorUnitario,ipiPct}], parcelas:[...]}`
- `PUT /compras/:id`, `DELETE /compras/:id`
- `POST /compras/:id/situacao`, `POST /compras/:id/acoes` (lançar estoque = **entrada** no depósito e atualiza `precoCusto` do produto pela última compra; lançar contas = contas a **pagar**)
- `POST /compras/importar-xml` multipart (XML de NF-e de entrada) → cria compra em aberto com itens casados por GTIN/código ou criados → `{compraId, itensNovos:[]}`
- `GET /compras/:id/imprimir`

## Ordens de serviço
- `GET /ordens-servico?pesquisa=&situacaoId=&situacoes=&contatoId=&tecnicoId=&vendedorId=&prioridade=&dataInicial=&dataFinal=&pagina=&limite=` → `{id,numero,dataEntrada,dataPrevista,contato,tecnico,vendedor,situacao,equipamento,marca,modelo,defeitoRelatado,total,prioridade,orcar,orcamentoAprovado,atrasada}`
- `GET /ordens-servico/kanban?tecnicoId=` → `[{situacao:{id,nome,cor,ordem}, ordens:[...resumo]}]` (todas as situações ativas do módulo OS, inclusive vazias; situações `final/cancelamento` só com OS dos últimos 7 dias)
- `GET /ordens-servico/:id` → completa (`itens`, `parcelas`, `anexos`, `contato`, `tecnico`, `vendedor`, `situacao`, `historico`, `comissoes`, `situacoesPermitidas`, `nota`)
- `POST /ordens-servico` body: dados da OS + `itens:[{tipo:'PECA'|'SERVICO', produtoId, descricao, quantidade, valorUnitario, desconto, comissaoVendedorPct, comissaoTecnicoPct, depositoId}]` + `parcelas`. Totais recalculados (`totalServicos`, `totalPecas`, `total = soma - desconto`).
- `PUT /ordens-servico/:id`, `DELETE /ordens-servico/:id`
- `POST /ordens-servico/:id/situacao`, `POST /ordens-servico/:id/acoes`
- `POST /ordens-servico/:id/aprovar-orcamento` `{aprovadoPor?}` → marca `orcamentoAprovado` e muda para "Aprovada" se a transição existir
- `POST /ordens-servico/:id/anexos` multipart → `{id,nome,url}`; `DELETE /ordens-servico/:id/anexos/:anexoId`
- `GET /ordens-servico/:id/imprimir?via=cliente|tecnico|etiqueta` → HTML
- `POST /ordens-servico/:id/notificar` `{canal, templateId?, mensagem?}`
- `POST /ordens-servico/:id/gerar-nfe` `{modelo:55}` → NF-e das **peças** (serviços ficam fora da NF-e de produto)
- **Peças**: ao lançar estoque, cada item `PECA` com `produtoId` gera SAÍDA no depósito do item (ou da OS); `estoqueBaixado=true`. Estorno reverte. Reserva/liberação idem com `reservado`.

## Comissões
- `GET /comissoes?competencia=2026-10&tipo=VENDEDOR|TECNICO&vendedorId=&tecnicoId=&status=&pagina=&limite=` → itens + `totais: {pendente, aprovada, paga}`
- `GET /comissoes/resumo?competencia=` → `[{tipo, pessoaId, nome, qtd, base, valor, pendente, paga}]`
- `POST /comissoes/aprovar` `{ids:[]}`; `POST /comissoes/pagar` `{ids:[], contaFinanceiraId, data}` → marca PAGA e gera 1 conta a pagar (PAGO) por pessoa; `POST /comissoes/cancelar` `{ids:[]}`
- `POST /comissoes/recalcular/:origemTipo/:id` → recalcula comissões de uma venda/OS (se não pagas)

## Financeiro
- `GET /contas-receber?situacao=ABERTO|RECEBIDO|PARCIAL|CANCELADO|ATRASADO&contatoId=&vendedorId=&dataInicial=&dataFinal=&tipoData=V|E|R&pesquisa=&pagina=&limite=` → itens + `totais:{aberto, recebido, atrasado}`; cada item inclui `atrasada:boolean`, `contato`, `formaPagamento`, `categoria`, `origem:{tipo,id,numero}`
- `GET /contas-receber/:id`, `POST /contas-receber`, `PUT /contas-receber/:id`, `DELETE /contas-receber/:id` (cancela)
- `POST /contas-receber/:id/baixar` `{valor, data, contaFinanceiraId, formaPagamentoId?, juros?, desconto?, observacoes?}` → cria MovimentoFinanceiro ENTRADA, atualiza situação (RECEBIDO/PARCIAL), saldo da conta; emite `conta.recebida`
- `POST /contas-receber/:id/estornar` → desfaz baixa(s)
- `/contas-pagar` — espelho (baixar = SAIDA; `recorrente`; `POST /contas-pagar/:id/estornar`)
- `GET /financeiro/resumo` → `{ saldoContas:[{id,nome,tipo,saldoAtual,saldoBanco,cor}], saldoTotal, receberHoje, receberSemana, receberAtrasado, pagarHoje, pagarSemana, pagarAtrasado }`
- `GET /financeiro/fluxo-caixa?dataInicial=&dataFinal=&contaFinanceiraId=&agrupar=dia|semana|mes` → `{ saldoInicial, series:[{periodo, entradas, saidas, saldo}], realizado, previsto:[{periodo, receber, pagar}] }`
- `GET /financeiro/movimentos?contaFinanceiraId=&dataInicial=&dataFinal=&pagina=&limite=` → extrato interno
- `POST /financeiro/movimentos` `{contaFinanceiraId, data, tipo:'ENTRADA'|'SAIDA', valor, descricao, categoriaId}` (lançamento avulso); `POST /financeiro/transferencia` `{origemId, destinoId, valor, data, descricao}`
- `DELETE /financeiro/movimentos/:id`

## Contas bancárias / Open Finance (Pluggy) / conciliação
- `GET /open-finance/status` → `{ativo, provedor, configurado, conectores?}`
- `POST /open-finance/connect-token` → `{accessToken}` para o Pluggy Connect widget (frontend abre o widget e devolve o `itemId`)
- `POST /open-finance/vincular` `{itemId, contaFinanceiraId?}` → lista contas do item e cria/vincula ContaFinanceira(s) → `[{contaFinanceiraId, nome, saldo}]`
- `POST /open-finance/sincronizar/:contaFinanceiraId` → busca saldo + transações (últimos 90 dias por padrão) → `{saldo, novasTransacoes}`
- `POST /open-finance/sincronizar-todas`
- `DELETE /open-finance/desvincular/:contaFinanceiraId`
- `POST /bancos/importar-ofx` multipart `{arquivo, contaFinanceiraId}` → transações (fallback sem Open Finance)
- `GET /bancos/transacoes?contaFinanceiraId=&conciliado=false&dataInicial=&dataFinal=&pagina=&limite=` → cada uma com `sugestoes:[{tipo:'RECEBER'|'PAGAR', id, descricao, valor, vencimento, score}]`
- `POST /bancos/transacoes/:id/conciliar` `{tipo:'RECEBER'|'PAGAR'|'LANCAMENTO', id?, categoriaId?, descricao?}` → faz a baixa da conta (ou cria movimento avulso) ligado à transação
- `POST /bancos/transacoes/:id/ignorar`
- `POST /webhooks/pluggy` (público; valida assinatura se configurada) → dispara sincronização do item

## Notas fiscais (NF-e 55 / NFC-e 65)
- `GET /notas-fiscais?tipo=0|1&modelo=&situacao=&pesquisa=&dataInicial=&dataFinal=&pagina=&limite=` → `{id,tipo,modelo,serie,numero,chave,situacao,dataEmissao,contato:{nome},valorTotal,venda:{id,numero}|null,os:{...}|null,motivo}`
- `GET /notas-fiscais/:id` → nota + `itens` + `eventos` + `contato`
- `POST /notas-fiscais` → nota manual `{tipo, modelo, contatoId, naturezaOperacao, finalidade, itens:[...], formaPagamentoFiscal, informacoesComplementares, valorFrete, valorDesconto}`
- `PUT /notas-fiscais/:id` (só PENDENTE/REJEITADA)
- `POST /notas-fiscais/:id/transmitir` → monta XML, assina com A1, envia à SEFAZ (ou simula no provedor `mock`), grava retorno → `{situacao, chave, protocolo, cStat, motivo}`
- `POST /notas-fiscais/:id/consultar` → consulta situação na SEFAZ
- `POST /notas-fiscais/:id/cancelar` `{justificativa (min 15)}` → evento 110111; estorna estoque/contas se configurado
- `POST /notas-fiscais/:id/carta-correcao` `{texto}`
- `POST /notas-fiscais/inutilizar` `{modelo, serie, numeroInicial, numeroFinal, justificativa}`
- `GET /notas-fiscais/:id/xml` → download XML (procNFe se autorizada)
- `GET /notas-fiscais/:id/danfe` → PDF (gerado com pdfkit; NFC-e com QR Code)
- `POST /notas-fiscais/:id/enviar-email` `{para?}` → e-mail com XML+DANFE
- `GET /fiscal/status-sefaz` → `{online, cStat, motivo, ambiente}`
- `DELETE /notas-fiscais/:id` (só PENDENTE)

## Notificações (e-mail SMTP / WhatsApp QR)
- `GET /notificacoes?status=&canal=&origemTipo=&origemId=&contatoId=&pagina=&limite=`
- `POST /notificacoes` `{canal, destinatario, assunto?, corpo, contatoId?, origemTipo?, origemId?}` → enfileira
- `POST /notificacoes/:id/reenviar`, `POST /notificacoes/:id/cancelar`
- `GET /templates-notificacao?evento=&canal=` / `POST` / `PUT /:id` / `DELETE /:id` — `{nome,evento,canal,situacaoId,assunto,corpo,anexarPdf,ativo}`
- `POST /templates-notificacao/:id/preview` `{origemTipo, origemId}` → `{assunto, corpo}` renderizados
- `GET /templates-notificacao/variaveis` → lista de variáveis disponíveis por evento
- **WhatsApp**: `GET /whatsapp/status` → `{status:'DESCONECTADO'|'AGUARDANDO_QR'|'CONECTANDO'|'CONECTADO', qrDataUrl?: 'data:image/png;base64,...', numero?, nome?, desde?}`; `POST /whatsapp/conectar` (inicia sessão e gera QR); `POST /whatsapp/desconectar` (logout, apaga sessão); `POST /whatsapp/enviar-teste` `{numero, mensagem}`; `GET /whatsapp/eventos` (SSE opcional)
- **Regras de disparo** (listener de `situacao.alterada`): para cada template ativo com `evento = <MODULO>_SITUACAO` e (`situacaoId = destino` OU (`situacaoId = null` E ação `notificarCliente` presente)), cria uma `Notificacao` para o contato (WhatsApp usa `contato.celular`; e-mail usa `contato.email`); sem destinatário → cria com status `CANCELADA` e erro "sem celular/e-mail". Worker processa a fila a cada 5s, 3 tentativas com backoff.
- Variáveis de template: `{{cliente.nome}} {{cliente.primeiroNome}} {{numero}} {{situacao}} {{total}} {{data}} {{itens}} {{equipamento}} {{defeito}} {{diagnostico}} {{tecnico}} {{vendedor}} {{garantiaDias}} {{empresa.nome}} {{empresa.telefone}} {{empresa.endereco}} {{chave}} {{link}}`

## Dashboards e relatórios
- `GET /dashboard/geral` → `{ hoje:{vendas, valorVendas, osAbertas, osConcluidasHoje}, financeiro:{saldoTotal, receberHoje, receberAtrasado, pagarHoje, pagarAtrasado}, os:{porSituacao:[{id,nome,cor,qtd}], atrasadas}, vendas:{porSituacao:[...]}, estoque:{abaixoMinimo:[{produtoId,nome,saldo,estoqueMinimo}], qtdAbaixoMinimo}, fiscal:{pendentes, rejeitadas}, comissoes:{pendentes}, whatsapp:{status}, ultimosMovimentos:[...], alertas:[{tipo,mensagem,link}] }`
- `GET /dashboard/vendas?dataInicial=&dataFinal=&vendedorId=&agrupar=dia|semana|mes&comparar=true` → `{ resumo:{faturamento, qtdVendas, ticketMedio, itensVendidos, lucroBruto, margemPct, comparativo:{faturamento, qtdVendas, ticketMedio} }, series:[{periodo, faturamento, qtd, lucro}], porVendedor:[{id,nome,faturamento,qtd,comissao}], porFormaPagamento:[{nome,valor,qtd}], porOrigem:[...], topProdutos:[{produtoId,nome,qtd,valor}], topClientes:[{contatoId,nome,valor,qtd}], porSituacao:[...], porCategoria:[...] }` (considera somente situações `final=true` e não canceladas, salvo `?todas=true`)
- `GET /dashboard/os?dataInicial=&dataFinal=&tecnicoId=` → `{resumo:{abertas, concluidas, faturamento, tempoMedioDias, ticketMedio}, porTecnico:[...], porSituacao:[...], porEquipamento:[...], series:[...]}`
- `GET /relatorios/dre?dataInicial=&dataFinal=&regime=competencia|caixa&comparar=true` →
  ```json
  { "periodo":{...}, "regime":"competencia",
    "linhas":[
      {"codigo":"1","nome":"RECEITA BRUTA","valor":0,"nivel":0,"itens":[{"nome":"Venda de produtos","valor":0},{"nome":"Prestação de serviços (OS)","valor":0}]},
      {"codigo":"2","nome":"(-) DEDUÇÕES","valor":0,"itens":[{"nome":"Impostos (Simples 6%)","valor":0},{"nome":"Devoluções e cancelamentos","valor":0}]},
      {"codigo":"3","nome":"= RECEITA LÍQUIDA","valor":0,"total":true},
      {"codigo":"4","nome":"(-) CMV / CUSTO DOS SERVIÇOS","valor":0,"itens":[...]},
      {"codigo":"5","nome":"= LUCRO BRUTO","valor":0,"total":true,"pct":0},
      {"codigo":"6","nome":"(-) DESPESAS OPERACIONAIS","valor":0,"itens":[...por categoria...]},
      {"codigo":"7","nome":"(-) DESPESAS COM PESSOAL","valor":0,"itens":[...]},
      {"codigo":"8","nome":"= RESULTADO OPERACIONAL (EBITDA)","valor":0,"total":true},
      {"codigo":"9","nome":"(+/-) RESULTADO FINANCEIRO","valor":0,"itens":[...]},
      {"codigo":"10","nome":"(+/-) OUTRAS RECEITAS/DESPESAS","valor":0,"itens":[...]},
      {"codigo":"11","nome":"= RESULTADO LÍQUIDO","valor":0,"total":true,"pct":0}
    ],
    "mensal":[{"competencia":"2026-10","receita":0,"cmv":0,"despesas":0,"resultado":0}],
    "comparativo": {...mesmo formato período anterior...} }
  ```
  Regime **competência**: receita = vendas/OS em situação final (não cancelada) pela data; CMV = `custoTotal` das vendas + custo das peças de OS; despesas = contas a pagar por `competencia`/vencimento. Regime **caixa**: receita = recebimentos (MovimentoFinanceiro ENTRADA por categoria), despesas = pagamentos. Deduções: `aliquotaSimplesPct` × receita bruta + categorias `DEDUCAO`.
- `GET /relatorios/vendas-por-periodo`, `GET /relatorios/produtos-mais-vendidos`, `GET /relatorios/estoque` (valor em estoque por depósito), `GET /relatorios/comissoes` — exportáveis: `?formato=csv` devolve CSV.

## Migração do Bling
- `GET /bling/status` → `{conectado, expira, ultimaImportacao}`
- `GET /bling/auth-url` → URL OAuth (redirect `APP_URL/configuracoes/bling/callback`); `POST /bling/callback` `{code}` troca por token
- `POST /bling/importar` `{entidades:['contatos','produtos','estoque','vendas','compras','contasReceber','contasPagar','notas'], dataInicial?, dataFinal?, detalhesProdutos?, fecharEmAberto?, baixarNoCaixa?}` → executa em background; `GET /bling/importar/status` → `{emAndamento, progresso:{entidade, feitos, total}, resultado:{vendas:{importados, atualizados, erros, resumo}}, log:[...]}`
  - `fecharEmAberto`: vendas "Em aberto", "Em andamento" e "Verificado" no Bling entram como **Fechada** (a situação original fica nas observações internas e no histórico). Mapeamento Bling → Balão: Atendido/Venda Agenciada → Fechada, Cancelado/Estornos → Cancelada, Verificado → Em andamento, Em digitação → Em aberto.
  - `baixarNoCaixa`: cada venda fechada (situação final, não cancelada) gera contas a receber por parcela (ou 1 pelo total, se o pedido não tem parcelas) **já recebidas na conta Caixa na data da venda** (`MovimentoFinanceiro` ENTRADA → fluxo de caixa/DRE caixa). Idempotente: reimportar não duplica nem relança.
  - `resumo` (também no log): quantidade e total dos pedidos, por mês e por situação, quantas foram fechadas na migração e o valor lançado no caixa — para conferir com o Bling.
- `POST /bling/importar-csv` multipart `{arquivo, entidade}` → importa planilha exportada do Bling (contatos/produtos)
- Regras: usa `blingId` para idempotência (reimportar não duplica); vendas importadas mapeiam `situacao.blingId`; números preservados.

## Público (sem token)
- `GET /publico/os/:token` → acompanhamento da OS pelo cliente (status, itens, total) — token = hash da OS; `POST /publico/os/:token/aprovar`
- `GET /publico/venda/:token` → resumo do pedido/orçamento (`tipo`, `validade`, `podeAprovar`, `expirado`); `POST /publico/venda/:token/aprovar` `{nome}` → cliente aprova o orçamento pelo link. Responder **APROVAR** no WhatsApp também aprova o último orçamento enviado ao número.

## Impressões (HTML prontos para `window.print()`)
- `/vendas/:id/imprimir` (e `/vendas/:id/pdf`), `/compras/:id/imprimir`, `/ordens-servico/:id/imprimir?via=`, `/notas-fiscais/:id/danfe` (PDF)
