-- Transferência e importação dos lançamentos que já existem.
-- Prefira `npx prisma db push` (apps/api): ele acerta a tabela a partir do schema.
-- Este SQL é para um banco que JÁ tem LancamentoAutomatico no formato da migração anterior.
-- Não lança dinheiro. Não apaga movimento. Rode uma vez.

PRAGMA foreign_keys=OFF;

CREATE TABLE "LancamentoAutomatico_new" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tipo" TEXT NOT NULL,
    "data" DATETIME NOT NULL,
    "valor" REAL NOT NULL,
    "contaFinanceiraId" INTEGER,
    "contaDestinoId" INTEGER,
    "contraparte" TEXT NOT NULL,
    "contraparteChave" TEXT NOT NULL,
    "categoriaId" INTEGER,
    "emailOrigemId" TEXT NOT NULL,
    "emailOrigemUrl" TEXT,
    "descricao" TEXT,
    "botNome" TEXT NOT NULL,
    "chaveApiId" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "jaLancado" BOOLEAN NOT NULL DEFAULT 0,
    "movimentoId" INTEGER,
    "movimentoEntradaId" INTEGER,
    "contaPagarId" INTEGER,
    "contaReceberId" INTEGER,
    "contaPagarCanceladaId" INTEGER,
    "requerEstornoManual" BOOLEAN NOT NULL DEFAULT 0,
    "confiadoPorId" INTEGER,
    "confiadoEm" DATETIME,
    "contestadoPorId" INTEGER,
    "contestadoEm" DATETIME,
    "observacaoContestacao" TEXT,
    "criadoEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" DATETIME NOT NULL,
    CONSTRAINT "LancamentoAutomatico_contaFinanceiraId_fkey" FOREIGN KEY ("contaFinanceiraId") REFERENCES "ContaFinanceira" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LancamentoAutomatico_contaDestinoId_fkey" FOREIGN KEY ("contaDestinoId") REFERENCES "ContaFinanceira" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LancamentoAutomatico_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "CategoriaFinanceira" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LancamentoAutomatico_chaveApiId_fkey" FOREIGN KEY ("chaveApiId") REFERENCES "ChaveApi" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "LancamentoAutomatico_movimentoId_fkey" FOREIGN KEY ("movimentoId") REFERENCES "MovimentoFinanceiro" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LancamentoAutomatico_movimentoEntradaId_fkey" FOREIGN KEY ("movimentoEntradaId") REFERENCES "MovimentoFinanceiro" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LancamentoAutomatico_contaPagarId_fkey" FOREIGN KEY ("contaPagarId") REFERENCES "ContaPagar" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LancamentoAutomatico_contaReceberId_fkey" FOREIGN KEY ("contaReceberId") REFERENCES "ContaReceber" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LancamentoAutomatico_confiadoPorId_fkey" FOREIGN KEY ("confiadoPorId") REFERENCES "Usuario" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "LancamentoAutomatico_contestadoPorId_fkey" FOREIGN KEY ("contestadoPorId") REFERENCES "Usuario" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "LancamentoAutomatico_new" (
    "id", "tipo", "data", "valor", "contaFinanceiraId", "contraparte", "contraparteChave", "categoriaId",
    "emailOrigemId", "emailOrigemUrl", "descricao", "botNome", "chaveApiId", "status", "movimentoId",
    "confiadoPorId", "confiadoEm", "contestadoPorId", "contestadoEm", "observacaoContestacao", "criadoEm", "atualizadoEm"
)
SELECT
    "id", "tipo", "data", "valor", "contaFinanceiraId", "contraparte", "contraparteChave", "categoriaId",
    "emailOrigemId", "emailOrigemUrl", "descricao", "botNome", "chaveApiId", "status", "movimentoId",
    "confiadoPorId", "confiadoEm", "contestadoPorId", "contestadoEm", "observacaoContestacao", "criadoEm", "atualizadoEm"
FROM "LancamentoAutomatico";

DROP TABLE "LancamentoAutomatico";
ALTER TABLE "LancamentoAutomatico_new" RENAME TO "LancamentoAutomatico";

CREATE UNIQUE INDEX "LancamentoAutomatico_emailOrigemId_key" ON "LancamentoAutomatico"("emailOrigemId");
CREATE UNIQUE INDEX "LancamentoAutomatico_movimentoId_key" ON "LancamentoAutomatico"("movimentoId");
CREATE UNIQUE INDEX "LancamentoAutomatico_movimentoEntradaId_key" ON "LancamentoAutomatico"("movimentoEntradaId");
CREATE INDEX "LancamentoAutomatico_status_data_idx" ON "LancamentoAutomatico"("status", "data");
CREATE INDEX "LancamentoAutomatico_contaFinanceiraId_data_idx" ON "LancamentoAutomatico"("contaFinanceiraId", "data");
CREATE INDEX "LancamentoAutomatico_contraparteChave_idx" ON "LancamentoAutomatico"("contraparteChave");
CREATE INDEX "LancamentoAutomatico_contaPagarId_idx" ON "LancamentoAutomatico"("contaPagarId");
CREATE INDEX "LancamentoAutomatico_contaReceberId_idx" ON "LancamentoAutomatico"("contaReceberId");

PRAGMA foreign_keys=ON;
