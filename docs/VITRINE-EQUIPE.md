# Vitrine da equipe — anúncios próprios com comissão sobre o lucro

> Pedido do Thiago em 30/10/2026, em duas partes que são a mesma coisa:
>
> - o **técnico** (PJ) cadastra e gerencia sozinho os produtos e serviços de assistência dele,
>   que aparecem na vitrine do site com o nome dele, e ganha **33% do lucro** do que vender;
> - o **vendedor** cria, pelo próprio dashboard, anúncios de produto ou serviço ligados a ele,
>   e quando o cliente chega por aquele anúncio ele ganha **20% do lucro** daquela venda.
>
> Os dois casos são o mesmo mecanismo: um anúncio com dono, um link que sabe de onde o cliente
> veio, e uma comissão extra calculada sobre o lucro de verdade. O ADMIN vê tudo somado no
> dashboard principal.

## Por que um só mecanismo

Técnico e vendedor querem a mesma coisa: colocar algo na vitrine com o nome deles e receber por
isso. Fazer dois sistemas paralelos dobraria o código de comissão — que é código de dinheiro,
o pior lugar para ter duas versões da mesma conta. Então existe **um** `Anuncio`, com um dono
(`VENDEDOR` ou `TECNICO`) e um percentual próprio.

## Como se encaixa no que já existe

| Peça | Já existe | O que muda |
|---|---|---|
| Produto / serviço | `Produto` com `tipo` `P` ou `S` | nada — o anúncio aponta para um produto |
| Vitrine pública | molde dos Consignados (`/publico/consignados`) | rota nova no mesmo formato |
| Comissão | `Comissao` com base, pct, valor, competência e fluxo aprovar → pagar | ganha `anuncioId` |
| Lucro | `fechamentoVenda()` e `fechamentoOs()` | reaproveitados, rateados por item |
| Dashboard do ADM | dashboard principal | card novo |

Nada de tabela paralela de produto: o anúncio é a **vitrine**, o `Produto` continua sendo a
coisa vendável (preço, custo, NCM, estoque). Quem cria um anúncio novo cria o produto por trás
dele na mesma tela, sem saber que são dois registros.

## Modelo de dados

### `Anuncio` (novo)

| Campo | Para que serve |
|---|---|
| `codigo` | pedaço curto do link (`balao.info/a/v7k2m`) — é o que identifica a origem do cliente |
| `titulo`, `descricao`, `fotos` | o que aparece na vitrine |
| `produtoId` | o que de fato é vendido |
| `donoTipo` | `VENDEDOR` ou `TECNICO` |
| `vendedorId` / `tecnicoId` | quem recebe a comissão e quem aparece na vitrine |
| `comissaoPct` | **congelado na criação** (33 ou 20) |
| `precoAPartirDe` | para serviço sem preço fechado ("a partir de R$ 180") |
| `prazoDias` | prazo de execução, na vitrine |
| `naVitrine`, `ativo` | ligar/desligar sem apagar |
| `visitas`, `vendas` | o que o dono vê como retorno |

`comissaoPct` fica gravado no anúncio de propósito: se amanhã a regra da loja mudar de 33 para
25, os anúncios antigos continuam pagando o que foi combinado quando foram criados. Mudar o
percentual de um anúncio que já vendeu não reescreve o passado.

### Campos novos em quem já existe

- `Venda.anuncioId` e `VendaItem.anuncioId` — de qual anúncio veio
- `OrdemServico.anuncioId` e `OrdemServicoItem.anuncioId` — idem
- `Comissao.anuncioId` — qual anúncio gerou aquele pagamento extra

## Atribuição: como o sistema sabe que o cliente veio por ali

É a parte que decide se isso é confiável ou se vira discussão no fim do mês. **Sem atribuição
registrada, não há comissão extra** — nunca por achismo.

Três caminhos, todos deixando rastro:

1. **Link do anúncio.** Cada anúncio tem `www.balao.info/a/<codigo>`. O site guarda o código por
   30 dias e manda junto no pedido (`POST /integracoes/site/vendas`, campo `anuncioCodigo`).
2. **Venda na loja.** No pedido de venda e na OS existe o campo "Veio de um anúncio?", onde se
   escolhe o anúncio. É o caso do cliente que viu no site e veio à loja.
3. **Item do portal do técnico.** Serviço do técnico lançado na OS já traz o anúncio dele.

Toda atribuição manual (caminho 2) fica na auditoria com quem marcou — é dinheiro saindo, então
precisa ter nome.

## A conta do lucro

O percentual incide sobre o **lucro**, usando a mesma fórmula do DRE e dos dashboards
(`fechamentoVenda` / `fechamentoOs`):

```
lucro = receita − custo do produto/peça − imposto − taxa de cartão − frete/logística
```

Isso não é detalhe: se a comissão usasse uma definição própria de lucro, o número do técnico
nunca bateria com o lucro do dashboard, e toda conversa sobre pagamento viraria perícia. Usando a
fórmula do sistema, o valor **reconcilia** com o que o ADMIN vê.

### Rateio por item

Quando só parte da venda veio do anúncio, os custos da venda inteira (imposto, cartão, frete)
são rateados **proporcionalmente à receita de cada item**:

```
lucro do item = total do item − custo do item − (custos da venda × total do item ÷ total da venda)
```

A soma dos lucros dos itens dá exatamente o lucro da venda, então nada se perde nem se duplica
no rateio.

### O que cada um recebe

- **Técnico — 33%:** sobre o lucro **dos itens dele**. Ele é pago pelo serviço que prestou, não
  pelo resto do carrinho.
- **Vendedor — 20%:** sobre o lucro **da venda** atribuída ao anúncio dele, conforme o pedido
  ("20% do lucro daquela venda"). O anúncio trouxe o cliente, e o que ele levou a mais entrou junto.

Se o lucro der zero ou negativo, não há comissão — e o motivo aparece na tela, para ninguém achar
que o sistema esqueceu.

### Quando é calculada

No mesmo momento em que as comissões normais já são calculadas: quando a venda/OS tem as contas
lançadas. Reaproveita `recriarComissoes()`, então ganha de graça o que já existe: recálculo ao
editar, cancelamento ao cancelar, trava de "comissão já paga não se mexe", competência e o fluxo
aprovar → pagar → contas a pagar.

## As três travas contra pagar duas vezes

O risco real: o técnico recebe três vezes pelo mesmo serviço — pela comissão normal da OS, pela
comissão do anúncio e pelo "Pagar técnico" do fim do mês. As travas:

1. **Item de anúncio do técnico entra com `comissaoTecnicoPct = 0`.** Aquele item é pago pelos
   33%, e a tela diz isso ao lançar.
2. **"Pagar técnico" desconta o que já foi pago por anúncio no período** e mostra a dedução na
   prévia, antes de lançar.
3. **Uma comissão por anúncio por origem.** `recriarComissoes` apaga e recria; comissão já paga
   bloqueia o recálculo (erro 422, comportamento que já existe).

Para o vendedor não há conflito: a comissão do anúncio é **extra**, somada à comissão normal de
venda — era o pedido, e é o que estimula a publicar anúncio.

## Permissões

| Quem | Pode |
|---|---|
| `TECNICO` | criar, editar e desligar **os próprios** anúncios e os produtos/serviços por trás deles |
| `VENDEDOR` | o mesmo, nos anúncios dele |
| `GERENTE` / `ADMIN` | tudo, mais o painel de acompanhamento |

Sem aprovação prévia — decisão do Thiago, porque o técnico é PJ e precisa de liberdade para
trabalhar. Em troca, o ADMIN tem visibilidade total: todo anúncio novo aparece no quadro de
acontecimentos do dashboard, e pode ser desligado a qualquer momento.

A liberdade tem um limite técnico: o dono mexe **só no que é dele**. A regra é por dono, não por
perfil — vendedor não edita anúncio de técnico nem o contrário.

## Telas

**Meus anúncios** (dashboard do vendedor e do técnico): cards com foto, visitas, vendas e o
quanto já rendeu. Botão "Criar anúncio" em destaque — é o que estimula a publicar. Ao criar:
título, foto, descrição, preço (ou "a partir de"), prazo e garantia. O link do anúncio sai pronto
para copiar e mandar no WhatsApp.

**Vitrine do site**: seção nova com os anúncios ligados, cada um com o nome de quem atende
("Atendimento com Jairlem"). O site é o repositório `balao2026`; aqui fica a API pública pronta
(`/publico/anuncios`), no mesmo formato dos Consignados.

**Dashboard do ADMIN**: card **"Pagamento extra por anúncio da equipe"** com o total do período,
a divisão entre técnicos e vendedores, quem mais vendeu e o lucro que os anúncios trouxeram —
porque o número que importa é esse, não a comissão isolada.

## O que fica fora desta primeira entrega

- A página da vitrine no site (`balao2026`): a API fica pronta, a página é outro repositório.
- Nota fiscal de serviço: a loja é do Simples Nacional e o sistema emite NF-e/NFC-e pela SEFAZ,
  que é mercadoria. Serviço é ISS, nota da prefeitura de Campinas (NFS-e), que o sistema **não
  emite**. Vender serviço pela vitrine não muda isso — se o cliente pedir nota do serviço, hoje
  alguém emite por fora.
