# Lançamentos automáticos – revisão

O bot lê e-mails de bancos e registra cada entrada ou saída no MEU BLING para uma pessoa revisar. A tela fica em **Financeiro → Lançamentos automáticos** (`/financeiro/lancamentos-automaticos`), só para o ADMIN.

## O que acontece com o dinheiro

| Situação | Saldo da conta | Movimento no extrato | Baixa de conta a pagar/receber |
| --- | --- | --- | --- |
| **Pendente** (o bot acabou de registrar) | não muda | não cria | não |
| **Confio** de lançamento novo | muda | entrada/saída: um movimento. Transferência: as duas pernas, sem categoria | não |
| **Confio** de um já importado | não muda de novo | não cria outro | não |
| **Contestar** | não muda | não cria e não apaga | não. Se já estava lançado, fica marcado para estorno manual |

Confio de um lançamento novo aceita o dinheiro. Transferência usa a mesma função do sistema (`transferirEntreContas`, a de `POST /financeiro/transferencia`): saída na origem, entrada no destino, `categoriaId` nulo, observação `TRANSFERENCIA` (fora do DRE). A baixa de um título continua manual.

Lançamento **importado** (`jaLancado`) já mexeu no saldo pelo caminho normal. Confio só grava quem confirmou. Contestar não desfaz o dinheiro: marca `requerEstornoManual` para alguém estornar na mão.

Valor **alto** (padrão R$ 1.000,00, inclusive; o ADMIN muda o limite na própria tela) e **pagador/fornecedor novo** (o nome ainda não foi aceito num Confio e não existe como contato) aparecem em destaque.

## O que o bot chama

Escopo da chave, em Configurações → API e integrações: **`lancamentos-automaticos`**.

- **GRAVACAO** — criar (e também listar)
- **LEITURA** — só listar

Não use o escopo `financeiro`: ele não abre esta rota, e esta rota não abre baixa, saldo nem contas.

A rota aparece em `listar_endpoints` (recurso `lancamentos-automaticos`), com o exemplo de corpo. O conector grava e consulta por ela.

Base: `https://www.balao.info/sistema/api/v1` (em casa: `http://localhost:3333/api/v1`).

Cabeçalho: `X-API-Key: mb_...` (ou `Authorization: Bearer mb_...`).

### Criar (nasce pendente)

`POST /api/v1/lancamentos-automaticos`

```bash
curl -s -X POST "https://www.balao.info/sistema/api/v1/lancamentos-automaticos" \
  -H "X-API-Key: mb_SUA_CHAVE" \
  -H "Content-Type: application/json" \
  -d '{
    "tipo": "SAIDA",
    "data": "2026-10-31",
    "valor": 1500.50,
    "contaFinanceiraId": 1,
    "contraparte": "Distribuidora Exemplo Ltda",
    "categoriaId": 3,
    "emailOrigemId": "id-do-email-no-provedor",
    "emailOrigemUrl": "https://mail.google.com/mail/u/0/#inbox/id-do-email-no-provedor",
    "descricao": "PIX enviado — aviso do banco"
  }'
```

| Campo | Obrigatório | Notas |
| --- | --- | --- |
| `tipo` | sim | `ENTRADA`, `SAIDA` ou `TRANSFERENCIA` |
| `data` | sim | `AAAA-MM-DD` |
| `valor` | sim | reais, maior que zero |
| `contaFinanceiraId` | sim | conta do lançamento; na transferência, a **origem**. Id da lista abaixo |
| `contaDestinoId` | na transferência | conta de destino. Não use categoria |
| `contraparte` | sim | quem pagou ou recebeu; na transferência, o nome da conta de destino |
| `categoriaId` | não | `RECEITA` na entrada, `DESPESA` na saída. Transferência rejeita categoria |
| `emailOrigemId` | sim | id estável do e-mail. O mesmo id **não duplica**: a segunda chamada devolve o lançamento já gravado (`idempotente: true`, HTTP 200) e ignora valor diferente |
| `emailOrigemUrl` | não | link `http` ou `https` para abrir o e-mail |
| `descricao` | não | texto curto |

Resposta 201: `{ "idempotente": false, "lancamento": { "status": "PENDENTE", ... } }`.

O nome do bot gravado é o nome da chave, não um campo do corpo.

Pelo MCP (`POST /api/v1/mcp`, mesma chave):

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "gravar",
    "arguments": {
      "metodo": "POST",
      "caminho": "/lancamentos-automaticos",
      "corpo": {
        "tipo": "SAIDA",
        "data": "2026-10-31",
        "valor": 1500.5,
        "contaFinanceiraId": 1,
        "contraparte": "Distribuidora Exemplo Ltda",
        "emailOrigemId": "id-do-email-no-provedor"
      }
    }
  }
}
```

### Listar por status

`GET /api/v1/lancamentos-automaticos?status=PENDENTE`

Filtros: `status` (`PENDENTE`, `CONFIADO`, `CONTESTADO`; sem filtro devolve todos), `dataInicial`, `dataFinal` (`AAAA-MM-DD`), `contaFinanceiraId`, `pagina`, `limite`.

Pelo conector: `consultar` com caminho `/lancamentos-automaticos?status=PENDENTE`.

### Transferência entre contas próprias

Mesma rota de criar. `contaFinanceiraId` é a origem. No Confio o saldo sai de uma conta e entra na outra, sem categoria.

```json
{
  "tipo": "TRANSFERENCIA",
  "data": "2026-10-31",
  "valor": 50,
  "contaFinanceiraId": 3,
  "contaDestinoId": 15,
  "contraparte": "Balão da Informática Morales",
  "emailOrigemId": "id-do-email-da-transferencia"
}
```

Na tela a conta aparece como `origem → destino`.

### Listas para o bot achar o id

Escopo `lancamentos-automaticos` com **LEITURA** já basta (não precisa de `financeiro`).

`GET /api/v1/lancamentos-automaticos/contas-financeiras`  
Devolve as contas ativas: `id`, `nome`, `tipo`, `banco`. Sem saldo.

`GET /api/v1/lancamentos-automaticos/categorias-financeiras`  
Devolve as categorias ativas: `id`, `nome`, `tipo` (`RECEITA` ou `DESPESA`).

As duas aparecem em `listar_endpoints`.

### Importar o que já foi lançado

`POST /api/v1/lancamentos-automaticos/importar` (nível **GRAVACAO**)

Não cria movimento e não altera saldo. Liga a fila ao título ou aos movimentos que já existem. O mesmo `emailOrigemId` na segunda vez entra em `idempotentes`.

```json
{
  "lancamentos": [
    {
      "emailOrigemId": "id-do-email-transferencia",
      "tipo": "TRANSFERENCIA",
      "valor": 50,
      "data": "2026-10-30",
      "contraparte": "Conta destino",
      "origemContaId": 3,
      "destinoContaId": 15,
      "movimentoSaidaId": 100,
      "movimentoEntradaId": 101,
      "situacao": "TRANSFERIDO"
    },
    {
      "emailOrigemId": "id-do-email-pagar",
      "tipo": "PAGAR",
      "valor": 19.75,
      "data": "2026-10-30",
      "contraparte": "Uber",
      "sistemaId": 10,
      "situacao": "PAGO",
      "contaFinanceiraId": 3,
      "categoriaId": 9
    },
    {
      "emailOrigemId": "id-do-email-receber",
      "tipo": "RECEBER",
      "valor": 29,
      "data": "2026-10-30",
      "contraparte": "Cliente",
      "sistemaId": 20,
      "situacao": "RECEBIDO",
      "contaFinanceiraId": 3,
      "categoriaId": 3
    }
  ]
}
```

`PAGAR` com `situacao` `ABERTO` e `contaFinanceiraId` null também entra: o título já existe e o caixa ainda não mudou. Confio só confirma. Contestar marca estorno manual.

Arquivo dos 18 já registrados: `apps/api/prisma/dados/lancamentos-futrico.json`.

```bash
cd apps/api
npx tsx scripts/importar-lancamentos-automaticos.ts
npx tsx scripts/importar-lancamentos-automaticos.ts --aplicar
```

Sem `--aplicar` nada é gravado. `--aplicar` grava no banco de `DATABASE_URL`. Não rode isso apontando para produção sem ser de propósito: os ids do arquivo são os do sistema que já lançou esses 18.

Confiar, contestar e mudar o limite de valor alto **não** abrem para chave. São botões do painel.
