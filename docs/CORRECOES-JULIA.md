# Correções pedidas pela Júlia — venda e assistência (10/11/2026)

A Júlia é quem mais usa o sistema no dia a dia. Esta é a lista que ela passou, o que
estava acontecendo de verdade em cada item e o que mudou. Vale como histórico: boa
parte não era "falta de configuração", era bug mesmo.

---

## Venda

### 1. Cadastro de cliente sem endereço

**Ela dizia:** "quando cadastra não tem a opção do endereço, só depois que salva o
cadastro preciso abrir uma nova aba e colocar o endereço".

O cadastro rápido dentro da venda só tinha nome, documento, telefone e e-mail. Sem
endereço não dá para emitir NF-e, então toda venda com nota virava duas idas à tela.

**Agora:** o cadastro rápido tem CEP, logradouro, número, complemento, bairro,
município e UF. O CEP com 8 dígitos preenche o resto sozinho (ViaCEP), como no
cadastro completo.

### 2. "Importar do SEFAZ" pelo CNPJ

**Ela dizia:** "no bling tem um botão escrito IMPORTAR DO SEFAZ, quando adiciona o
CNPJ e clica ele já puxa e preenche todos os dados do CNPJ".

**Agora:** `GET /contatos/cnpj/{cnpj}` consulta o cadastro público da Receita Federal
(BrasilAPI, com ReceitaWS de reserva) e devolve razão social, nome fantasia, endereço
completo com código IBGE, telefone, e-mail e situação cadastral. O botão está no
cadastro rápido e no cadastro completo.

Dois avisos que a tela dá:

- empresa **BAIXADA / INAPTA / SUSPENSA** na Receita aparece como alerta antes de
  emitir nota para ela;
- a **Inscrição Estadual não é publicada** pela Receita na maioria das UFs. Quando não
  vier, o campo fica vazio e a tela avisa para preencher à mão — em vez de fingir que
  importou tudo.

### 3. WhatsApp "na fila" que enviava horas depois

**Ela dizia:** "quando estamos enviando o link direto pro número do cliente, mostra que
está em uma fila e não envia, as vezes envia horas depois".

Eram três problemas somados:

1. a tela **sempre** dizia "na fila de envio", mesmo quando a mensagem não tinha a
   menor chance de sair;
2. com o WhatsApp desconectado, a notificação ficava `PENDENTE` sendo tentada a cada
   5 segundos **para sempre** — quando alguém reconectava horas depois, ela saía ali,
   fora de hora;
3. se a API reiniciava no meio de um envio, a notificação ficava presa em `ENVIANDO`,
   e o worker só procurava por `PENDENTE`: ficava parada para sempre, sem erro.

**Agora:**

- o envio é **síncrono**: a API tenta mandar na hora e devolve o resultado, e a tela
  diz "enviado", "WhatsApp desconectado" ou o erro real;
- o modal avisa **antes de escrever** quando o WhatsApp está desconectado, com o
  caminho para ler o QR Code;
- `destravarFila()` devolve à fila o que ficou preso em `ENVIANDO` por mais de 5 min;
- o que não sai em **6 horas** vira `ERRO` em vez de sair de surpresa depois. Reenviar
  continua sendo um clique.

### 4. Emissão de NF-e — a Inscrição Estadual que "sumia"

**Ela dizia:** "antes estava com erro pois nossa inscrição estadual não tava no sistema,
eu adicionei mas mesmo assim diz que não é possível".

A causa: CNPJ, Inscrição Estadual, Inscrição Municipal e regime tributário são
`CAMPOS_EMPRESA_ADMIN` — só o ADMIN altera. Mas o servidor **apagava esses campos do
corpo do PUT em silêncio** para quem não era ADMIN. A tela dizia "salvo com sucesso",
o valor não entrava, e a checagem da NF continuava reclamando que faltava a IE. Sem
nenhuma pista do motivo.

**Agora:**

- o PUT é **recusado com 403** nomeando os campos barrados e dizendo que nada foi
  salvo (reenviar o mesmo valor, como a tela faz com o formulário inteiro, continua
  passando normalmente);
- na tela da empresa esses campos ficam **desabilitados** para quem não é ADMIN, com
  um aviso explicando que a alteração é com o Thiago.

> **Atenção:** isto resolve o caso "a IE não entrava". Se a emissão continuar bloqueada
> depois de o ADMIN gravar a IE, o motivo é outro e aparece na lista do botão **Emitir
> NF** — quase sempre o **certificado digital A1** não enviado, o sistema em modo
> **simulado**, ou o ambiente em **homologação**. Esses três dependem do arquivo `.pfx`
> e da senha, que só o Thiago tem.

### 5. Tela cheia para o cliente acompanhar

**Ela dizia:** "quando estou montando orçamento coloco em uma segunda tela pro cliente
acompanhar, mas está com uma borda grande e aparecendo nosso menu na esquerda, quero um
botão pra ficar em tela cheia".

**Agora:** botão **Tela cheia** no orçamento/venda. Esconde o menu da esquerda e a barra
de cima, tira a largura máxima e põe o navegador em tela cheia de verdade. Sai com
**Esc**, com o botão, ou ao trocar de tela.

### 6. Parcelas do cartão (o 30/60/90)

**Ela dizia:** "nas formas de pagamento adicionar a quantidade de parcela [...] quando
seleciona aparece a data ex se foi em 3x aparece pagamento 30/60/90 e isso é ruim pq a
data de pagamento é hoje, a parcela o cliente vai pagar pro cartão dele não pra nós".

Ela está certa, e havia um motivo técnico escondido: a **taxa da maquininha era
calculada contando as linhas de parcela** (`credito.length`). Para a taxa de 3x sair
certa, o sistema *precisava* de três linhas — e essas três linhas viravam três contas a
receber em 30/60/90, que nunca existiram.

**Agora:** `VendaParcela.parcelasCartao` guarda em quantas vezes o cliente parcelou no
cartão dele. Em 3x sai **uma linha só**, com vencimento na data da venda mais o prazo
de recebimento da maquininha. A taxa continua a de 3x, lida do campo e não da contagem
de linhas. Vale igual na OS.

### 7 e 8. Link de pagamento e cobrança automática no Asaas

**Ela dizia:** "não conseguimos gerar link de pagamento direto do sistema" e "uma opção
pra quando colocar venda no sistema, gerar automaticamente a cobrança no asaas".

O link do Mercado Pago já existia no código e continua. O que faltava era o Asaas, que
é por onde a loja emite boleto.

**Agora:** integração com o Asaas em `integracoes/asaas/cobranca.ts`:

- **Configurações → Asaas**: chave de API (criptografada), ambiente e o botão de testar;
- no pedido, bloco **Cobrança no Asaas**: gera boleto, PIX ou cartão, copia o link,
  manda no WhatsApp, confere o pagamento e cancela;
- opção **gerar a cobrança sozinho ao finalizar a venda**. Se o Asaas estiver fora do
  ar, a venda é finalizada do mesmo jeito e a cobrança pode ser gerada à mão.

Depende da chave de API da conta Asaas da loja, que o Thiago cola na tela.

---

## Assistência

### 9. Wendell continuava como vendedor

**Ele dizia:** "colocar wendell como técnico, ele estava como vendedor eu removi mas
ainda não está só como técnico".

Dois bugs, somados:

1. **o login recriava o vínculo.** `vendedorDoUsuario()` segue a regra "o técnico também
   vende" (decisão de 29/10) e criava um cadastro de vendedor para **todo** TÉCNICO sem
   um. Apagar o cadastro não adiantava: o próximo login dele refazia — inclusive
   reativando um cadastro que tivesse sido desativado;
2. **editar o usuário rebaixava o perfil.** O PUT usava `usuarioSchema.partial()`, mas
   os campos com `.default()` continuam devolvendo o padrão quando a chave não vem no
   corpo. Salvar qualquer detalhe de um usuário gravava `perfil: 'VENDEDOR'` e
   `ativo: true` por cima — rebaixando quem era TÉCNICO e **reativando usuário
   desativado**. Esse valia para todos os usuários, não só o Wendell.

**Agora:**

- `Usuario.vendeTambem` (padrão `true`, ninguém mais muda). Desmarcar **Também vende**
  na tela de usuários desfaz o vínculo, desativa o cadastro de vendedor (só se não for
  de mais ninguém) e impede a recriação no login. As vendas antigas continuam no nome
  dele;
- o PUT só altera o que foi enviado.

### 10. Custos das OS antigas para o Amiel e o Gabriel

**Ele dizia:** "Preciso preencher os custos das OS antigas e vou delegar isso para os 2,
mas só aparece pra mim. Já fiz umas 50 mas tem muito ainda".

Os campos de custo da OS **sempre** foram visíveis e editáveis por qualquer perfil — o
que era só do ADMIN é o painel do **Robô da Saúde**, que é onde a lista das OS sem custo
existia. Sem essa lista, não havia como a equipe saber *quais* OS preencher.

**Agora:** filtro **`semCusto`** na listagem de OS, aberto a todos os perfis, com um chip
**Sem custo** na barra de filtros e uma coluna **Custo** mostrando quantas peças faltam
em cada OS. O Amiel e o Gabriel abrem a lista, filtram e vão preenchendo; a OS sai da
fila sozinha quando o custo entra.

> O lucro e a margem continuam só para ADMIN e GERENTE — eles preenchem o custo sem ver
> o lucro, como já era a regra.

---

## Onde ficou cada coisa

| Item | Arquivos principais |
| --- | --- |
| Endereço no cadastro rápido | `web/components/compartilhados/ContatoRapidoDrawer.tsx` |
| Importar do SEFAZ (CNPJ) | `api/modules/contatos/cnpj.ts`, `contatos/routes.ts`, `web/pages/contatos/ContatoForm.tsx` |
| Envio de WhatsApp na hora | `api/modules/notificacoes/service.ts`, `vendas/routes.ts`, `ordens-servico/routes.ts`, `web/components/compartilhados/NotificarModal.tsx` |
| Campo fiscal travado (IE) | `api/plugins/auth.ts`, `web/pages/configuracoes/Empresa.tsx` |
| Tela cheia | `web/stores/apresentacao.ts`, `web/components/layout/AppShell.tsx`, `web/pages/vendas/VendaForm.tsx` |
| Parcelas do cartão | `api/modules/comum/custos-venda.ts`, `custos-os.ts`, `web/components/compartilhados/ParcelasEditor.tsx` |
| Asaas | `api/integracoes/asaas/cobranca.ts`, `web/pages/configuracoes/Asaas.tsx`, `web/components/compartilhados/CobrancaAsaas.tsx` |
| Só técnico (Wendell) | `api/modules/comum/vendedores.ts`, `api/modules/auth/routes.ts`, `web/pages/configuracoes/Usuarios.tsx` |
| Fila de OS sem custo | `api/modules/ordens-servico/routes.ts`, `web/pages/os/OsLista.tsx` |

Testes: `apps/api/testes/julia-venda-assistencia.ts` (entra no `npm test`).
