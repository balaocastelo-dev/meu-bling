# API externa — conectar outros sistemas e agentes de IA (desde 24/10/2026)

Tela: **Configurações → API e integrações** (`www.balao.info/sistema/configuracoes/api`), **só ADMIN**.

## Como funciona
- Cada sistema ou agente ganha uma **chave** (`mb_` + 48 caracteres). A chave aparece **uma vez** ao criar; no banco fica só o hash.
- Por chave, o ADMIN escolhe o nível em cada área: **Nada · Ler · Gravar (inclui ler) · Total (inclui excluir)**.
  Áreas: clientes, produtos/estoque, vendas/orçamentos, compras, OS, financeiro, notas fiscais, comissões/metas, relatórios (só leitura), mensagens (WhatsApp/e-mail), cadastros auxiliares.
- A chave usa **as mesmas rotas `/api/v1`** das telas (contrato em `API.md`). GET = ler; POST/PUT = gravar; DELETE = total.
- **Nunca** abrem para chave: usuários, as próprias chaves/webhooks, certificado, SMTP, logo, alterar empresa, configurações, situações (alterar), Bling, Open Finance, auditoria, diagnóstico, conectar WhatsApp, catálogo do site, inutilizar NF. Rota fora das áreas = fechada.
- Opções por chave: validade, IPs liberados, limite por minuto (padrão 120; acima → 429), desativar, gerar nova chave (a antiga morre na hora), "permitir na URL" (só para o conector do claude.ai).
- A chave age em nome do ADMIN que a criou; a auditoria e o quadro de acontecimentos do dashboard mostram **"API: <nome>"** ou **"Agente de IA (MCP): <nome>"**.
- Toda chamada fica no **Registro de chamadas** (30 dias): método, rota, status, tempo, IP, motivo da recusa.

## Como chamar
```
X-API-Key: mb_...                 (ou Authorization: Bearer mb_...)
Base: https://www.balao.info/sistema/api/v1
GET  /externo/eu                   quem sou eu e o que posso
GET  /externo/openapi.json         OpenAPI 3.1 só com o que a chave pode (Postman, n8n, GPT Actions)
POST /mcp                          servidor MCP (agentes de IA)
POST /mcp/mb_...                   MCP com a chave na URL (precisa de "permitir na URL")
```

## Agentes de IA (MCP)
Transporte Streamable HTTP sem sessão, respostas JSON. Ferramentas (filtradas pelas permissões da chave):
`listar_endpoints`, `consultar` (GET), `gravar` (POST/PUT), `excluir`, `buscar_clientes`, `historico_do_cliente`, `buscar_produtos`, `listar_vendas`, `ver_venda`, `listar_ordens_servico`, `ver_ordem_servico`, `resumo_financeiro`, `situacoes`, `enviar_whatsapp`.
Cada ferramenta chama a própria API com a mesma chave — permissões, limite e registro valem igual.

- Claude Code: `claude mcp add --transport http meu-bling https://www.balao.info/sistema/api/v1/mcp --header "X-API-Key: mb_..."`
- Claude Desktop/Cursor: `{"mcpServers":{"meu-bling":{"type":"http","url":".../api/v1/mcp","headers":{"X-API-Key":"mb_..."}}}}`
- claude.ai (conector personalizado): `.../api/v1/mcp/mb_...` (ligar "permitir na URL").
- ChatGPT (GPT Actions): importar `.../externo/openapi.json`, autenticação por cabeçalho `X-API-Key`.

## Webhooks de saída
O MEU BLING faz POST JSON nos endereços cadastrados quando acontece: `venda.criada`, `venda.alterada`, `situacao.alterada`, `compra.criada`, `os.criada`, `os.orcamento`, `nfe.autorizada`, `nfe.cancelada`, `conta.recebida`, `conta.paga` (ou todos).
- Corpo: `{ evento, quando, sistema, origem, dados: { ...ids, resumo (venda/os/nota/conta), recurso: "/vendas/123" } }`
- Cabeçalhos: `X-MeuBling-Evento`, `X-MeuBling-Entrega`, `X-MeuBling-Assinatura: sha256=<HMAC-SHA256 do corpo com o segredo>`.
- Resposta 2xx = entregue; senão novas tentativas em 1 min, 5 min, 30 min e 2 h. Botões: enviar teste, últimas entregas, reenviar, ver/gerar segredo.

## Técnico
- Tabelas: `ChaveApi`, `LogApi`, `WebhookSaida`, `EntregaWebhook` (aplicadas pelo `prisma db push` na subida do container).
- Código: `apps/api/src/modules/api-externa/` (`recursos.ts` catálogo e regras, `chaves.ts`, `webhooks.ts`, `openapi.ts`, `mcp.ts`, `routes.ts`); autenticação da chave em `plugins/auth.ts`; limite por chave em `app.ts`.
- Rotas da tela: `/api-externa/*` (só ADMIN). Tela: `apps/web/src/pages/configuracoes/ApiIntegracoes.tsx` + `api/`.
- Teste: `apps/api/testes/api-externa.ts` (89 verificações, entra no `npm test`).
