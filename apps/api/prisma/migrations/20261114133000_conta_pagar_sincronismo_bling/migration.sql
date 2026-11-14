-- Situação original do Bling e o carimbo da sincronização de contas a pagar.
-- Colunas opcionais: título já lançado não muda até alguém sincronizar.
ALTER TABLE "ContaPagar" ADD COLUMN "situacaoBling" INTEGER;
ALTER TABLE "ContaPagar" ADD COLUMN "sincronizadoEm" DATETIME;
