# Testes automáticos do MEU BLING

Um comando testa o sistema inteiro: **`npm test`** (na raiz). Leva uns 7 minutos. `npm run test:rapido` pula a compilação e o navegador (~40 s).

O teste **nunca toca o banco de verdade**: cria um banco novo numa pasta temporária, carrega os dados de exemplo e sobe uma API de teste numa porta livre.

| Etapa | O que confere |
|---|---|
| Tipos da API e da tela | código sem erro de tipo (TypeScript) |
| Compilação da tela | a tela compila para produção |
| Fluxo completo (2 rodadas) | cadastros, venda (situações, estoque, contas, comissão, NF-e simulada), compra, OS, financeiro, bancos/conciliação, notificações, dashboards, DRE, relatórios, orçamento, metas e desafios. A 2ª rodada no mesmo banco pega erro de numeração/duplicidade |
| Perfis de acesso | o que ADMIN, GERENTE, VENDEDOR, TÉCNICO e FINANCEIRO podem e não podem fazer |
| Regras de vendas | painel do vendedor ao vivo (venda em aberto conta na hora, cancelada sai, transferir/editar/excluir), privacidade do ranking, períodos (hoje ⊂ semana ⊂ 7 dias…), metas, desafios (valor, nº de vendas, unidades, produto, categoria, "só o primeiro", agendado, encerrado, estorno do prêmio), vendedor sem cadastro, estoque e contas sem lançar em dobro, cálculo de totais e descontos |
| Telas no navegador | abre **todas** as páginas (lidas do `routes.tsx`, página nova entra sozinha) com os 5 perfis: erro de JavaScript, tela "Ops, algo deu errado", chamada à API com erro, "Sem permissão" indevido, tela proibida que abre; e no celular, página que rola para o lado |
| Links | todo link do código (API e telas) e todo link que o dashboard e a Saúde do sistema devolvem leva a uma tela que existe |
| Integridade dos dados | roda a "Saúde do sistema" sobre o banco de teste: depois de tudo, saldos de contas, estoque, comissões e contas a receber têm que bater |
| Robustez | chama **todas** as rotas da API (lidas do próprio app) sem login (tem que pedir login), com código inexistente, com lixo e com cada perfil: nunca pode dar erro interno (500) |
| Log da API | nenhum erro interno registrado durante os testes |

No GitHub, `.github/workflows/testes.yml` roda tudo a cada envio e em cada PR: PR com teste vermelho não deve ser mesclado.

Arquivos: `apps/api/testes/` (rodar.ts, lib.ts, regras-vendas.ts, telas.ts, integridade.ts, robustez.ts) e `apps/api/scripts/` (smoke.ts, teste-perfis.ts).

## Saúde do sistema (dados reais)
Configurações → **Saúde do sistema** (só ADMIN) confere os dados de produção, só lendo, e lista o que corrigir com link: vendedor sem cadastro, venda sem vendedor, venda fechada sem lançamentos, cancelada ainda lançada, parcelas ≠ total, venda parada em aberto, comissão de venda cancelada, conta a receber de venda cancelada, saldo de conta ≠ movimentos, estoque negativo ou ≠ histórico, NF rejeitada/parada, produto sem NCM, certificado, OS atrasada. Roda sozinha a cada 6 horas e avisa no dashboard.
