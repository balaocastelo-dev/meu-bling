# Guia de desenvolvimento (backend `apps/api`)

## Stack
- Node 22 + TypeScript (ESM, `"type":"module"`, imports com sufixo `.js`), Fastify 5, Prisma 6 (SQLite), Zod 4, tsx.
- Rodar: `npm run dev` (porta 3333). Banco: `prisma/schema.prisma`; `npm run db:push` após mudar schema; `npm run db:seed -- --demo`.

## Estrutura
```
src/
  app.ts            # monta o Fastify, plugins, autoload de módulos e integrações
  server.ts         # sobe o servidor e inicia serviços de fundo
  lib/              # prisma, env, errors (AppError/NotFound/Forbidden), crypto (encrypt/decrypt), util (paginação, proximoNumero, renderTemplate, datas), auditoria
  core/
    situacoes.ts    # MOTOR DE SITUAÇÕES: registrarModulo, registrarAcao, mudarSituacao, executarAcoes, situacoesPermitidas, historico
    eventos.ts      # barramento: eventos.emitir('situacao.alterada', ...) / eventos.ouvir(...)
    servicos.ts     # registrarServico(nome, fn) → workers iniciados após listen
  plugins/auth.ts   # JWT; app.exigirPerfil('ADMIN','GERENTE'); req.user {id,nome,perfil,vendedorId,tecnicoId}
  modules/<nome>/
    routes.ts       # OBRIGATÓRIO: `export default async function (app: FastifyInstance) { ... }` — carregado automaticamente
    service.ts      # regras de negócio (opcional)
    schemas.ts      # zod (opcional)
  integracoes/<nome>/
    routes.ts       # idem (fiscal, whatsapp, email, openfinance, bling)
```

## Regras
1. **Rotas**: caminhos completos `/api/v1/...`. Validar `req.body`/`req.query` com Zod (`schema.parse`). Erros de negócio: `throw new AppError('mensagem', 422, 'CODIGO')`. Não encontrado: `throw new NotFound('Venda')`.
2. **Listagens**: usar `paginacaoSchema`, `paginar`, `respostaPaginada` de `lib/util.ts`.
3. **Numeração**: `proximoNumero('VENDA', tx)` dentro da transação.
4. **Situações**: cada módulo (VENDA/COMPRA/OS) chama no topo do `routes.ts`:
   ```ts
   registrarModulo('VENDA', { obterSituacaoId, gravarSituacao });
   registrarAcao('VENDA', 'lancarEstoque', async (ctx) => { /* idempotente: checar venda.estoqueLancado */ });
   ```
   Trocar situação SEMPRE via `mudarSituacao({...})` (nunca update direto no campo `situacaoId`).
   Handlers recebem `ctx.tx` (transação) e devem ser idempotentes (flags `estoqueLancado`/`contasLancadas`, `OrdemServicoItem.estoqueBaixado`).
5. **Estoque**: toda alteração de saldo cria `MovimentoEstoque` (com `saldoAnterior/saldoPosterior`) e atualiza `EstoqueSaldo` (upsert por `produtoId_depositoId`). Produtos `tipo='S'` ou `controlaEstoque=false` não movimentam. Reservas usam `EstoqueSaldo.reservado`.
6. **Financeiro**: lançar contas = criar `ContaReceber`/`ContaPagar` por parcela (descrição `Venda nº X (1/3)`, `origemTipo`, `origemId`, `competencia`, `categoriaId` da venda/compra ou padrão) e vincular `parcela.contaReceberId`. Estornar = situação `CANCELADO` nas contas não baixadas (se já recebida → erro 422 pedindo estorno da baixa). Baixa = `MovimentoFinanceiro` + atualizar `ContaFinanceira.saldoAtual`.
7. **Eventos**: após criar venda/OS emitir `eventos.emitir('venda.criada', ...)`. Mudança de situação já emite `situacao.alterada`.
8. **Auditoria**: `auditar(req, 'Venda', id, 'CRIAR'|'ALTERAR'|'EXCLUIR'|'ACAO', detalhes)` nas mutações.
9. **Segredos**: nunca devolver campos criptografados; usar `encrypt/decrypt/mask` de `lib/crypto.ts`.
10. **Mensagens** de erro e nomes de campos em português. Código comentado em português.
11. **Perfis**: VENDEDOR vê/edita vendas, contatos, produtos (leitura), OS; TECNICO vê OS; FINANCEIRO vê financeiro; configurações ADMIN/GERENTE. Use `preHandler: app.exigirPerfil(...)`.
12. **Sem dependências novas** sem necessidade; se precisar, adicionar em `apps/api/package.json` e rodar `npm install` em `apps/api`.
13. Antes de concluir: `npm run typecheck` tem que passar sem erros no `apps/api`.
