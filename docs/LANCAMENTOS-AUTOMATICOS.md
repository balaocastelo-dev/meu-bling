# Lançamentos automáticos – revisão

O bot lê e-mails de bancos e registra cada entrada ou saída no MEU BLING para uma pessoa revisar. A tela fica em **Financeiro → Lançamentos automáticos** (`/financeiro/lancamentos-automaticos`), só para o ADMIN.

## O que acontece com o dinheiro

| Situação | Saldo da conta | Movimento no extrato | Baixa de conta a pagar/receber |
| --- | --- | --- | --- |
| **Pendente** (o bot acabou de registrar) | não muda | não cria | não |
| **Confio** | muda (entrada soma, saída tira) | cria o lançamento avulso | não |
| **Contestar** | não muda | não cria | não |

Confio é a decisão de aceitar que o dinheiro entrou ou saiu da conta. O e-mail não diz, com segurança, qual título em aberto foi quitado — por isso a baixa continua na tela de contas ou na ferramenta `baixar_conta`. Contestar exige uma observação e grava quem contestou e quando. As duas decisões ficam gravadas com usuário e data/hora e não voltam atrás.

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
| `tipo` | sim | `ENTRADA` ou `SAIDA` |
| `data` | sim | `AAAA-MM-DD` |
| `valor` | sim | reais, maior que zero |
| `contaFinanceiraId` | sim | o id de `contas_financeiras` (outra chave, escopo financeiro em leitura) |
| `contraparte` | sim | quem pagou (entrada) ou quem recebeu (saída) |
| `categoriaId` | não | receita na entrada, despesa na saída |
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

Confiar, contestar e mudar o limite de valor alto **não** abrem para chave. São botões do painel.
