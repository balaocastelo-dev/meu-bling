-- Lançamentos automáticos (revisão de e-mails de banco).
-- O MEU BLING em desenvolvimento aplica o schema com `npx prisma db push` (apps/api).
-- Em um banco que já existe, este SQL cria só a tabela nova — não apaga nada.
-- Lançamento PENDENTE não tem movimento e não altera ContaFinanceira.saldoAtual.

CREATE TABLE "LancamentoAutomatico" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tipo" TEXT NOT NULL,
    "data" DATETIME NOT NULL,
    "valor" REAL NOT NULL,
    "contaFinanceiraId" INTEGER NOT NULL,
    "contraparte" TEXT NOT NULL,
    "contraparteChave" TEXT NOT NULL,
    "categoriaId" INTEGER,
    "emailOrigemId" TEXT NOT NULL,
    "emailOrigemUrl" TEXT,
    "descricao" TEXT,
    "botNome" TEXT NOT NULL,
    "chaveApiId" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "movimentoId" INTEGER,
    "confiadoPorId" INTEGER,
    "confiadoEm" DATETIME,
    "contestadoPorId" INTEGER,
    "contestadoEm" DATETIME,
    "observacaoContestacao" TEXT,
    "criadoEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" DATETIME NOT NULL,
    CONSTRAINT "LancamentoAutomatico_contaFinanceiraId_fkey" FOREIGN KEY ("contaFinanceiraId") REFERENCES "ContaFinanceira" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LancamentoAutomatico_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "CategoriaFinanceira" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LancamentoAutomatico_chaveApiId_fkey" FOREIGN KEY ("chaveApiId") REFERENCES "ChaveApi" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "LancamentoAutomatico_movimentoId_fkey" FOREIGN KEY ("movimentoId") REFERENCES "MovimentoFinanceiro" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LancamentoAutomatico_confiadoPorId_fkey" FOREIGN KEY ("confiadoPorId") REFERENCES "Usuario" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "LancamentoAutomatico_contestadoPorId_fkey" FOREIGN KEY ("contestadoPorId") REFERENCES "Usuario" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "LancamentoAutomatico_emailOrigemId_key" ON "LancamentoAutomatico"("emailOrigemId");
CREATE UNIQUE INDEX "LancamentoAutomatico_movimentoId_key" ON "LancamentoAutomatico"("movimentoId");
CREATE INDEX "LancamentoAutomatico_status_data_idx" ON "LancamentoAutomatico"("status", "data");
CREATE INDEX "LancamentoAutomatico_contaFinanceiraId_data_idx" ON "LancamentoAutomatico"("contaFinanceiraId", "data");
CREATE INDEX "LancamentoAutomatico_contraparteChave_idx" ON "LancamentoAutomatico"("contraparteChave");
