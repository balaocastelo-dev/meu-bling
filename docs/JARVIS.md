# JARVIS — agente do gestor para chegar a R$ 1.000.000 livres no caixa

Especificação completa decidida com o Thiago em 29/10/2026. Este documento é o briefing para quem for
implementar (Claude Code ou outro agente): segue as convenções do projeto (`docs/DEV.md`), o padrão do
robô da Saúde (`docs/ROBO-SAUDE.md`) e o Meu Dashboard por perfil (`docs/MEU-DASHBOARD.md`).

**Comando sugerido no Claude Code (dentro de `C:\meu-bling`, depois de `git pull`):**
> Implemente `docs/JARVIS.md`, etapa 1. Siga as convenções de `docs/DEV.md`, escreva os testes em
> `apps/api/testes`, rode `npm test`, faça o merge na `main` e publique com `scripts\deploy-vps.ps1`.
> Ao terminar, continue com a etapa 2 sem perguntar.

---

## 1. Objetivo

Colocar **R$ 1.000.000,00 livres no caixa** da loja. O JARVIS é um módulo do MEU BLING, só para o perfil
**ADMIN**, que:

1. mostra o caixa livre de hoje, a distância para R$ 1 milhão, o ritmo diário necessário e a evolução;
2. gera **sugestões ao vivo** (a cada 30 min) a partir dos dados do próprio sistema, cada uma com valor
   estimado e botões Aceitar / Adiar / Recusar;
3. espalha as sugestões nos dashboards de cada perfil (vendedor, técnico, gerente, gestor) no que cabe a cada um;
4. responde perguntas do gestor ("o que faço com R$ 20 mil que entraram hoje?") cruzando os dados reais;
5. avalia **produtos usados** que chegam na loja (preço máximo de compra e preço de venda) pesquisando o
   Mercado Livre;
6. tem o botão **Anunciar** (Central de Anúncios), que monta o anúncio com IA e publica no Mercado Livre
   pela API oficial, no site, no blog e nas redes (ver seção 9).

Princípios que não mudam:

- O JARVIS **sugere e mede**; a decisão de onde colocar o dinheiro é do Thiago. Nada que mova dinheiro de
  verdade (pagar, transferir, comprar) acontece sem alguém apertar o botão.
- Ele roda **na VPS, 24h**, dentro do container do MEU BLING — não depende de nenhum chat aberto.
- Tudo em português, no mesmo padrão visual do sistema (estilo Power BI / V18, filtro "Hoje" por padrão,
  alinhado em computador, tablet e celular, custos com `****` + olhinho).

---

## 2. Decisões do Thiago (29/10/2026)

| Tema | Decisão |
|---|---|
| Caixa livre | A fórmula da seção 3 foi aprovada ("SIM") |
| IA | Usar a API da Anthropic na VPS com o modelo mais atual: **`claude-fable-5-1`** |
| Usado | Não existe "margem fixa"; valem as regras de compra da seção 4 (30% / 50% / 75% do valor) |
| Referência de preço | O **Mercado Livre** é a referência de mercado |
| Mercado Livre | O sistema se conecta à conta do Thiago via API (OAuth) e tem o botão **Anunciar no Mercado Livre**: a IA monta o anúncio inteiro do jeito que achar melhor para vender; a loja cuida de logística e entrega |
| Anunciar | O mesmo botão deve publicar também em OLX, Facebook, Instagram, Google Meu Negócio, site próprio e blog do sistema (ver limites na seção 9) |
| Operação | Sempre fazer merge, sempre publicar na VPS, deixar tudo pronto; monitoramento recorrente para o sistema nunca parar de evoluir |

---

## 3. Caixa livre (aprovado)

```
caixa_livre = saldo de todos os bancos + caixa físico
            − contas a pagar vencidas e a vencer nos próximos 30 dias
            − saldo das caixinhas comprometidas (valor-alvo ainda não usado)
            − saldo devedor dos empréstimos (Lumicred: principal + 6%)
```

- Bancos da loja: Cora (PIX/boleto), Asaas (boleto), SumUp Loja, SumUp Assistência; a conta padrão é o banco,
  não o caixa físico. Reusar o cálculo de saldo que o Dashboard já faz (`modules/dashboard`, `modules/bancos`).
- Gravar uma foto do número a cada rodada do worker em `JarvisMetrica` (data/hora, caixa livre, cada parcela
  da fórmula) para o gráfico de evolução.
- Painel mostra: caixa livre de hoje · meta R$ 1.000.000 · falta · ritmo necessário por dia útil para uma
  data-alvo configurável (padrão: 365 dias) · variação vs ontem / 7 dias / 30 dias.

---

## 4. Regras de precificação de usado (do Thiago)

Referência = **preço do produto NOVO no Mercado Livre** (mediana dos anúncios novos, descartando os 10% mais
baratos e mais caros).

| Situação | Preço máximo de compra (sobre o valor de novo) |
|---|---|
| Usado em condição regular | **30%** |
| Usado em boas condições | **50%** |
| Lacrado com nota fiscal | **75%** |

- Cliente paga, em média, **30% a menos** em um usado de boas condições do que no novo → preço de venda
  sugerido = **70% do novo** (ajustável na tela).
- **Compra de balcão à vista**: a loja paga em média **50% dos 70%** (= 35% do valor de novo) e vende pelo
  melhor preço possível.
- **Consignado**: consignante fica com 80% e a loja com **20%** (regras completas em `docs/CONSIGNACAO.md`).
- O avaliador mostra: preço de novo (com os anúncios usados como base), preço máximo de compra por condição,
  preço de venda sugerido, lucro estimado e giro esperado (quantos anúncios usados parecidos existem e a
  faixa de preço deles). Tudo editável antes de gravar no pedido de compra.

---

## 5. Arquitetura

### 5.1 Módulo da API — `apps/api/src/modules/jarvis/`

Seguir o layout dos outros módulos (rotas + serviço + worker), como `modules/robo-saude`.

```
jarvis/
  rotas.ts          GET /jarvis/painel · GET/POST /jarvis/sugestoes · POST /jarvis/sugestoes/:id/(aceitar|adiar|recusar)
                    POST /jarvis/perguntar · GET /jarvis/placar · GET/PUT /jarvis/config (só ADMIN)
                    GET /jarvis/feed?perfil=  (usado pelos Meu Dashboards; filtra pelo perfil do usuário logado)
                    POST /jarvis/avaliar-usado · rotas do Mercado Livre (seção 8) · rotas da Central (seção 9)
  caixa-livre.ts    cálculo da fórmula da seção 3 (reaproveita dashboard/bancos/financeiro/caixinhas/emprestimos)
  regras.ts         catálogo de regras que geram sugestões (seção 6)
  ia.ts             cliente da API da Anthropic (seção 7)
  worker.ts         roda 1 min após subir e a cada 30 min (mesmo padrão do catálogo do site / robô da Saúde)
  avaliador.ts      avaliador de usado (seção 4) usando mercadolivre.ts
  mercadolivre.ts   OAuth + API do Mercado Livre (seção 8)
  anuncios.ts       Central de Anúncios (seção 9)
```

Registrar em `app.ts` com o prefixo `/api/v1/jarvis`; iniciar o worker em `server.ts` junto dos outros robôs
(`JARVIS_LIGADO=0` desliga, igual a `SITE_SINCRONIZAR=0`).

### 5.2 Banco (Prisma, SQLite) — novos modelos

```prisma
model JarvisMetrica {        // uma linha por rodada do worker
  id            String   @id @default(cuid())
  em            DateTime @default(now())
  caixaLivre    Decimal
  saldoBancos   Decimal
  saldoCaixa    Decimal
  aPagar30d     Decimal
  caixinhas     Decimal
  emprestimos   Decimal
  detalhes      Json?    // o que entrou em cada parcela
}

model JarvisSugestao {
  id            String   @id @default(cuid())
  criadaEm      DateTime @default(now())
  regra         String   // ex.: ESTOQUE_PARADO, CREDIARIO_VENCIDO, CONSIGNADO_PRAZO, LUMICRED_CUSTO, CAIXINHA_ATRASADA,
                         //      TAXA_CARTAO, OS_SEM_CUSTO, PRECO_FORA_MERCADO, OPORTUNIDADE_COMPRA, PERGUNTA_IA
  perfis        String   // para quem aparece: "ADMIN" | "ADMIN,GERENTE" | "VENDEDOR" | "TECNICO"...
  titulo        String
  texto         String   // instrução em português (gerada pela IA a partir dos números da regra)
  impactoEstimado Decimal? // R$ que libera/ganha se aceita
  prioridade    Int      @default(3)  // 1 = urgente ... 5 = baixa
  dados         Json?    // ids e números usados (produtos, contas, contratos) — alimenta a ação de 1 clique
  acao          String?  // ação executável: DESCONTO_LOTE, COBRAR_WHATSAPP, CRIAR_CAIXINHA, ABRIR_TELA, NENHUMA
  situacao      String   @default("ABERTA") // ABERTA | ACEITA | ADIADA | RECUSADA | CONCLUIDA | EXPIRADA
  adiadaAte     DateTime?
  decididaEm    DateTime?
  decididaPorId String?
  resultadoReal Decimal? // medido depois (placar)
  medidaEm      DateTime?
  chave         String   @unique // regra + alvo (ex.: "ESTOQUE_PARADO:produto:123") — evita duplicar enquanto ABERTA/ADIADA
}

model JarvisConversa {        // modo pergunta
  id         String   @id @default(cuid())
  em         DateTime @default(now())
  usuarioId  String
  pergunta   String
  resposta   String
  contexto   Json?    // números que a IA recebeu
}

model JarvisConfig {          // uma linha só (id = "unica")
  id                 String  @id @default("unica")
  metaCaixa          Decimal @default(1000000)
  dataAlvo           DateTime?
  modeloIa           String  @default("claude-fable-5-1")
  chaveAnthropic     String? // criptografada com APP_SECRET (mesmo helper dos segredos de SMTP/Pluggy)
  mlClientId         String?
  mlClientSecret     String? // criptografado
  mlAccessToken      String? // criptografado
  mlRefreshToken     String? // criptografado
  mlExpiraEm         DateTime?
  mlUserId           String?
  percVendaUsado     Int     @default(70)   // cliente paga 30% a menos
  percCompraRegular  Int     @default(30)
  percCompraBom      Int     @default(50)
  percCompraLacrado  Int     @default(75)
  diasEstoqueParado  Int     @default(45)
  canais             Json?   // configuração dos canais da Central (Meta, Google, site/blog, OLX)
}

model JarvisAnuncio {         // Central de Anúncios
  id          String   @id @default(cuid())
  criadoEm    DateTime @default(now())
  produtoId   String
  titulo      String
  descricao   String
  preco       Decimal
  condicao    String   // novo | usado
  fotos       Json     // urls
  canais      Json     // [{canal:"MERCADO_LIVRE", situacao:"PUBLICADO", idExterno:"MLB...", url:"...", erro:null}, {canal:"OLX", situacao:"KIT_PRONTO"}, ...]
  geradoPorIa Boolean  @default(true)
}
```

Segredos sempre pelo helper de criptografia já existente (AES-256-GCM com `APP_SECRET`) — ver como SMTP e
Pluggy são gravados em `modules/empresa` / Configurações.

### 5.3 Worker (a cada 30 min)

1. Calcula o caixa livre e grava `JarvisMetrica`.
2. Roda todas as regras (seção 6); para cada alvo encontrado cria/atualiza uma `JarvisSugestao` (pela `chave`),
   sem duplicar enquanto houver uma ABERTA ou ADIADA para o mesmo alvo.
3. Chama a IA **uma vez por rodada** com o resumo (números + sugestões novas) para escrever os textos em
   português e ordenar por prioridade. Sem chave configurada, usa os textos padrão de cada regra (o JARVIS
   funciona mesmo sem IA, só menos "JARVIS").
4. Expira sugestões cujo alvo já se resolveu sozinho (ex.: o produto vendeu) e mede o resultado real das aceitas
   (ex.: quanto entrou daquele lote com desconto) → `resultadoReal`.
5. Uma vez por dia (primeira rodada depois das 06:00): varre o estoque contra o Mercado Livre
   (`PRECO_FORA_MERCADO`) e grava um aviso no painel se a chave da IA ou o token do ML estiverem vencidos.

Registrar cada rodada no mesmo lugar que os outros robôs registram (log + Saúde do sistema).

---

## 6. Catálogo de regras (sugestões)

Cada regra devolve alvos com números; a IA só escreve o texto. Impacto estimado em R$ sempre que possível.

| Regra | Perfis | O que olha | Ação de 1 clique |
|---|---|---|---|
| `ESTOQUE_PARADO` | ADMIN, GERENTE, VENDEDOR | produtos com estoque e sem venda há N dias (`diasEstoqueParado`), valor imobilizado = estoque × custo | `DESCONTO_LOTE` (aplica % de desconto nos itens) + cria desafio para vendedores |
| `CREDIARIO_VENCIDO` | ADMIN, GERENTE | contas a receber vencidas (carnê/crediário), total e dias | `COBRAR_WHATSAPP` (manda o template de cobrança já existente) |
| `CONSIGNADO_PRAZO` | ADMIN, GERENTE | consignados a 2 dias ou menos do 10º dia (começam as diárias de 5%) e os que já pagam diária | `ABRIR_TELA` do contrato; sugere desconto de 5% ao consignante (regra da consignação) |
| `LUMICRED_CUSTO` | ADMIN | empréstimos ativos: custo de 6%/mês vs caixa livre disponível; se o caixa livre cobre com folga, sugerir quitar antes | `ABRIR_TELA` do empréstimo |
| `CAIXINHA_ATRASADA` | ADMIN, GERENTE | caixinhas cujo ritmo diário não está sendo cumprido | `ABRIR_TELA` da caixinha; valor sugerido para guardar hoje |
| `TAXA_CARTAO` | ADMIN | vendas do mês por parcela × taxa (1x = 5% … 12x = 12%); quanto se perdeu; sugere incentivar PIX/1x | nenhuma |
| `OS_SEM_CUSTO` / `OS_SEM_TECNICO` | TECNICO, GERENTE | OS sem custo de peça/mão de obra (já cuidado pela Saúde — aqui só com o valor em jogo) | `ABRIR_TELA` da OS ("corrija") |
| `MARGEM_BAIXA` | ADMIN | categorias com margem real (DRE) abaixo da média da loja | nenhuma |
| `PRECO_FORA_MERCADO` | ADMIN, GERENTE | produto com preço > mediana do ML em mais de 15% (não vende) ou < custo + margem mínima (deixa dinheiro na mesa) | `ABRIR_TELA` do produto com o preço sugerido |
| `OPORTUNIDADE_COMPRA` | ADMIN | itens que mais giram (vendas 30 dias) e estão com estoque abaixo de 7 dias de venda; sugere repor com o caixa livre | `ABRIR_TELA` do pedido de compra |
| `MAPA_MILHAO` | ADMIN | gerada 1x por dia: as 3 alavancas com maior impacto hoje (margem, giro, assistência, consignação, custo financeiro) | nenhuma |

Aceitar executa a ação, muda a situação para ACEITA e agenda a medição; Adiar pede uma data; Recusar guarda o
motivo (opcional) para a IA não insistir na mesma coisa.

---

## 7. IA — API da Anthropic

- Pacote Node oficial: `@anthropic-ai/sdk`. Endpoint `POST https://api.anthropic.com/v1/messages`, cabeçalhos
  `x-api-key` e `anthropic-version: 2023-06-01`. Modelo: **`claude-fable-5-1`** (campo `modeloIa`, trocável na
  tela). Se a API devolver que o modelo não existe, listar os modelos disponíveis (`GET /v1/models`) e mostrar o
  erro na tela de configuração em vez de quebrar o worker.
- A chave é digitada **pelo ADMIN** em Configurações → JARVIS (campo com `****` e botão "Testar") e fica
  criptografada no banco. Nunca em arquivo, nunca no código, nunca no log.
- Três usos: (a) escrever/ordenar as sugestões da rodada; (b) modo pergunta do painel (com os números da
  rodada atual + caixa livre + últimas 30 sugestões como contexto; a resposta deve citar os números e terminar
  com até 3 ações); (c) montar anúncios na Central (título, descrição por canal, categoria, preço).
- Cuidados: limite de ~1 chamada por rodada + perguntas; `max_tokens` moderado; guardar custo estimado
  (tokens) em `JarvisConversa.contexto` para o Thiago acompanhar o gasto.

---

## 8. Mercado Livre (API oficial)

1. **Aplicação**: o Thiago cria uma aplicação em https://developers.mercadolivre.com.br (Minhas aplicações),
   com redirect URI `https://www.balao.info/sistema/api/v1/jarvis/ml/callback`, e cola **Client ID** e
   **Client Secret** em Configurações → JARVIS → Mercado Livre. A tela mostra o passo a passo e um botão
   **Conectar minha conta** (abre `https://auth.mercadolivre.com.br/authorization?response_type=code&client_id=…&redirect_uri=…`).
2. **Callback** troca o `code` por `access_token` + `refresh_token` (`POST https://api.mercadolibre.com/oauth/token`),
   grava criptografado e renova sozinho antes de vencer (o access token dura 6 h; o refresh é de uso único —
   gravar o novo a cada renovação).
3. **Pesquisa de preço** (avaliador e `PRECO_FORA_MERCADO`): `GET https://api.mercadolibre.com/sites/MLB/search?q=…&condition=new`
   e `condition=used` (desde 2024 a busca exige o token da aplicação; usar o token da conta conectada). Guardar
   cache de 24 h por termo para não estourar o limite da API.
4. **Anunciar no Mercado Livre** (botão no produto e na Central):
   - categoria: `GET /sites/MLB/domain_discovery/search?q=<título>` → `category_id`; atributos obrigatórios da
     categoria: `GET /categories/{id}/attributes` (a IA preenche marca, modelo etc. a partir do nome/descrição);
   - item: `POST /items` com `title` (≤ 60 caracteres), `category_id`, `price`, `currency_id: BRL`,
     `available_quantity`, `buying_mode: buy_it_now`, `condition: new|used`, `listing_type_id` (padrão
     `gold_special`; configurável), `pictures` (urls das fotos do produto — `imagemUrl` do site), `attributes`,
     `shipping` (me2 quando disponível; senão retirada na loja) e `sale_terms` (garantia: 1 ano novo / 3 meses
     seminovo);
   - descrição: `POST /items/{id}/description` (texto puro, sem HTML);
   - gravar `JarvisAnuncio` + canal MERCADO_LIVRE com `idExterno` e `permalink`; erro da API vai para a tela
     com o que falta (mesma filosofia do sistema: dizer exatamente o que falta e como resolver).
5. Testes: mock do `fetch` para OAuth, busca e criação de item (`apps/api/testes/jarvis-mercadolivre.ts`).

---

## 9. Central de Anúncios (botão Anunciar)

Um anúncio é montado uma vez pela IA (seção 7c) e publicado por canal. Cada canal mostra a situação:
**Publicado** (com link) · **Pendente** · **Kit pronto** (precisa de uma pessoa) · **Precisa configurar**.

| Canal | Como | Situação |
|---|---|---|
| Mercado Livre | API oficial (seção 8) | automático |
| Site próprio (www.balao.info) | endpoint novo no `balao2026` (`/api/sistema/anuncios`, autenticado com a mesma `MEU_BLING_CHAVE`) que cria/destaca a oferta e, para consignados, a página da seção "Consignados" | automático (precisa criar o endpoint no site — ver `docs/SITE-E-PDV.md`) |
| Blog do sistema | mesmo endpoint do site com `tipo: "post"` (o blog já publica sozinho e só com imagem — usar a foto do produto) | automático |
| Facebook (Página) | Graph API: `POST /{page-id}/photos` ou `/feed` com token da Página | automático depois de conectar o app da Meta (app id/secret + login na tela de config) |
| Instagram (conta comercial) | Graph API de publicação: `POST /{ig-user-id}/media` (imagem + legenda) → `POST /{ig-user-id}/media_publish` | automático depois de conectar (a conta do Instagram precisa ser comercial e ligada à Página) |
| Google Meu Negócio | Business Profile API (`localPosts`) — o Google exige aprovação do projeto para usar a API | **Kit pronto** até a aprovação; botão abre o painel do Google com o texto copiado |
| OLX | Não há API pública (só OLX Pro, conta profissional com contrato). Automatizar o site logado por navegador viola os termos e pode derrubar a conta — **não fazer** | **Kit pronto**: título, descrição, preço e fotos num clique + link para a página de publicação |

Kit pronto = tela com os campos já preenchidos, botão "Copiar tudo", fotos para baixar e o link do canal; uma
pessoa publica em um minuto e marca "Publiquei" (grava a URL).

O "Anunciar" também cria um lembrete no Meu Dashboard do vendedor: "anúncio publicado — responder perguntas".

---

## 10. Interface (apps/web)

- Rota `/jarvis` (menu lateral, só ADMIN; ícone de robô). Topo: 4 cartões — Caixa livre hoje · Falta para
  R$ 1 mi · Ritmo/dia · Sugestões abertas (R$ em jogo). Gráfico de linha da evolução (filtros de data do
  sistema). Mapa do milhão: 5 alavancas com barra de progresso semanal. Feed de sugestões (cartões com
  prioridade, impacto, botões). Modo pergunta (caixa de texto + histórico). Placar: sugestões aceitas,
  R$ estimado × R$ medido, acerto do JARVIS.
- Meu Dashboard de cada perfil ganha o bloco **"Sugestões do JARVIS"** (só as do perfil; vendedor e técnico
  nunca veem lucro nem caixa).
- Configurações → **JARVIS** (só ADMIN): meta, data-alvo, modelo e chave da IA (com Testar), percentuais do
  usado, dias de estoque parado, Mercado Livre (Client ID/Secret, Conectar, situação do token), Meta
  (Facebook/Instagram), Google, site/blog, OLX.
- Pedido de compra: botão **Avaliar usado** ao lado do produto (abre o avaliador com os números e preenche custo
  e preço sugeridos ao confirmar).
- Produto / venda: botão **Anunciar** (abre a Central com o anúncio já montado pela IA).
- Estilo V18/Power BI como o resto; filtro "Hoje" por padrão; tudo alinhado em celular.

---

## 11. Etapas (fazer nesta ordem, cada etapa vai para o ar)

1. **Núcleo**: modelos Prisma, caixa livre, worker, regras `ESTOQUE_PARADO`, `CREDIARIO_VENCIDO`,
   `CONSIGNADO_PRAZO`, `LUMICRED_CUSTO`, `CAIXINHA_ATRASADA`, `MAPA_MILHAO`; IA com chave na tela; painel
   `/jarvis`; bloco nos Meu Dashboards; modo pergunta; placar; tela de configuração; testes.
2. **Mercado Livre**: OAuth, pesquisa de preço, avaliador de usado no pedido de compra, botão Anunciar no
   Mercado Livre, regra `PRECO_FORA_MERCADO` e `OPORTUNIDADE_COMPRA`.
3. **Central de Anúncios**: site/blog (endpoint no `balao2026`), Facebook/Instagram (Graph API), Google e OLX
   (kit), tela da Central, lembrete ao vendedor.
4. **Evolução contínua**: monitoramento recorrente (Saúde + logs do worker + custo da IA), regras novas
   conforme o placar mostrar o que funciona, e o relatório semanal "Caminho do milhão" no painel.

Cada etapa: branch → testes (`npm test`) → merge na `main` (autorizado) → `scripts\deploy-vps.ps1` →
conferir `https://www.balao.info/sistema/jarvis` → atualizar este documento e `docs/ROADMAP.md`.

---

## 12. Deploy e monitoramento

- Publicação: `scripts\deploy-vps.ps1` no PC da loja (chave SSH já autorizada em `root@179.199.148.87`); o
  instalador reconstrói a imagem e troca o container (`docs/ONLINE.md`). A VPS não aceita SSH de fora da loja.
- Para o deploy acontecer sem o PC: criar o workflow `.github/workflows/deploy-vps.yml` (push na `main` →
  `git archive | ssh root@VPS tar -x -C /opt/meu-bling` → `bash deploy/vps/instalar-vps.sh`) com uma chave SSH
  própria gravada como segredo `VPS_SSH_KEY` no GitHub e autorizada na VPS. Fazer isso na etapa 1 — a partir
  daí todo merge publica sozinho.
- Monitoramento: o worker do JARVIS registra cada rodada na Saúde; a Saúde já avisa no dashboard ADM. Um
  agendamento (Claude Code no PC via Agendador de Tarefas, ou tarefa agendada do claude.ai) revisa de hora em
  hora: Saúde 100%?, worker rodou?, deploy da `main` no ar?, próxima etapa deste documento.

---

## 13. O que não fazer

- Não automatizar OLX, Facebook Marketplace ou qualquer site logado por navegador: viola os termos e arrisca a
  conta da loja. Só APIs oficiais; o resto vira kit.
- Não mover dinheiro, pagar conta, quitar empréstimo ou comprar nada sozinho. O JARVIS só sugere.
- Não gravar chave da Anthropic, Client Secret ou tokens fora do banco criptografado; não imprimir no log.
- Não bloquear as vendas: o worker roda em segundo plano, em lotes, e qualquer erro dele fica na Saúde, nunca
  na tela do vendedor.
