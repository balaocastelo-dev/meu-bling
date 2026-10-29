# Testes automáticos do MEU BLING

Um comando testa o sistema inteiro: **`npm test`** (na raiz). Leva uns 12 minutos. `npm run test:rapido` pula a compilação e o navegador (~40 s).

O teste **nunca toca o banco de verdade**: cria um banco novo numa pasta temporária, carrega os dados de exemplo e sobe uma API de teste numa porta livre.

| Etapa | O que confere |
|---|---|
| Tipos da API e da tela | código sem erro de tipo (TypeScript) |
| Compilação da tela | a tela compila para produção |
| Fluxo completo (2 rodadas) | cadastros, venda (situações, estoque, contas, comissão, NF-e simulada), compra, OS, financeiro, bancos/conciliação, notificações, dashboards, DRE, relatórios, orçamento, metas e desafios, últimas movimentações do dashboard, resumo do período da lista de vendas. A 2ª rodada no mesmo banco pega erro de numeração/duplicidade |
| Perfis de acesso | o que ADMIN, GERENTE, VENDEDOR, TÉCNICO e FINANCEIRO podem e não podem fazer |
| Regras de vendas | painel do vendedor ao vivo (venda em aberto conta na hora, cancelada sai, transferir/editar/excluir), privacidade do ranking, períodos (hoje ⊂ semana ⊂ 7 dias…), metas, desafios (valor, nº de vendas, unidades, produto, categoria, "só o primeiro", agendado, encerrado, estorno do prêmio), vendedor sem cadastro, estoque e contas sem lançar em dobro, cálculo de totais e descontos |
| Meu Dashboard | vendedor e técnico nunca recebem custo/lucro/margem/DRE/saldo (todas as chaves conferidas); técnico que vende; alertas "Corrija" (venda sem custo, OS sem técnico, OS sem custo de peça) somem ao corrigir; lembretes; meta e desafio de técnico pagando prêmio; "ver como" só da gestão |
| API externa | chaves de API: só o ADMIN cria; leitura/gravação/exclusão por área; rotas de administração nunca abrem; chave inválida, desativada, vencida, IP errado, na URL sem permissão; limite por minuto; regenerar; OpenAPI e ferramentas MCP filtradas; webhook assinado chega quando a chave cria uma venda; registro de chamadas |
| Telas no navegador | abre **todas** as páginas (lidas do `routes.tsx`, página nova entra sozinha) com os 5 perfis: erro de JavaScript, tela "Ops, algo deu errado", chamada à API com erro, "Sem permissão" indevido, tela proibida que abre |
| Layout em 5 tamanhos | abre **todas** as páginas em celular pequeno (360 px), celular (390), tablet (768), tablet deitado (1024) e computador (1440) e reprova: página que rola para o lado, pedaço que sai da tela ou do card, texto cortado sem "…". Tabela larga que rola **dentro** do próprio card é só aviso |
| Links | todo link do código (API e telas) e todo link que o dashboard e a Saúde do sistema devolvem leva a uma tela que existe |
| Integridade dos dados | roda a "Saúde do sistema" sobre o banco de teste: depois de tudo, saldos de contas, estoque, comissões e contas a receber têm que bater |
| Robustez | chama **todas** as rotas da API (lidas do próprio app) sem login (tem que pedir login), com código inexistente, com lixo e com cada perfil: nunca pode dar erro interno (500) |
| Log da API | nenhum erro interno registrado durante os testes |

No GitHub, `.github/workflows/testes.yml` roda tudo a cada envio e em cada PR: PR com teste vermelho não deve ser mesclado.

Arquivos: `apps/api/testes/` (rodar.ts, lib.ts, rotas.ts, regras-vendas.ts, telas.ts, layout.ts, integridade.ts, robustez.ts) e `apps/api/scripts/` (smoke.ts, teste-perfis.ts). O layout sozinho: `npx tsx testes/layout.ts <url da API> [url das telas] [pasta para salvar prints]`; `LAYOUT_SO=/vendas` restringe às telas que casam.

## Regras de tela para celular e tablet
- **Listas** usam o componente `Table`: abaixo de 1024 px cada linha vira um cartão (2 por linha no tablet). Coluna com `ocultarMobile` some da tabela até 1280 px e aparece no cartão. Cartão próprio: `cartao={(linha) => …}` (vendas, compras, OS, notas e contas já têm).
- **Tabelas de itens** (formulários e detalhes): `className="tbl tbl-pilha"` e, nas células, `data-rotulo="Qtd"`; `pilha-cheio` (linha inteira), `pilha-oculto` (some no celular), `pilha-canto` (botão no canto).
- **Tabela solta** sempre dentro de `<div className="overflow-x-auto">`.
- `.input-base` e `.tbl` ficam em `@layer components`: um `w-36`, `py-0` ou `text-right` no className vale por cima delas.
- Itens de `grid` têm `min-width: 0` e o conteúdo quebra palavra comprida (`overflow-wrap`), ambos na camada base.
- Formulários: grade de 2 colunas até 1280 px e de 12 colunas acima (`sm:grid-cols-2 xl:grid-cols-12`).
- Grades de 3–4 colunas (cards de indicadores, campos) viram 2 no tablet: use `lg:grid-cols-3`/`lg:grid-cols-4` (ou `xl:`), nunca `sm:`/`md:` com 3+ colunas.
- **Dashboards (padrão Power BI)**: todo dashboard abre com os números principais no topo — saldo em bancos + caixa, faturamento/vendas e lucro — e os detalhes menos importantes abaixo do separador `SecaoDetalhes`. Use `FaixaKpis` (2 por linha no celular, 3–4 no tablet, até 6 no computador) com `KpiV18`; o número principal leva `destaque` + `className="col-span-2"` (linha inteira no celular). Saldo de cada conta: `SaldosContas` (rola de lado no celular). Gráficos com altura `h-52 sm:h-64`. Filtro de período rola de lado no celular em vez de quebrar em várias linhas.
- **Menu**: até 1024 px é gaveta (botão ☰), fecha ao escolher item, tocar fora ou Esc; acima fica fixo.
- **Modal** fica em tela cheia no celular com rolagem interna (o `tamanho="sm"` sobe como folha de baixo); `Drawer` e busca (Ctrl+K) também ocupam a tela toda no celular.
- **Toque**: em tela de toque (`pointer-coarse:`) botões, itens de menu e campos têm no mínimo 40 px; no celular campos têm fonte de 16 px (sem zoom do iPhone). No computador nada muda.
- **Barra fixa de Salvar** (venda/compra/OS): classe `barra-fixa` + `espaco-barra-fixa` no conteúdo, ambas com `env(safe-area-inset-bottom)`.
- Altura de tela cheia com `dvh` (`min-h-dvh`, `h-dvh`), não `vh`/`h-screen`. O `index.html` tem `viewport-fit=cover`, então algo fixo no topo/rodapé precisa de `env(safe-area-inset-*)`.
- Animação de entrada com `animation-fill-mode: backwards`, nunca `both`/`forwards` em bloco de página: o transform que sobra prende o `position: fixed` dos filhos.

## Saúde do sistema (dados reais)
Configurações → **Saúde do sistema** (só ADMIN) confere os dados de produção, só lendo, e lista o que corrigir com link: vendedor sem cadastro, venda sem vendedor, venda fechada sem lançamentos, cancelada ainda lançada, parcelas ≠ total, venda parada em aberto, comissão de venda cancelada, conta a receber de venda cancelada, saldo de conta ≠ movimentos, estoque negativo ou ≠ histórico, NF rejeitada/parada, produto sem NCM, certificado, OS atrasada. Roda sozinha a cada 6 horas e avisa no dashboard.
