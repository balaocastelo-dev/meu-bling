# Painel do vendedor, metas e desafios (desde 22/10/2026)

Endereços: **www.balao.info/sistema/meu-painel** (vendedor) e **www.balao.info/sistema/metas-desafios** (ADMIN e GERENTE).

## Painel do vendedor ("Meu painel")
- O perfil VENDEDOR cai direto nele ao entrar. ADMIN/GERENTE escolhem o vendedor no seletor do topo.
- Cards: **Hoje · Esta semana (seg→hoje) · Últimos 7 dias · Este mês · Últimos 30 dias · Sempre**, com total vendido, nº de vendas, ticket médio e comissão.
- **Meta do mês**: vendido / meta, %, quanto falta, quanto precisa por dia, dias restantes. Cor pelo ritmo: verde no ritmo, amarelo um pouco atrás (75–95% do esperado), vermelho bem atrás. A linha na barra marca o esperado até hoje.
- **Ranking do mês**: posição e nomes de todos; o vendedor vê só o próprio valor e "faltam R$ X para passar Fulano". A gestão vê os valores de todos.
- **Desafios** em cards (laranja em andamento, verde conquistado, cinza encerrado) e **últimas vendas**.
- Conta como venda: **todo pedido não cancelado**, assim que é salvo (Em aberto, Em andamento, Fechada, NF emitida). Cancelada sai; orçamento não conta. A tela se atualiza a cada 20 s e após qualquer gravação.
- Usuário VENDEDOR sem cadastro de vendedor ganha um automaticamente (mesmo nome) no login, no painel ou na primeira venda.

## Metas
- Metas e desafios → aba **Metas do mês**: **meta padrão** (vale todo mês) e, se quiser, **"Só neste mês"** com outro valor.

## Desafios
- Título, descrição, **o que conta** (valor vendido R$, nº de vendas ou unidades), **alvo**, **prêmio** (+R$ 50, 100, 150, 200 ou outro), início/fim, **quem ganha** (todos que baterem ou só o primeiro), filtro opcional de **produto ou categoria**, participantes (todos ou escolhidos).
- Ao bater o alvo o prêmio entra **sozinho** como comissão extra **já aprovada** (origem "Desafio" em Comissões) e é pago junto com as outras comissões.
- Se uma venda for cancelada e o vendedor deixar de bater o alvo, o prêmio **ainda não pago** é estornado (comissão cancelada). Prêmio já pago fica.
- Recalcula a cada mudança de situação de venda e a cada 10 minutos (pega transferência de vendedor e vendas do PDV).
- Encerrar: ninguém mais ganha; quem ganhou mantém. Excluir só sem prêmio lançado.

## Técnico
- Tabelas: `MetaVendedor`, `Desafio`, `DesafioConquista`; `Vendedor.metaMensal`; `Comissao.desafioId` (`origemTipo = DESAFIO`). Aplicadas pelo `prisma db push` na subida do container.
- Rotas: `GET /painel-vendedor`, `GET|PUT /metas`, `GET|POST /desafios`, `PUT|DELETE /desafios/:id`, `POST /desafios/:id/encerrar|reabrir` (código em `apps/api/src/modules/metas`).
- Testes: `scripts/smoke.ts` (161 verificações) e `scripts/teste-perfis.ts` (60).
