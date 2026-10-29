# Painel de auditoria (29/10/2026)

Endereço: **www.balao.info/sistema/auditoria** (menu Configurações → Painel de auditoria). Só o **ADMIN** entra, e ainda precisa da **senha do dia**.

## A senha do dia

O **prefixo combinado com o Thiago** + a data de hoje em **DDMMAAAA**, no fuso de São Paulo (ex.: prefixo `1234` em 30/10/2026 → `123430102026`). Depois da senha certa a aba fica liberada por 4 h (token próprio no cabeçalho `x-auditoria`, guardado só naquela aba do navegador). Cada tentativa, certa ou errada, fica registrada na própria trilha; 10 tentativas por minuto no máximo; três erradas no dia viram achado alto.

- O prefixo padrão está em `modules/auditoria/acesso.ts`; para trocar sem mexer no código: `Configuracao` chave `auditoria.prefixoSenha`, ou a variável `AUDITORIA_PREFIXO_SENHA` no `/etc/meu-bling.env`.
- Chave de API (outros sistemas, agentes MCP) **nunca** abre o painel, mesmo com permissão de "sistema". Gerente, vendedor, técnico e financeiro também não, nem com a senha.

## O que o painel mostra

| Aba | O que é |
|---|---|
| **Ao vivo** | Cada operação do sistema aparece em segundos (a tela pergunta a cada 3 s), agrupada por dia, com quem fez, categoria, o que gravou e o IP. Pausa; esconde os robôs por padrão. Clique abre a operação. |
| **Histórico** | Tudo desde que a trilha existe, com filtros: período completo, funcionário, categoria, origem (tela, API, agente MCP, site/PDV, robô, reversão), texto, só revertidas, e por registro (ex.: tudo o que mexeu na venda nº X). O botão **"Desde o 1º dia"** mostra a auditoria legível antiga (quem fez o quê desde 19/10/2026, antes da trilha com antes/depois). |
| **Funcionários** | Por pessoa, no período: operações, por categoria, registros criados/alterados/excluídos, fora do horário, revertidas, com erro, logins, achados dos agentes. "Ver tudo que fez" abre o histórico filtrado. |
| **Achados** | O que os agentes encontraram, por nível (alto/médio/baixo), agente e situação. Cada achado tem explicação, evidências com link, "ver operação" e "vida do registro"; marque como visto, resolvido ou ignorado (ignorado não volta). |
| **Agentes de IA** | Liga/desliga cada agente, "rodar agora", regras (horário da loja, desconto máximo, saída manual) e o **Analista (Claude)**. |

### A operação aberta
Quem, origem, categoria, HTTP devolvido, rota, IP, hora; as ações legíveis; e **cada registro gravado no banco, com o conteúdo antes e depois** (campo a campo nas alterações; registro inteiro nas criações e exclusões). Itens gravados dentro do pai aparecem como "dentro do pai"; o que o banco apagou em cascata (itens, parcelas, saldos) como "em cascata". Senhas, tokens e certificados aparecem como `***`.

## Reverter qualquer coisa

O botão **Reverter esta operação** desfaz tudo o que a operação gravou, na ordem inversa, numa transação só:
- o que foi criado é excluído (com o que depende dele em cascata);
- o que foi excluído volta exatamente como era (inclusive itens, parcelas, saldos);
- o que foi alterado recebe de volta **só os campos que a operação mudou**.

Antes de confirmar o painel mostra a prévia (cada passo) e avisa quando alguém mexeu nos mesmos registros depois (a reversão passa por cima). A reversão também vira uma operação na trilha (origem **Reversão**, ligada à original) e pode ser desfeita de novo (**Refazer**). O que não é revertido: numeração (Sequencia), gravações em massa resumidas (mais de 500 linhas) e qualquer operação que tenha tocado **nota fiscal já transmitida à SEFAZ** (cancele/corrija pela tela fiscal).

## Agentes de auditoria (rodam a cada 5 min, 24 h)

| Agente | Olha | Exemplos de achado |
|---|---|---|
| Vigia de exclusões e cancelamentos | 7 dias | venda/OS/compra/conta/lançamento/contato/produto excluídos (alto se ≥ R$ 1.000); venda cancelada já com pagamento (alto) ou criada e cancelada em 60 min (médio) |
| Detetive de preços e descontos | 7 dias | item abaixo do custo (alto); desconto acima do limite (médio/alto); valor mexido em venda já fechada (alto); preço do produto baixado e subido de novo (médio) |
| Guardião do caixa | 7 dias | saída manual de caixa/banco (alto a partir do valor configurado); valor de conta reduzido; estorno; saldo inicial ajustado; entrada e saída iguais em 30 min |
| Fiscal de estoque | 7 dias | ajuste manual grande ou muitos no dia; saldo negativo; produto excluído com estoque (alto) |
| Sentinela de horários e acessos | 7 dias | gravações fora do horário da loja ou no domingo; muitos logins/IPs no dia; senha errada no painel 3× (alto); perfil/senha de usuário alterados (alto se o próprio) |
| Auditor de comissões e metas | 7 dias | venda transferida de vendedor (alto se para si mesmo); comissão mexida por quem recebe (alto); metas/percentuais alterados |
| Caçador de inconsistências | 7 dias (vendas: 30) | operação que gravou e terminou em erro 5xx; total da venda ≠ itens; venda duplicada; conta recebida sem lançamento; registro alterado 8+ vezes |
| Analista de padrões da equipe | 30 dias | cada funcionário × média da equipe (cancelamentos, exclusões, descontos, fora do horário, ajustes, saídas manuais): z ≥ 2 ou 2,5× a média |

Achados "de estado" (saldo negativo, total diferente, duplicada, recebida sem caixa, padrões) resolvem sozinhos quando a situação muda. Regras em Configuração `auditoria.config`: `horaInicio` (7), `horaFim` (22), `descontoMaxPct` (15), `saidaManualAlerta` (500), `modeloIa`, `desligados`. `AGENTES_AUDITORIA=off` desliga o serviço.

### Analista (Claude) — opcional
Com a chave da API da Anthropic (Painel → Agentes → Analista; fica criptografada em `Configuracao` `auditoria.analista.chave`, ou `ANTHROPIC_API_KEY`), uma vez por dia às 06:30 e quando o ADMIN pede, a IA recebe o resumo das últimas 24 h (operações por pessoa e categoria, movimentos ≥ R$ 500 e exclusões, achados abertos, últimas operações) e devolve resumo, pontos (viram achados do agente `analista`) e perguntas para investigar. Vai só o resumo — nunca senhas, documentos ou dados de clientes.

## Como funciona por dentro (para quem mexe no código)

- **Trilha** (`apps/api/src/modules/auditoria/trilha.ts`): extensão do Prisma aplicada em `lib/prisma.ts`. Toda gravação (`create`, `update`, `upsert`, `delete`, `createMany`, `updateMany`, `deleteMany`) lê o registro antes, deixa a gravação acontecer e grava `AuditoriaEvento` (antes/depois/campos) na **mesma transação**. Cobre itens aninhados (compara os filhos antes e depois), cascata (`onDelete: Cascade`) e vínculos zerados (`SetNull`). Nenhum módulo precisa chamar nada. Fora da trilha: `Auditoria`, `LogApi`, `EntregaWebhook` e as tabelas do painel. Carimbos (`atualizadoEm`, `ultimoLogin`, `siteSincronizadoEm`…) sozinhos não geram evento. `TRILHA_AUDITORIA=off` desliga (só para diagnóstico).
- **Contexto** (`contexto.ts`): `AsyncLocalStorage`. O `app.ts` abre um contexto por requisição (antes do `authPlugin`, lendo o usuário na hora da gravação); `core/servicos.ts` abre um por serviço de fundo (rajadas com mais de 3 s de intervalo viram operações separadas); os robôs agendados por evento (`robo-saude`, `robo-nf`) rodam no contexto deles; a reversão abre o contexto `REVERSAO`.
- **Operações** (`operacoes.ts`): cabeçalho `AuditoriaOperacao` (quem, origem, rota, IP, HTTP, categoria), fechado no `onResponse` com a descrição legível (ações da `Auditoria` ligadas pela coluna nova `operacaoId` + resumo dos registros).
- **Reversão** (`reversao.ts`): prévia (bloqueios, avisos, passos) e execução em `$transaction` com contexto `REVERSAO`.
- **Acesso** (`acesso.ts`): senha do dia e token do painel (HMAC do `APP_SECRET`, 4 h). Rotas em `routes.ts` (`/api/v1/auditoria/painel/*`), políticas em `plugins/politicas.ts` (só ADMIN) e `api-externa/recursos.ts` (bloqueadas para chave).
- **Agentes** (`agentes.ts`) e **analista** (`analista.ts`).
- **Tela**: `apps/web/src/pages/auditoria/` (`PainelAuditoria.tsx` cofre + KPIs + abas; `abas.tsx`; `partes.tsx` gaveta da operação com antes/depois e reversão; `apiPainel.ts`).
- **Teste**: `apps/api/testes/auditoria.ts` (70 verificações), na suíte `npm test`.
