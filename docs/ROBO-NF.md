# Robô de NF

Roda 24h dentro da API (serviço `robo-nf`). Desliga com `ROBO_NF=off`.

## O que ele faz em cada pedido de venda sem NF autorizada
1. **Cliente**: CEP → rua, bairro, cidade, UF e código IBGE (ViaCEP); CNPJ → razão social e endereço (BrasilAPI); cidade+UF → código IBGE (IBGE); tipo de pessoa e indicador de IE. Só preenche o que está vazio.
2. **NCM dos produtos** (nunca troca um NCM existente):
   - `HISTORICO`: NCM das notas já autorizadas do produto, ou de outro produto com o mesmo nome → vale direto.
   - `SUGERIDO`: pela tabela de tipos (`apps/api/src/modules/robo-nf/ncm.ts`) → trava a NF até a gestão clicar em **Confirmar NCM** (uma vez por produto).
   - Sem regra → pendência com o link do produto.
3. **Checklist da NF-e 55** (o mesmo da emissão) → `PRONTA` (botão verde **Pronto pra NF**) ou `PENDENTE` (botão amarelo com o que falta e onde corrigir).

## Quando ele confere
Ao criar/editar a venda (8 s depois), ao mudar a situação, ao autorizar/cancelar a nota, a cada 5 min (vendas dos últimos 60 dias) e ao abrir a venda.

## Emitir
`POST /api/v1/vendas/:id/emitir-nf` confere de novo, gera a NF-e modelo 55 (DANFE A4) e transmite à SEFAZ. Nota rejeitada antes é reenviada com o mesmo número.

## Regras fiscais (Simples Nacional)
- CFOP: 5102 dentro de SP; fora de SP 6102 (contribuinte) ou **6108** (pessoa física / empresa sem IE); 5405 vira 6404 fora do estado.
- A tabela de NCM e os CFOPs devem ser revisados pelo contador.
