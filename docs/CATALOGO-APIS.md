# Catálogo de APIs do MEU BLING

Levantamento completo das APIs do sistema — as que o MEU BLING **oferece** (444 rotas) e as que ele **consome** lá fora (14 serviços).

Gerado a partir do código em `balaocastelo-dev/meu-bling`, subindo o servidor e lendo a tabela de rotas real do Fastify — não é lista escrita à mão, então confere com o que está no ar.

---

## 1. Resumo em números

| | |
|---|---|
| Rotas HTTP publicadas | **444** |
| Rotas sob `/api/v1` | 443 (+ `/uploads/*`) |
| Rotas públicas (sem login) | 27 |
| Rotas abertas para chave de API | **249** |
| Rotas fechadas para chave (só pela tela) | 194 |
| Endpoints documentados no catálogo interno | 254 |
| Documentação desatualizada (endpoint que não existe mais) | **0** |
| Módulos | 36 |
| Serviços externos consumidos | 14 |

A API é um **Fastify** (`apps/api`) com carregamento automático: cada pasta em `src/modules/*/routes.ts` e `src/integracoes/*/routes.ts` vira um bloco de rotas. O front (`apps/web`, React + Vite) é servido pelo mesmo processo em produção, por isso tudo responde no mesmo endereço.

---

## 2. Como chamar a API

**Endereço base:** `https://www.balao.info/sistema/api/v1` (em casa: `http://localhost:3333/api/v1`)

### Três formas de se identificar

| Forma | Como manda | Para que serve |
|---|---|---|
| **Sessão (JWT)** | `Authorization: Bearer <token>` do `POST /auth/login`, vale 12 h | As telas do sistema, usadas pelos funcionários |
| **Chave de API** | `X-API-Key: mb_...` (ou `Authorization: Bearer mb_...`) | Outro sistema, n8n, Make, planilha, robô |
| **Chave na URL** | `POST /mcp/mb_...` | Conectores de IA que não conseguem mandar cabeçalho (precisa ligar "permitir na URL" na chave) |

Fora isso, as rotas **públicas** não pedem nada: `POST /auth/login`, `GET /saude`, `/publico/*`, `/webhooks/*`, `/integracoes/site/*` (essa exige a chave do site), o retorno do Mercado Livre e o WebSocket do chat (que autentica na primeira mensagem).

### Convenções válidas em toda a API

- **Listagens:** `?pagina=1&limite=50` → `{ data: [...], meta: { total, pagina, limite, totalPaginas } }`. Limite máximo 200.
- **Erros:** `{ erro: "mensagem em português", code: "CODIGO", detalhes?: ... }`. O `erro` é escrito para a pessoa ler na tela, não para o programador.
- **Datas:** manda `AAAA-MM-DD` ou ISO; volta ISO.
- **Valores:** número em reais (`1234.56`). Percentual é número (`3` = 3%).
- **Código na URL** tem que ser inteiro positivo — `/vendas/abc` devolve 400 com mensagem clara, não estoura no banco.
- **Segredos nunca voltam:** senha de certificado, SMTP e tokens saem como `***` ou `temSenha: true`.
- **Limite de uso:** 1200 chamadas/minuto por usuário logado; por chave de API, o que estiver configurado nela (padrão 120). Estourou → 429.

### Os cinco perfis

`ADMIN` (dono, tudo) · `GERENTE` (operacional completo, sem usuários/segredos/fiscal) · `FINANCEIRO` (dinheiro, bancos, comissões, relatórios) · `VENDEDOR` · `TECNICO`.

A permissão é decidida em dois lugares — por isso vale conferir os dois antes de mexer:

1. **`apps/api/src/plugins/politicas.ts`** — política central, a primeira regra que casar decide, aplicada a *todas* as rotas `/api/*`.
2. **O `preHandler` de cada rota** (`app.exigirPerfil(...)`) — a trava específica do módulo.

Duas regras de negócio ficam embutidas na autenticação e valem para qualquer rota:

- **Venda é do vendedor:** `VENDEDOR` e `TECNICO` só enxergam as próprias vendas e orçamentos — em qualquer rota `/vendas/:id...` de qualquer módulo, e na nota ligada a elas. Nunca veem o total vendido da loja.
- **Empresa:** o `GERENTE` pode editar dados básicos em `PUT /empresa`, mas os campos fiscais e de segredo são removidos do corpo antes de salvar.
---

## 3. APIs que o MEU BLING consome lá fora

Catorze serviços. A coluna "Onde está a credencial" importa: quase tudo fica **criptografado no banco** (AES-256-GCM com a `APP_SECRET`), não em arquivo — então trocar de servidor não perde configuração, mas perder a `APP_SECRET` inutiliza todos os segredos de uma vez.

| Serviço | Para que serve na loja | Como autentica | Onde está a credencial | Código |
|---|---|---|---|---|
| **SEFAZ (NF-e 4.00)** | Emitir, cancelar, inutilizar e consultar NF-e e NFC-e | Certificado digital **A1** (TLS mútuo), SOAP 1.2 | Empresa → certificado `.pfx` + senha, criptografados | `integracoes/fiscal/sefaz.ts` |
| **Bling API v3** | Importar o histórico (pedidos, orçamentos, produtos) do sistema antigo | OAuth 2.0 (authorization code + refresh) | Token criptografado na Empresa | `integracoes/bling/cliente.ts` |
| **Mercado Pago** | Link de pagamento do pedido (Checkout Pro, cartão até 12× e PIX) | `Bearer <Access Token>` de produção | Empresa → Mercado Pago, criptografado (ou `MERCADOPAGO_ACCESS_TOKEN`) | `integracoes/mercadopago/link.ts` |
| **Mercado Livre** | Publicar anúncio a partir do produto; botão "Anunciar" | OAuth 2.0, retorno em `/jarvis/ml/callback` | Token criptografado no banco | `modules/jarvis/mercadolivre.ts` |
| **Pluggy (Open Finance)** | Puxar extrato dos bancos para conciliar | `clientId` + `clientSecret` → token; webhook em `/webhooks/pluggy` | Empresa → Open Finance, criptografado | `integracoes/openfinance/pluggy.ts` |
| **Anthropic** | Cérebro do JARVIS: sugestões, chat, montagem de anúncio | `x-api-key`, versão `2023-06-01` | Criptografada no banco; modelo padrão `claude-fable-5-1` | `modules/jarvis/ia.ts` |
| **Gmail API** | Ler os e-mails dos bancos (SumUp, Cora, Mercado Pago) para conciliar | OAuth 2.0 Google | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` + refresh token no banco | `integracoes/email/leitor.ts` |
| **WhatsApp (Baileys)** | QR Code único da loja: CRM, avisos e cobranças | Sessão do QR Code salva em `storage/whatsapp` | Nenhuma chave — é a sessão do aparelho | `integracoes/whatsapp/servico.ts` |
| **SMTP** | Enviar pedido, orçamento, NF e cobrança por e-mail | Usuário e senha SMTP | Empresa → SMTP, senha criptografada | `integracoes/email/servico.ts` |
| **ViaCEP** | Preencher endereço pelo CEP | Aberta, sem chave | — | `modules/contatos/routes.ts` |
| **BrasilAPI** | Puxar dados da empresa pelo CNPJ | Aberta, sem chave | — | `modules/robo-nf/cliente.ts` |
| **IBGE** | Código do município para a NF-e | Aberta, sem chave | — | `modules/robo-nf/cliente.ts` |
| **Azure Speech** | Voz do JARVIS (opção em nuvem) | Chave de assinatura | `AZURE_SPEECH_KEY` / `AZURE_SPEECH_REGION` | `modules/jarvis/voz-azure.ts` |
| **Voz clonada / Kokoro** | Voz do JARVIS rodando no PC da loja (RTX 4090) | Rede interna, sem chave | `VOZ_CLONE_URL`, `VOZ_KOKORO_URL` | `modules/jarvis/voz.ts` |

**Quando o serviço está fora do ar:** o padrão do sistema é não travar a loja. Sem chave da Anthropic o JARVIS continua funcionando com os textos próprios de cada regra; sem certificado a emissão para e explica o que falta, com link para resolver. Vale manter esse padrão em qualquer integração nova.

---

## 4. Webhooks de saída — o MEU BLING avisando outros sistemas

Cadastrados em **Configurações → API e integrações**. Dez acontecimentos:

`venda.criada` · `venda.alterada` · `situacao.alterada` · `compra.criada` · `os.criada` · `os.orcamento` · `nfe.autorizada` · `nfe.cancelada` · `conta.recebida` · `conta.paga`

O envio é um `POST` JSON com estes cabeçalhos:

```
content-type: application/json
user-agent: MEU-BLING-Webhook/1.0
x-meubling-evento: venda.criada
x-meubling-entrega: 1234
x-meubling-assinatura: <HMAC do corpo com o segredo do webhook>
```

Quem recebe **deve conferir a assinatura** antes de confiar no conteúdo — é o que impede alguém de forjar "conta.recebida". As entregas ficam registradas e podem ser reenviadas uma a uma por `POST /api-externa/entregas/{id}/reenviar`.

---

## 5. As 444 rotas, módulo por módulo

Legenda das colunas:

- **Perfis** — quem pode chamar, segundo `plugins/politicas.ts`. "todos" = os cinco perfis.
- **Chave de API** — nome do recurso que a chave precisa ter e o nível exigido (`LEITURA` / `GRAVACAO` / `TOTAL`). `—` significa **fechada para chave**: só pela tela, com usuário logado. `✋` é rota que pertence a um recurso mas está na lista de bloqueio.
- ⚠️ marca rota que gasta dinheiro, fala com cliente, chama serviço externo ou não tem volta.

### Login, usuários e auditoria

> Código: `apps/api/src/modules/auth/`

| Método | Rota | O que faz | Perfis | Chave de API |
|---|---|---|---|---|
| `GET` | `/auditoria` | Trilha de auditoria: quem fez o quê, quando.<br>Filtros: `entidade`, `entidadeId`, `limite` | ADMIN, GERENTE | `sistema` · LEITURA |
| `GET` | `/auth/eu` | Diz quem está logado agora: nome, e-mail, perfil e se está ligado a um cadastro de vendedor ou técnico. | todos | — |
| `POST` | `/auth/login` | Entra no sistema com e-mail e senha e devolve o passe de acesso (token) usado no resto do dia. ⚠️ SENSÍVEL: porta de entrada do sistema. Aceita no máximo 20 tentativas por minuto. Avisa quando a senha ainda é a de fábrica e grava o login na auditoria. O passe vale 12 horas. | **pública** | — |
| `POST` | `/auth/logout` | Sai do sistema, limpando o cookie de sessão usado para ver arquivos e imagens. | todos | — |
| `GET` | `/auth/perfis` | Explica em texto o que cada perfil de usuário pode fazer (dono, gerente, financeiro, vendedor, técnico), para escolher na hora de cadastrar alguém. | todos | — |
| `PUT` | `/auth/senha` | Troca a própria senha, confirmando a senha atual. ⚠️ SENSÍVEL: muda credencial de acesso. A nova senha precisa de pelo menos 8 caracteres; a atual é conferida antes. | todos | — |
| `GET` | `/usuarios` | Lista as pessoas que usam o sistema, com perfil, se estão ativas, o cadastro de vendedor ou técnico ligado e o último login. ⚠️ SENSÍVEL: mexe em usuários. Só dono ou gerente. Nenhuma senha é devolvida. Nunca fica disponível para chave de API. | ADMIN | — |
| `POST` | `/usuarios` | Cadastra uma pessoa para usar o sistema, com perfil e senha inicial, e cria sozinho o cadastro de vendedor dela. ⚠️ SENSÍVEL: mexe em usuários e define senha de acesso. Só o dono (ADMIN). A senha é guardada embaralhada. Recusa e-mail repetido e vendedor/técnico já ligado a outra pessoa. Fica registrado na auditoria. | ADMIN | — |
| `DELETE` | `/usuarios/:id` | Desliga o acesso de uma pessoa — ela some das telas mas o histórico dela continua no sistema. ⚠️ SENSÍVEL: mexe em usuários. Na prática apenas desativa (não apaga de verdade). Você não pode desligar o próprio acesso. Só o dono (ADMIN). Fica registrado na auditoria. | ADMIN | — |
| `PUT` | `/usuarios/:id` | Altera uma pessoa do sistema: nome, e-mail, perfil, senha, se está ativa e o vendedor ou técnico ligado a ela. ⚠️ SENSÍVEL: mexe em usuários e pode trocar senha e perfil de outra pessoa. Você não pode desativar o próprio usuário. Só o dono (ADMIN). Fica registrado na auditoria. | ADMIN | — |

### Empresa e configurações

> Empresa (dados do emitente, fiscal, SMTP, Open Finance, Bling) e configurações genéricas. Segredos são gravados com encrypt() e nunca devolvidos. NÃO contém /empresa/certificado nem /empresa/smtp/testar (módulos fiscal/notificações).
>
> Código: `apps/api/src/modules/empresa/routes.ts`

| Método | Rota | O que faz | Perfis | Chave de API |
|---|---|---|---|---|
| `GET` | `/configuracoes` | Lê todos os ajustes gerais do sistema, como uma lista de nome e valor. | todos | — |
| `PUT` | `/configuracoes` | Grava ajustes gerais do sistema: manda nome e valor de cada um; mandar valor vazio (nulo) apaga aquele ajuste. ⚠️ SENSÍVEL: altera o comportamento do sistema inteiro e só o dono (ADMIN) pode gravar. Fica registrado na auditoria. Nunca fica disponível para chave de API. | ADMIN | — |
| `GET` | `/empresa` | Dados da empresa (sem segredos). | todos | `cadastros` · LEITURA |
| `PUT` | `/empresa` | Altera os dados da loja: razão social, CNPJ, endereço, contatos e os ajustes fiscais, de e-mail, de Open Finance, do Bling e do Mercado Pago. ⚠️ SENSÍVEL: mexe em dados fiscais e em senhas/segredos de integração (senha do SMTP, segredo do Open Finance, segredo do Bling, token do Mercado Pago, token CSC). Esses campos são gravados embaralhados e nunca voltam na resposta — só um aviso de que existem. Gerente altera só os dados básicos; os campos fiscais e de segredo são do dono (ADMIN). Mandar o campo com asteriscos mantém o valor atual. Fica registrado na auditoria. | ADMIN, GERENTE | ✋ cadastros (bloqueada) |
| `POST` | `/empresa/logo` | Sobe a logo da loja, usada nas impressões e nos documentos, e apaga a anterior. ⚠️ Apaga a logo anterior do disco. Dono ou gerente. Fica registrado na auditoria. | ADMIN, GERENTE | — |
| `POST` | `/empresa/mercado-pago/testar` | Testa se o acesso ao Mercado Pago já gravado está funcionando, para gerar link de pagamento. ⚠️ Usa o acesso que já está salvo; não recebe nem devolve o token. Dono ou gerente. | ADMIN, GERENTE | — |

### Cadastros auxiliares

> Cadastros auxiliares: vendedores, técnicos, depósitos, formas de pagamento, categorias financeiras, categorias de produto e contas financeiras. Listagens devolvem array simples (para selects). DELETE: se estiver em uso → ativo=false, senão exclui.
>
> Código: `apps/api/src/modules/cadastros/routes.ts`

| Método | Rota | O que faz | Perfis | Chave de API |
|---|---|---|---|---|
| `GET` | `/categorias-financeiras` | Lista categorias financeiras (receitas/despesas, grupo do DRE) (array simples, sem paginação).<br>Filtros: `ativo` | todos | `financeiro` · LEITURA |
| `POST` | `/categorias-financeiras` | Cadastra em categorias financeiras (receitas/despesas, grupo do DRE). | ADMIN, GERENTE | `financeiro` · GRAVACAO |
| `DELETE` | `/categorias-financeiras/:id` | Exclui de categorias financeiras (receitas/despesas, grupo do DRE) (se estiver em uso, dá 409). | ADMIN, GERENTE | `financeiro` · TOTAL |
| `GET` | `/categorias-financeiras/:id` | Um registro de categorias financeiras (receitas/despesas, grupo do DRE). | todos | `financeiro` · LEITURA |
| `PUT` | `/categorias-financeiras/:id` | Altera em categorias financeiras (receitas/despesas, grupo do DRE) (mande só os campos que mudam). | ADMIN, GERENTE | `financeiro` · GRAVACAO |
| `GET` | `/categorias-produto` | Lista categorias de produto (array simples, sem paginação). | todos | `produtos` · LEITURA |
| `POST` | `/categorias-produto` | Cadastra em categorias de produto. | ADMIN, GERENTE | `produtos` · GRAVACAO |
| `DELETE` | `/categorias-produto/:id` | Exclui de categorias de produto (se estiver em uso, dá 409). | ADMIN, GERENTE | `produtos` · TOTAL |
| `GET` | `/categorias-produto/:id` | Um registro de categorias de produto. | todos | `produtos` · LEITURA |
| `PUT` | `/categorias-produto/:id` | Altera em categorias de produto (mande só os campos que mudam). | ADMIN, GERENTE | `produtos` · GRAVACAO |
| `GET` | `/depositos` | Lista depósitos de estoque (array simples, sem paginação).<br>Filtros: `ativo` | todos | `cadastros` · LEITURA |
| `POST` | `/depositos` | Cadastra em depósitos de estoque. | ADMIN, GERENTE | `cadastros` · GRAVACAO |
| `DELETE` | `/depositos/:id` | Exclui de depósitos de estoque (se estiver em uso, dá 409). | ADMIN, GERENTE | `cadastros` · TOTAL |
| `GET` | `/depositos/:id` | Um registro de depósitos de estoque. | todos | `cadastros` · LEITURA |
| `PUT` | `/depositos/:id` | Altera em depósitos de estoque (mande só os campos que mudam). | ADMIN, GERENTE | `cadastros` · GRAVACAO |
| `GET` | `/formas-pagamento` | Lista formas de pagamento (array simples, sem paginação).<br>Filtros: `ativo` | todos | `cadastros` · LEITURA |
| `POST` | `/formas-pagamento` | Cadastra em formas de pagamento. | ADMIN, GERENTE | `cadastros` · GRAVACAO |
| `DELETE` | `/formas-pagamento/:id` | Exclui de formas de pagamento (se estiver em uso, dá 409). | ADMIN, GERENTE | `cadastros` · TOTAL |
| `GET` | `/formas-pagamento/:id` | Um registro de formas de pagamento. | todos | `cadastros` · LEITURA |
| `PUT` | `/formas-pagamento/:id` | Altera em formas de pagamento (mande só os campos que mudam). | ADMIN, GERENTE | `cadastros` · GRAVACAO |
| `GET` | `/tecnicos` | Lista técnicos (array simples, sem paginação).<br>Filtros: `ativo` | todos | `cadastros` · LEITURA |
| `POST` | `/tecnicos` | Cadastra em técnicos. | ADMIN, GERENTE | `cadastros` · GRAVACAO |
| `DELETE` | `/tecnicos/:id` | Exclui de técnicos (se estiver em uso, dá 409). | ADMIN, GERENTE | `cadastros` · TOTAL |
| `GET` | `/tecnicos/:id` | Um registro de técnicos. | todos | `cadastros` · LEITURA |
| `PUT` | `/tecnicos/:id` | Altera em técnicos (mande só os campos que mudam). | ADMIN, GERENTE | `cadastros` · GRAVACAO |
| `GET` | `/vendedores` | Lista vendedores (array simples, sem paginação).<br>Filtros: `ativo` | todos | `cadastros` · LEITURA |
| `POST` | `/vendedores` | Cadastra em vendedores. | ADMIN, GERENTE | `cadastros` · GRAVACAO |
| `DELETE` | `/vendedores/:id` | Exclui de vendedores (se estiver em uso, dá 409). | ADMIN, GERENTE | `cadastros` · TOTAL |
| `GET` | `/vendedores/:id` | Um registro de vendedores. | todos | `cadastros` · LEITURA |
| `PUT` | `/vendedores/:id` | Altera em vendedores (mande só os campos que mudam). | ADMIN, GERENTE | `cadastros` · GRAVACAO |

### Situações (motor de status)

> Situações (motor de status) e transições — configuração por módulo (VENDA/COMPRA/OS/ORCAMENTO). `acoes` é JSON string no banco; aqui entra/sai como array.
>
> Código: `apps/api/src/modules/situacoes/routes.ts`

| Método | Rota | O que faz | Perfis | Chave de API |
|---|---|---|---|---|
| `GET` | `/situacoes` | Situações de cada módulo (use o id certo ao mudar a situação).<br>Filtros: `modulo`, `ativo` | todos | `cadastros` · LEITURA |
| `POST` | `/situacoes` | Cria uma situação nova para pedidos de venda, compras, ordens de serviço ou orçamentos, com cor e o que acontece quando o documento chega nela. ⚠️ Configuração do motor de status: só o dono (ADMIN) altera. As ações automáticas mexem em estoque, contas e nota fiscal (lancarEstoque, estornarEstoque, lancarContas, estornarContas, reservarEstoque, liberarReserva, gerarNfe, notificarCliente) e cada uma só vale nos módulos a que pertence. Marcar inicial=true tira o inicial da situação que o módulo tinha antes. | ADMIN | ✋ cadastros (bloqueada) |
| `DELETE` | `/situacoes/:id` | Exclui uma situação que não é usada por nenhum documento. ⚠️ Configuração do motor de status: só o dono (ADMIN) altera. Irreversível e leva junto, em cascata, as transições ligadas a ela. Se já houver venda, compra ou OS nessa situação, o sistema apenas a desativa e avisa; situação de sistema não pode ser excluída. | ADMIN | ✋ cadastros (bloqueada) |
| `GET` | `/situacoes/:id` | Uma situação com as ações automáticas. | todos | `cadastros` · LEITURA |
| `PUT` | `/situacoes/:id` | Altera uma situação: nome, cor, ordem, ações automáticas e se é inicial, final, de cancelamento ou ativa. ⚠️ Configuração do motor de status: só o dono (ADMIN) altera. Mudar as ações muda o que o sistema faz sozinho com estoque, contas e nota em todos os documentos que passarem por essa situação. Não é possível trocar o módulo, nem renomear uma situação de sistema (cor, ordem e ações dela podem mudar). | ADMIN | ✋ cadastros (bloqueada) |
| `GET` | `/situacoes/:id/permitidas` | Para quais situações se pode ir a partir desta. | todos | `cadastros` · LEITURA |
| `GET` | `/situacoes/acoes` | Ações automáticas disponíveis (lançar estoque, contas, NF-e, avisar cliente…). | todos | `cadastros` · LEITURA |
| `GET` | `/situacoes/transicoes` | Transições permitidas de um módulo.<br>Filtros: `modulo` | todos | `cadastros` · LEITURA |
| `PUT` | `/situacoes/transicoes` | Redesenha o fluxo de um módulo: define de qual situação se pode ir para qual e o que o sistema faz em cada passagem. ⚠️ Configuração do motor de status: só o dono (ADMIN) altera. Substitui TODO o conjunto de transições do módulo: o que não vier na lista é apagado. Origem e destino precisam ser do mesmo módulo e não podem ser iguais; pares repetidos são ignorados. | ADMIN | ✋ cadastros (bloqueada) |

### Clientes, fornecedores e transportadoras

> Contatos (clientes / fornecedores / transportadoras) + histórico unificado + ViaCEP.
>
> Código: `apps/api/src/modules/contatos/routes.ts`

| Método | Rota | O que faz | Perfis | Chave de API |
|---|---|---|---|---|
| `GET` | `/contatos` | Lista/busca contatos (nome, fantasia, documento, e-mail, telefone).<br>Filtros: `pesquisa`, `tipo`, `ativo`, `vendedorId`, `uf`, `pagina`, `limite` | todos | `clientes` · LEITURA |
| `POST` | `/contatos` | Cadastra contato. | todos | `clientes` · GRAVACAO |
| `DELETE` | `/contatos/:id` | Exclui contato (com movimento, só desativa). | todos | `clientes` · TOTAL |
| `GET` | `/contatos/:id` | Um contato com resumo (total comprado, qtd. de vendas e OS, em aberto, última compra). | todos | `clientes` · LEITURA |
| `PUT` | `/contatos/:id` | Altera contato (mande só os campos que mudam). | todos | `clientes` · GRAVACAO |
| `GET` | `/contatos/:id/historico` | Histórico do cliente: vendas, OS, contas a receber, mensagens e linha do tempo.<br>Filtros: `limite` | todos | `clientes` · LEITURA |
| `GET` | `/contatos/cep/:cep` | Endereço pelo CEP (ViaCEP): logradouro, bairro, município, UF e código IBGE. | todos | `clientes` · LEITURA |

### Produtos e estoque

> Produtos/serviços e estoque (saldos, ajustes, transferências, movimentos).
>
> Código: `apps/api/src/modules/produtos/routes.ts`

| Método | Rota | O que faz | Perfis | Chave de API |
|---|---|---|---|---|
| `POST` | `/estoque/ajuste` | Ajuste de estoque: ENTRADA, SAIDA ou BALANCO (quantidade = saldo novo). | ADMIN, GERENTE | `produtos` · GRAVACAO |
| `GET` | `/estoque/movimentos` | Movimentos de estoque (entradas, saídas, ajustes, transferências).<br>Filtros: `produtoId`, `depositoId`, `dataInicial`, `dataFinal`, `origemTipo`, `tipo`, `pagina`, `limite` | todos | `produtos` · LEITURA |
| `GET` | `/estoque/saldos` | Saldos por produto e depósito.<br>Filtros: `depositoId`, `pesquisa`, `abaixoMinimo` | todos | `produtos` · LEITURA |
| `POST` | `/estoque/transferencia` | Transfere estoque entre depósitos. | ADMIN, GERENTE | `produtos` · GRAVACAO |
| `GET` | `/produtos` | Lista/busca produtos com preço, estoque total e reservado, foto e pronta entrega.<br>Filtros: `pesquisa`, `tipo`, `categoriaId`, `ativo`, `estoque`, `prontaEntrega`, `marca`, `origem`, `ordem`, `pagina`, `limite` | todos | `produtos` · LEITURA |
| `POST` | `/produtos` | Cadastra produto. | ADMIN, GERENTE | `produtos` · GRAVACAO |
| `DELETE` | `/produtos/:id` | Exclui produto (com movimento, só desativa). | ADMIN, GERENTE | `produtos` · TOTAL |
| `GET` | `/produtos/:id` | Um produto com saldos por depósito e dados fiscais. | todos | `produtos` · LEITURA |
| `PUT` | `/produtos/:id` | Altera produto (preço, custo, dados fiscais, estoque mínimo…). | ADMIN, GERENTE | `produtos` · GRAVACAO |
| `GET` | `/produtos/:id/movimentos` | Movimentos de estoque do produto.<br>Filtros: `pagina`, `limite` | todos | `produtos` · LEITURA |

### Pedidos de venda e orçamentos

> Vendas (pedidos) e orçamentos — módulo completo conforme docs/API.md. Orçamento = Venda com tipo ORCAMENTO: numeração e situações próprias (módulo ORCAMENTO do motor), nunca movimenta estoque/financeiro nem emite nota; "converter" gera a venda vinculada.
>
> Código: `apps/api/src/modules/vendas/routes.ts`

| Método | Rota | O que faz | Perfis | Chave de API |
|---|---|---|---|---|
| `GET` | `/vendas` | Lista pedidos (tipo=ORCAMENTO para orçamentos, TODOS para os dois).<br>Filtros: `tipo`, `pesquisa`, `situacaoId`, `situacoes`, `contatoId`, `vendedorId`, `dataInicial`, `dataFinal`, `origem`, `pagina`, `limite` | todos | `vendas` · LEITURA |
| `POST` | `/vendas` | Cria pedido ou orçamento (tipo ORCAMENTO). Totais recalculados no servidor; item sem valor usa o preço do produto; sem parcelas cria 1 à vista; sem situação usa a inicial. | todos | `vendas` · GRAVACAO |
| `DELETE` | `/vendas/:id` | Exclui pedido (só sem estoque/contas lançados e sem NF autorizada). | todos | `vendas` · TOTAL |
| `GET` | `/vendas/:id` | Pedido completo: itens, parcelas (com a conta a receber), situação, nota, comissões, histórico e situações permitidas. | todos | `vendas` · LEITURA |
| `PUT` | `/vendas/:id` | Altera pedido (bloqueado depois de lançar estoque/contas, exceto observações e transporte). | todos | `vendas` · GRAVACAO |
| `POST` | `/vendas/:id/acoes` | Executa ações avulsas: lancarEstoque, estornarEstoque, lancarContas, estornarContas. | todos | `vendas` · GRAVACAO |
| `POST` | `/vendas/:id/aprovar` | Marca orçamento como aprovado. | todos | `vendas` · GRAVACAO |
| `POST` | `/vendas/:id/converter` | Converte orçamento em pedido (uma vez só). | todos | `vendas` · GRAVACAO |
| `POST` | `/vendas/:id/duplicar` | Clona o pedido/orçamento em situação inicial. | todos | `vendas` · GRAVACAO |
| `GET` | `/vendas/:id/finalizacao` | O que falta para finalizar a venda (cliente completo ou Consumidor final, produto, custo, forma de pagamento, vendedor). | todos | `vendas` · LEITURA |
| `POST` | `/vendas/:id/finalizar` | Finaliza a venda (vai para Fechada) a partir de qualquer situação. Erro 422 VENDA_INCOMPLETA traz as pendências. | todos | `vendas` · GRAVACAO |
| `POST` | `/vendas/:id/gerar-nfe` | Cria a NF-e (55) ou NFC-e (65) da venda, pendente (transmita em /notas-fiscais/{id}/transmitir). | todos | `vendas` · GRAVACAO |
| `POST` | `/vendas/:id/gerar-parcelas` | Calcula parcelas para a venda (não grava; mande depois no PUT). | todos | `vendas` · GRAVACAO |
| `GET` | `/vendas/:id/imprimir` | HTML do pedido para impressão. | todos | `vendas` · LEITURA |
| `POST` | `/vendas/:id/link-pagamento` | Gera o link de pagamento do Mercado Pago para o pedido (padrão: total da venda). | todos | `vendas` · GRAVACAO |
| `GET` | `/vendas/:id/nfe/verificar` | Confere se a venda tem tudo para emitir NF-e (diz o que falta). | todos | `vendas` · LEITURA |
| `POST` | `/vendas/:id/notificar` | Envia o pedido/orçamento ao cliente por WhatsApp ou e-mail, com PDF. | todos | `vendas` · GRAVACAO |
| `GET` | `/vendas/:id/pdf` | PDF A4 do pedido/orçamento.<br>Filtros: `download` | todos | `vendas` · LEITURA |
| `POST` | `/vendas/:id/situacao` | Muda a situação (Fechada/NF emitida exigem a venda completa: 422 VENDA_INCOMPLETA). Fechada lança estoque, contas e comissão; Cancelada estorna. Erro 422 TRANSICAO_INVALIDA traz as permitidas. | todos | `vendas` · GRAVACAO |
| `POST` | `/vendas/:id/transferir-vendedor` | Troca o vendedor (refaz a comissão pendente). | todos | `vendas` · GRAVACAO |
| `GET` | `/vendas/consumidor-final` | Cliente "Consumidor final" (criado se não existir) para vendas sem cadastro do cliente. | todos | `vendas` · LEITURA |
| `POST` | `/vendas/gerar-parcelas` | Calcula parcelas de um total qualquer (não grava). | todos | `vendas` · GRAVACAO |

### Pedidos de compra

> Compras (pedidos de compra) — conforme docs/API.md.
>
> Código: `apps/api/src/modules/compras/routes.ts`

| Método | Rota | O que faz | Perfis | Chave de API |
|---|---|---|---|---|
| `GET` | `/compras` | Lista pedidos de compra.<br>Filtros: `pesquisa`, `situacaoId`, `fornecedorId`, `dataInicial`, `dataFinal`, `pagina`, `limite` | todos | `compras` · LEITURA |
| `POST` | `/compras` | Cria pedido de compra. | todos | `compras` · GRAVACAO |
| `DELETE` | `/compras/:id` | Exclui pedido de compra (sem lançamentos). | todos | `compras` · TOTAL |
| `GET` | `/compras/:id` | Pedido de compra completo: itens, parcelas (contas a pagar), fornecedor, histórico. | todos | `compras` · LEITURA |
| `PUT` | `/compras/:id` | Altera pedido de compra. | todos | `compras` · GRAVACAO |
| `POST` | `/compras/:id/acoes` | Ações avulsas: lancarEstoque, estornarEstoque, lancarContas, estornarContas. | todos | `compras` · GRAVACAO |
| `GET` | `/compras/:id/imprimir` | HTML do pedido de compra para impressão. | todos | `compras` · LEITURA |
| `POST` | `/compras/:id/situacao` | Muda a situação (Fechado: entrada de estoque + contas a pagar; Consignado: só estoque). | todos | `compras` · GRAVACAO |
| `POST` | `/compras/importar-xml` | Cria compra a partir do XML da NF-e do fornecedor (casa itens por GTIN/código ou cria). | todos | `compras` · GRAVACAO |

### Ordens de serviço (assistência técnica)

> Ordens de serviço (assistência técnica) — conforme docs/API.md.
>
> Código: `apps/api/src/modules/ordens-servico/routes.ts`

| Método | Rota | O que faz | Perfis | Chave de API |
|---|---|---|---|---|
| `GET` | `/ordens-servico` | Lista ordens de serviço (com "atrasada").<br>Filtros: `pesquisa`, `situacaoId`, `situacoes`, `contatoId`, `tecnicoId`, `vendedorId`, `prioridade`, `dataInicial`, `dataFinal`, `pagina`, `limite` | todos | `os` · LEITURA |
| `POST` | `/ordens-servico` | Abre OS. | todos | `os` · GRAVACAO |
| `DELETE` | `/ordens-servico/:id` | Exclui OS (sem lançamentos). | todos | `os` · TOTAL |
| `GET` | `/ordens-servico/:id` | OS completa: equipamento, defeito, diagnóstico, peças e serviços, parcelas, anexos, histórico. | todos | `os` · LEITURA |
| `PUT` | `/ordens-servico/:id` | Altera OS (diagnóstico, serviço executado, itens, datas…). Mande só o que muda. | todos | `os` · GRAVACAO |
| `POST` | `/ordens-servico/:id/acoes` | Ações avulsas: lancarEstoque, estornarEstoque, lancarContas, estornarContas, reservarEstoque, liberarReserva, gerarNfe. | todos | `os` · GRAVACAO |
| `POST` | `/ordens-servico/:id/anexos` | Anexa arquivo/foto (multipart/form-data, campo "arquivo"). | todos | `os` · GRAVACAO |
| `DELETE` | `/ordens-servico/:id/anexos/:anexoId` | Remove um anexo. | todos | `os` · TOTAL |
| `POST` | `/ordens-servico/:id/aprovar-orcamento` | Marca o orçamento da OS como aprovado. | todos | `os` · GRAVACAO |
| `POST` | `/ordens-servico/:id/gerar-nfe` | Cria a NF-e das peças da OS (pendente). | todos | `os` · GRAVACAO |
| `GET` | `/ordens-servico/:id/imprimir` | HTML da OS para impressão.<br>Filtros: `via` | todos | `os` · LEITURA |
| `GET` | `/ordens-servico/:id/nfe/verificar` | Confere se a OS tem tudo para a NF-e das peças. | todos | `os` · LEITURA |
| `POST` | `/ordens-servico/:id/notificar` | Envia a OS/orçamento ao cliente por WhatsApp ou e-mail. | todos | `os` · GRAVACAO |
| `POST` | `/ordens-servico/:id/situacao` | Muda a situação da OS (avisa o cliente se configurado). | todos | `os` · GRAVACAO |
| `GET` | `/ordens-servico/kanban` | OS agrupadas por situação (quadro). Com período: todas as OS que entraram nele.<br>Filtros: `tecnicoId`, `diasFinalizadas`, `dataInicial`, `dataFinal` | todos | `os` · LEITURA |

### Consignação

> CONSIGNAÇÃO — rotas.   Loja (login): /api/v1/consignacoes/*  → todos os funcionários criam e acompanham contratos (decisão do Thiago);                 pagar/quitar só ADMIN, GERENTE e FINANCEIRO; cancelar e regras só a gestão.   Consignante (sem login, pelo token do link): /api/v1/publico/consignacao/:token/*   Site (vitrine "Consignados"): /api/v1/publico/consignados
>
> Código: `apps/api/src/modules/consignacoes/routes.ts`

| Método | Rota | O que faz | Perfis | Chave de API |
|---|---|---|---|---|
| `GET` | `/consignacoes` | Contratos de consignação com valores, prazo, quanto falta pagar ao consignante, diárias e o alerta do que fazer; totais.<br>Filtros: `status`, `ativas`, `pesquisa`, `consignanteId` | todos | `consignacao` · LEITURA |
| `POST` | `/consignacoes` | Cria o contrato: produto CONS-N com 1 no estoque, pedido de compra "Consignado" e WhatsApp ao consignante com o link para assinar. | todos | `consignacao` · GRAVACAO |
| `GET` | `/consignacoes/:id` | Um contrato com pagamentos, descontos pedidos, fotos e linha do tempo. | todos | `consignacao` · LEITURA |
| `PUT` | `/consignacoes/:id` | Altera dados do equipamento, preço (nunca abaixo do valor travado do consignante) e vitrine do site. | todos | `consignacao` · GRAVACAO |
| `POST` | `/consignacoes/:id/assinar-na-loja` | Registra o contrato como assinado na loja (com a imagem da assinatura opcional). | todos | `consignacao` · GRAVACAO |
| `POST` | `/consignacoes/:id/cancelar` | Cancela um contrato lançado por engano (sem venda e sem pagamento). Exige nível total. | todos | `consignacao` · TOTAL |
| `GET` | `/consignacoes/:id/contrato` | Contrato em HTML pronto para imprimir. | todos | `consignacao` · LEITURA |
| `POST` | `/consignacoes/:id/desconto` | Pede ao consignante, pelo WhatsApp, autorização para baixar o preço (padrão 5%). | todos | `consignacao` · GRAVACAO |
| `POST` | `/consignacoes/:id/escolha` | Registra a escolha do consignante no fim do prazo: RECEBER (diárias) ou RETIRAR. | todos | `consignacao` · GRAVACAO |
| `POST` | `/consignacoes/:id/fotos` | Envia fotos (multipart, campo de arquivo); a primeira é a capa no site. | todos | `consignacao` · GRAVACAO |
| `DELETE` | `/consignacoes/:id/fotos/:nome` | Remove uma foto. | todos | `consignacao` · TOTAL |
| `PUT` | `/consignacoes/:id/fotos/ordem` | Reordena as fotos (a primeira vira capa). | todos | `consignacao` · GRAVACAO |
| `POST` | `/consignacoes/:id/iniciar-diarias` | Começa as diárias agora (encerra o prazo hoje). | todos | `consignacao` · GRAVACAO |
| `POST` | `/consignacoes/:id/pagar` | Paga o consignante (o que vence até hoje, ou o valor informado) saindo da conta escolhida. Exige nível total. | todos | `consignacao` · TOTAL |
| `POST` | `/consignacoes/:id/quitar` | Troca as diárias que faltam por um pagamento só, hoje (e paga se vier a conta). Exige nível total. | todos | `consignacao` · TOTAL |
| `POST` | `/consignacoes/:id/reenviar-link` | Reenvia ao consignante o link do contrato pelo WhatsApp. | todos | `consignacao` · GRAVACAO |
| `POST` | `/consignacoes/:id/retirada` | Registra a retirada do equipamento pelo consignante (taxa antes do prazo, devolução de diárias recebidas). | todos | `consignacao` · GRAVACAO |
| `GET` | `/consignacoes/dashboard` | Dashboard de consignação: estoque consignado, lucro possível, vendas, lucro, margem e pagamentos (dataInicial/dataFinal). | todos | `consignacao` · LEITURA |
| `GET` | `/consignacoes/painel` | Painel do ADM: pagar agora, compromisso de caixa por dia, sugestões de quitar (vendidos durante as diárias), perto do prazo e sem assinatura. | ADMIN, GERENTE, FINANCEIRO | `consignacao` · LEITURA |
| `GET` | `/consignacoes/regras` | Regras vigentes (percentual do consignante, prazo, diária %/mínimo/máximo, taxa de retirada, desconto do robô). | todos | `consignacao` · LEITURA |
| `PUT` | `/consignacoes/regras` | Altera as regras padrão da consignação: quanto fica para o dono do equipamento, prazo, valor da diária, taxa de retirada, desconto automático e feriados. ⚠️ Só o dono (ADMIN). As regras novas valem apenas para os próximos contratos: os contratos já assinados continuam com as regras deles. A diária máxima não pode ser menor que a mínima. | ADMIN | ✋ consignacao (bloqueada) |
| `POST` | `/consignacoes/robo` | Roda na hora o robô da consignação: pede ao dono do equipamento autorização para baixar o preço e, nos contratos com prazo vencido, começa as diárias. ⚠️ Só o dono (ADMIN). Dispara mensagens de WhatsApp para os consignantes e cria contas a pagar das diárias, portanto não é um simples teste. O robô já roda sozinho a cada 30 minutos. | ADMIN | ✋ consignacao (bloqueada) |
| `GET` | `/consignacoes/simular` | Conta de um contrato antes de criar: valor do consignante, lucro da loja e diárias.<br>Filtros: `precoVenda`, `percentual` | todos | `consignacao` · LEITURA |
| `GET` | `/publico/consignacao/:token` | O que o dono do equipamento vê no link que a loja mandou: situação do contrato, preço, quanto vai receber, pagamentos e linha do tempo. ⚠️ Página aberta, sem login: quem tem o link do contrato (token de 24 caracteres) entra. Limitada a 40 chamadas por minuto. Não mostra custo interno da loja nem dados de outras pessoas. | **pública** | — |
| `POST` | `/publico/consignacao/:token/assinar` | O dono do equipamento assina o contrato pelo celular, com o dedo na tela. ⚠️ Página aberta, sem login: quem tem o link do contrato (token de 24 caracteres) entra. Limitada a 40 chamadas por minuto. Assinatura vale como aceite do contrato e não dá para desfazer: grava data, nome, CPF, IP e o navegador usado. O CPF/CNPJ digitado precisa ser o mesmo do contrato, o desenho da assinatura é obrigatório (PNG ou JPEG em data URI) e contrato já encerrado (retirado ou cancelado) não assina. Assinar de novo devolve jaAssinado: true sem mudar nada. | **pública** | — |
| `GET` | `/publico/consignacao/:token/contrato` | Mostra o contrato de consignação em tela, pronto para ler ou imprimir. ⚠️ Página aberta, sem login: quem tem o link do contrato (token de 24 caracteres) entra. Limitada a 40 chamadas por minuto. Devolve uma página HTML, não dados em JSON. | **pública** | — |
| `POST` | `/publico/consignacao/:token/desconto/:descontoId` | O dono do equipamento autoriza ou recusa, com um toque, a baixa de preço que a loja pediu. ⚠️ Página aberta, sem login: quem tem o link do contrato (token de 24 caracteres) entra. Limitada a 40 chamadas por minuto. Autorizar muda o preço de venda na hora, no produto, na compra e nas parcelas do consignante — e não volta atrás por esta rota. Só vale enquanto o equipamento está no prazo; pedido já respondido devolve jaRespondido: true. | **pública** | — |
| `POST` | `/publico/consignacao/:token/escolha` | No fim do prazo, o dono do equipamento escolhe entre receber aos poucos (diárias) ou retirar o equipamento. ⚠️ Página aberta, sem login: quem tem o link do contrato (token de 24 caracteres) entra. Limitada a 40 chamadas por minuto. Escolher RETIRAR cancela as diárias ainda em aberto e coloca o contrato aguardando retirada; retirar antes do prazo pode gerar a taxa de retirada. Só vale quando o contrato está no prazo, em diárias ou aguardando retirada. | **pública** | — |
| `GET` | `/publico/consignados` | Entrega ao site a vitrine 'Consignados': os equipamentos de terceiros que estão à venda na loja, com fotos, preço e estado. ⚠️ Rota aberta que o site www.balao.info consulta sem login. Só aparecem contratos assinados, no prazo ou em diárias, marcados para o site e com o produto ativo e em estoque. A resposta fica em cache por 60 segundos. | **pública** | — |
| `GET` | `/publico/consignados/:numero` | Abre a página de um equipamento consignado no site, pelo número do contrato. ⚠️ Rota aberta que o site consulta sem login. Devolve 404 se o equipamento saiu da vitrine (vendido, retirado ou desmarcado do site). Cache de 60 segundos. | **pública** | — |

### Financeiro (contas, caixa, conciliação)

> FINANCEIRO — contas a receber/pagar, baixas, estornos, resumo, fluxo de caixa, movimentos (extrato interno) e transferências.
>
> Código: `apps/api/src/modules/financeiro/routes.ts`

| Método | Rota | O que faz | Perfis | Chave de API |
|---|---|---|---|---|
| `GET` | `/contas-financeiras` | Lista contas financeiras (caixa, bancos, cartões; lista traz saldoAtual e saldoBanco) (array simples, sem paginação).<br>Filtros: `ativo` | todos | `financeiro` · LEITURA |
| `POST` | `/contas-financeiras` | Cadastra em contas financeiras (caixa, bancos, cartões; lista traz saldoAtual e saldoBanco). | ADMIN, GERENTE | `financeiro` · GRAVACAO |
| `DELETE` | `/contas-financeiras/:id` | Exclui de contas financeiras (caixa, bancos, cartões; lista traz saldoAtual e saldoBanco) (se estiver em uso, dá 409). | ADMIN, GERENTE | `financeiro` · TOTAL |
| `GET` | `/contas-financeiras/:id` | Um registro de contas financeiras (caixa, bancos, cartões; lista traz saldoAtual e saldoBanco). | todos | `financeiro` · LEITURA |
| `PUT` | `/contas-financeiras/:id` | Altera em contas financeiras (caixa, bancos, cartões; lista traz saldoAtual e saldoBanco) (mande só os campos que mudam). | ADMIN, GERENTE | `financeiro` · GRAVACAO |
| `POST` | `/contas-financeiras/:id/ajustar-saldo` | Acerta o saldo da conta com o valor real; lança só a diferença, fora do DRE. | ADMIN, GERENTE | `financeiro` · GRAVACAO |
| `GET` | `/contas-financeiras/:id/extrato` | Extrato da conta: cada lançamento com de onde veio / para onde foi e o saldo depois dele. | todos | `financeiro` · LEITURA |
| `GET` | `/contas-pagar` | Contas a pagar com totais.<br>Filtros: `situacao`, `contatoId`, `categoriaId`, `contaFinanceiraId`, `origemTipo`, `origemId`, `dataInicial`, `dataFinal`, `tipoData`, `pesquisa`, `recorrente`, `pagina`, `limite` | ADMIN, GERENTE, FINANCEIRO | `financeiro` · LEITURA |
| `POST` | `/contas-pagar` | Lança conta a pagar (recorrente=true repete todo mês). | ADMIN, GERENTE, FINANCEIRO | `financeiro` · GRAVACAO |
| `DELETE` | `/contas-pagar/:id` | Cancela a conta a pagar. | ADMIN, GERENTE, FINANCEIRO | `financeiro` · TOTAL |
| `GET` | `/contas-pagar/:id` | Uma conta a pagar com as baixas. | ADMIN, GERENTE, FINANCEIRO | `financeiro` · LEITURA |
| `PUT` | `/contas-pagar/:id` | Altera conta a pagar. | ADMIN, GERENTE, FINANCEIRO | `financeiro` · GRAVACAO |
| `POST` | `/contas-pagar/:id/baixar` | Paga (baixa) a conta — total ou parcial. Lança a saída na conta financeira. | ADMIN, GERENTE, FINANCEIRO | `financeiro` · GRAVACAO |
| `POST` | `/contas-pagar/:id/estornar` | Desfaz TODAS as baixas da conta a pagar. | ADMIN, GERENTE, FINANCEIRO | `financeiro` · GRAVACAO |
| `POST` | `/contas-pagar/:id/gerar-proxima` | Gera a próxima ocorrência de uma conta recorrente. | ADMIN, GERENTE, FINANCEIRO | `financeiro` · GRAVACAO |
| `POST` | `/contas-pagar/:id/pagamentos/:movimentoId/estornar` | Estorna só um pagamento (baixa parcial) da conta, mantendo os outros. movimentoId vem de "lancamentos" no GET /contas-pagar/{id}. | ADMIN, GERENTE, FINANCEIRO | `financeiro` · GRAVACAO |
| `GET` | `/contas-receber` | Contas a receber com totais (aberto, recebido, atrasado).<br>Filtros: `situacao`, `contatoId`, `vendedorId`, `categoriaId`, `contaFinanceiraId`, `origemTipo`, `origemId`, `dataInicial`, `dataFinal`, `tipoData`, `pesquisa`, `pagina`, `limite` | todos | `financeiro` · LEITURA |
| `POST` | `/contas-receber` | Lança conta a receber avulsa. | ADMIN, GERENTE, FINANCEIRO | `financeiro` · GRAVACAO |
| `DELETE` | `/contas-receber/:id` | Cancela a conta a receber. | ADMIN, GERENTE, FINANCEIRO | `financeiro` · TOTAL |
| `GET` | `/contas-receber/:id` | Uma conta a receber com as baixas. | todos | `financeiro` · LEITURA |
| `PUT` | `/contas-receber/:id` | Altera conta a receber (vencimento, valor, forma…). | ADMIN, GERENTE, FINANCEIRO | `financeiro` · GRAVACAO |
| `POST` | `/contas-receber/:id/baixar` | Recebe (baixa) a conta — total, ou parcial informando valor. Lança a entrada na conta financeira. | ADMIN, GERENTE, FINANCEIRO | `financeiro` · GRAVACAO |
| `POST` | `/contas-receber/:id/estornar` | Desfaz as baixas da conta a receber. | ADMIN, GERENTE, FINANCEIRO | `financeiro` · GRAVACAO |
| `GET` | `/financeiro/fluxo-caixa` | Fluxo de caixa realizado e previsto.<br>Filtros: `dataInicial`, `dataFinal`, `contaFinanceiraId`, `agrupar` | ADMIN, GERENTE, FINANCEIRO | `financeiro` · LEITURA |
| `GET` | `/financeiro/movimentos` | Extrato interno (entradas e saídas das contas).<br>Filtros: `contaFinanceiraId`, `dataInicial`, `dataFinal`, `tipo`, `conciliado`, `pesquisa`, `pagina`, `limite` | ADMIN, GERENTE, FINANCEIRO | `financeiro` · LEITURA |
| `POST` | `/financeiro/movimentos` | Lançamento avulso no caixa/banco. | ADMIN, GERENTE, FINANCEIRO | `financeiro` · GRAVACAO |
| `DELETE` | `/financeiro/movimentos/:id` | Exclui um lançamento avulso. | ADMIN, GERENTE, FINANCEIRO | `financeiro` · TOTAL |
| `GET` | `/financeiro/resumo` | Saldos das contas e o que há a receber/pagar hoje, na semana e atrasado. | ADMIN, GERENTE, FINANCEIRO | `financeiro` · LEITURA |
| `POST` | `/financeiro/transferencia` | Transferência entre contas (ex.: caixa → banco). | ADMIN, GERENTE, FINANCEIRO | `financeiro` · GRAVACAO |

### Bancos e Open Finance

> BANCOS / OPEN FINANCE — vínculo de contas (Pluggy ou mock), sincronização, importação OFX, transações bancárias com sugestões e conciliação.
>
> Código: `apps/api/src/modules/bancos/routes.ts`

| Método | Rota | O que faz | Perfis | Chave de API |
|---|---|---|---|---|
| `POST` | `/bancos/importar-ofx` | Importa extrato OFX (conteúdo do arquivo em texto). | ADMIN, GERENTE, FINANCEIRO | `financeiro` · GRAVACAO |
| `GET` | `/bancos/transacoes` | Transações do extrato bancário, com sugestões de conciliação.<br>Filtros: `contaFinanceiraId`, `conciliado`, `tipo`, `dataInicial`, `dataFinal`, `pesquisa`, `sugestoes`, `pagina`, `limite` | ADMIN, GERENTE, FINANCEIRO | `financeiro` · LEITURA |
| `POST` | `/bancos/transacoes/:id/conciliar` | Concilia a transação com uma conta (faz a baixa) ou lança avulso. | ADMIN, GERENTE, FINANCEIRO | `financeiro` · GRAVACAO |
| `POST` | `/bancos/transacoes/:id/ignorar` | Ignora a transação na conciliação. | ADMIN, GERENTE, FINANCEIRO | `financeiro` · GRAVACAO |
| `POST` | `/bancos/transacoes/:id/reabrir` | Volta a transação para "a conciliar". | ADMIN, GERENTE, FINANCEIRO | `financeiro` · GRAVACAO |
| `POST` | `/open-finance/connect-token` | Gera o acesso temporário que abre a tela do banco para a loja autorizar a leitura da conta. ⚠️ Fala com o serviço externo (Pluggy) para criar o acesso usado pela tela de conexão com o banco. Se o Open Finance não estiver ativo e configurado, o sistema responde com um provedor simulado. | ADMIN | — |
| `DELETE` | `/open-finance/desvincular/:contaFinanceiraId` | Desliga a conta da loja do banco conectado, parando a leitura automática de extrato. ⚠️ Desconecta o serviço externo para essa conta: tira o vínculo com o banco e a sincronização para. A conta da loja e os lançamentos já importados continuam. Fica registrado na auditoria. | ADMIN | — |
| `POST` | `/open-finance/sincronizar-todas` | Sincroniza todas as contas ligadas ao Open Finance. | ADMIN, GERENTE, FINANCEIRO | `financeiro` · GRAVACAO |
| `POST` | `/open-finance/sincronizar/:contaFinanceiraId` | Busca saldo e transações do banco agora.<br>Filtros: `dias` | ADMIN, GERENTE, FINANCEIRO | `financeiro` · GRAVACAO |
| `GET` | `/open-finance/status` | Open Finance (Pluggy) configurado e ativo? | ADMIN, GERENTE, FINANCEIRO | `financeiro` · LEITURA |
| `POST` | `/open-finance/vincular` | Liga as contas do banco recém-autorizado às contas financeiras da loja. ⚠️ Conecta o serviço externo: consulta as contas no banco (Pluggy) e, sem "contaFinanceiraId", cria uma conta financeira nova para cada conta encontrada; com ele, apenas vincula a conta já existente. Grava o saldo do banco na hora do vínculo. Fica registrado na auditoria. | ADMIN | — |
| `POST` | `/webhooks/pluggy` | Porta por onde o serviço de Open Finance (Pluggy) avisa que houve novidade na conta do banco; o sistema então busca os lançamentos novos sozinho. ⚠️ Rota pública (não pede login nem chave), limitada a 120 chamadas por minuto. Responde na hora e sincroniza depois, em segundo plano. Quando o aviso é de erro de login no banco, marca a conta como com problema. | **pública** | — |

### Carnê próprio (crediário)

> CARNÊ PRÓPRIO (Financeiro › Carnês) — perfis ADMIN, GERENTE, FINANCEIRO (a política central fecha /financeiro). A impressão do carnê de uma venda fica em /vendas/:id/carne (o vendedor imprime na hora da venda).
>
> Código: `apps/api/src/modules/carnes/routes.ts`

| Método | Rota | O que faz | Perfis | Chave de API |
|---|---|---|---|---|
| `GET` | `/financeiro/carnes` | Carnês próprios (PIX no Cora) com situação calculada (EM_DIA, ATRASADO, QUITADO, CANCELADO), saldo, vencido, próxima parcela e totais.<br>Filtros: `status`, `clienteId`, `pesquisa`, `dataInicial`, `dataFinal` | ADMIN, GERENTE, FINANCEIRO | `financeiro` · LEITURA |
| `POST` | `/financeiro/carnes` | Emite um carnê avulso para um cliente (sem taxa = juros pelo risco). Cada parcela vira uma conta a receber no banco do PIX. | ADMIN, GERENTE, FINANCEIRO | `financeiro` · GRAVACAO |
| `GET` | `/financeiro/carnes/:id` | Um carnê com as parcelas, o PIX copia e cola de cada uma, encargos de atraso sugeridos e recebimentos. | ADMIN, GERENTE, FINANCEIRO | `financeiro` · LEITURA |
| `PUT` | `/financeiro/carnes/:id` | Altera juros, parcelas ou 1º vencimento (só sem parcela recebida) e observações. | ADMIN, GERENTE, FINANCEIRO | `financeiro` · GRAVACAO |
| `POST` | `/financeiro/carnes/:id/cancelar` | Cancela o carnê (sem parcela recebida). Se veio de venda, a conta a receber da venda volta a valer. | ADMIN, GERENTE, FINANCEIRO | `financeiro` · GRAVACAO |
| `GET` | `/financeiro/carnes/:id/imprimir` | Carnê para imprimir (HTML A4, 3 por folha, com capa e agradecimento, QR Code PIX em cada parcela).<br>Filtros: `abertas` | ADMIN, GERENTE, FINANCEIRO | `financeiro` · LEITURA |
| `POST` | `/financeiro/carnes/:id/parcelas/:contaId/estornar` | Estorna o recebimento de uma parcela do carnê. | ADMIN, GERENTE, FINANCEIRO | `financeiro` · GRAVACAO |
| `POST` | `/financeiro/carnes/:id/parcelas/:contaId/receber` | Baixa uma parcela no caixa/banco escolhido (PIX → Cora; dinheiro → Caixa). Sem juros informados aplica multa e mora se atrasou. | ADMIN, GERENTE, FINANCEIRO | `financeiro` · GRAVACAO |
| `GET` | `/financeiro/carnes/auditoria` | Auditoria de crédito: todos os clientes que já compraram com nota 0-100, classe A-E, juros ao mês sugeridos (7% a 15%), limite, se está apto ao carnê e os motivos da nota.<br>Filtros: `filtro`, `classe`, `pesquisa`, `limite` | ADMIN, GERENTE, FINANCEIRO | `financeiro` · LEITURA |
| `GET` | `/financeiro/carnes/config` | Configuração do carnê: chave/nome/cidade do PIX, juros mínimo e máximo ao mês, multa e mora. | ADMIN, GERENTE, FINANCEIRO | `financeiro` · LEITURA |
| `PUT` | `/financeiro/carnes/config` | Altera a configuração do carnê (chave PIX, faixa de juros, multa e mora). | ADMIN, GERENTE, FINANCEIRO | `financeiro` · GRAVACAO |
| `GET` | `/financeiro/carnes/risco/:id` | Risco de um cliente (id do contato): histórico de compras e pagamentos, nota, classe, juros sugeridos, limite e motivos. | ADMIN, GERENTE, FINANCEIRO | `financeiro` · LEITURA |
| `GET` | `/financeiro/carnes/simular` | Simula um carnê (tabela Price) sem gravar: parcelas, juros e total. Sem taxaPct usa os juros pelo risco do cliente.<br>Filtros: `valor`, `parcelas`, `taxaPct`, `clienteId`, `primeiroVencimento` | ADMIN, GERENTE, FINANCEIRO | `financeiro` · LEITURA |
| `GET` | `/vendas/:id/carne` | Carnê da venda paga na forma "Carnê" (parcelas, PIX de cada uma, situação) ou null. | todos | `vendas` · LEITURA |
| `GET` | `/vendas/:id/carne/imprimir` | Carnê da venda para imprimir (HTML A4, 3 por folha, capa e agradecimento). | todos | `vendas` · LEITURA |

### Empréstimos (Lumicred)

> Rotas do módulo de empréstimos (Financeiro › Empréstimos). Perfis: ADMIN, GERENTE, FINANCEIRO (a política central já fecha /financeiro para os demais).
>
> Código: `apps/api/src/modules/emprestimos/routes.ts`

| Método | Rota | O que faz | Perfis | Chave de API |
|---|---|---|---|---|
| `GET` | `/financeiro/emprestimos` | Empréstimos/antecipações (ex.: Lumicred) com saldo devedor, boleto do cliente, alerta do que fazer e totais (em aberto, vencido, a repassar).<br>Filtros: `status`, `credorId`, `modalidade`, `dataInicial`, `dataFinal`, `pesquisa` | ADMIN, GERENTE, FINANCEIRO | `financeiro` · LEITURA |
| `POST` | `/financeiro/emprestimos` | Lança uma operação: o valor entra na conta informada e gera a devolução (valor + taxa) no contas a pagar. REPASSE = cliente paga o boleto à loja e a loja repassa; DIRETO = cliente paga direto ao credor; CAPITAL_GIRO = sem cliente. | ADMIN, GERENTE, FINANCEIRO | `financeiro` · GRAVACAO |
| `GET` | `/financeiro/emprestimos/:id` | Uma operação de empréstimo com as parcelas a devolver e a entrada do dinheiro. | ADMIN, GERENTE, FINANCEIRO | `financeiro` · LEITURA |
| `PUT` | `/financeiro/emprestimos/:id` | Altera a operação. Sem pagamentos recalcula a devolução; com pagamentos só corrige o valor recebido (juros = devolvido − recebido). | ADMIN, GERENTE, FINANCEIRO | `financeiro` · GRAVACAO |
| `POST` | `/financeiro/emprestimos/:id/cancelar` | Cancela uma operação lançada por engano (sem pagamentos): tira a entrada do caixa e cancela a devolução. | ADMIN, GERENTE, FINANCEIRO | `financeiro` · GRAVACAO |
| `POST` | `/financeiro/emprestimos/:id/cliente-pagou-direto` | O cliente pagou o boleto direto ao credor: baixa o boleto do cliente e abate o mesmo valor da dívida (encontro de contas, sem mexer no banco). | ADMIN, GERENTE, FINANCEIRO | `financeiro` · GRAVACAO |
| `POST` | `/financeiro/emprestimos/:id/pagar` | Paga o credor (total ou parcial) saindo da conta informada. | ADMIN, GERENTE, FINANCEIRO | `financeiro` · GRAVACAO |

### Caixinhas (reservas de dinheiro)

> Rotas das caixinhas (ADMIN, GERENTE, FINANCEIRO) e dos avisos do painel do gestor/gerente.
>
> Código: `apps/api/src/modules/caixinhas/routes.ts`

| Método | Rota | O que faz | Perfis | Chave de API |
|---|---|---|---|---|
| `GET` | `/avisos` | Mostra os avisos mais importantes do dia para o gestor e a gerente: o que precisa ser guardado nas caixinhas, contas a pagar vencidas e de hoje, contas a receber vencidas, OS com previsão vencida e pendências de consignação — já em ordem de urgência. Vem também o total sugerido para guardar hoje e o saldo somado dos bancos. ⚠️ Só ADMIN e GERENTE (exigirPerfil). Apesar de estar na lista como módulo caixinhas, é a rota de avisos da gestão (apps/api/src/modules/caixinhas/routes.ts chamando comum/avisos-gestao.ts). Somente leitura. | todos | — |
| `GET` | `/caixinhas` | Lista as caixinhas de dinheiro guardado, com quanto já tem, quanto falta, quanto guardar hoje e se está em dia ou atrasada. ⚠️ Só o dono, a gerente e o financeiro acessam as caixinhas.<br>Filtros: `ativas` | todos | — |
| `POST` | `/caixinhas` | Cria uma caixinha nova: para que é o dinheiro, quanto precisa juntar e o dia em que vai usar. ⚠️ Se não informar a conta, o sistema usa a do Nubank (ou a primeira conta ativa); se não houver nenhuma conta cadastrada a criação é recusada. Só o dono, a gerente e o financeiro acessam as caixinhas. | todos | — |
| `DELETE` | `/caixinhas/:id` | Apaga uma caixinha que foi criada por engano. ⚠️ Irreversível. Só funciona se ainda não houve nenhuma guardada ou retirada; se já houve movimento, o sistema manda marcar como usada em vez de excluir. Só o dono, a gerente e o financeiro acessam as caixinhas. | todos | — |
| `GET` | `/caixinhas/:id` | Abre uma caixinha e mostra o resumo dela mais todas as guardadas e retiradas já feitas. ⚠️ Só o dono, a gerente e o financeiro acessam as caixinhas. | todos | — |
| `PUT` | `/caixinhas/:id` | Muda os dados da caixinha (nome, valor, dia de uso, observação) ou marca que ela já foi usada. ⚠️ Marcar ativo=false encerra a caixinha e grava a data de uso; a conta financeira dela não pode ser trocada por aqui. Só o dono, a gerente e o financeiro acessam as caixinhas. | todos | — |
| `POST` | `/caixinhas/:id/guardar` | Guarda dinheiro na caixinha: transfere o valor do banco escolhido para a conta da caixinha. ⚠️ Mexe no dinheiro de verdade: gera uma transferência entre contas (fora do DRE). O banco de origem precisa ser diferente da conta da caixinha. Só o dono, a gerente e o financeiro acessam as caixinhas. | todos | — |
| `POST` | `/caixinhas/:id/retirar` | Retira dinheiro da caixinha para um banco, normalmente na hora de pagar o compromisso. ⚠️ Mexe no dinheiro de verdade: gera uma transferência entre contas. Não deixa retirar mais do que a caixinha tem e o banco de destino precisa ser diferente da conta da caixinha. Só o dono, a gerente e o financeiro acessam as caixinhas. | todos | — |

### Comissões

> Comissões de vendedores e técnicos: listagem, resumo, aprovar/pagar/cancelar e recálculo. Pagar: marca PAGA e gera 1 conta a pagar (já PAGA) por pessoa na categoria "Comissões", com MovimentoFinanceiro SAIDA na conta informada (atualiza saldoAtual).
>
> Código: `apps/api/src/modules/comissoes/routes.ts`

| Método | Rota | O que faz | Perfis | Chave de API |
|---|---|---|---|---|
| `GET` | `/comissoes` | Comissões com totais (pendente, aprovada, paga).<br>Filtros: `competencia`, `tipo`, `vendedorId`, `tecnicoId`, `status`, `origemTipo`, `pagina`, `limite` | todos | `comissoes` · LEITURA |
| `GET` | `/comissoes/:id` | Uma comissão. | todos | `comissoes` · LEITURA |
| `POST` | `/comissoes/aprovar` | Aprova comissões. | ADMIN, GERENTE, FINANCEIRO | `comissoes` · GRAVACAO |
| `POST` | `/comissoes/cancelar` | Cancela comissões. | ADMIN, GERENTE, FINANCEIRO | `comissoes` · GRAVACAO |
| `POST` | `/comissoes/pagar` | Paga comissões (gera conta a pagar paga por pessoa — exige nível TOTAL). | ADMIN, GERENTE, FINANCEIRO | `comissoes` · TOTAL |
| `POST` | `/comissoes/recalcular/:origemTipo/:id` | Recalcula as comissões de uma venda (VENDA) ou OS (OS) ainda não pagas. | ADMIN, GERENTE, FINANCEIRO | `comissoes` · GRAVACAO |
| `GET` | `/comissoes/resumo` | Comissões por pessoa na competência.<br>Filtros: `competencia`, `tipo` | todos | `comissoes` · LEITURA |

### Metas e desafios

> PAINEL DO VENDEDOR, METAS e DESAFIOS   GET  /api/v1/painel-vendedor?vendedorId=   vendas por período, meta, desafios, ranking e últimas vendas        (VENDEDOR vê só o próprio; ADMIN/GERENTE escolhem o vendedor)   GET  /api/v1/metas?competencia=             metas de todos os vendedores no mês (gestão)   PUT  /api/v1/metas                          grava meta do mês e/ou meta padrão (gestão)   GET  
>
> Código: `apps/api/src/modules/metas/routes.ts`

| Método | Rota | O que faz | Perfis | Chave de API |
|---|---|---|---|---|
| `GET` | `/desafios` | Desafios de venda.<br>Filtros: `situacao` | ADMIN, GERENTE | `comissoes` · LEITURA |
| `POST` | `/desafios` | Cria desafio (prêmio vira comissão extra automática). | ADMIN, GERENTE | `comissoes` · GRAVACAO |
| `DELETE` | `/desafios/:id` | Exclui desafio (só sem prêmio lançado). | ADMIN, GERENTE | `comissoes` · TOTAL |
| `GET` | `/desafios/:id` | Um desafio com quem conquistou. | ADMIN, GERENTE | `comissoes` · LEITURA |
| `PUT` | `/desafios/:id` | Altera desafio. | ADMIN, GERENTE | `comissoes` · GRAVACAO |
| `POST` | `/desafios/:id/encerrar` | Encerra o desafio (ninguém mais ganha). | ADMIN, GERENTE | `comissoes` · GRAVACAO |
| `POST` | `/desafios/:id/reabrir` | Reabre o desafio. | ADMIN, GERENTE | `comissoes` · GRAVACAO |
| `GET` | `/metas` | Metas do mês por vendedor.<br>Filtros: `competencia` | ADMIN, GERENTE | `comissoes` · LEITURA |
| `PUT` | `/metas` | Grava as metas (padrão e só do mês). | ADMIN, GERENTE | `comissoes` · GRAVACAO |
| `GET` | `/metas-tecnicos` | Mostra a meta de cada técnico no mês e como ele está indo: a meta padrão dele, a meta específica daquele mês (se houver), o valor em serviços e a quantidade de OS concluídas no período, quanto já atingiu e a porcentagem da meta. ⚠️ Só ADMIN e GERENTE. A meta pode ser em reais de serviços (VALOR_SERVICOS) ou em número de OS (QTD_OS); conta só as OS concluídas no mês.<br>Filtros: `competencia` | ADMIN, GERENTE | — |
| `PUT` | `/metas-tecnicos` | Grava as metas dos técnicos: a meta padrão de cada um (que vale todos os meses) e, se quiser, uma meta específica para o mês escolhido. Mandando a meta do mês como nula, apaga a meta específica e o técnico volta a usar a padrão. ⚠️ Só ADMIN e GERENTE. tipoPadrao e tipoMes aceitam VALOR_SERVICOS (reais de serviços) ou QTD_OS (número de OS); tipoPadrao vem como VALOR_SERVICOS quando não informado. metaMes nulo apaga a meta daquele mês — não tem volta. Grava tudo de uma vez (ou tudo ou nada) e registra na auditoria. | ADMIN, GERENTE | — |
| `GET` | `/painel-vendedor` | Painel do vendedor: períodos, meta, ranking, desafios e últimas vendas.<br>Filtros: `vendedorId` | ADMIN, GERENTE, VENDEDOR, TECNICO | `comissoes` · LEITURA |

### Dashboards do gestor

> DASHBOARDS — geral, vendas e OS. "Realizadas" = situação com final=true e cancelamento=false. Agregações feitas em JS (SQLite) após filtrar por data no banco.
>
> Código: `apps/api/src/modules/dashboard/routes.ts`

| Método | Rota | O que faz | Perfis | Chave de API |
|---|---|---|---|---|
| `GET` | `/dashboard/assistencia` | Assistência técnica: valor de entrada das OS, mão de obra x peças, custos (peças, logística, terceiros) e lucro por OS, técnico e período.<br>Filtros: `dataInicial`, `dataFinal`, `tecnicoId`, `base`, `agrupar` | ADMIN | `relatorios` · LEITURA |
| `GET` | `/dashboard/assistencia/pagamentos-tecnico` | Últimos pagamentos de técnico lançados no contas a pagar. | ADMIN | `relatorios` · LEITURA |
| `POST` | `/dashboard/assistencia/pagar-tecnico` | Pagar técnico: % do lucro da assistência no período vira uma conta a pagar (simular=true só calcula). | ADMIN | ✋ relatorios (bloqueada) |
| `GET` | `/dashboard/atividades` | Últimos lançamentos financeiros e acontecimentos do sistema.<br>Filtros: `limite`, `categoria`, `so` | ADMIN | `relatorios` · LEITURA |
| `GET` | `/dashboard/geral` | Painel geral: hoje, financeiro, OS, vendas por situação, estoque baixo, fiscal, alertas. | ADMIN | `relatorios` · LEITURA |
| `GET` | `/dashboard/os` | OS: abertas, concluídas, faturamento, tempo médio, por técnico e equipamento.<br>Filtros: `dataInicial`, `dataFinal`, `tecnicoId`, `agrupar` | ADMIN | `relatorios` · LEITURA |
| `GET` | `/dashboard/panorama` | Panorama da loja no período: vendas + assistência (faturamento, custos, lucro), caixa, série por dia e equipe, com comparação ao período anterior.<br>Filtros: `dataInicial`, `dataFinal`, `base`, `agrupar` | ADMIN | `relatorios` · LEITURA |
| `GET` | `/dashboard/vendas` | Faturamento, ticket, lucro, por vendedor/forma de pagamento/origem, top produtos e clientes.<br>Filtros: `dataInicial`, `dataFinal`, `vendedorId`, `agrupar`, `comparar`, `todas` | ADMIN | `relatorios` · LEITURA |

### Meu Dashboard (por perfil)

> MEU DASHBOARD (29/10/2026) — a tela inicial de cada perfil, no estilo Power BI.   GET /api/v1/meu-dashboard?dataInicial=&dataFinal=&usuarioId=       Devolve só o que o perfil pode ver:         VENDEDOR   → vendas (faturamento, meta, ranking, desafios), alertas das vendas dele, lembretes         TECNICO    → assistência (OS, meta, ranking, desafios de OS) + vendas dele (também vende), alertas, lemb
>
> Código: `apps/api/src/modules/meu-dashboard/routes.ts`

| Método | Rota | O que faz | Perfis | Chave de API |
|---|---|---|---|---|
| `GET` | `/meu-dashboard` | A tela inicial de cada pessoa, montada conforme o perfil dela: o vendedor vê as vendas dele (faturamento, meta, ranking, desafios), os alertas das vendas dele e os lembretes; o técnico vê a assistência dele (OS, meta, ranking, desafios) mais as vendas dele; o gestor, a gerente e o financeiro veem a loja — saldo, receita, entradas e saídas, caixinhas, avisos, equipe e desafios. Vendedor e técnico nunca recebem custo, lucro, margem, saldo ou DRE. ⚠️ Sem datas, usa o dia de hoje. O "ver como" é só para ADMIN e GERENTE, e a GERENTE não pode abrir o dashboard do ADMIN. Se o usuário for VENDEDOR sem cadastro de vendedor vinculado (ou TECNICO sem cadastro de técnico), devolve erro 422 pedindo o vínculo em Configurações → Usuários.<br>Filtros: `dataInicial`, `dataFinal`, `usuarioId` | todos | — |
| `GET` | `/meu-dashboard/equipe` | Lista as pessoas da equipe (usuários ativos) que podem ser abertas no "ver como" do Meu Dashboard, com nome e perfil. ⚠️ Só ADMIN e GERENTE. Não inclui você mesmo na lista, e a GERENTE não vê os usuários de perfil ADMIN. | todos | — |

### Relatórios e DRE

> RELATÓRIOS — DRE, vendas por período, produtos mais vendidos, estoque, comissões. Todos aceitam `?formato=csv` (exceto DRE, que também aceita e exporta as linhas).
>
> Código: `apps/api/src/modules/relatorios/routes.ts`

| Método | Rota | O que faz | Perfis | Chave de API |
|---|---|---|---|---|
| `GET` | `/relatorios/comissoes` | Relatório de comissões da competência.<br>Filtros: `competencia` | ADMIN, GERENTE, FINANCEIRO | `relatorios` · LEITURA |
| `GET` | `/relatorios/contas` | Relatório de contas a receber ou a pagar.<br>Filtros: `tipo`, `dataInicial`, `dataFinal` | ADMIN, GERENTE, FINANCEIRO | `relatorios` · LEITURA |
| `GET` | `/relatorios/dre` | DRE por competência ou caixa.<br>Filtros: `dataInicial`, `dataFinal`, `regime`, `comparar` | ADMIN, GERENTE, FINANCEIRO | `relatorios` · LEITURA |
| `GET` | `/relatorios/estoque` | Posição de estoque com custo e valor.<br>Filtros: `depositoId`, `categoriaId` | ADMIN, GERENTE, FINANCEIRO | `relatorios` · LEITURA |
| `GET` | `/relatorios/produtos-mais-vendidos` | Ranking de produtos.<br>Filtros: `dataInicial`, `dataFinal`, `limite` | ADMIN, GERENTE, FINANCEIRO | `relatorios` · LEITURA |
| `GET` | `/relatorios/vendas-por-periodo` | Vendas agrupadas por dia/semana/mês.<br>Filtros: `dataInicial`, `dataFinal`, `agrupar` | ADMIN, GERENTE, FINANCEIRO | `relatorios` · LEITURA |

### JARVIS (agente do gestor)

> JARVIS — o agente do gestor (docs/JARVIS.md). Objetivo: R$ 1.000.000 livres no caixa.   GET  /api/v1/jarvis/painel                 painel do ADMIN: caixa livre, mapa do milhão, sugestões, placar   GET  /api/v1/jarvis/evolucao               série do gráfico (filtro de data do sistema)   GET  /api/v1/jarvis/sugestoes              lista com filtro de situação   POST /api/v1/jarvis/sugestoes/:id/aceit
>
> Código: `apps/api/src/modules/jarvis/routes.ts`

| Método | Rota | O que faz | Perfis | Chave de API |
|---|---|---|---|---|
| `GET` | `/jarvis/anuncios` | Lista os anúncios de produtos já montados na Central de Anúncios, com a situação de cada canal (publicado, kit pronto, pendente, erro) e o produto ligado a ele.<br>Filtros: `limite` | ADMIN | — |
| `POST` | `/jarvis/anuncios` | Salva o anúncio do produto (título, descrição, preço, fotos) e cria uma linha para cada canal escolhido: canais com API nascem pendentes de publicação e os canais de kit (OLX, Google Meu Negócio) já nascem prontos para alguém publicar à mão. ⚠️ Só grava o anúncio no sistema; não publica nada em canal nenhum. Fica registrado na auditoria. | ADMIN | — |
| `POST` | `/jarvis/anuncios/:id/publicar` | Manda o sistema publicar esse anúncio no canal escolhido. Hoje só o Mercado Livre publica de verdade (e só se a conta estiver conectada); nos outros canais o sistema marca 'precisa configurar' e explica o que falta, em vez de dizer que publicou. ⚠️ Publica o produto na internet, com preço, em nome da loja: o anúncio passa a ficar visível para clientes. Chama a API do Mercado Livre. Canal de kit (OLX, Google Meu Negócio) é recusado com erro. | ADMIN | — |
| `POST` | `/jarvis/anuncios/:id/publiquei` | Registra que alguém da loja publicou o kit à mão naquele canal e guarda o link onde o anúncio ficou, junto com o nome de quem publicou. ⚠️ Só anota no sistema; não publica nada. Fica registrado na auditoria. | ADMIN | — |
| `GET` | `/jarvis/anuncios/canais` | Mostra a lista dos canais de anúncio (Mercado Livre, site, blog, Facebook, Instagram, Google Meu Negócio, OLX), dizendo qual publica sozinho, qual vira kit para publicar à mão, o motivo e o limite de caracteres do título. | ADMIN | — |
| `POST` | `/jarvis/anuncios/rascunho` | Monta o texto do anúncio a partir do cadastro do produto: pega nome, marca, descrição, preço e fotos e devolve título, descrição longa e um texto adaptado para cada canal, já pronto para revisar. ⚠️ Quando há chave da Anthropic cadastrada, o texto é escrito pela IA — isso consome tokens pagos da conta da Anthropic. Sem chave, usa um texto padrão e não gasta nada. | ADMIN | — |
| `GET` | `/jarvis/config` | Mostra a configuração do JARVIS: se está ligado, a meta de caixa e a data-alvo, o modelo de IA, os percentuais usados nos cálculos de preço, os dias para considerar estoque parado e a última rodada. A chave da Anthropic e o segredo do Mercado Livre só aparecem mascarados. | ADMIN | — |
| `PUT` | `/jarvis/config` | Altera a configuração do JARVIS: liga ou desliga o robô, muda a meta de caixa e a data-alvo, troca o modelo de IA e a chave da Anthropic, ajusta os percentuais de compra/venda e de consignado, os dias de estoque parado e as credenciais do Mercado Livre. ⚠️ A chave da Anthropic e o Client Secret do Mercado Livre são gravados criptografados; mandar o campo em branco ou com a máscara não apaga o que já estava lá. Desligar o JARVIS aqui para as rodadas automáticas. Fica registrado na auditoria (sem a chave). | ADMIN | — |
| `POST` | `/jarvis/config/testar-ia` | Testa se a chave da Anthropic e o modelo escolhido estão funcionando, e devolve em português o que deu errado (chave recusada, modelo inexistente, limite de uso atingido). ⚠️ Faz uma chamada real e paga à API da Anthropic (mensagem mínima, de 16 tokens). Se nenhuma chave for enviada, usa a que está cadastrada. | ADMIN | — |
| `POST` | `/jarvis/confirmar` | É o botão 'pode fazer': executa a ação que o JARVIS havia deixado pendente no chat por mexer em dinheiro ou falar com cliente, e grava o resultado na conversa. ⚠️ Executa de verdade a ação, sem a trava que a fez ficar pendente: pode baixar conta, enviar WhatsApp a cliente ou excluir registro. Fica registrado na auditoria, mas muita coisa aqui não tem volta. | ADMIN | — |
| `GET` | `/jarvis/conversas` | Lista as conversas do gestor com o JARVIS que não foram arquivadas, da mais recente para a mais antiga, com título e quantidade de mensagens. | ADMIN | — |
| `DELETE` | `/jarvis/conversas/:id` | Tira a conversa da lista do chat do JARVIS (ela é arquivada, não apagada do banco). ⚠️ Fica registrado na auditoria. As mensagens continuam gravadas; só deixam de aparecer na lista. | ADMIN | — |
| `GET` | `/jarvis/conversas/:id` | Abre uma conversa inteira do chat do JARVIS, com todas as mensagens do gestor e do robô em ordem. | ADMIN | — |
| `GET` | `/jarvis/evolucao` | Devolve a série do gráfico de evolução do caixa: um ponto por dia com caixa livre, saldo dos bancos, saldo em caixa, contas a pagar dos próximos 30 dias, caixinhas e empréstimos.<br>Filtros: `dataInicial`, `dataFinal` | ADMIN | — |
| `GET` | `/jarvis/feed` | Mostra a quem está logado só as sugestões abertas do JARVIS destinadas ao perfil dele (até 20). Vendedor e técnico não recebem o valor de impacto em dinheiro — só ADMIN e FINANCEIRO veem esse número. | todos | — |
| `GET` | `/jarvis/ml/callback` | É a página que o Mercado Livre abre no navegador depois que o Thiago autoriza a aplicação: troca o código recebido pelos tokens de acesso, conecta a conta e mostra uma página dizendo se deu certo. ⚠️ Rota aberta, sem login — o que autentica é o código do Mercado Livre, que vale uma única vez. Chama a API do Mercado Livre e grava os tokens criptografados na configuração. Responde HTML, não JSON.<br>Filtros: `code`, `error`, `error_description` | **pública** | — |
| `POST` | `/jarvis/ml/conectar` | Gera o link para o dono autorizar a loja na conta dele do Mercado Livre. Não conecta nada ainda: só devolve a URL para abrir no navegador. ⚠️ Exige que o Client ID do Mercado Livre já esteja cadastrado. Fica registrado na auditoria. | ADMIN | — |
| `POST` | `/jarvis/ml/desconectar` | Desliga a conta do Mercado Livre do sistema, apagando os tokens de acesso guardados. Depois disso nenhum anúncio é publicado lá até reconectar. ⚠️ Apaga os tokens de forma irreversível: para voltar, é preciso autorizar a conta de novo pelo navegador. Fica registrado na auditoria. | ADMIN | — |
| `GET` | `/jarvis/ml/status` | Diz como está a ligação com o Mercado Livre: se as credenciais estão cadastradas, se a conta está conectada, qual é o apelido da conta, quando o acesso expira e qual endereço de retorno usar no cadastro da aplicação. | ADMIN | — |
| `GET` | `/jarvis/painel` | É o painel principal do JARVIS para o dono: quanto de caixa livre a loja tem hoje, o mapa até a meta do milhão (quanto falta, por dia útil, degrau atual, variação em 7 e 30 dias), as até 30 sugestões abertas, quanto dinheiro está 'em jogo' nelas, se a IA está ligada e quando foi a última rodada. ⚠️ Cálculo pesado: lê bancos, contas a pagar, caixinhas e empréstimos a cada chamada. | ADMIN | — |
| `POST` | `/jarvis/perguntar` | Manda uma pergunta ao JARVIS no chat. Ele responde com os números reais da loja do momento e, se precisar, consulta o sistema sozinho; o que mexe em dinheiro ou fala com cliente volta como pendente para o gestor confirmar. ⚠️ Chama a API paga da Anthropic, podendo fazer até 6 voltas de ferramentas numa só resposta — é a rota mais cara e mais lenta do módulo. Durante essas voltas o JARVIS pode criar cliente, orçamento ou OS por conta própria (coisas reversíveis). Fica registrado na auditoria. | ADMIN | — |
| `GET` | `/jarvis/placar` | Mostra o acerto do JARVIS: quantas sugestões foram aceitas, recusadas e estão abertas, as 20 últimas já medidas e a comparação entre o que ele estimou de ganho e o que o caixa realmente rendeu. | ADMIN | — |
| `POST` | `/jarvis/rodar` | Faz o JARVIS rodar a rodada agora, sem esperar os 30 minutos: recalcula o caixa livre, grava a foto do dia, cria e atualiza as sugestões, fecha as que se resolveram sozinhas e mede o resultado das aceitas. ⚠️ Rodada pesada e demorada; quando há chave cadastrada, chama a API paga da Anthropic para reescrever os textos das sugestões novas. Se já houver uma rodada em andamento, avisa e não faz nada. Fica registrado na auditoria. | ADMIN | — |
| `GET` | `/jarvis/sugestoes` | Lista as sugestões do JARVIS com seu título, texto, impacto estimado em reais, prioridade e situação, podendo filtrar por situação.<br>Filtros: `situacao`, `limite` | ADMIN | — |
| `POST` | `/jarvis/sugestoes/:id/aceitar` | Aceita a sugestão e manda o JARVIS fazer o trabalho de verdade: dependendo da sugestão, ele coloca as cobranças na fila do WhatsApp ou baixa o preço dos produtos parados. Depois de 7 dias o sistema mede quanto isso rendeu. ⚠️ Executa a ação da sugestão: pode enfileirar mensagens de cobrança por WhatsApp para clientes (sem repetir a mesma conta no mesmo dia) ou alterar o preço de venda de produtos em lote — o preço antigo não é revertido automaticamente. Nunca baixa abaixo do custo mais 5% e não mexe em produto que vem do site. O percentual só vale para a sugestão de desconto em lote (1 a 60). Fica registrado na auditoria. | ADMIN | — |
| `POST` | `/jarvis/sugestoes/:id/adiar` | Adia a sugestão por alguns dias: ela sai da lista e volta a aparecer sozinha quando o prazo vencer. ⚠️ Fica registrado na auditoria. | ADMIN | — |
| `POST` | `/jarvis/sugestoes/:id/recusar` | Recusa a sugestão, com um motivo opcional. O JARVIS não cria essa mesma sugestão de novo pelos próximos 7 dias. ⚠️ Fica registrado na auditoria. | ADMIN | — |
| `POST` | `/jarvis/voz` | Transforma um texto em áudio na voz do JARVIS e devolve o arquivo de som, para o painel falar com o dono. Frases repetidas saem na hora, do cache em disco. ⚠️ Frase nova chama um serviço externo de voz: primeiro a Azure (serviço pago da Microsoft, com cota mensal gratuita) e, se ela não estiver configurada, os servidores de voz do PC da loja. Responde 503 quando nenhuma voz está no ar. | ADMIN | — |
| `GET` | `/jarvis/voz/estado` | Diz se a voz do JARVIS está disponível agora (Azure configurada ou o PC-servidor da loja respondendo), para a tela saber se pode pedir o áudio ou se usa a voz do próprio navegador. ⚠️ Consulta os servidores de voz do PC da loja com espera curta de 2,5 segundos. | ADMIN | — |

### Chat da equipe

> CHAT DA EQUIPE — caixa de entrada, salas de reunião, texto, áudio gravado, arquivos, chamadas de voz/vídeo (WebRTC) e avisos no celular (Web Push). Tudo dentro do sistema, só com o navegador.   GET    /api/v1/chat/config                      onde ligar o tempo real, STUN/TURN, chave do push   GET    /api/v1/chat/ws                           WebSocket (autentica pela 1ª mensagem {tipo:'auth', token
>
> Código: `apps/api/src/modules/chat/routes.ts`

| Método | Rota | O que faz | Perfis | Chave de API |
|---|---|---|---|---|
| `POST` | `/chat/chamadas/:id/entrar` | Atende uma chamada de voz ou vídeo que está tocando: entra na chamada e avisa na hora todo mundo da conversa de que você atendeu. ⚠️ Avisa em tempo real (WebSocket) todos os participantes da conversa. Só funciona se a chamada ainda estiver ATIVA e você for participante da conversa; cancela o cronômetro de 45 s de chamada perdida. | todos | — |
| `POST` | `/chat/chamadas/:id/recusar` | Recusa a chamada que está tocando. Em conversa direta a chamada é encerrada na hora e fica registrada como "chamada recusada"; em sala, apenas avisa aos outros que você não vai entrar e a chamada continua. ⚠️ Avisa em tempo real todos os participantes. Em conversa direta encerra a chamada e grava a mensagem "Chamada recusada" no histórico da conversa — não tem como desfazer. | todos | — |
| `POST` | `/chat/chamadas/:id/rtc` | Canal técnico usado pelo navegador durante a chamada: repassa para a outra pessoa os dados de conexão de voz/vídeo (oferta, resposta e candidatos de rede). Quem usa o sistema nunca chama isso na mão. ⚠️ Envia os dados em tempo real para o outro participante pelo WebSocket. É a mesma função da mensagem {tipo:'rtc'} do WebSocket — existe como rota HTTP para quando o WebSocket não passa pelo proxy. Ignora silenciosamente se a chamada não estiver ATIVA ou se remetente/destinatário não forem participantes da conversa. | todos | — |
| `POST` | `/chat/chamadas/:id/sair` | Desliga a chamada. Se sobrar menos de duas pessoas depois de alguém ter atendido, ou se quem ligou desistir antes de ser atendido, a chamada acaba para todos e fica registrada na conversa (com a duração, ou como perdida). ⚠️ Avisa em tempo real todos os participantes e, quando a chamada termina, grava a mensagem de registro ("Chamada de voz · 3 min" / "Chamada perdida") na conversa — não tem volta. | todos | — |
| `GET` | `/chat/chamadas/ativas` | Lista as chamadas de voz/vídeo acontecendo agora nas conversas em que você participa — é o que a tela usa para mostrar o aviso de chamada quando você abre o sistema ou reconecta. | todos | — |
| `GET` | `/chat/config` | Entrega ao navegador as configurações que o chat precisa para funcionar: endereço do tempo real, de quanto em quanto tempo consultar quando o tempo real não conecta, servidores STUN/TURN para a chamada de voz e vídeo, a chave pública do aviso no celular e em quantos segundos uma chamada não atendida é considerada perdida. ⚠️ As credenciais do TURN são geradas na hora para o usuário logado e valem 12 horas. | todos | — |
| `GET` | `/chat/conversas` | Sua caixa de entrada do chat da equipe: todas as conversas e salas de que você participa, com a última mensagem, quem está nelas, quem está online e quantas mensagens você ainda não leu em cada uma. ⚠️ Traz no máximo 300 conversas, das mais recentes para as mais antigas.<br>Filtros: `todas` | todos | — |
| `POST` | `/chat/conversas` | Abre uma conversa: ou uma conversa direta com um colega (se já existir uma, reaproveita a mesma), ou uma sala de reunião com nome e as pessoas que você escolher. ⚠️ Aceita dois formatos: {tipo:'DIRETA', usuarioId} ou {tipo:'SALA', nome (2 a 80 caracteres), usuarioIds (1 a 100 pessoas)}. Ao criar uma sala, avisa todo mundo em tempo real e manda aviso no celular (Web Push) para quem não estiver no sistema, além de deixar uma mensagem de sistema na sala. | todos | — |
| `GET` | `/chat/conversas/:id` | Abre os dados de uma conversa ou sala: nome, quem participa, quem está online, até onde você já leu, se está silenciada e quantas mensagens não lidas restam nela. ⚠️ Só participantes (mesmo quem já saiu) acessam; o perfil ADMIN pode abrir qualquer conversa. | todos | — |
| `PUT` | `/chat/conversas/:id` | Muda o nome de uma sala de reunião. ⚠️ Só funciona em sala (não em conversa direta) e só para quem criou a sala, o ADMIN ou a GERENTE. Deixa uma mensagem de sistema na sala e avisa todos em tempo real. | todos | — |
| `POST` | `/chat/conversas/:id/arquivo` | Manda um arquivo na conversa — imagem (PNG, JPG, WEBP, GIF) ou PDF. O arquivo fica guardado no sistema e aparece como mensagem para todos da conversa. ⚠️ Envio multipart (não JSON). Limite de 25 MB; só imagens ou PDF. Envia a mensagem em tempo real a todos e manda aviso no celular (Web Push) para quem estiver fora do sistema e não tiver silenciado a conversa. | todos | — |
| `POST` | `/chat/conversas/:id/atencao` | Chama a atenção de quem está na conversa (a outra pessoa, na direta; os demais, na sala): a tela de quem recebe treme na hora, o histórico ganha "Fulano chamou sua atenção" e o WhatsApp da loja avisa o celular cadastrado do usuário. ⚠️ Anti-spam por remetente e destinatário: no máximo 1 tremor a cada 30 segundos (429 ATENCAO_RAPIDO) e no máximo 1 WhatsApp a cada 5 minutos. Sem celular, número inválido ou WhatsApp da loja desconectado, a tela treme mesmo assim e a resposta diz o motivo. Quem não participa recebe 403. | todos | — |
| `POST` | `/chat/conversas/:id/audio` | Manda um áudio gravado pelo navegador na conversa, como no WhatsApp: o áudio é guardado no sistema e aparece como mensagem, com a duração, para todos da conversa. ⚠️ Grava áudio: o arquivo enviado é salvo em disco (storage/chat/aaaa-mm). Envio multipart, limite de 25 MB e apenas formatos de áudio (webm, ogg, mp4/m4a, mp3, aac, wav). Envia a mensagem em tempo real e manda aviso no celular para quem estiver fora do sistema e não tiver silenciado a conversa. | todos | — |
| `POST` | `/chat/conversas/:id/chamadas` | Liga para a conversa: inicia uma chamada de voz ou de vídeo e faz o telefone/sistema das outras pessoas tocar. Se já houver chamada rolando nessa conversa, você entra nela em vez de abrir outra. ⚠️ tipo aceita VOZ (padrão) ou VIDEO. Chama todos em tempo real e manda aviso urgente no celular (Web Push) para quem estiver fora do sistema. Se ninguém atender em 45 segundos a chamada é marcada como perdida e isso fica registrado na conversa. | todos | — |
| `POST` | `/chat/conversas/:id/digitando` | Avisa aos outros da conversa que você está digitando agora (o "está digitando..." da tela). ⚠️ Envia um aviso em tempo real aos outros participantes. Se você não for participante ativo, nada acontece. | todos | — |
| `POST` | `/chat/conversas/:id/lida` | Marca a conversa como lida (ou lida até uma mensagem específica), zerando o contador de não lidas e mostrando aos outros que você já viu. ⚠️ Avisa em tempo real os outros participantes de até onde você leu. Sem ateId, marca como lida até a última mensagem. | todos | — |
| `GET` | `/chat/conversas/:id/mensagens` | Carrega o histórico de mensagens de uma conversa ou sala, da mais antiga para a mais nova, em blocos — é o que a tela usa para rolar para trás e ver o que já foi conversado. ⚠️ Mensagens apagadas vêm sem conteúdo (aparecem como "Mensagem apagada").<br>Filtros: `antesDe`, `limite` | todos | — |
| `POST` | `/chat/conversas/:id/mensagens` | Manda uma mensagem de texto na conversa ou sala, podendo ser uma resposta a outra mensagem. ⚠️ Envia mensagem a pessoas: aparece na hora para todos da conversa (tempo real) e manda aviso no celular (Web Push) para quem estiver fora do sistema e não tiver silenciado a conversa. Texto de 1 a 8000 caracteres; só quem ainda está na conversa pode enviar. | todos | — |
| `POST` | `/chat/conversas/:id/participantes` | Chama mais gente para a sala de reunião. ⚠️ Só em salas; qualquer participante da sala (ou a gestão) pode incluir gente. Manda aviso no celular (Web Push) para quem for incluído e estiver fora do sistema, deixa mensagem de sistema na sala e atualiza a sala de todos em tempo real. De 1 a 100 pessoas por chamada. | todos | — |
| `DELETE` | `/chat/conversas/:id/participantes/:usuarioId` | Tira uma pessoa da sala — ou sai você mesmo da sala, usando o seu próprio ID. ⚠️ Só em salas. Para tirar outra pessoa é preciso ser quem criou a sala, ADMIN ou GERENTE; sair de si mesmo qualquer um pode. Deixa mensagem de sistema na sala ("saiu da sala" / "tirou X da sala") e avisa todos em tempo real. | todos | — |
| `POST` | `/chat/conversas/:id/silenciar` | Silencia a conversa até a data/hora que você escolher, para parar de receber aviso no celular dela; mandando sem data (ou com ate nulo), volta a avisar. ⚠️ Vale só para você (sua participação na conversa). Data inválida devolve erro 422. | todos | — |
| `GET` | `/chat/eventos` | Alternativa ao tempo real para quando a conexão ao vivo não passa pela rede ou pelo proxy: a tela pergunta de tempo em tempo "tem novidade?" e a resposta fica em espera até algo acontecer, trazendo as novidades do chat, o total de não lidas e quem está online. ⚠️ Long polling: a resposta pode demorar até 25 segundos de propósito. Resposta sempre com Cache-Control: no-store.<br>Filtros: `desde`, `espera` | todos | — |
| `DELETE` | `/chat/mensagens/:id` | Apaga uma mensagem do chat: ela passa a aparecer como "Mensagem apagada" para todos, sem o conteúdo. ⚠️ Não tem volta. Só quem escreveu a mensagem (ou o ADMIN) pode apagar; todos os participantes são avisados em tempo real. | todos | — |
| `GET` | `/chat/nao-lidas` | Diz quantas mensagens você tem sem ler, no total e separado por conversa — é o número do sininho no topo do sistema e no Meu Dashboard. ⚠️ Não conta mensagens de sistema, apagadas, nem as que você mesmo mandou. | todos | — |
| `POST` | `/chat/push/assinar` | Autoriza este celular ou navegador a receber os avisos do chat quando você estiver fora do sistema (mensagem nova, chamada, inclusão em sala). ⚠️ Guarda a inscrição de aviso no celular (Web Push) junto do seu usuário, com o navegador/aparelho usado (user-agent). Se o mesmo aparelho assinar de novo, só atualiza a inscrição existente. | todos | — |
| `GET` | `/chat/push/assinaturas` | Lista os celulares e navegadores seus que estão autorizados a receber aviso do chat, com o aparelho, quando foi autorizado e quando recebeu aviso pela última vez. ⚠️ O endereço de cada inscrição vem cortado (só os 40 primeiros caracteres). | todos | — |
| `POST` | `/chat/push/cancelar` | Para de receber aviso do chat neste celular ou navegador. ⚠️ Apaga a inscrição de aviso no celular (só as suas) — não tem volta, é preciso autorizar de novo para voltar a receber. | todos | — |
| `GET` | `/chat/usuarios` | Lista os colegas da loja (todos os usuários ativos) com o estado de cada um — online, ausente, ocupado ou offline — e o último login, para você escolher com quem conversar. ⚠️ Marca qual da lista é você (campo "eu"). | todos | — |
| `GET` | `/chat/ws` | É a ligação ao vivo do chat: por ela o navegador recebe na hora as mensagens novas, quem está online, o "está digitando", as leituras e as chamadas de voz e vídeo. Chamada como endereço comum (sem a ligação ao vivo), só informa como conectar. ⚠️ PROTOCOLO: conexão WebSocket. Autenticação: a conexão é aceita sem token, mas a PRIMEIRA mensagem precisa ser {"tipo":"auth","token":"<jwt>"}; o token é verificado e o usuário tem de estar ativo no cadastro. Se não autenticar em 8 segundos, a conexão é fechada com código 4401 ("Não autenticado"); token inválido também fecha com 4401. Em produção, o cabeçalho Origin precisa ser do próprio sistema (APP_URL / CORS_ORIGENS), senão fecha com 4403 ("Origem não permitida"). Autenticado, o servidor responde {tipo:'pronto', usuarioId, online, chamadas, naoLidas}. Depois disso aceita as mensagens: {tipo:'ping'} (responde {tipo:'pong', em}), {tipo:'estado', valor:'online'\|'ausente'\|'ocupado'}, {tipo:'digitando', conversaId}, {tipo:'lida', conversaId, ateId?} e {tipo:'rtc', chamadaId, para, dados} (sinalização de voz/vídeo). Qualquer outro tipo é ignorado. O servidor manda ping periódico e espera pong para saber se a conexão está viva. As mensagens 'digitando', 'lida' e 'rtc' avisam outras pessoas em tempo real. Chamada como GET comum (sem upgrade) exige login por JWT e devolve 401 com code NAO_AUTENTICADO se não houver. | **pública** | — |

### Mensagens (fila de WhatsApp e e-mail)

> NOTIFICAÇÕES — fila (listar, criar manual, reenviar, cancelar) e templates (CRUD, preview, variáveis).
>
> Código: `apps/api/src/modules/notificacoes/routes.ts`

| Método | Rota | O que faz | Perfis | Chave de API |
|---|---|---|---|---|
| `GET` | `/notificacoes` | Fila de mensagens (enviadas, pendentes, com erro).<br>Filtros: `status`, `canal`, `origemTipo`, `origemId`, `contatoId`, `dataInicial`, `dataFinal`, `pesquisa`, `pagina`, `limite` | todos | `comunicacao` · LEITURA |
| `POST` | `/notificacoes` | Envia WhatsApp ou e-mail (entra na fila). Com origemTipo/origemId, as {{variáveis}} são preenchidas. | todos | `comunicacao` · GRAVACAO |
| `GET` | `/notificacoes/:id` | Uma mensagem. | todos | `comunicacao` · LEITURA |
| `POST` | `/notificacoes/:id/cancelar` | Cancela mensagem pendente. | todos | `comunicacao` · GRAVACAO |
| `POST` | `/notificacoes/:id/reenviar` | Reenvia uma mensagem. | todos | `comunicacao` · GRAVACAO |
| `POST` | `/notificacoes/lembretes-contas` | Dispara os lembretes de contas a vencer agora. | todos | `comunicacao` · GRAVACAO |
| `POST` | `/notificacoes/processar` | Processa a fila agora. | todos | `comunicacao` · GRAVACAO |
| `GET` | `/templates-notificacao` | Lista modelos de mensagem (array simples, sem paginação).<br>Filtros: `evento`, `canal`, `ativo` | todos | `comunicacao` · LEITURA |
| `POST` | `/templates-notificacao` | Cadastra em modelos de mensagem. | ADMIN, GERENTE | `comunicacao` · GRAVACAO |
| `DELETE` | `/templates-notificacao/:id` | Exclui de modelos de mensagem (se estiver em uso, dá 409). | ADMIN, GERENTE | `comunicacao` · TOTAL |
| `GET` | `/templates-notificacao/:id` | Um registro de modelos de mensagem. | todos | `comunicacao` · LEITURA |
| `PUT` | `/templates-notificacao/:id` | Altera em modelos de mensagem (mande só os campos que mudam). | ADMIN, GERENTE | `comunicacao` · GRAVACAO |
| `POST` | `/templates-notificacao/:id/preview` | Mostra o modelo preenchido com uma venda/OS. | ADMIN, GERENTE | `comunicacao` · GRAVACAO |
| `GET` | `/templates-notificacao/variaveis` | Variáveis disponíveis nos modelos ({{cliente.nome}}, {{total}}…). | todos | `comunicacao` · LEITURA |

### Lembretes

> LEMBRETES do Meu Dashboard (29/10/2026) Cada usuário tem os seus lembretes ("ligar para o cliente", "orçamento vence sexta"). A gestão (ADMIN/GERENTE) pode mandar lembrete para qualquer pessoa da equipe — ele aparece no Meu Dashboard dela.   GET    /api/v1/lembretes?usuarioId=&concluidos=   os meus (ou de alguém, para a gestão)   POST   /api/v1/lembretes                           { titulo, descric
>
> Código: `apps/api/src/modules/lembretes/routes.ts`

| Método | Rota | O que faz | Perfis | Chave de API |
|---|---|---|---|---|
| `GET` | `/lembretes` | Lista os seus lembretes ("ligar para o cliente", "orçamento vence sexta"), com a situação de cada um: atrasado, para hoje, futuro ou concluído. O gestor e a gerente podem ver os lembretes de qualquer pessoa da equipe. ⚠️ Traz no máximo 200 lembretes, com os atrasados e de hoje primeiro.<br>Filtros: `usuarioId`, `concluidos` | todos | — |
| `POST` | `/lembretes` | Cria um lembrete com título, data e, se quiser, uma descrição e um link para a tela do sistema. O gestor e a gerente podem criar lembrete para outra pessoa da equipe — ele aparece no Meu Dashboard dela. ⚠️ Mandar lembrete para outra pessoa (paraUsuarioId diferente do seu) é só para ADMIN e GERENTE, e o destinatário precisa estar ativo. Data só com o dia (AAAA-MM-DD) é gravada ao meio-dia, para não escorregar de dia por causa do fuso. | todos | — |
| `DELETE` | `/lembretes/:id` | Exclui o lembrete de vez. ⚠️ Não tem volta. Cada pessoa só mexe nos próprios lembretes; ADMIN e GERENTE mexem em qualquer um. | todos | — |
| `PUT` | `/lembretes/:id` | Altera um lembrete: título, descrição, data ou link. O gestor e a gerente também podem passar o lembrete para outra pessoa. ⚠️ Todos os campos são opcionais (só o que vier é alterado). Trocar o paraUsuarioId (de quem é o lembrete) é só para ADMIN e GERENTE. Cada pessoa só mexe nos próprios lembretes; a gestão mexe em qualquer um. | todos | — |
| `POST` | `/lembretes/:id/concluir` | Marca o lembrete como feito, tirando-o da lista de pendências do Meu Dashboard. ⚠️ Cada pessoa só mexe nos próprios lembretes; ADMIN e GERENTE mexem em qualquer um. Dá para desfazer com /lembretes/{id}/reabrir. | todos | — |
| `POST` | `/lembretes/:id/reabrir` | Desmarca um lembrete concluído, trazendo-o de volta para a lista de pendências. ⚠️ Cada pessoa só mexe nos próprios lembretes; ADMIN e GERENTE mexem em qualquer um. | todos | — |

### Robô da Saúde do sistema

> ROBÔ DA SAÚDE — rotas (só ADMIN) e o serviço que roda 24h.   GET  /api/v1/robo-saude                         painel: % de saúde, o que precisa de um clique, o que ele corrigiu   GET  /api/v1/robo-saude/contagem                número do sino (leve, para o topo)   POST /api/v1/robo-saude/rodar                   roda agora   POST /api/v1/robo-saude/avisos/:id/executar     { acao } — o botão da sugest
>
> Código: `apps/api/src/modules/robo-saude/routes.ts`

| Método | Rota | O que faz | Perfis | Chave de API |
|---|---|---|---|---|
| `GET` | `/robo-saude` | Painel do robô da saúde do sistema: a configuração, o percentual de saúde, se está rodando agora, quantos problemas estão abertos, quantas sugestões podem ser resolvidas em lote, quantas correções ele fez hoje, a lista do que precisa de um clique e o histórico do que ele corrigiu sozinho. ⚠️ Consulta pesada: lê até 300 avisos abertos mais o histórico de correções a cada chamada. | ADMIN | — |
| `POST` | `/robo-saude/avisos/:id/executar` | Aperta o botão de uma sugestão do robô da saúde: executa a correção que ele propôs (lançar a venda no caixa e no estoque, estornar venda cancelada, recalcular o saldo da conta, transmitir a nota parada, atribuir o vendedor, acertar a parcela, zerar estoque negativo, fechar pedido antigo do Bling) e marca a sugestão como resolvida. ⚠️ Mexe de verdade no sistema e muitas dessas ações não têm botão de voltar: altera saldo de conta financeira, lança ou estorna contas e estoque, muda a situação de vendas. Dependendo da sugestão, transmite nota fiscal à SEFAZ, o que é irreversível. Fica registrado na auditoria e dispara uma nova rodada do robô em 5 segundos. | ADMIN | — |
| `POST` | `/robo-saude/avisos/:id/ignorar` | Marca a sugestão do robô da saúde como ignorada, para ela não incomodar mais na lista. | ADMIN | — |
| `PUT` | `/robo-saude/config` | Liga ou desliga o robô da saúde e decide se ele pode corrigir sozinho os problemas que sabe resolver, sem esperar um clique. ⚠️ Ligar a correção automática faz o robô alterar dados do sistema a cada rodada (a cada 5 minutos) sem pedir nada a ninguém. Fica registrado na auditoria. | ADMIN | — |
| `GET` | `/robo-saude/contagem` | Devolve só os números do sininho do topo da tela: quantos avisos estão abertos, quantos deles são erro e quantas correções do robô ainda não foram lidas. | ADMIN | — |
| `GET` | `/robo-saude/lembretes` | Mostra a quem está logado os lembretes do robô que são da sua responsabilidade (OS com peça sem custo, para o técnico; venda sem custo, para o vendedor). ADMIN e GERENTE recebem também os da equipe inteira, com o nome de quem precisa agir, e o total de OS sem técnico atribuído. | todos | — |
| `POST` | `/robo-saude/marcar-lidas` | Zera o contador de 'novas correções' do robô, marcando todos os avisos como lidos. | ADMIN | — |
| `POST` | `/robo-saude/resolver-tudo` | Aperta de uma vez o botão principal de todas as sugestões abertas que o robô marcou como seguras para lote, e devolve quantas foram resolvidas, os textos do que foi feito e as que falharam. ⚠️ Executa muitas correções de uma só vez, sem confirmação uma por uma, e boa parte delas não tem volta: lança ou estorna contas e estoque, altera saldos de contas financeiras e muda situação de vendas. Cada execução fica registrada na auditoria, e no fim roda o robô de novo. | ADMIN | — |
| `POST` | `/robo-saude/rodar` | Faz o robô da saúde conferir o sistema agora, sem esperar os 5 minutos, e devolve o painel atualizado. Roda mesmo que o robô esteja desligado na configuração. ⚠️ Rodada pesada: passa por todos os conferentes do sistema. Se a correção automática estiver ligada, ele corrige dados sozinho durante a rodada (lançamentos, estornos, saldos) sem pedir confirmação. | ADMIN | — |

### Robô da NF

> ROBÔ DE NF — rotas e o serviço que roda 24h.   GET  /api/v1/vendas/:id/robo-nf            estado do robô na venda (confere na hora se estiver velho)   POST /api/v1/vendas/:id/robo-nf/conferir   confere agora   POST /api/v1/vendas/:id/emitir-nf          o botão: gera a NF-e (modelo 55, A4) e transmite à SEFAZ   POST /api/v1/produtos/:id/confirmar-ncm    confirma o NCM sugerido pelo robô (um clique)
>
> Código: `apps/api/src/modules/robo-nf/routes.ts`

| Método | Rota | O que faz | Perfis | Chave de API |
|---|---|---|---|---|
| `POST` | `/produtos/:id/confirmar-ncm` | Confirma o NCM sugerido pelo robô de NF (vale para todas as vendas do produto). Pode mandar outro NCM no corpo. | ADMIN, GERENTE | `produtos` · GRAVACAO |
| `GET` | `/robo-nf/painel` | Resumo do robô de nota fiscal nos últimos 60 dias: quantas vendas estão prontas para emitir NF, quantas têm pendência, quantas já foram emitidas, quantos produtos têm NCM sugerido esperando confirmação e quando foi a última varredura. | todos | — |
| `POST` | `/robo-nf/varrer` | Força o robô de NF a varrer agora todas as vendas dos últimos 60 dias que ainda não têm nota autorizada, conferindo o que falta em cada uma para poder emitir. ⚠️ Rodada pesada: confere até 300 vendas numa chamada. Só confere e preenche cadastro; não emite nem transmite nota nenhuma. Se já houver varredura em andamento, devolve o resultado da anterior. Liberada para ADMIN e GERENTE. | todos | — |
| `GET` | `/robo-nf/vendas` | Lista as vendas dos últimos 60 dias agrupadas pelo status do robô de NF (prontas, com pendência ou já emitidas), com número, data, total, cliente e a lista do que falta em cada uma. Vendedor e técnico só veem as próprias vendas.<br>Filtros: `status`, `limite` | todos | — |
| `POST` | `/vendas/:id/emitir-nf` | Emite a NF-e (modelo 55, DANFE A4) da venda e transmite à SEFAZ — só quando o robô diz PRONTA (senão 422 NFE_PENDENCIAS com a lista). | todos | `vendas` · TOTAL |
| `GET` | `/vendas/:id/robo-nf` | Robô de NF: status da venda (PRONTA = "Pronto pra NF", PENDENTE com a lista do que falta e onde corrigir, EMITIDA, IGNORADA) e o que o robô preencheu sozinho. | todos | `vendas` · LEITURA |
| `POST` | `/vendas/:id/robo-nf/conferir` | Robô de NF: confere a venda agora (completa cliente pelo CEP/CNPJ e NCM dos produtos) e devolve o status. | todos | `vendas` · GRAVACAO |

### Leitura de e-mails dos bancos

> ROBÔ DE E-MAIL DOS BANCOS — lê as caixas da loja e vira lançamento no financeiro.   GET    /api/v1/email-banco/painel          situação do robô, últimas mensagens, pendências   POST   /api/v1/email-banco/rodar           roda agora   GET    /api/v1/email-banco/mensagens       histórico, com filtro de situação   GET    /api/v1/email-banco/caixas          caixas cadastradas (sem devolver senha)   POS
>
> Código: `apps/api/src/modules/email-banco/routes.ts`

| Método | Rota | O que faz | Perfis | Chave de API |
|---|---|---|---|---|
| `GET` | `/email-banco/caixas` | Lista as caixas de e-mail que o robô dos bancos acompanha. ⚠️ A senha nunca aparece: vem mascarada, mostrando só os últimos caracteres. | ADMIN | — |
| `POST` | `/email-banco/caixas` | Cadastra uma caixa de e-mail para o robô ler os avisos dos bancos. ⚠️ Passa a dar acesso de leitura a uma caixa de e-mail da loja. A senha (IMAP) ou o código de acesso (Gmail) é obrigatório e fica guardado criptografado; caixa do tipo IMAP exige o servidor. Fica registrado na auditoria. | ADMIN | — |
| `DELETE` | `/email-banco/caixas/:id` | Remove uma caixa de e-mail do robô dos bancos. ⚠️ Não tem volta: apaga junto todo o histórico de mensagens já vistas naquela caixa. Os lançamentos que já entraram no financeiro continuam lá. Fica registrado na auditoria. | ADMIN | — |
| `PUT` | `/email-banco/caixas/:id` | Altera os dados de uma caixa de e-mail já cadastrada. ⚠️ A senha só é trocada se o campo vier preenchido: em branco, a senha atual é mantida. Fica registrado na auditoria. | ADMIN | — |
| `POST` | `/email-banco/caixas/:id/testar` | Testa se o robô consegue entrar na caixa de e-mail e mostra um aviso de exemplo. ⚠️ Lê a caixa de e-mail: entra nela e busca até 5 mensagens dos últimos 2 dias, apenas para conferir o acesso. Nada é marcado, movido ou apagado na caixa, e nada é lançado no financeiro. | ADMIN | — |
| `GET` | `/email-banco/config` | Mostra a configuração do robô dos bancos: ligado ou não, baixa automática e janela de leitura. ⚠️ Se a configuração ainda não existir, ela é criada com os valores padrão na primeira consulta. | ADMIN | — |
| `PUT` | `/email-banco/config` | Liga ou desliga o robô dos bancos e ajusta a baixa automática e o período lido. ⚠️ Com a baixa automática ligada, o robô pode dar baixa sozinho em contas a receber quando o casamento é exato — isso mexe no financeiro. Fica registrado na auditoria. | ADMIN | — |
| `GET` | `/email-banco/mensagens` | Mostra o histórico dos avisos de banco que o robô já leu, com o que aconteceu com cada um.<br>Filtros: `situacao`, `pagina`, `limite` | ADMIN | — |
| `GET` | `/email-banco/painel` | Painel do robô dos bancos: situação, caixas, últimos avisos e quantos lançamentos esperam conciliação. ⚠️ Traz os 20 últimos avisos, o resumo por situação dos últimos 7 dias e as senhas das caixas sempre mascaradas. | ADMIN | — |
| `GET` | `/email-banco/regras` | Lista de quais remetentes o robô aceita aviso e para qual conta da loja cada um vai. | ADMIN | — |
| `POST` | `/email-banco/regras` | Cria uma regra dizendo que avisos de um remetente valem como movimento de uma conta. ⚠️ É essa regra que autoriza o robô a transformar e-mail em lançamento no financeiro: sem regra, o aviso é só anotado. O remetente pode ser o e-mail exato ou só o domínio (o exato tem preferência). Leitores disponíveis: SUMUP_PIX, SUMUP_PAYOUT, CORA, ASAAS, MERCADOPAGO, BOLETO_FORNECEDOR. Fica registrado na auditoria. | ADMIN | — |
| `DELETE` | `/email-banco/regras/:id` | Remove uma regra de remetente do robô dos bancos. ⚠️ Depois disso, avisos daquele remetente deixam de virar lançamento e passam a ficar apenas anotados. Fica registrado na auditoria. | ADMIN | — |
| `PUT` | `/email-banco/regras/:id` | Altera uma regra de remetente: conta de destino, leitor usado, ordem ou se está ativa. ⚠️ Trocar a conta de destino muda para onde vão os próximos lançamentos desse remetente. Fica registrado na auditoria. | ADMIN | — |
| `POST` | `/email-banco/rodar` | Manda o robô dos bancos ler as caixas agora e lançar os avisos encontrados. ⚠️ Lê as caixas de e-mail e mexe em dinheiro: cada aviso de remetente autorizado vira lançamento bancário e, com a baixa automática ligada, pode dar baixa em conta a receber quando o valor casa com exatamente uma conta aberta. Avisos reprovados na verificação de origem (DKIM/SPF) nunca viram lançamento, viram pendência. Nada é alterado na caixa de e-mail. Também roda sozinho de 30 em 30 minutos, se a configuração estiver ligada. | ADMIN | — |

### Documentos e impressões

> DOCUMENTOS DA VENDA   GET /api/v1/vendas/:id/documentos?formato=cupom|a4|garantia   HTML pronto para imprimir / salvar PDF   GET /api/v1/vendas/:id/documentos/resumo                      o que a venda tem (certificados, licenças, NF)
>
> Código: `apps/api/src/modules/documentos/routes.ts`

| Método | Rota | O que faz | Perfis | Chave de API |
|---|---|---|---|---|
| `GET` | `/vendas/:id/documentos` | Documentos da venda em HTML para imprimir/salvar PDF: ?formato=cupom (recibo 80mm), a4 (recibo A4 + certificados + termo de garantia + licenças) ou garantia (só o kit de garantia). | todos | `vendas` · LEITURA |
| `GET` | `/vendas/:id/documentos/resumo` | O que a venda imprime: certificados de garantia (PC, PC Gamer, Notebook, iPhone, Games), termo de garantia, folha de licenças e a NF. | todos | `vendas` · LEITURA |

### Porta do site e do PDV

> PORTA DO SITE (www.balao.info) → MEU BLING. Pedido do Thiago (22/10/2026): o PDV do site (/pdv) manda as vendas para o /sistema e não mais para o Bling; e os produtos do sistema são os do site. Quem chama é o servidor do site (Vercel), nunca o navegador: todas as rotas /api/v1/integracoes/site/* exigem `Authorization: Bearer <SITE_CHAVE_INTEGRACAO>` (variável de ambiente da VPS, a mesma cadastrada
>
> Código: `apps/api/src/modules/site/routes.ts`

| Método | Rota | O que faz | Perfis | Chave de API |
|---|---|---|---|---|
| `POST` | `/integracoes/site/agente/documentos` | Registra o orçamento ou o pedido que a JUL.IA (agente de IA no WhatsApp) fechou com o cliente. ⚠️ Chamada pelo servidor do site (Vercel), nunca pelo navegador do cliente: não usa login, exige o cabeçalho Authorization: Bearer <chave do site> (SITE_CHAVE_INTEGRACAO na VPS = MEU_BLING_CHAVE na Vercel). Sem chave configurada devolve 503; chave errada devolve 401. Diferente do balcão: o pedido fica EM ABERTO na situação inicial, sem parcelas, para um vendedor conferir pagamento e entrega. É idempotente pelo idExterno: repetir devolve o mesmo documento (200). | **pública** | — |
| `GET` | `/integracoes/site/clientes` | Procura o cliente pelo CPF ou CNPJ para o balcão já preencher nome, telefone e endereço. ⚠️ Chamada pelo servidor do site (Vercel), nunca pelo navegador do cliente: não usa login, exige o cabeçalho Authorization: Bearer <chave do site> (SITE_CHAVE_INTEGRACAO na VPS = MEU_BLING_CHAVE na Vercel). Sem chave configurada devolve 503; chave errada devolve 401. Devolve cliente: null quando não existe no cadastro. Documento com outro tamanho é recusado (400).<br>Filtros: `documento` | **pública** | — |
| `POST` | `/integracoes/site/notas/:id/consultar` | Confere na SEFAZ em que pé está a nota e, se ela ainda não foi enviada, tenta transmitir de novo. ⚠️ Chamada pelo servidor do site (Vercel), nunca pelo navegador do cliente: não usa login, exige o cabeçalho Authorization: Bearer <chave do site> (SITE_CHAVE_INTEGRACAO na VPS = MEU_BLING_CHAVE na Vercel). Sem chave configurada devolve 503; chave errada devolve 401. Pode transmitir a nota para a SEFAZ quando ela está pendente ou com erro e ainda sem chave. | **pública** | — |
| `GET` | `/integracoes/site/notas/:id/danfe` | Baixa o PDF do DANFE da nota para o cliente levar ou receber por e-mail. ⚠️ Chamada pelo servidor do site (Vercel), nunca pelo navegador do cliente: não usa login, exige o cabeçalho Authorization: Bearer <chave do site> (SITE_CHAVE_INTEGRACAO na VPS = MEU_BLING_CHAVE na Vercel). Sem chave configurada devolve 503; chave errada devolve 401. Devolve o arquivo PDF, não dados em JSON. | **pública** | — |
| `GET` | `/integracoes/site/status` | Confere se a ligação do site com o sistema está de pé e mostra a empresa, quantos vendedores ativos existem, quantos produtos vieram do site e quando foi a última sincronização. ⚠️ Chamada pelo servidor do site (Vercel), nunca pelo navegador do cliente: não usa login, exige o cabeçalho Authorization: Bearer <chave do site> (SITE_CHAVE_INTEGRACAO na VPS = MEU_BLING_CHAVE na Vercel). Sem chave configurada devolve 503; chave errada devolve 401. | **pública** | — |
| `GET` | `/integracoes/site/vendas` | Lista as vendas de um dia ou de um período, de todas as origens, para o painel e os relatórios do site. ⚠️ Chamada pelo servidor do site (Vercel), nunca pelo navegador do cliente: não usa login, exige o cabeçalho Authorization: Bearer <chave do site> (SITE_CHAVE_INTEGRACAO na VPS = MEU_BLING_CHAVE na Vercel). Sem chave configurada devolve 503; chave errada devolve 401. É obrigatório mandar dia, ou então de e ate juntos.<br>Filtros: `dia`, `de`, `ate` | **pública** | — |
| `POST` | `/integracoes/site/vendas` | Registra no sistema uma venda feita no PDV do site e já a deixa fechada, baixando estoque e lançando as contas a receber. ⚠️ Chamada pelo servidor do site (Vercel), nunca pelo navegador do cliente: não usa login, exige o cabeçalho Authorization: Bearer <chave do site> (SITE_CHAVE_INTEGRACAO na VPS = MEU_BLING_CHAVE na Vercel). Sem chave configurada devolve 503; chave errada devolve 401. Mexe em estoque e em dinheiro. É idempotente pelo pdvId: repetir a mesma chamada devolve a mesma venda (200) em vez de duplicar. Cria ou completa o cadastro do cliente e cria o produto se a sincronização do catálogo ainda não o trouxe. Formas aceitas: pix, dinheiro, credito, debito, boleto, outro. | **pública** | — |
| `GET` | `/integracoes/site/vendas/:id` | Abre uma venda para o site montar o comprovante: itens, pagamentos, cliente, vendedor e situação da nota. ⚠️ Chamada pelo servidor do site (Vercel), nunca pelo navegador do cliente: não usa login, exige o cabeçalho Authorization: Bearer <chave do site> (SITE_CHAVE_INTEGRACAO na VPS = MEU_BLING_CHAVE na Vercel). Sem chave configurada devolve 503; chave errada devolve 401. Só devolve pedidos de venda; orçamento não entra por aqui. | **pública** | — |
| `POST` | `/integracoes/site/vendas/:id/nfe` | Emite a nota fiscal (NF-e modelo 55) da venda do balcão e já transmite para a SEFAZ. ⚠️ Chamada pelo servidor do site (Vercel), nunca pelo navegador do cliente: não usa login, exige o cabeçalho Authorization: Bearer <chave do site> (SITE_CHAVE_INTEGRACAO na VPS = MEU_BLING_CHAVE na Vercel). Sem chave configurada devolve 503; chave errada devolve 401. Documento fiscal: depois de autorizada a nota só se desfaz por cancelamento na SEFAZ. O corpo é opcional; mandando o cliente com CPF/CNPJ, ele passa a ser o cliente da venda e das contas a receber dela (não troca se já existir nota autorizada ou em processamento, e recusa a troca se o estado ou o tipo de pessoa mudar com a nota já criada). Se faltar dado obrigatório, devolve em português o que precisa ser corrigido. | **pública** | — |
| `GET` | `/integracoes/site/vendedores` | Devolve a lista de vendedores ativos para o PDV do site escolher quem está atendendo. ⚠️ Chamada pelo servidor do site (Vercel), nunca pelo navegador do cliente: não usa login, exige o cabeçalho Authorization: Bearer <chave do site> (SITE_CHAVE_INTEGRACAO na VPS = MEU_BLING_CHAVE na Vercel). Sem chave configurada devolve 503; chave errada devolve 401. | **pública** | — |
| `GET` | `/site/catalogo` | Mostra como está a sincronização dos produtos do site: quando rodou, quantos produtos vieram, quantos são pronta-entrega, quantos estão fora do site e se a ligação com o PDV está ativa. ⚠️ Tela de dentro do sistema: exige login (qualquer perfil). A sincronização também roda sozinha a cada 30 minutos. | todos | — |
| `POST` | `/site/catalogo/desativar-fora-do-site` | Desativa de uma vez todos os produtos que não vêm do site, para o cadastro ficar igual à loja virtual. ⚠️ Só o dono (ADMIN). Ação em lote que desativa muitos produtos de uma vez (serviços não são tocados); é reversível reativando produto por produto. | todos | — |
| `POST` | `/site/catalogo/sincronizar` | Puxa agora os produtos do site para o sistema, criando, atualizando e desativando o que mudou. ⚠️ Só o dono e a gerente (ADMIN, GERENTE). Altera o cadastro de produtos em lote; uma volta por vez, quem chamar durante a volta recebe o mesmo resultado. | todos | — |

### Rotas públicas

> Rotas públicas (sem token): acompanhamento de OS / pedido pelo cliente e aprovação de orçamento. O token é derivado do id + APP_SECRET (ver token.ts). Nunca expõe dados sensíveis (custos, senha do equipamento, observações internas).
>
> Código: `apps/api/src/modules/publico/routes.ts`

| Método | Rota | O que faz | Perfis | Chave de API |
|---|---|---|---|---|
| `GET` | `/publico/os/:token` | O que o cliente vê no link de acompanhamento da ordem de serviço: equipamento, defeito, diagnóstico, serviço feito, valores, parcelas e histórico. ⚠️ Página aberta, sem login: quem tem o link entra (token de 24 caracteres derivado do id com a chave do sistema). Limitada a 60 chamadas por minuto. Mostra só o primeiro nome do cliente e nunca custos internos nem senha do equipamento. | **pública** | — |
| `POST` | `/publico/os/:token/aprovar` | O cliente aprova pelo link o orçamento da assistência técnica, autorizando o serviço. ⚠️ Página aberta, sem login: quem tem o link entra (token de 24 caracteres derivado do id com a chave do sistema). Limitada a 60 chamadas por minuto. A aprovação é registrada em definitivo e, se houver a transição configurada, a OS passa sozinha para 'Aprovada'. Só funciona em OS que tem orçamento e ainda não foi finalizada ou cancelada; aprovar de novo devolve jaAprovado: true. | **pública** | — |
| `GET` | `/publico/venda/:token` | O que o cliente vê no link do pedido ou orçamento: itens, descontos, frete, total, parcelas, nota autorizada e histórico. ⚠️ Página aberta, sem login: quem tem o link entra (token de 24 caracteres derivado do id com a chave do sistema). Limitada a 60 chamadas por minuto. Mostra só o primeiro nome do cliente; a nota aparece apenas quando já está autorizada. | **pública** | — |
| `POST` | `/publico/venda/:token/aprovar` | O cliente aprova pelo link o orçamento de venda, virando pedido. ⚠️ Página aberta, sem login: quem tem o link entra (token de 24 caracteres derivado do id com a chave do sistema). Limitada a 60 chamadas por minuto. Dispara a aprovação do orçamento no sistema (muda a situação e o que estiver configurado nela). Só vale para orçamento; orçamento vencido há mais de um dia é recusado e manda falar com a loja. Aprovar de novo devolve jaAprovado: true. | **pública** | — |

### API externa: chaves, webhooks e MCP

> API EXTERNA — conectar outros sistemas e agentes de IA ao MEU BLING. Tela (só ADMIN): Configurações → API e integrações.   GET    /api-externa/resumo                       números do topo da tela + endereços   GET    /api-externa/recursos                     recursos, níveis, endpoints documentados e eventos   GET    /api-externa/chaves                       chaves (sem a chave em si)   POST   /ap
>
> Código: `apps/api/src/modules/api-externa/routes.ts`

| Método | Rota | O que faz | Perfis | Chave de API |
|---|---|---|---|---|
| `GET` | `/api-externa/chaves` | Lista as chaves de acesso que você criou para outros sistemas e agentes, com permissões, limite por minuto, validade, último uso e quantas chamadas fizeram nas últimas 24 horas. ⚠️ Só o dono (perfil ADMIN) entra nesta tela. A chave em si nunca aparece aqui: só o começo dela (prefixo), para você reconhecer qual é. | ADMIN | — |
| `POST` | `/api-externa/chaves` | Cria uma chave nova para ligar um sistema ou um agente de IA na loja, escolhendo o que ele pode ler e gravar. ⚠️ SENSÍVEL: cria chave de acesso. A chave completa é mostrada UMA única vez, nesta resposta — depois só fica guardada embaralhada (hash). Exige liberar pelo menos uma área, senão recusa. Fica registrado na auditoria. | ADMIN | — |
| `DELETE` | `/api-externa/chaves/:id` | Apaga uma chave de acesso de vez; o sistema que a usava para de entrar na hora. ⚠️ SENSÍVEL: corta o acesso de quem usava a chave imediatamente e não há como desfazer. Fica registrado na auditoria. | ADMIN | — |
| `PUT` | `/api-externa/chaves/:id` | Altera uma chave: que áreas ela pode ler ou gravar, de quais IPs pode vir, quantas chamadas por minuto, até quando vale e se está ligada ou desligada. ⚠️ SENSÍVEL: muda o que a chave pode fazer. Manda só os campos que mudam. Não troca a chave em si. Fica registrado na auditoria. | ADMIN | — |
| `POST` | `/api-externa/chaves/:id/regenerar` | Troca o código da chave mantendo nome e permissões — use quando a chave antiga vazou ou você quer cortar quem já a tinha. ⚠️ SENSÍVEL: a chave antiga para de funcionar na hora e a nova é mostrada UMA única vez, nesta resposta. Fica registrado na auditoria. | ADMIN | — |
| `POST` | `/api-externa/entregas/:id/reenviar` | Manda de novo um aviso de acontecimento que não chegou ao outro sistema, zerando as tentativas e enviando na hora. | ADMIN | — |
| `GET` | `/api-externa/logs` | Registro de todas as chamadas feitas com chave de API: qual chave, que rota, se deu erro, quanto tempo levou e de qual IP veio. ⚠️ O sistema apaga sozinho os registros com mais de 30 dias.<br>Filtros: `chaveId`, `erros`, `origem`, `pagina`, `limite` | ADMIN | — |
| `GET` | `/api-externa/recursos` | Catálogo de tudo que você pode liberar numa chave: as áreas do sistema, os níveis (leitura, gravação, total), as rotas documentadas, os acontecimentos que disparam webhook e as ferramentas que um agente de IA vê. ⚠️ É a lista que monta a tela de permissões — não depende de nenhuma chave existir. | ADMIN | — |
| `GET` | `/api-externa/resumo` | Números do topo da tela de integrações: quantas chaves existem e quantas estão ligadas, quantos webhooks ativos, chamadas e erros nas últimas 24 horas, avisos esperando envio, e os endereços da API, do MCP e da documentação. | ADMIN | — |
| `GET` | `/api-externa/webhooks` | Lista os endereços de outros sistemas que recebem aviso quando algo acontece na loja, com os acontecimentos escolhidos, último envio e quantas falhas seguidas. ⚠️ O segredo da assinatura não vem nesta lista. | ADMIN | — |
| `POST` | `/api-externa/webhooks` | Cadastra um endereço que vai receber aviso automático quando acontecerem coisas na loja (venda criada, nota autorizada, conta recebida etc.). ⚠️ SENSÍVEL: a resposta mostra o segredo usado para assinar os avisos. Se você não escolher acontecimentos, ele recebe todos (*). O endereço tem de começar com http:// ou https://. Fica registrado na auditoria. | ADMIN | — |
| `DELETE` | `/api-externa/webhooks/:id` | Apaga um endereço que recebia avisos; ele deixa de ser avisado e o histórico de entregas dele sai junto. ⚠️ SENSÍVEL: não há como desfazer, e as entregas guardadas desse webhook são apagadas com ele. Fica registrado na auditoria. | ADMIN | — |
| `PUT` | `/api-externa/webhooks/:id` | Altera um endereço de aviso: nome, endereço, quais acontecimentos interessam e se está ligado. ⚠️ SENSÍVEL: ao religar um webhook o contador de falhas seguidas volta a zero. Fica registrado na auditoria. | ADMIN | — |
| `GET` | `/api-externa/webhooks/:id/entregas` | Últimos avisos enviados para um endereço: qual acontecimento, se entregou, que resposta o outro sistema deu e quantas tentativas foram feitas. ⚠️ O conteúdo completo enviado (payload) aparece aqui. Entregas com mais de 30 dias são apagadas sozinhas.<br>Filtros: `limite` | ADMIN | — |
| `GET` | `/api-externa/webhooks/:id/segredo` | Mostra o segredo que o outro sistema usa para confirmar que o aviso saiu mesmo da sua loja. ⚠️ SENSÍVEL: revela o segredo de assinatura do webhook em texto aberto. Só o dono (ADMIN) chega aqui. | ADMIN | — |
| `POST` | `/api-externa/webhooks/:id/segredo` | Gera um segredo novo para o webhook, quando o antigo vazou ou você quer trocar. ⚠️ SENSÍVEL: revela o segredo novo na resposta e o antigo deixa de valer — quem recebe os avisos precisa ser atualizado, senão vai recusar as assinaturas. Fica registrado na auditoria. | ADMIN | — |
| `POST` | `/api-externa/webhooks/:id/testar` | Manda agora um aviso de teste para o endereço cadastrado e mostra se o outro sistema respondeu, com que resposta e em quanto tempo. ⚠️ Envia de verdade (não é simulação) e conta como uma entrega no histórico; se falhar, soma nas falhas seguidas do webhook. | ADMIN | — |
| `GET` | `/externo/buscar` | Busca geral: clientes, produtos, vendas, OS e notas de uma vez (só nas áreas liberadas). Aceita nome, documento, telefone, número do pedido/OS/nota.<br>Filtros: `q`, `limite` | todos | — |
| `GET` | `/externo/eu` | Quem sou eu: nome da chave, permissões por área e endereços. | todos | — |
| `GET` | `/externo/openapi.json` | Esta documentação em OpenAPI 3.1, só com o que a chave pode. | todos | — |
| `GET` | `/externo/resumo` | Resumo do dia: vendas, orçamentos, OS abertas/atrasadas, a receber e a pagar, estoque baixo (só as áreas liberadas).<br>Filtros: `data` | todos | — |
| `GET` | `/mcp` | Não atende por aqui: o canal para agentes de IA só funciona por envio (POST). Responde avisando para usar POST. ⚠️ Resposta fixa 405 com o aviso de usar POST — é o que o protocolo MCP pede quando não há fluxo contínuo (SSE). | todos | — |
| `POST` | `/mcp` | Canal por onde um agente de IA (Claude, ChatGPT, n8n, agente próprio) conversa com o sistema e usa as ferramentas da loja, mandando a chave no cabeçalho. ⚠️ SENSÍVEL por consequência: com chave de gravação o agente cria vendas, baixa contas e manda WhatsApp; com nível total exclui registros. Cada ferramenta chama a própria API com a mesma chave, então as permissões, o limite por minuto e o registro de chamadas valem igual. Aceita também um lote de mensagens (até 50 por envio). | todos | — |
| `POST` | `/mcp/:chave` | Mesmo canal para agentes de IA, mas com a chave dentro do endereço — para conectores que não conseguem mandar cabeçalho. ⚠️ SENSÍVEL: a chave vai no endereço, então aparece em históricos e logs de quem chama. Só funciona se a chave tiver a opção "permitir na URL" ligada; senão o sistema recusa. No registro de chamadas a chave é trocada por "(chave)". | todos | — |

### Diagnóstico

> GET /api/v1/diagnostico — "Saúde do sistema" (só ADMIN; só leitura). Também roda toda madrugada e guarda o resumo em Configuracao "diagnostico.ultimo" para o alerta do dashboard.
>
> Código: `apps/api/src/modules/diagnostico/routes.ts`

| Método | Rota | O que faz | Perfis | Chave de API |
|---|---|---|---|---|
| `GET` | `/diagnostico` | Saúde do sistema: inconsistências nos dados, com o que corrigir. | ADMIN | `sistema` · LEITURA |

### Notas fiscais (NF-e / NFC-e)

> Código: `apps/api/src/integracoes/fiscal/`

| Método | Rota | O que faz | Perfis | Chave de API |
|---|---|---|---|---|
| `DELETE` | `/empresa/certificado` | Apaga o certificado digital da loja; sem ele o sistema não consegue mais emitir nota fiscal. ⚠️ SENSÍVEL: altera certificado digital e trava a emissão de notas até subir outro. Só o dono (ADMIN). Fica registrado na auditoria. | ADMIN | — |
| `POST` | `/empresa/certificado` | Sobe o certificado digital A1 da loja (arquivo .pfx ou .p12 com a senha) para emitir nota fiscal, e devolve o nome e a validade lidos do arquivo. ⚠️ SENSÍVEL: altera certificado digital. A senha é guardada embaralhada. Se o CNPJ do certificado for diferente do da loja, o sistema só anota um alerta no log e aceita. Só o dono (ADMIN). Fica registrado na auditoria. | ADMIN | — |
| `GET` | `/fiscal/status-sefaz` | SEFAZ no ar? Ambiente (homologação/produção). | todos | `fiscal` · LEITURA |
| `GET` | `/notas-fiscais` | Lista notas fiscais.<br>Filtros: `tipo`, `modelo`, `situacao`, `pesquisa`, `contatoId`, `dataInicial`, `dataFinal`, `pagina`, `limite` | todos | `fiscal` · LEITURA |
| `POST` | `/notas-fiscais` | Cria nota manual (pendente). | ADMIN, GERENTE, FINANCEIRO, VENDEDOR | `fiscal` · GRAVACAO |
| `DELETE` | `/notas-fiscais/:id` | Exclui nota pendente. | ADMIN, GERENTE, FINANCEIRO, VENDEDOR | `fiscal` · TOTAL |
| `GET` | `/notas-fiscais/:id` | Nota com itens, eventos e contato. | todos | `fiscal` · LEITURA |
| `PUT` | `/notas-fiscais/:id` | Altera nota pendente ou rejeitada. | ADMIN, GERENTE, FINANCEIRO, VENDEDOR | `fiscal` · GRAVACAO |
| `POST` | `/notas-fiscais/:id/cancelar` | Cancela a nota na SEFAZ (sem volta — exige nível TOTAL). | ADMIN, GERENTE, FINANCEIRO, VENDEDOR | `fiscal` · TOTAL |
| `POST` | `/notas-fiscais/:id/carta-correcao` | Carta de correção (texto com 15+ caracteres). | ADMIN, GERENTE, FINANCEIRO, VENDEDOR | `fiscal` · GRAVACAO |
| `POST` | `/notas-fiscais/:id/consultar` | Consulta a situação da nota na SEFAZ. | ADMIN, GERENTE, FINANCEIRO, VENDEDOR | `fiscal` · GRAVACAO |
| `GET` | `/notas-fiscais/:id/danfe` | PDF do DANFE.<br>Filtros: `download` | todos | `fiscal` · LEITURA |
| `POST` | `/notas-fiscais/:id/enviar-email` | Envia XML + DANFE por e-mail (padrão: e-mail do cliente). | ADMIN, GERENTE, FINANCEIRO, VENDEDOR | `fiscal` · GRAVACAO |
| `POST` | `/notas-fiscais/:id/renumerar` | Dá o próximo número a uma nota rejeitada por duplicidade. | ADMIN, GERENTE, FINANCEIRO, VENDEDOR | `fiscal` · GRAVACAO |
| `POST` | `/notas-fiscais/:id/transmitir` | Assina com o certificado A1 e envia à SEFAZ. | ADMIN, GERENTE, FINANCEIRO, VENDEDOR | `fiscal` · GRAVACAO |
| `GET` | `/notas-fiscais/:id/xml` | XML da nota (procNFe se autorizada). | todos | `fiscal` · LEITURA |
| `POST` | `/notas-fiscais/inutilizar` | Inutiliza numeração na SEFAZ (sem volta — exige nível TOTAL). | ADMIN, GERENTE | `fiscal` · TOTAL |

### WhatsApp (conexão)

> Rotas do WhatsApp: status, conectar (QR Code), desconectar, enviar teste, eventos (SSE) e a configuração do servidor Evolution — o caminho do "um QR Code só" para toda a loja. O status/conexão passam pelo provedor (Evolution quando configurada, senão a sessão própria do sistema). O SSE e o robô de reconexão continuam ligados ao Baileys, que é quem tem eventos locais; com a Evolution a tela recarre
>
> Código: `apps/api/src/integracoes/whatsapp/routes.ts`

| Método | Rota | O que faz | Perfis | Chave de API |
|---|---|---|---|---|
| `POST` | `/whatsapp/conectar` | Inicia a conexão do WhatsApp da loja e devolve o QR Code para ler no celular. ⚠️ Conecta o serviço externo: usa o servidor Evolution quando configurado (cria a instância se ainda não existir) ou abre a sessão própria do sistema. Espera até 8 segundos pelo QR Code antes de responder. Fica registrado na auditoria. | ADMIN, GERENTE | — |
| `POST` | `/whatsapp/desconectar` | Desconecta o WhatsApp da loja, parando mensagens automáticas e cobranças. ⚠️ Desconecta o serviço externo. Na sessão própria do sistema a sessão salva é apagada, então voltar exige ler um QR Code novo; com o servidor Evolution o aparelho é desconectado e a instância continua existindo. Fica registrado na auditoria. | ADMIN, GERENTE | — |
| `POST` | `/whatsapp/enviar-teste` | Envia uma mensagem direta (sem fila). | todos | `comunicacao` · GRAVACAO |
| `GET` | `/whatsapp/eventos` | Acompanha ao vivo a situação do WhatsApp e as mensagens que chegam. ⚠️ Conexão que fica aberta enviando atualizações (SSE): manda o estado a cada mudança, as mensagens recebidas e um sinal de vida a cada 15 segundos. Não exige perfil específico e reflete só a sessão própria do sistema, não a do servidor Evolution. | todos | — |
| `GET` | `/whatsapp/evolution` | Mostra a configuração do servidor de WhatsApp da loja e qual motor está no ar. ⚠️ Só para ADMIN. A chave de acesso nunca aparece: vem mascarada, mostrando só os últimos caracteres. | todos | — |
| `PUT` | `/whatsapp/evolution` | Salva o endereço, a chave e a instância do servidor de WhatsApp e escolhe se ele é quem manda. ⚠️ Só para ADMIN. Ligar aqui troca o motor do WhatsApp de toda a loja (CRM, mensagens automáticas, orçamentos e cobrança do JARVIS passam a sair pelo servidor Evolution) — pode exigir ler o QR Code de novo. A chave fica guardada criptografada e, se vier vazia ou mascarada, a anterior é mantida. Fica registrado na auditoria. | todos | — |
| `GET` | `/whatsapp/evolution/instancias` | Lista as instâncias existentes no servidor de WhatsApp, para escolher a certa. ⚠️ Só para ADMIN. Consulta o servidor externo usando a configuração já salva; se não houver configuração, dá erro. | todos | — |
| `POST` | `/whatsapp/evolution/testar` | Testa endereço, chave e instância do servidor de WhatsApp antes de salvar. ⚠️ Só para ADMIN. Fala com o servidor externo apenas para conferir, sem gravar nada. Se a chave vier mascarada ou em branco, usa a que já está salva; sem nenhuma chave, responde pedindo a chave. | todos | — |
| `POST` | `/whatsapp/reconectar` | Reconecta a sessão do WhatsApp (sem precisar de novo QR). | todos | `comunicacao` · GRAVACAO |
| `GET` | `/whatsapp/status` | WhatsApp da loja conectado? (número, desde quando). | todos | `comunicacao` · LEITURA |

### Bling (importação)

> Rotas de migração do Bling: OAuth2 (auth-url/callback), status, importação em background e CSV.
>
> Código: `apps/api/src/integracoes/bling/routes.ts`

| Método | Rota | O que faz | Perfis | Chave de API |
|---|---|---|---|---|
| `GET` | `/bling/auth-url` | Gera o link para autorizar o MEU BLING a acessar a conta do Bling da loja. ⚠️ Só funciona depois que o Client ID e o Client Secret do aplicativo Bling estiverem salvos em Configurações. Devolve também o endereço de retorno que precisa estar cadastrado no aplicativo Bling. O link vale 15 minutos. | ADMIN | — |
| `POST` | `/bling/callback` | Conclui a autorização do Bling usando o código devolvido pela tela de permissão. ⚠️ Conecta um serviço externo: troca o código pelo acesso definitivo ao Bling e guarda esse acesso na empresa. Fica registrado na auditoria. | ADMIN | — |
| `DELETE` | `/bling/desconectar` | Desliga a ligação com o Bling, parando qualquer consulta ou importação. ⚠️ Desconecta o serviço externo e apaga o acesso guardado; para voltar é preciso autorizar de novo pela tela do Bling. Fica registrado na auditoria. | ADMIN | — |
| `POST` | `/bling/importar` | Começa a trazer do Bling os cadastros e as movimentações escolhidas, em segundo plano. ⚠️ Mexe em dinheiro e não tem volta: com "baixarNoCaixa" ligado, cada venda fechada entra como recebida no caixa na data da venda, e com "fecharEmAberto" as vendas em aberto do Bling entram como fechadas. Roda em segundo plano e recusa começar se já houver outra importação rodando. Gera um arquivo de registro na pasta de armazenamento. | ADMIN | — |
| `POST` | `/bling/importar-csv` | Importa uma planilha de clientes ou de produtos exportada do Bling. ⚠️ Não tem volta: cria e atualiza cadastros direto, casando pelo documento ou pelo código da planilha. Aceita o envio do arquivo (multipart, com o campo "entidade") ou o texto da planilha no corpo. Fica registrado na auditoria. | ADMIN | — |
| `GET` | `/bling/importar/status` | Mostra como está a importação do Bling: o que já veio, o que falta e os erros. ⚠️ Devolve as últimas 200 linhas do registro da importação, além do progresso por tipo de dado. | ADMIN | — |
| `POST` | `/bling/renovar-token` | Renova o acesso ao Bling sem precisar autorizar de novo na tela deles. ⚠️ Fala com o serviço externo do Bling para trocar o acesso. Só funciona se a loja já estiver conectada; o sistema também renova sozinho quando falta menos de 5 minutos para vencer. | ADMIN | — |
| `GET` | `/bling/status` | Diz se o Bling está conectado, até quando vale o acesso e quando foi a última importação. ⚠️ Informa também o endereço de retorno a cadastrar no aplicativo Bling e se há importação rodando. | ADMIN | — |
| `GET` | `/bling/testar` | Testa a conexão com o Bling trazendo um cliente de exemplo. ⚠️ Consulta o serviço externo do Bling (um único contato) e não grava nada. | ADMIN | — |

### E-mail (SMTP)

> Rotas de e-mail: teste de SMTP.
>
> Código: `apps/api/src/integracoes/email/routes.ts`

| Método | Rota | O que faz | Perfis | Chave de API |
|---|---|---|---|---|
| `POST` | `/empresa/smtp/testar` | Manda um e-mail de teste para o endereço que você informar, para conferir se o envio de e-mail da loja está configurado certo. ⚠️ SENSÍVEL: usa a configuração de e-mail da loja (SMTP) e envia mensagem de verdade. Só o dono (ADMIN) pelas regras de perfil. Fica registrado na auditoria. | ADMIN | — |

### Infraestrutura

> Código: `apps/api/src/(sem módulo)/`

| Método | Rota | O que faz | Perfis | Chave de API |
|---|---|---|---|---|
| `GET` | `/saude` | Diz se o sistema está de pé e conversando com o banco de dados, com a versão e a hora do servidor. ⚠️ Rota pública: não pede login nem chave. Serve para monitoramento. | **pública** | — |
| `GET` | `/uploads/*` | Arquivos do storage: logos são públicos; anexos, DANFE e XML exigem sessão. Pastas sensíveis (WhatsApp, temporários, importação) nunca são servidas. | **pública** | — |

---

## 6. Apêndice A — API externa, MCP e chaves em detalhe

Tela: **Configurações → API e integrações** (só perfil ADMIN).
Código: `apps/api/src/modules/api-externa/` (`routes.ts`, `chaves.ts`, `recursos.ts`, `mcp.ts`, `webhooks.ts`, `openapi.ts`, `externo.ts`) e o plugin `apps/api/src/plugins/auth.ts`, que é quem confere a chave em toda chamada.

---

## 1. Como uma chave de API se autentica e como ela é conferida

### Formato da chave
`mb_` + 48 caracteres hexadecimais (`gerarChave()` em `chaves.ts`, 24 bytes aleatórios). No banco (`ChaveApi`) ficam guardados apenas:

- `hash` — o sha256 da chave;
- `prefixo` — os 11 primeiros caracteres, só para o dono reconhecer qual é a chave na lista.

A chave completa aparece **uma única vez**: na resposta de `POST /api-externa/chaves` e na de `POST /api-externa/chaves/:id/regenerar`. Não há como recuperá-la depois — se perder, é só regenerar.

### As três maneiras de mandar a chave
Todas tratadas no `onRequest` do `plugins/auth.ts`, usando `chaveDoCabecalho()` e `chaveDaUrl()`:

1. **`X-API-Key: mb_...`** — o jeito preferido.
2. **`Authorization: Bearer mb_...`** — reconhecido pelo padrão `Bearer mb_...` (ou seja, só vale como chave de API se começar com `mb_`; outro Bearer é tratado como passe de login JWT).
3. **Chave dentro do endereço do MCP: `POST /api/v1/mcp/mb_...`** — para conectores de IA que não conseguem mandar cabeçalho. Só funciona se a chave tiver a opção `permitirNaUrl` ligada; senão o sistema recusa com `CHAVE_NA_URL`.

O cabeçalho tem prioridade: se vier `X-API-Key` ou `Bearer`, a chave da URL é ignorada.

### O que é conferido (`conferirChave()` em `chaves.ts`)
Na ordem:

| Conferência | Recusa com |
|---|---|
| formato `mb_` + 48 hex | 401 `CHAVE_INVALIDA` |
| o sha256 existe no banco | 401 `CHAVE_INVALIDA` |
| `ativo` está ligado | 401 `CHAVE_INATIVA` |
| `expiraEm` ainda não passou | 401 `CHAVE_VENCIDA` |
| veio na URL e a chave permite isso | 401 `CHAVE_NA_URL` |
| IP de quem chama está na lista `ipsPermitidos` (se a lista não estiver vazia) | 403 `IP_NAO_PERMITIDO` |

Detalhes práticos:

- **Hash, nunca a chave.** A conferência é `sha256(chave recebida)` comparado com `ChaveApi.hash`. O banco não tem como devolver a chave.
- **Cache de 30 segundos.** `buscarChave()` guarda o resultado por 30 s (mapa em memória, limpo quando passa de 500 entradas). Por isso alterar ou excluir uma chave chama `limparCacheChaves()` — mudanças valem na hora. Em troca, uma chave alterada direto no banco pode levar até 30 s para surtir efeito.
- **Validade** é gravada como fim do dia no fuso de São Paulo (`fimDoDia`: `AAAA-MM-DDT23:59:59-03:00`), então "vale até dia 31" inclui o dia 31 inteiro.
- **IPs** aceitam vários separados por vírgula, espaço ou ponto-e-vírgula; na comparação o prefixo IPv6-mapeado `::ffff:` é removido dos dois lados. Lista vazia = qualquer IP.
- **Limite por minuto.** Configurado por chave (`limitePorMinuto`, 1 a 5000, padrão 120). O `@fastify/rate-limit` registrado em `app.ts` conta por chave (`keyGenerator` devolve `k:<hash>`) e lê o limite do cache (`limiteDaChaveEmCache`); se a chave ainda não está no cache, usa 120. Usuário logado tem 1200/min, e sem login conta por IP. Passar do limite devolve 429 `LIMITE_REQUISICOES`.
- **Em nome de quem a chave age.** A chave herda o usuário ADMIN que a criou (`criadoPorId`); se esse usuário saiu ou deixou de ser ADMIN, o sistema usa o ADMIN ativo mais antigo. Na auditoria e nos históricos a chamada aparece como `API: <nome da chave>`.
- **Registro de cada chamada.** No `onResponse`, `registrarChamada()` grava em `LogApi`: chave, método, rota (com a query), status, tempo em ms, IP, origem (`API` ou `MCP`) e, quando negado, o motivo. Na rota do MCP a chave que está no endereço é substituída por `/mcp/(chave)` antes de gravar. Registros com mais de 30 dias são apagados por um serviço que roda a cada 6 horas.

---

## 2. Permissões por recurso e nível

### Recursos
`recursos.ts` define 13 áreas (`RECURSOS`), cada uma ligada a um conjunto de rotas por expressão regular:

`clientes`, `produtos`, `vendas`, `compras`, `consignacao`, `os`, `financeiro`, `fiscal`, `comissoes`, `relatorios` (máximo LEITURA), `comunicacao`, `cadastros`, `sistema` (máximo LEITURA).

As permissões de uma chave são guardadas como JSON `{ "<recurso>": "<nível>" }`. Recurso ou nível desconhecido é descartado na leitura/gravação (`lerPermissoes` / `limparPermissoes`), e nível acima do `maximo` do recurso é rebaixado automaticamente — pedir `TOTAL` em `relatorios` grava `LEITURA`.

### Níveis
Pesos: `LEITURA` 1 < `GRAVACAO` 2 < `TOTAL` 3. O nível é **cumulativo**: quem tem gravação também lê; quem tem total também grava.

O nível exigido vem do método HTTP (`nivelExigido`):

- `GET` / `HEAD` → LEITURA
- `POST` / `PUT` / `PATCH` → GRAVACAO
- `DELETE` → TOTAL

Mais um grupo de ações sem volta que exigem **TOTAL mesmo sendo POST** (`EXIGEM_TOTAL`): cancelar nota (`/notas-fiscais/{id}/cancelar`), inutilizar numeração (`/notas-fiscais/inutilizar`), pagar comissões (`/comissoes/pagar`), emitir NF de uma venda (`/vendas/{id}/emitir-nf`) e pagar/quitar/cancelar consignação.

### A decisão em si (`chavePode`)
1. Rotas **sempre liberadas** para qualquer chave válida: `/externo/...` e `/mcp/...`.
2. Rotas **bloqueadas para chave, sempre** (`BLOQUEADAS`), qualquer que seja a permissão: `/usuarios`, `/auth`, `/api-externa` (a própria tela de chaves), `/empresa/certificado`, `/empresa/smtp`, `/empresa/logo`, gravação em `/empresa`, gravação em `/situacoes`, `/configuracoes`, `/bling`, vincular/desvincular Open Finance, conectar/desconectar WhatsApp, catálogo do site e as regras/robô da consignação. Resposta: 403 com o aviso de que é função de administração.
3. Se a rota não pertence a nenhum recurso, fica **fechada por padrão** ("Esta rota não está liberada para chaves de API").
4. Caso contrário, compara o nível que a chave tem no recurso com o nível exigido. Faltando, devolve 403 `CHAVE_SEM_PERMISSAO` com `detalhes: { recurso, exigido }` e uma mensagem em português dizendo qual área liberar.

Pontos importantes para o dia a dia:

- A chave usa **as mesmas rotas `/api/v1` da tela** — nada é duplicado. O catálogo só diz a que recurso cada rota pertence.
- Criar uma chave **sem nenhuma área liberada é recusado** (422 `SEM_PERMISSOES`), tanto no POST como no PUT.
- `GET /api-externa/recursos` devolve o catálogo inteiro (recursos, níveis, rotas documentadas, eventos de webhook, ferramentas do MCP) — é o que monta a tela de permissões.
- `GET /externo/eu` mostra à própria chave o que ela pode, e `GET /externo/openapi.json` devolve a documentação OpenAPI 3.1 **filtrada**: só os endpoints que aquelas permissões alcançam (`endpointsPermitidos` em `openapi.ts`). Bom para importar em Postman, n8n, Make ou entregar a um agente de IA.

---

## 3. O servidor MCP

### Endereços e transporte
- `POST /api/v1/mcp` com `X-API-Key: mb_...` — Claude Code, Claude Desktop, n8n, agentes próprios.
- `POST /api/v1/mcp/mb_...` — chave no endereço, só com `permitirNaUrl` ligado.
- `GET /api/v1/mcp` responde **405** com `allow: POST` (é o que o protocolo pede quando não há fluxo SSE).

Transporte "Streamable HTTP" **sem sessão**: cada POST traz uma mensagem JSON-RPC 2.0 (ou um lote de até 50) e a resposta volta em JSON, com `cache-control: no-store`. Quando só vêm notificações, a resposta é **202** sem corpo.

Métodos JSON-RPC atendidos: `initialize`, `ping`, `tools/list`, `tools/call`, `resources/list`, `resources/templates/list`, `prompts/list`. Versões de protocolo aceitas: `2025-06-18`, `2025-03-26`, `2024-11-05` (se o cliente pedir outra, o servidor responde com a primeira). `serverInfo.name` é `meu-bling`, título "MEU BLING — Balão da Informática".

### Como as ferramentas funcionam por dentro
Cada ferramenta não fala com o banco: ela monta um método + caminho e **chama a própria API `/api/v1` com a MESMA chave** (`chamarApi` usa `app.inject` repassando `x-api-key` e marcando `x-meubling-origem: mcp`). Consequência direta: permissões, limite por minuto e registro de chamadas valem igualzinho; o agente não ganha nada que a chave não tenha.

Travas: o caminho tem de começar com `/`, não pode ter `//`, `..`, nem começar com `/mcp` ou `/api/`, e tem menos de 2000 caracteres. A resposta é cortada em 60.000 caracteres (com aviso para usar filtros, `pagina` e `limite`). Arquivo binário não vem no texto — o servidor avisa para baixar direto pela API.

`tools/list` mostra **só as ferramentas que a chave alcança** (`podeNivel` por recurso e nível), com as dicas `readOnlyHint` (nível LEITURA) e `destructiveHint` (nível TOTAL).

### Ferramentas expostas (27)

Genéricas (recurso `*` — basta a chave ter o nível em alguma área):

| Ferramenta | Nível | O que faz |
|---|---|---|
| `listar_endpoints` | LEITURA | Lista as rotas que esta chave pode usar, com filtros e exemplo de corpo |
| `consultar` | LEITURA | GET em qualquer rota liberada (sem `/api/v1`) |
| `gravar` | GRAVACAO | POST ou PUT em qualquer rota liberada |
| `excluir` | TOTAL | DELETE em qualquer rota liberada |
| `buscar` | LEITURA | Busca geral (clientes, produtos, vendas, OS, notas) via `/externo/buscar` |
| `resumo_do_dia` | LEITURA | Resumo do dia via `/externo/resumo` |
| `mudar_situacao` | GRAVACAO | Muda situação de venda, orçamento, compra ou OS |

Por área:

| Ferramenta | Recurso / nível | O que faz |
|---|---|---|
| `buscar_clientes` | clientes / LEITURA | Procura cliente, fornecedor ou transportadora |
| `historico_do_cliente` | clientes / LEITURA | Linha do tempo do cliente |
| `criar_cliente` | clientes / GRAVACAO | Cadastra cliente (deduz pessoa física/jurídica pelo documento) |
| `buscar_produtos` | produtos / LEITURA | Procura produto com preço e estoque |
| `estoque_do_produto` | produtos / LEITURA | Produto com saldo por depósito |
| `listar_vendas` | vendas / LEITURA | Pedidos e orçamentos por período, cliente, vendedor ou texto |
| `ver_venda` | vendas / LEITURA | Venda completa: itens, parcelas, situação, nota |
| `criar_venda` | vendas / GRAVACAO | Cria pedido ou orçamento com itens e parcelas |
| `listar_ordens_servico` | os / LEITURA | OS por texto, situação, técnico ou período |
| `ver_ordem_servico` | os / LEITURA | OS completa |
| `abrir_ordem_servico` | os / GRAVACAO | Abre OS na assistência |
| `resumo_financeiro` | financeiro / LEITURA | Saldos e o que há a receber e a pagar |
| `contas_a_receber` | financeiro / LEITURA | Contas a receber (use `situacao=ATRASADO` para cobrança) |
| `contas_a_pagar` | financeiro / LEITURA | Contas a pagar |
| `contas_financeiras` | financeiro / LEITURA | Caixa, bancos e cartões com saldo |
| `baixar_conta` | financeiro / GRAVACAO | Dá baixa numa conta a receber ou a pagar |
| `situacoes` | cadastros / LEITURA | Situações de um módulo, para achar o `situacaoId` |
| `formas_pagamento` | cadastros / LEITURA | Formas de pagamento com o id |
| `vendedores_e_tecnicos` | cadastros / LEITURA | Vendedores ou técnicos ativos |
| `enviar_whatsapp` | comunicacao / GRAVACAO | Põe uma mensagem de WhatsApp na fila |

As instruções que o servidor manda no `initialize` orientam o agente a usar `listar_endpoints` primeiro, as buscas para achar códigos, valores em reais, datas AAAA-MM-DD, e a **confirmar com a pessoa antes de gravar, excluir ou mandar mensagem a cliente**.

### Como um agente se conecta, na prática
1. No painel, criar uma chave liberando só as áreas necessárias (ex.: `produtos: LEITURA`, `vendas: GRAVACAO`).
2. Apontar o cliente MCP para o endereço que `GET /api-externa/resumo` devolve em `urlMcp` (`<APP_URL>/api/v1/mcp`), com `X-API-Key`.
3. Se o conector não aceitar cabeçalho, ligar `permitirNaUrl` na chave e usar `<APP_URL>/api/v1/mcp/mb_...`. Lembre que aí a chave fica visível no endereço.
4. Acompanhar o uso em `GET /api-externa/logs` (filtro `origem=MCP`).

---

## 4. Webhooks de saída

### O que dispara
`ligarWebhooks()` escuta o barramento interno (`core/eventos.ts`) e cada acontecimento vira entrega. Os 10 eventos (`EVENTOS_WEBHOOK`):

| Evento | Quando |
|---|---|
| `venda.criada` | Pedido de venda ou orçamento criado |
| `venda.alterada` | Venda editada, transferida, excluída ou vinda do PDV |
| `situacao.alterada` | Mudança de situação (venda, orçamento, compra ou OS) |
| `compra.criada` | Pedido de compra criado |
| `os.criada` | Ordem de serviço aberta |
| `os.orcamento` | Orçamento de OS aprovado |
| `nfe.autorizada` | Nota fiscal autorizada |
| `nfe.cancelada` | Nota fiscal cancelada |
| `conta.recebida` | Conta a receber baixada (dinheiro entrou) |
| `conta.paga` | Conta a pagar baixada (dinheiro saiu) |

Cada webhook escolhe sua lista de eventos; `["*"]` (o padrão) recebe todos. Nome de evento desconhecido é descartado, e se sobrar nada a lista volta para `["*"]` (`limparEventos`).

Há ainda o evento `teste`, só disparado por `POST /api-externa/webhooks/:id/testar`.

### Formato do POST
`POST` na URL cadastrada, corpo JSON:

```json
{
  "evento": "venda.criada",
  "quando": "2026-10-30T12:34:56.000Z",
  "sistema": "MEU BLING",
  "origem": "<endereço do sistema, da variável APP_URL>",
  "dados": { "vendaId": 123, "venda": { "...": "resumo" }, "recurso": "/vendas/123" }
}
```

O `dados` leva o que o evento trouxe **mais um resumo legível** montado por `montarDados()`: para venda, o número, data, total, cliente, vendedor e situação; para compra, o fornecedor; para OS, o equipamento; para situação alterada, os nomes de origem e destino; para nota, modelo/série/número/chave/valor; para conta, descrição, valor e cliente. Vem também `recurso`, o caminho para buscar o registro completo na API (ex.: `/vendas/123`). Esse resumo é cortesia: se a consulta falhar, vai só o evento. Em venda, `excluida: true` indica que o registro já não existe.

Cabeçalhos enviados:

- `content-type: application/json`
- `user-agent: MEU-BLING-Webhook/1.0`
- `x-meubling-evento` — nome do evento
- `x-meubling-entrega` — número da entrega, use para **não processar duas vezes**
- `x-meubling-assinatura` — a assinatura (abaixo)

### Como é assinado
`x-meubling-assinatura: sha256=<HMAC-SHA256 do corpo exato, com o segredo do webhook>`.

O segredo é `whsec_` + 48 hex, gerado ao cadastrar o webhook e guardado **criptografado** no banco (`encrypt`/`decrypt` de `lib/crypto.ts`, chave derivada da variável de ambiente `APP_SECRET`). Diferente da chave de API, ele é recuperável: `GET /api-externa/webhooks/:id/segredo` mostra, e `POST .../segredo` gera outro (o antigo deixa de valer na hora — quem recebe precisa ser atualizado).

Para conferir do outro lado: calcular o HMAC-SHA256 do **corpo cru recebido** com o segredo, em hexadecimal, e comparar com o valor depois de `sha256=`.

### Política de reenvio
- **Sucesso** = resposta 2xx. A entrega vira `ENTREGUE` e `falhasSeguidas` do webhook volta a zero.
- **Tempo máximo de espera**: 10 segundos por tentativa; estourar conta como falha ("sem resposta em 10 s").
- **Até 5 tentativas no total**, com espera de **1 min, 5 min, 30 min e 2 h** entre elas. Esgotadas, a entrega fica `FALHOU`.
- A fila é processada em ordem por `processarFila()`, uma entrega de cada vez, chamada ao enfileirar e por um serviço a cada **30 segundos** (lotes de 20, até 20 voltas por rodada).
- Webhook desativado antes do envio: a entrega é marcada `FALHOU` com o aviso "Webhook desativado antes do envio".
- Cada envio atualiza no webhook o último envio, o último status e o contador de falhas seguidas. Religar o webhook por `PUT` zera esse contador.
- **Reenvio manual**: `POST /api-externa/entregas/:id/reenviar` volta a entrega para `PENDENTE`, zera as tentativas e processa a fila na hora — dá os 5 ciclos de novo.
- O histórico é visto em `GET /api-externa/webhooks/:id/entregas` (status, resposta do outro sistema, tentativas, conteúdo enviado). Entregas com mais de **30 dias** são apagadas por um serviço que roda a cada 6 horas.

### Recomendação para quem recebe
Responder 2xx rápido, conferir a assinatura antes de usar os dados e guardar o `x-meubling-entrega` já processado — como há reenvio automático, a mesma entrega pode chegar mais de uma vez.

---

## 7. Apêndice B — integrações de banco, WhatsApp e e-mail em detalhe

Levantado lendo os handlers e os clientes em `apps/api/src`. Nenhum segredo foi lido: só os
**nomes** das variáveis de ambiente e dos campos do banco onde cada credencial é guardada.

Observação geral: todo segredo guardado no banco passa por `encrypt()`/`decrypt()`
(`apps/api/src/lib/crypto.ts`), AES-256-GCM com chave derivada de `APP_SECRET`. As telas nunca
devolvem o segredo — usam `mask()`, que mostra só os 4 últimos caracteres.

---

## 1. Bling API v3 (OAuth2)

**Para que serve no MEU BLING**
É a migração de dados do ERP antigo. Traz do Bling contatos, produtos, saldo de estoque, vendas,
compras, contas a receber, contas a pagar e notas fiscais, além dos cadastros auxiliares
(depósitos, formas de pagamento, categorias de receita/despesa, vendedores, situações).
Arquivos: `integracoes/bling/routes.ts`, `integracoes/bling/cliente.ts`, `integracoes/bling/importador.ts`.

**Como autentica**
OAuth2 *authorization code* + *refresh token*, tudo guardado no banco (não em `.env`):
- `Empresa.blingClientId` — Client ID do aplicativo Bling (texto puro).
- `Empresa.blingClientSecret` — Client Secret (criptografado).
- `Empresa.blingAccessToken` / `Empresa.blingRefreshToken` — tokens (criptografados).
- `Empresa.blingTokenExpira` — vencimento do token.

Fluxo: `GET /bling/auth-url` monta a URL de autorização com um `state` aleatório guardado em
memória por 15 min → o lojista autoriza no Bling → `POST /bling/callback` troca o `code` por
tokens. A chamada de token usa `Authorization: Basic base64(clientId:clientSecret)` e
`Accept: 1.0`. `POST /bling/renovar-token` força o refresh; o cliente também renova sozinho
quando falta menos de 5 min para vencer, e repete a chamada após um 401.
`DELETE /bling/desconectar` apenas limpa os tokens no banco (não revoga no Bling).

Variável de ambiente envolvida: `APP_URL` — compõe o endereço de retorno
`APP_URL/configuracoes/bling/callback`, que precisa estar cadastrado no aplicativo Bling.

**Endpoints externos chamados**
- `https://www.bling.com.br/Api/v3/oauth/authorize` (URL de autorização, aberta pelo navegador)
- `https://www.bling.com.br/Api/v3/oauth/token` (POST — authorization_code e refresh_token)
- Base de dados: `https://api.bling.com.br/Api/v3` + os caminhos
  `/contatos`, `/produtos`, `/estoques/saldos`, `/depositos`, `/pedidos/vendas`,
  `/pedidos/compras`, `/nfe`, `/formas-pagamentos`, `/categorias/produtos`,
  `/categorias/receitas-despesas`, `/vendedores`, `/situacoes/modulos`.

**Cuidados vistos no código**
Limite próprio de 3 requisições por segundo, com espera; em HTTP 429 tenta até 6 vezes com
espera crescente. A paginação percorre `pagina=1..n` com `limite=100` até vir página vazia.
O log de cada importação é gravado em `STORAGE_DIR/importacao/bling-<data>.log`.

---

## 2. Pluggy / Open Finance

**Para que serve no MEU BLING**
Puxa saldo e extrato das contas bancárias da loja para dentro das contas financeiras, alimentando
a conciliação. Arquivos: `modules/bancos/routes.ts`, `modules/bancos/service.ts`,
`integracoes/openfinance/index.ts`, `integracoes/openfinance/pluggy.ts`, `integracoes/openfinance/mock.ts`.

**Como autentica**
Credenciais de aplicação guardadas no banco, na Empresa:
- `Empresa.openFinanceClientId` — Client ID do Pluggy (texto puro).
- `Empresa.openFinanceClientSecret` — Client Secret (criptografado).
- `Empresa.openFinanceAtivo` — liga ou desliga o provedor real.
- `Empresa.openFinanceProvedor` — nome do provedor (padrão `pluggy`).

Quem fala com o Pluggy é a biblioteca `pluggy-sdk` (`new PluggyClient({ clientId, clientSecret })`),
que cuida sozinha do token de API. Se `openFinanceAtivo` estiver desligado ou faltarem as
credenciais, o sistema cai num **provedor simulado (mock)** em vez de falhar — importante saber
ao testar. O vínculo de cada conta fica em `ContaFinanceira.openFinanceItemId`,
`openFinanceAccountId` e `openFinanceStatus`.

O frontend abre o widget Pluggy Connect com o token devolvido por
`POST /open-finance/connect-token`; o `itemId` resultante volta em `POST /open-finance/vincular`.

Variável de ambiente envolvida: `APP_URL` — compõe o `webhookUrl` registrado no connect token,
`APP_URL/api/v1/webhooks/pluggy`.

**Endpoints externos chamados** (pela `pluggy-sdk`, sobre a API do Pluggy em `https://api.pluggy.ai`)
- `createConnectToken` — token do widget, com `webhookUrl`, `clientUserId: "meu-bling"` e `avoidDuplicates`
- `fetchAccounts(itemId)` — contas de uma conexão
- `fetchAccount(accountId)` — saldo
- `fetchItem(itemId)` — situação da conexão
- `fetchTransactions(accountId, { from, to, page, pageSize: 500 })` — extrato, paginado
- `fetchConnectors({ countries: ['BR'] })` — bancos disponíveis

**Entrada de volta**
`POST /api/v1/webhooks/pluggy` é pública (fora do grupo C, mas é o par das rotas acima): recebe o
aviso do Pluggy e dispara a sincronização das contas daquele `itemId`; em evento de erro/login
falho marca `openFinanceStatus` como `ERRO: ...`. Não há verificação de assinatura do webhook no
código — só limite de 120 chamadas por minuto.

---

## 3. WhatsApp — Evolution API e Baileys

**Para que serve no MEU BLING**
É o canal de WhatsApp da loja: CRM dos vendedores, mensagens automáticas por situação, envio de
orçamentos e de documentos em PDF, e a cobrança do JARVIS. Arquivos:
`integracoes/whatsapp/routes.ts`, `provedor.ts`, `evolution.ts`, `servico.ts`.

Há **dois motores**, escolhidos em `provedor.ts`:

### 3a. Evolution API (padrão quando configurada) — "um QR Code só"
A sessão do WhatsApp fica num servidor Evolution próprio e todos os sistemas falam com ele por
HTTP, pelo mesmo número.

**Como autentica**
Configuração guardada no banco, na tabela `Configuracao`, chave `whatsapp.evolution`, em JSON:
- `url` — endereço do servidor Evolution.
- `instancia` — nome da instância.
- `apiKey` — chave da API (criptografada; viaja no cabeçalho `apikey` de cada chamada).
- `ligado` — se é a Evolution quem manda.

Não usa `.env`. A Evolution só é considerada ativa quando `ligado`, `url`, `instancia` e `apiKey`
estão todos preenchidos. Timeout por chamada, de 8 s (status) a 60 s (envio de documento).

**Endpoints externos chamados** (sempre `<url>` + caminho, cabeçalho `apikey`)
- `GET /instance/connectionState/<instancia>` — situação da conexão
- `GET /instance/connect/<instancia>` — pede o QR Code
- `POST /instance/create` — cria a instância (`integration: "WHATSAPP-BAILEYS"`, `qrcode: true`)
- `DELETE /instance/logout/<instancia>` — desconecta o aparelho
- `GET /instance/fetchInstances` — lista instâncias (também usado pelo botão "Testar")
- `POST /message/sendText/<instancia>` — envia texto
- `POST /message/sendMedia/<instancia>` — envia PDF em base64

### 3b. Baileys (sessão própria do sistema, usada quando a Evolution está desligada)
Biblioteca `@whiskeysockets/baileys` 7.x dentro da própria API: a sessão é pareada por QR Code e
os arquivos ficam em `STORAGE_DIR/whatsapp` (multi-file auth state), com as mensagens enviadas
em `STORAGE_DIR/whatsapp-enviadas.json`. Não há chave de API: a credencial **é** a pasta da
sessão, e `POST /whatsapp/desconectar` a apaga, exigindo novo QR Code.

**Para onde fala**
Direto nos servidores do WhatsApp (protocolo do WhatsApp Web, pela biblioteca) — não há endpoint
HTTP nosso a documentar. `GET /whatsapp/eventos` (SSE) e o robô de reconexão enxergam só este
motor; com a Evolution ligada a tela recarrega o estado sozinha.

Variáveis de ambiente envolvidas: `STORAGE_DIR` (pasta da sessão) e `WHATSAPP_LOG_LEVEL`
(verbosidade do log do Baileys, padrão `warn`).

---

## 4. Leitura dos e-mails de banco — IMAP e Gmail API

**Para que serve no MEU BLING**
O robô dos bancos lê as caixas de e-mail da loja, transforma aviso de banco em transação bancária
(fonte `EMAIL`) e, quando o casamento é exato, deixa a conciliação dar a baixa.
Arquivos: `modules/email-banco/routes.ts`, `modules/email-banco/service.ts`,
`modules/email-banco/parsers.ts`, `integracoes/email/leitor.ts`.

**Como autentica** — por caixa, na tabela `EmailBancoCaixa`:
- `tipo` — `IMAP` ou `GMAIL`.
- `host`, `porta` (padrão 993), `usuario`, `pasta` (padrão `INBOX`) — para IMAP.
- `segredo` — criptografado; é a **senha IMAP** quando `tipo=IMAP` e o **refresh token do Google**
  quando `tipo=GMAIL`.
- `endereco`, `ativo`, `ultimaLeituraEm`, `ultimoErro`.

No caminho Gmail, o refresh token da caixa é trocado por um access token usando as credenciais do
app OAuth do Google Cloud, que **vêm do ambiente**:
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

Sem essas duas variáveis a leitura de caixas Gmail falha com mensagem explícita.

Outras variáveis: `EMAIL_BANCO=off` desliga o worker que roda de 30 em 30 minutos
(`modules/email-banco/routes.ts`); `APP_SECRET` é a chave que decifra o `segredo` guardado.

**Endpoints externos chamados**
- IMAP: conexão TLS direta ao `host`:`porta` da caixa, via `imapflow`, em **modo somente leitura**
  (`getMailboxLock(..., { readOnly: true })`) — nada é marcado, movido ou apagado na caixa.
- Gmail: `POST https://oauth2.googleapis.com/token` (grant_type `refresh_token`),
  `GET https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=..&q=after:<epoch>` e
  `GET https://gmail.googleapis.com/gmail/v1/users/me/messages/<id>?format=full`.
  Só leitura, também.

**Travas de segurança no código** (vale registrar, porque é dinheiro)
1. Só remetente que está em `EmailBancoRegra` vira lançamento; o resto fica anotado como `SEM_REGRA`.
2. E-mail reprovado no DKIM/SPF (cabeçalho `Authentication-Results`) nunca vira lançamento —
   vira `REMETENTE_SUSPEITO`. É a proteção contra phishing imitando SumUp/Cora.
3. Baixa automática só no casamento 1:1 (pedido citado no aviso ou uma única conta aberta com o
   valor exato). Qualquer dúvida fica pendente na conciliação para uma pessoa decidir.
4. O `Message-ID` evita processar o mesmo aviso duas vezes, mesmo caindo em duas caixas.
5. A releitura volta 2 dias para trás da última leitura, porque e-mail às vezes atrasa.

Leitores de aviso disponíveis (campo `parser` da regra): `SUMUP_PIX`, `SUMUP_PAYOUT`, `CORA`,
`ASAAS`, `MERCADOPAGO`, `BOLETO_FORNECEDOR`.

---

## 8. O que o levantamento encontrou

### Está saudável

- **Documentação bate com o código.** Das 254 entradas do catálogo interno (`api-externa/recursos.ts`), **nenhuma** aponta para rota que não existe mais. O teste `testes/api-cobertura.ts` segura isso a cada PR: rota nova aberta para chave sem documentação reprova o build.
- **Toda rota aberta para chave está documentada.** 249 rotas abertas, 249 documentadas. Não há buraco entre o que a chave alcança e o que o OpenAPI mostra.
- **Permissão em duas camadas.** A política central (`politicas.ts`) e o `preHandler` de cada rota — uma falha na outra segura.
- **Erro com saída.** O padrão de devolver mensagem em português dizendo o que falta, com link para resolver, está aplicado nas rotas fiscais e de configuração.

### Pontos de atenção

1. **`POST /webhooks/pluggy` é público e não confere assinatura.** A rota aceita um `itemId` no corpo e dispara a sincronização bancária. A única proteção é o limite de 120 chamadas/minuto. Quem souber o formato pode forçar sincronizações. O Pluggy oferece assinatura no webhook — vale conferir, como já é feito nos webhooks de saída.
2. **Open Finance cai em modo simulado sem avisar.** Se `openFinanceAtivo` estiver desligado ou faltar credencial, `obterProvedor()` devolve o provedor falso: `connect-token` e `vincular` respondem "deu certo" sem tocar em banco nenhum. Confunde na hora de testar — melhor devolver erro explicando.
3. **As ferramentas genéricas do MCP alcançam qualquer rota liberada.** `consultar` / `gravar` / `excluir` são genéricas, então uma chave com nível `TOTAL` numa área permite `DELETE` arbitrário dentro dela por um agente de IA. Isso é o desenho pretendido, mas reforça: dar `TOTAL` é diferente de dar `GRAVACAO`.
4. **Chave sobrevive ao dono.** A chave age em nome do ADMIN que a criou; se esse usuário for desativado, cai para o ADMIN ativo mais antigo e a chave continua valendo. Desligar o funcionário não desliga a chave dele — isso precisa ser feito à mão.
5. **Cache de 30 s na conferência de chave.** Alteração feita direto no banco demora até 30 s para valer (pelo `PUT` é na hora, porque limpa o cache).
6. **`POST /bling/importar` mexe em dinheiro.** As opções `baixarNoCaixa` e `fecharEmAberto` lançam recebimentos no caixa e fecham vendas. É importação, não simulação.

### Sobre "abrir todas as APIs para chave"

As 194 rotas fechadas para chave **não são esquecimento** — há uma lista de bloqueio explícita em `recursos.ts`. O que está fechado hoje:

| Área | Rotas | Por quê |
|---|---|---|
| Login, usuários, senha | 9 | Quem tem chave não deve poder criar usuário nem trocar senha |
| As próprias chaves e webhooks | 17 | Chave que cria chave anula o controle de permissão |
| Certificado, SMTP, configurações, empresa | 9 | Segredos e configuração fiscal |
| Bling, Open Finance (vincular) | 12 | Conexões bancárias e de ERP |
| JARVIS | 29 | Gasta API paga, publica anúncio, fala com cliente |
| Chat da equipe | 28 | Conversas privadas e áudios dos funcionários |
| E-mails dos bancos | 14 | Leitura de caixa postal |
| Robôs, caixinhas, lembretes, meu-dashboard, avisos | 28 | Operacionais — candidatos naturais a abrir |

Abrir tudo de uma vez transformaria qualquer chave vazada em controle total da loja, incluindo ler as conversas privadas da equipe. A sugestão é abrir **por área**, começando pelas operacionais de baixo risco (caixinhas, lembretes, meu-dashboard, metas de técnico, leitura dos robôs) e tratar JARVIS, chat e e-mail de banco como decisão à parte.
