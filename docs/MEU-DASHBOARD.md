# Meu Dashboard (desde 29/10/2026)

Endereço: **www.balao.info/sistema/** (tela inicial de todo mundo) e **/meu-dashboard**.

Todo perfil entra no sistema e cai no **seu** dashboard, no estilo Power BI (números principais no topo, detalhes embaixo, ajustando-se a computador, tablet e celular), com o efeito V18 e o filtro de período completo (Todo o período · Hoje · Ontem · 7 dias · 30 dias · Este mês · Mês passado · Este ano · Ano passado · Últimos 12 meses · Período), **abrindo sempre em "Hoje"**.

Todo alerta vem com o botão **Corrija** (ou Resolver/Ver), que abre o registro direto na tela onde se preenche o que falta.

| Perfil | O que vê | O que NUNCA vê |
|---|---|---|
| **Vendedor** | Minhas vendas no período (com variação), nº de vendas, ticket médio, comissão; meta do mês com ritmo; ranking (só o próprio valor); desafios; alertas das vendas dele; lembretes; cards Hoje/semana/mês; vendas por dia; o que mais vendi; últimas vendas | custo, lucro, margem, saldo de banco, DRE |
| **Técnico** | OS abertas comigo (em andamento, esperando peça, aprovação, prontas), OS concluídas e **receita de serviços** (valor cobrado) no período, tempo médio; meta do mês (R$ de serviços ou nº de OS); ranking da assistência; desafios de OS (e de vendas, porque ele também vende); alertas das OS dele + OS sem técnico para assumir; lembretes; fila de OS; OS por dia; **as vendas dele** | custo das peças, lucro, margem, "pagar técnico", saldo |
| **Gerente** (e Financeiro) | Saldo em bancos + caixa, a receber/pagar hoje e atrasado; receita (vendas + assistência), entradas e saídas no período; avisos (caixinhas no prazo primeiro, contas vencidas, OS atrasadas, consignação); alertas da loja inteira; lembretes (os dela e os que manda para a equipe); vendedores × meta e técnicos × meta; desafios em andamento; receita por dia; vendas por vendedor; últimos acontecimentos; atalhos | lucro, margem, DRE (decisão do Thiago, 29/10/2026) |
| **Gestor** (ADMIN) | O "Dashboard" completo de sempre, renomeado para Meu Dashboard: tudo da gerente + lucro, margem, DRE, lançamentos, Saúde, dashboards de vendas/assistência/consignação | — |

A API só devolve ao vendedor e ao técnico o que eles podem ver: a rota `GET /meu-dashboard` monta a resposta por perfil e ainda passa um filtro que remove qualquer chave com custo/lucro/margem/DRE/saldo (defesa extra; o teste `testes/meu-dashboard.ts` confere todas as chaves).

## "Ver como"
O gestor e a gerente têm, no topo, o seletor **Ver como…** com a equipe: abre o dashboard de qualquer vendedor ou técnico **exatamente como a pessoa vê** (mesma API, mesmas regras, sem lucro), com uma faixa amarela lembrando. A gerente não abre o do gestor. Dá para mandar um lembrete para a pessoa direto dali.

## Alertas do sistema (pendências com Corrija)
- **Vendas** (do vendedor, ou da loja para a gerente): venda com produto sem custo informado · venda sem forma de pagamento · venda em aberto com cliente incompleto (CPF, telefone, e-mail, endereço — ou "Consumidor final") · venda parada em aberto há mais de 7 dias · orçamento sem resposta há mais de 3 dias · venda "Pronto pra NF" esperando o botão (o técnico não recebe este, porque não emite NF).
- **Assistência** (do técnico, ou da loja): OS aberta sem técnico (qualquer técnico pode assumir) · OS com peça sem custo informado · OS há mais de 2 dias sem diagnóstico · OS aguardando aprovação do cliente há mais de 3 dias · OS com prazo vencido · OS parada há mais de 5 dias.
- **Loja** (gerente/gestor): venda do mês sem vendedor · NF rejeitada · pedido de compra em aberto há mais de 15 dias — mais todos os de vendas e OS consolidados.
- Cada alerta mostra até 6 registros com link direto e "ver todos". Os alertas somem sozinhos quando a pendência é corrigida.

## Lembretes
- Cada usuário escreve os seus (texto + data) no próprio dashboard; marca como feito ou exclui. Atrasados e de hoje ficam em destaque.
- O gestor e a gerente mandam lembrete para qualquer pessoa da equipe (seletor "Para…", ou direto no "ver como"). Aparece no dashboard dela com "de Fulano".
- Ninguém mexe no lembrete de outro (só a gestão).
- Rotas: `GET /lembretes`, `POST /lembretes`, `PUT /lembretes/:id`, `POST /lembretes/:id/concluir|reabrir`, `DELETE /lembretes/:id`. Tabela `Lembrete`.

## Técnico que também vende
- Ao entrar, o usuário TÉCNICO ganha sozinho o cadastro de **técnico** (para as OS) e o de **vendedor** (para as vendas dele), pelo nome. A venda feita por ele fica no nome dele, conta no ranking de vendedores e na meta de vendas (se a gestão definir uma).
- O técnico tem o painel do vendedor e o Meu Dashboard; continua sem emitir NF.

## Metas e desafios de técnico
- **Metas e desafios → Metas do mês** ganhou a tabela **Metas dos técnicos**: para cada técnico escolhe-se o **tipo** (R$ de serviços concluídos ou nº de OS concluídas) e o valor — padrão para todo mês ou "só neste mês". Tabela `MetaTecnico`; `Tecnico.metaMensal`/`metaTipo`. Rotas `GET|PUT /metas-tecnicos`.
- **Desafio** tem agora **Para quem**: Vendedores (conta vendas: R$, nº de vendas, unidades) ou Técnicos (conta OS concluídas: nº de OS ou R$ das OS). O prêmio entra como comissão do técnico (origem "Desafio"). Conta a OS numa situação final que não é cancelamento (Entregue, Sem reparo…), pela data de conclusão; recalcula a cada mudança de situação de OS e a cada 10 minutos. Campos `Desafio.publico`, `Desafio.tecnicosIds`, `DesafioConquista.tecnicoId`.

## Técnico (código)
- API: `apps/api/src/modules/meu-dashboard/` (`routes.ts` perfil + "ver como", `service.ts` blocos de vendas/assistência/gerente, `alertas.ts` pendências), `apps/api/src/modules/lembretes/routes.ts`, `apps/api/src/modules/metas/` (metas e desafios de vendedores e técnicos, `painelDoVendedor`), `apps/api/src/modules/comum/avisos-gestao.ts` (avisos do gestor/gerente, usados por `/avisos` e pelo dashboard).
- Tela: `apps/web/src/pages/meu-dashboard/` (`MeuDashboard.tsx` escolhe o dashboard pelo perfil e cuida do "ver como"; `DashboardVendedor`, `DashboardTecnico`, `DashboardGerente`; `partes.tsx` com alertas Corrija, lembretes, meta e ranking). O do gestor é `pages/dashboard/DashboardGeral.tsx`.
- Políticas: `/meu-dashboard` e `/lembretes` para todos os perfis (a rota decide o que devolve); `/metas-tecnicos` e `/desafios` só gestão; `/painel-vendedor` inclui o técnico.
- Testes: `apps/api/testes/meu-dashboard.ts` (109 verificações) + perfis em `scripts/teste-perfis.ts`; as telas novas entram sozinhas nos testes de navegador e de layout.
