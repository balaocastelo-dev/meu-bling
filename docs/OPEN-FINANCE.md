# Open Finance (Pluggy) — como configurar

O MEU BLING usa a **Pluggy** (pluggy.ai) para ler saldo e extrato das contas bancárias da loja direto do banco (Open Finance Brasil). Com isso a tela **Financeiro → Bancos & conciliação** mostra o saldo real, puxa as transações e sugere a conciliação com as contas a receber/pagar. Sem Pluggy, a importação de OFX continua funcionando.

Tudo o que o sistema precisa são duas chaves: **Client ID** e **Client Secret** de uma aplicação criada no dashboard da Pluggy. Elas são gravadas criptografadas em Configurações → Open Finance.

## Qual caminho escolher

| | Meu Pluggy (gratuito) | Plano pago da Pluggy |
|---|---|---|
| Para quem | Só as contas da própria empresa (caso do Balão) | Produto que conecta contas de terceiros, ou precisa de atualização mais frequente |
| Custo | R$ 0 — o Meu Pluggy é um app gratuito da própria Pluggy | Sob consulta (pluggy.ai/pricing) |
| Como conecta | Você conecta o banco em meu.pluggy.ai e autoriza a sua aplicação a ler esses dados | O botão "Conectar banco" abre o login do banco direto |
| Atualização | 1x por dia (a conexão é mantida pelo Meu Pluggy) + sincronização do ERP a cada 30 min | Conforme o plano (horas) |
| Pegadinha | Fazer tudo nos **15 dias de teste** do dashboard; depois a lista de conectores da aplicação não pode mais ser alterada (a conexão continua funcionando) | — |

Recomendação: comece pelo Meu Pluggy. Se mais tarde precisar de dados de hora em hora, contrate o plano e só troque as chaves — nada muda no sistema.

## Passo a passo — Meu Pluggy (gratuito)

1. **Conectar o banco no Meu Pluggy**
   Entre em https://meu.pluggy.ai, crie a conta (pode ser com o e-mail da loja), clique em conectar, escolha o banco e conclua a autorização Open Finance no app do banco. Use o **CNPJ** da loja quando o banco perguntar (conta PJ). Repita para cada banco.
2. **Criar a conta de desenvolvedor**
   Entre em https://dashboard.pluggy.ai (começa um teste de 15 dias). Em **Connectors / Customize** da aplicação, inclua o conector **MeuPluggy** na lista de conectores.
3. **Criar a aplicação e copiar as chaves**
   Em **Applications → New application**, escolha o tipo **Development**. Copie o `CLIENT_ID` e o `CLIENT_SECRET`.
4. **Gravar no MEU BLING**
   Configurações → Open Finance: cole Client ID e Client Secret, ligue **Ativo**, Salvar.
5. **Vincular as contas** — dois jeitos, escolha um:
   - **Pelo sistema:** Financeiro → Bancos → **Conectar banco (Open Finance)**. O widget da Pluggy abre; escolha **MeuPluggy**, autorize, e as contas aparecem vinculadas.
   - **Pelo app Demo da Pluggy:** no dashboard clique em **Ir para Demo**, conecte usando **MeuPluggy** (uma vez por banco), depois menu **⋮ → Copiar Item ID**. No MEU BLING, Financeiro → Bancos → card **Vincular pelo Item ID**, cole e clique em Vincular. Esse caminho serve também para recuperar um vínculo que caiu.
6. **Conferir**
   O card da conta mostra "Saldo no banco" com data/hora; clique em **Sincronizar** para trazer as transações dos últimos 90 dias e vá à aba **Conciliação**.

## Passo a passo — plano pago

Igual ao anterior, pulando o Meu Pluggy: crie a aplicação (de produção) no dashboard, cole as chaves no sistema e use **Conectar banco** — o widget mostra os bancos diretamente. Para NFC-e/Pix com baixa automática (roadmap) é esse o caminho.

## Webhook (opcional)

Para sincronizar assim que o banco atualizar (em vez de esperar os 30 min), cadastre no dashboard da Pluggy a URL de webhook que a tela de configuração mostra. Na VPS ela é:

```
https://www.balao.info/sistema/api/v1/webhooks/pluggy
```

O MEU BLING já envia essa URL ao gerar o token de conexão, então o cadastro manual só é necessário para itens criados fora do sistema (app Demo).

## Como funciona por dentro

- `apps/api/src/integracoes/openfinance/pluggy.ts` — `pluggy-sdk`: connect token, contas do item, saldo, transações (paginadas, até 500/página).
- `apps/api/src/modules/bancos/routes.ts` — `/open-finance/status`, `/connect-token`, `/vincular`, `/sincronizar`, `/desvincular`, webhook `/webhooks/pluggy`, importação OFX e conciliação. Serviço `open-finance-sync` roda a cada 30 min.
- `apps/web/src/lib/pluggy.ts` — carrega o widget **Pluggy Connect** do CDN (`.../pluggy-connect/latest/pluggy-connect.js`; as URLs versionadas do CDN não existem) e pré-preenche o CNPJ da empresa.
- `apps/web/src/pages/financeiro/Bancos.tsx` — botão Conectar banco, card Vincular pelo Item ID, OFX e conciliação.
- Sem credenciais, o provedor **mock** é usado (dados de exemplo, só para demonstração).

## Problemas comuns

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| "Não foi possível gerar o token do Pluggy" | Client ID/Secret errados ou aplicação desativada | Confira no dashboard; salve de novo (o Secret só é trocado se você preencher o campo) |
| Widget abre mas não lista MeuPluggy | Conector não incluído na lista da aplicação | Dashboard → Connectors → adicionar MeuPluggy (só dá para alterar dentro do trial) |
| "Nenhuma conta encontrada nesta conexão" | Item ainda atualizando ou autorização incompleta | Aguarde 1 min e vincule de novo pelo Item ID |
| Conta com status `ERRO: …` | Consentimento do banco expirou (Open Finance pede renovação periódica) | Reconecte em meu.pluggy.ai e vincule de novo |
| Saldo do banco ≠ saldo do sistema | Transações pendentes de conciliação | Aba Conciliação → aceitar sugestões / lançar avulso / ignorar |
