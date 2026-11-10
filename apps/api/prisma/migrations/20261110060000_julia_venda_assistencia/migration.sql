-- Correções pedidas pela Júlia (10/11/2026) — venda e assistência.
-- Todas as colunas são novas e opcionais (ou com valor padrão): nenhuma linha é
-- apagada e nenhuma tabela é recriada. O container aplica este arquivo com
-- `prisma migrate deploy` ao subir.

-- 1) Cartão de crédito: em quantas vezes o CLIENTE parcelou no cartão dele.
--    A loja recebe numa data só, então isto NÃO vira várias contas a receber:
--    serve para a taxa do cartão e para sair no documento ("3x de R$ 100,00").
ALTER TABLE "VendaParcela" ADD COLUMN "parcelasCartao" INTEGER;
ALTER TABLE "OrdemServicoParcela" ADD COLUMN "parcelasCartao" INTEGER;

-- 2) Técnico que NÃO vende (caso do Wendell): sem isso o login recriava o
--    cadastro de vendedor dele toda vez. Padrão true mantém os outros como estão.
ALTER TABLE "Usuario" ADD COLUMN "vendeTambem" BOOLEAN NOT NULL DEFAULT true;

-- 3) Asaas: cobrança gerada a partir da venda.
ALTER TABLE "Empresa" ADD COLUMN "asaasApiKey" TEXT;
ALTER TABLE "Empresa" ADD COLUMN "asaasAmbiente" TEXT NOT NULL DEFAULT 'producao';
ALTER TABLE "Empresa" ADD COLUMN "asaasCobrancaAuto" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Venda" ADD COLUMN "asaasCobrancaId" TEXT;
ALTER TABLE "Venda" ADD COLUMN "asaasLinkUrl" TEXT;
ALTER TABLE "Venda" ADD COLUMN "asaasStatus" TEXT;
ALTER TABLE "Venda" ADD COLUMN "asaasEm" DATETIME;
