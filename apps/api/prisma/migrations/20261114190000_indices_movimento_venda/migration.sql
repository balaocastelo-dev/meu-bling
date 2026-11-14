-- Fechar a venda procura movimentos pela conta a receber/pagar e as saídas pela venda.
-- Sem estes índices o SQLite varre a tabela inteira dentro da transação de 5 s.
CREATE INDEX IF NOT EXISTS "MovimentoFinanceiro_contaReceberId_idx" ON "MovimentoFinanceiro"("contaReceberId");
CREATE INDEX IF NOT EXISTS "MovimentoFinanceiro_contaPagarId_idx" ON "MovimentoFinanceiro"("contaPagarId");
CREATE INDEX IF NOT EXISTS "ContaPagar_origemTipo_origemId_idx" ON "ContaPagar"("origemTipo", "origemId");
CREATE INDEX IF NOT EXISTS "ContaPagar_competencia_idx" ON "ContaPagar"("competencia");
