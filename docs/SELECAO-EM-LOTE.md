# Seleção em lote (pedido do Thiago, 10/11/2026)

A caixinha de marcar várias linhas, que nasceu só para apagar vendas de teste, virou
peça do sistema inteiro: **vendas, orçamentos, ordens de serviço, notas fiscais e
produtos**. Marca várias, escolhe a ação, aplica de uma vez.

## Como funciona na tela

- **caixinha no cabeçalho** marca/desmarca a página toda;
- **Shift+clique** marca uma faixa (clica na primeira, segura Shift, clica na última);
- a seleção **não se perde ao trocar de página ou de filtro** — dá para marcar na
  página 1, ir à 2 e continuar marcando;
- funciona **no celular**: a caixinha fica à esquerda do cartão;
- a **barra de ações gruda no topo** enquanto a lista rola.

Cada ação roda **registro a registro**. Um que recuse (regra, permissão, nota
autorizada) não derruba o lote: os que deram certo são aplicados, e **os que
falharam continuam marcados** com o motivo no aviso. É isso que permite mandar 50
de uma vez sem medo.

## O que dá para fazer em cada lista

| Lista | Ações |
| --- | --- |
| Vendas e Orçamentos | Imprimir · Relatório · Clonar · **Apagar** (só ADMIN) |
| Ordens de serviço | Imprimir OS · **Etiquetas** · Relatório · Editar em lote (ADMIN/gerente) |
| Produtos | **Etiquetas** · Relatório · **Reajustar preço** · Editar em lote (ADMIN/gerente) |
| Notas fiscais | DANFE · Baixar XML · Relatório |

**Nota fiscal não tem "apagar", e é de propósito:** o documento existe na SEFAZ. As
ações ali são de conferência e de entrega ao contador.

**Imprimir tem limite de 20 por vez.** Cada documento abre numa aba; acima disso o
navegador bloqueia e vira bagunça. O botão some quando há mais de 20 marcados.

## Etiquetas

Dois formatos, escolhidos na hora de imprimir (decisão do Thiago, 10/11/2026), e a
escolha fica lembrada no navegador:

- **Folha A4 adesiva** (tipo Pimaco): 3 por linha, 24 por folha, impressora comum;
- **Etiquetadora térmica**: rolo, 50 × 30 mm, uma por página.

O **código de barras é Code 128 desenhado no próprio navegador**, sem biblioteca e
sem internet: a etiqueta sai igual em qualquer máquina da loja, inclusive com a rede
fora do ar. No produto usa o código do fabricante (GTIN) quando existe; senão, o SKU.

Em produto dá para pedir **várias cópias da mesma etiqueta** (várias unidades na
prateleira). Em OS não — cada OS é uma.

> A OS também tem a etiqueta antiga de 80 × 50 mm, individual, no botão da tela da OS.
> A nova é a de lote.

## Reajuste de preço

Três modos — **percentual**, **somar/subtrair R$** e **preço fixo** — com
arredondamento opcional para terminar em `,90` ou em inteiro.

Sempre mostra a **prévia de-para** (preço de hoje → preço novo, produto a produto)
antes de confirmar. Mexer em preço de vários produtos de uma vez é das coisas mais
fáceis de errar no sistema, então aqui ninguém confirma às cegas. Só mexe no preço de
venda: custo e preço do site ficam como estão.

## Editar em lote

**Um campo por vez**, de propósito: escolhe o que mudar, para quê, vê quantos vão ser
afetados e confirma.

- **OS**: situação, técnico responsável
- **Produtos**: categoria, ativo/inativo, pronta entrega

## Onde fica o código

| Peça | Arquivo |
| --- | --- |
| Estado da seleção | `web/hooks/useSelecao.ts` |
| Caixinhas na tabela e no cartão | `web/components/ui/Table.tsx` (prop `selecao`) |
| Barra de ações + `emLote` | `web/components/compartilhados/BarraSelecao.tsx` |
| Relatório A4 da seleção | `web/components/compartilhados/relatorioSelecao.ts` |
| Etiquetas (Code 128, A4 e térmica) | `web/components/compartilhados/etiquetas.ts` |
| Diálogo de formato da etiqueta | `web/components/compartilhados/EtiquetaModal.tsx` |
| Editar em lote | `web/components/compartilhados/EditarEmLote.tsx` |
| Reajuste de preço | `web/components/compartilhados/ReajustePreco.tsx` |

## Para colocar numa lista nova

```tsx
const selecao = useSelecao();

const acoes: AcaoLote[] = [
  { rotulo: 'Relatório', icone: <FileText />, executar: async (ids) => { /* … */ } },
];

<BarraSelecao selecao={selecao} acoes={acoes} nome="compra marcada" nomePlural="compras marcadas" />
<Table selecao={selecao} colunas={colunas} dados={resp?.data} chave={(x) => x.id} />
```

`executar` devolvendo uma lista de ids deixa **só esses** marcados (usado para os que
falharam, e para as ações que ainda vão abrir um diálogo). `emLote` já faz a contagem
de certos/errados e os avisos.

## Ideias que ficaram de fora desta primeira rodada

Valem conversa quando fizer falta:

- **Compras e contas a pagar/receber**: mesma seleção, com "baixar em lote" — é o
  lugar onde mais se repete trabalho hoje;
- **Enviar por WhatsApp em lote** (orçamentos para vários clientes de uma vez);
- **Exportar a seleção em Excel/CSV**, além do relatório impresso;
- **Anunciar nos marketplaces** a partir da seleção de produtos, usando o botão
  Anunciar que já existe;
- **Juntar vários PDFs num arquivo só** em vez de abrir uma aba por documento — tira
  o limite de 20.
