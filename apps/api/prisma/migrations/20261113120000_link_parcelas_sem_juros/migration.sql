-- Parcelas sem juros pedidas no link do Mercado Pago.
-- 0 = nenhuma (juros do cliente, o padrão da loja). 2 ou 3 = até Nx sem juros,
-- e as demais parcelas continuam com juros do cliente.
-- Coluna nova com padrão 0: venda já feita não muda de comportamento.
ALTER TABLE "Venda" ADD COLUMN "linkPagamentoSemJuros" INTEGER NOT NULL DEFAULT 0;
