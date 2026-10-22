# Site www.balao.info ↔ MEU BLING (desde 22/10/2026)

Pedido do Thiago: **os produtos do sistema são os do site**, com foto e o selo de pronta entrega, e **o PDV do
site (`www.balao.info/pdv`) manda as vendas para o /sistema**, não mais para o Bling.

## Produtos do site

- Fonte: o espelho do catálogo que o CRM mantém na mesma VPS (`https://srv1963897.hstgr.cloud/api/crm/catalogo`,
  variável `SITE_CATALOGO_URL`). Não toca o MySQL do site (cota de conexões por hora).
- Serviço `catalogo-do-site` (`apps/api/src/modules/site/catalogo.ts`): 1 min depois de subir e a cada 30 min.
  Botão **Sincronizar agora** em Produtos (ADMIN/GERENTE). `SITE_SINCRONIZAR=0` desliga.
- Vem do site (sobrescrito a cada volta): nome, preço à vista (Pix) → `preco`, preço no cartão → `precoCartao`, custo,
  foto (`imagemUrl`), marca, categoria (caminho "A/B" vira categoria e subcategoria), fornecedor, disponibilidade.
  `Pronta entrega` no site → `prontaEntrega = true` (selo verde nas telas). Código do produto: `SITE-<id do site>`.
- Fica do sistema e nunca é tocado: NCM/CSOSN/CFOP e demais dados fiscais, controle de estoque, saldos, mínimo, garantia.
- Produto que saiu do site fica **inativo** (some da busca da venda; continua nas vendas antigas). Se o espelho
  vier com menos de 1.000 produtos, nada é desativado naquela volta.
- Produtos antigos que não são do site (vieram do Bling): a faixa da lista de produtos mostra quantos são e o ADMIN
  pode desativá-los de uma vez (reversível um a um). Nada é desativado sozinho.
- Gravação em lotes de 100 com pausa: a primeira volta (6,4 mil produtos) leva ~12 s sem travar as vendas.

## PDV do site → /sistema

- Porta: `apps/api/src/modules/site/routes.ts`, rotas `/api/v1/integracoes/site/*`, chave
  `SITE_CHAVE_INTEGRACAO` (criada pelo `deploy/vps/instalar-vps.sh` no `/etc/meu-bling.env`). A mesma chave vai
  na Vercel como `MEU_BLING_CHAVE`: o `scripts\deploy-vps.ps1` copia para a área de transferência e abre a Vercel
  (uma vez só).
- Venda do caixa: acha o cliente pelo CPF/CNPJ (ou pelo celular; sem nada, "Consumidor Final"), cria se não existir,
  completa o endereço e o código IBGE pelo CEP (ViaCEP); itens pelo `siteId` (produto ainda não sincronizado é
  criado na hora; item avulso vai como linha livre); uma parcela por forma de pagamento (crédito com "3x no cartão");
  vendedor do sistema; origem Balcão; `numeroPedidoLoja` = id do PDV. Cria e passa para **Fechada** (lança estoque,
  contas e comissão). Repetir com o mesmo id do PDV devolve a mesma venda.
- Nota: `POST /vendas/:id/nfe` gera e transmite a NF-e 55. Se falta algo, devolve 422 com a lista do que falta (o
  balcão mostra). Item avulso não vai na nota. Com `{cliente}`, troca o cliente da venda antes (nota pedida depois).
- DANFE: o site gera um link assinado (`/api/pdv/danfe/<nota>?t=…`) para o QR do cupom e busca o PDF aqui.

## Banco (SQLite) com duas pontas gravando

Desde esta mudança o PDV grava vendas enquanto a equipe usa o /sistema. Para isso:
`lib/prisma.ts` usa **uma conexão** (`connection_limit=1`, o Prisma enfileira as consultas), espera até 20 s pelo
arquivo (`socket_timeout=20`) e liga o modo **WAL** na subida. Antes, duas gravações ao mesmo tempo davam
"Socket timeout" (reproduzido no teste de fumaça com gravações em paralelo).
