-- Prazo de garantia escolhido pelo vendedor na hora de imprimir o certificado.
-- Vazio = vale a regra automática de sempre (12 meses novo / 3 meses seminovo),
-- então nenhuma venda já feita muda de comportamento.
ALTER TABLE "VendaItem" ADD COLUMN "garantiaMeses" INTEGER;
