/**
 * ROBÔ DE E-MAIL DOS BANCOS (29/10/2026)
 * - Parsers contra os textos REAIS que a SumUp e o Asaas mandam.
 * - As três travas: só remetente com regra, DKIM reprovado não vira dinheiro,
 *   baixa automática só no casamento 1:1.
 * - Mesma mensagem em duas caixas entra uma vez só (Message-ID).
 * - Caixas e regras: CRUD, senha mascarada, só ADMIN.
 *   npx tsx testes/email-banco.ts http://localhost:3333
 */
import { encerrar, entrar, igual, secao, SUF, verifica } from './lib.js';
import { parseSumUpPix, parseAsaas, valorBr, normalizarRemetente } from '../src/modules/email-banco/parsers.js';
import { conferirAutenticacao, type MensagemEmail } from '../src/integracoes/email/index.js';
import { processarMensagem } from '../src/modules/email-banco/service.js';
import { prisma } from '../src/lib/prisma.js';

// textos reais, copiados dos e-mails que chegam na caixa da loja
const PIX_RECEBIDO =
  'Olá, BALAO DA INFORMATICA CASTELO. Você recebeu uma transferência pelo Pix de MARIANA ZOPPI no valor de R$ 39,00 em 27/10/2026 às 09:56:20 (horário de Brasília).';
const PIX_ENVIADO =
  'Olá, BALAO DA INFORMATICA CASTELO. Deu tudo certo com o Pix que você fez para CASTELO DISTRIBUICAO LTDA no valor de R$ 2.000,00, em 28/10/2026 às 17:33:40 (horário de Brasília).';
const ASAAS_PAGO =
  'O pagamento da cobrança #906087709 foi confirmado. | Valor R$ 300,90 Juros e multa R$ 0,90 Valor original R$ 300,00 Cliente Pedro Henrique Máximo Rodrigues Forma de pagamento Pix Data de vencimento 05/10/2026 Confirmado em 08/10/2026 Descrição Parcela 1 de 2. Pedido 24466';
const ASAAS_NAO_PAGO =
  'Não registramos o pagamento de Gustavo Vargas da Silva. A cobrança #906087710 segue em aberto. Valor R$ 500,00';
const CORA_MANUTENCAO = 'Aviso: Manutenção programada na sua conta Cora. Nos dias 30 e 31 o app pode ficar indisponível.';

const hojeIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const ddmmaaaa = () => {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};

async function main() {
  secao('Valores em português: milhar, centavo e a vírgula grudada da SumUp');
  verifica(igual(valorBr('2.000,00'), 2000), 'milhar brasileiro', valorBr('2.000,00'));
  verifica(igual(valorBr('300,90'), 300.9), 'centavos', valorBr('300,90'));
  // a regex da SumUp arrasta a vírgula do fim ("R$ 2.000,00, em 28/10") — isso já zerou o valor uma vez
  verifica(igual(valorBr('2.000,00,'), 2000), 'vírgula grudada no fim não vira NaN', valorBr('2.000,00,'));
  verifica(valorBr('abc') === null && valorBr('') === null, 'texto sem número devolve nulo');

  secao('Pix recebido da SumUp: valor, hora cravada e pagador');
  const rec = parseSumUpPix(PIX_RECEBIDO, 'msg-1');
  verifica(rec !== null && igual(rec.valor, 39) && rec.tipo === 'CREDITO', 'entrada de 39,00', rec);
  verifica(rec?.contraparte === 'MARIANA ZOPPI', 'nome de quem pagou', rec?.contraparte);
  verifica(rec?.data.getHours() === 9 && rec?.data.getMinutes() === 56, 'hora exata da transação (09:56)', rec?.data);

  secao('Pix enviado da SumUp entra como SAÍDA');
  const env = parseSumUpPix(PIX_ENVIADO, 'msg-2');
  // se isto voltar a quebrar, as saídas somem e o caixa aparece maior do que é
  verifica(env !== null && igual(env.valor, -2000), 'saída de 2.000,00 com sinal negativo', env);
  verifica(env?.tipo === 'DEBITO', 'marcada como débito', env?.tipo);
  verifica(env?.contraparte === 'CASTELO DISTRIBUICAO LTDA', 'para quem foi', env?.contraparte);

  secao('Asaas confirmado: juros separados e o número do pedido');
  const pago = parseAsaas(ASAAS_PAGO, 'msg-3', 'Pagamento confirmado - Fatura 906087709');
  verifica(pago !== null && igual(pago.valor, 300.9), 'valor recebido com juros', pago?.valor);
  verifica(igual(pago?.juros ?? 0, 0.9), 'juros e multa separados', pago?.juros);
  verifica(pago?.referencia === 'Pedido 24466', 'traz o pedido, então casa sem adivinhar', pago?.referencia);
  verifica(pago?.externalId === 'asaas:cobranca:906087709', 'id estável pela cobrança (não duplica)', pago?.externalId);

  secao('O que NÃO pode virar lançamento');
  verifica(parseAsaas(ASAAS_NAO_PAGO, 'msg-4') === null, 'cobrança em aberto não é dinheiro que entrou');
  verifica(parseSumUpPix(CORA_MANUTENCAO, 'msg-5') === null, 'aviso de manutenção é ignorado');
  verifica(parseSumUpPix('', 'msg-6') === null, 'corpo vazio');
  verifica(parseAsaas('Valor R$ 10,00', 'msg-7') === null, 'valor solto sem confirmação de pagamento');

  secao('Remetente: tag +, nome junto e domínio');
  verifica(normalizarRemetente('cobrancas+5357164@asaas.com').endereco === 'cobrancas@asaas.com', 'ignora a tag +');
  verifica(normalizarRemetente('SumUp <no-reply@sumup.com>').endereco === 'no-reply@sumup.com', 'extrai de "Nome <email>"');
  verifica(normalizarRemetente('x@cora.com.br').dominio === '@cora.com.br', 'domínio para regra ampla');

  secao('Trava anti-phishing: DKIM/SPF');
  verifica(conferirAutenticacao('spf=pass; dkim=pass; dmarc=pass') === true, 'passou = aceita');
  verifica(conferirAutenticacao('spf=fail; dkim=fail') === false, 'reprovado = NÃO vira lançamento');
  verifica(conferirAutenticacao(null) === null, 'sem cabeçalho = indefinido (não bloqueia sozinho)');

  // ---- API ----
  const adm = await entrar('admin@balao.info', 'admin123');
  adm.nome = 'ADMIN';
  const conta = await adm.post('/contas-financeiras', { nome: `SumUp Loja ${SUF}`, tipo: 'BANCO', saldoInicial: 0, padrao: false, ativo: true }, [200, 201]);

  secao('Config do robô');
  const cfg: any = await adm.get('/email-banco/config');
  verifica(cfg.ligado === true && cfg.baixaAutomatica === true, 'nasce ligado com baixa automática', cfg);
  const cfg2: any = await adm.put('/email-banco/config', { baixaAutomatica: false });
  verifica(cfg2.baixaAutomatica === false, 'dá para desligar a baixa automática', cfg2);
  await adm.put('/email-banco/config', { baixaAutomatica: true });

  secao('Caixa de e-mail: senha nunca volta na resposta');
  const caixa: any = await adm.post('/email-banco/caixas', {
    nome: `Caixa ${SUF}`, endereco: `teste${SUF}@balaodainformatica.com.br`, tipo: 'IMAP',
    host: 'imap.dreamhost.com', porta: 993, pasta: 'INBOX', segredo: 'senha-secreta-123', ativo: true,
  }, 201);
  verifica(!JSON.stringify(caixa).includes('senha-secreta-123'), 'a senha NÃO aparece na resposta', caixa.segredo);
  verifica(caixa.temSegredo === true && String(caixa.segredo).startsWith('••••'), 'volta mascarada', caixa.segredo);
  await adm.post('/email-banco/caixas', { nome: 'x', endereco: `semhost${SUF}@x.com`, tipo: 'IMAP', segredo: 'a' }, 422);
  await adm.post('/email-banco/caixas', { nome: 'x', endereco: 'nao-e-email', tipo: 'IMAP', host: 'h', segredo: 'a' }, 400);

  secao('Alterar caixa com senha em branco não apaga a senha');
  const alt: any = await adm.put(`/email-banco/caixas/${caixa.id}`, { nome: `Renomeada ${SUF}` });
  verifica(alt.nome === `Renomeada ${SUF}` && alt.temSegredo === true, 'nome mudou, senha continua lá', alt);

  secao('Regra de remetente');
  const regra: any = await adm.post('/email-banco/regras', {
    nome: `SumUp Pix ${SUF}`, remetente: 'no-reply@sumup.com', parser: 'SUMUP_PIX', contaFinanceiraId: conta.id, ativo: true, ordem: 0,
  }, 201);
  verifica(regra.parser === 'SUMUP_PIX' && regra.contaFinanceiraId === conta.id, 'remetente ligado ao banco certo', regra);
  await adm.post('/email-banco/regras', { nome: 'x', remetente: 'a@b.com', parser: 'PARSER_INVENTADO' }, 400);

  secao('Painel');
  const painel: any = await adm.get('/email-banco/painel');
  verifica(Array.isArray(painel.caixas) && painel.caixas.length >= 1, 'lista as caixas', painel.caixas?.length);
  verifica(typeof painel.pendentesDeConciliacao === 'number', 'conta as pendências', painel.pendentesDeConciliacao);
  verifica(!JSON.stringify(painel).includes('senha-secreta-123'), 'o painel também não vaza senha');

  secao('Só o gestor entra');
  const senha = 'Senha@12345';
  await adm.post('/usuarios', { nome: `Vend EmailBanco ${SUF}`, email: `vemail${SUF}@teste.com`, senha, perfil: 'VENDEDOR' }, [201, 409]);
  const vend = await entrar(`vemail${SUF}@teste.com`, senha).catch(() => null);
  if (vend) {
    vend.nome = 'VENDEDOR';
    await vend.get('/email-banco/painel', 403);
    await vend.get('/email-banco/caixas', 403);
    await vend.post('/email-banco/rodar', {}, 403);
  }

  // ---- a parte que mexe em dinheiro ----
  secao('Baixa automática: casa 1:1 e dá a baixa de verdade');
  const caixa2: any = await adm.post('/email-banco/caixas', {
    nome: `Caixa baixa ${SUF}`, endereco: `baixa${SUF}@balaodainformatica.com.br`, tipo: 'IMAP',
    host: 'imap.dreamhost.com', porta: 993, pasta: 'INBOX', segredo: 'x', ativo: true,
  }, 201);
  await adm.post('/email-banco/regras', {
    nome: `SumUp baixa ${SUF}`, remetente: `pix${SUF}@sumup.com`, parser: 'SUMUP_PIX', contaFinanceiraId: conta.id, ativo: true, ordem: 0,
  }, 201);

  // uma conta a receber com valor que nenhuma outra tem, para o casamento ser único
  const valorUnico = 7777.77;
  const cr: any = await adm.post('/contas-receber', {
    descricao: `Recebimento teste ${SUF}`, vencimento: hojeIso(), valor: valorUnico, situacao: 'ABERTO',
  }, [200, 201]);

  const avisoPix = (valor: string, id: string): MensagemEmail => ({
    messageId: id,
    de: `pix${SUF}@sumup.com`,
    assunto: 'Você recebeu um Pix!',
    data: new Date(),
    texto: `Olá. Você recebeu uma transferência pelo Pix de CLIENTE TESTE no valor de R$ ${valor} em ${ddmmaaaa()} às 10:00:00 (horário de Brasília).`,
    autenticado: true,
    anexos: [],
  });

  const r1 = await processarMensagem(avisoPix('7.777,77', `<baixa-${SUF}@teste>`), caixa2.id, { baixaAutomatica: true });
  verifica(r1 === 'BAIXADO', 'valor único casou e deu baixa sozinho', r1);
  const crDepois = await prisma.contaReceber.findUnique({ where: { id: cr.id } });
  verifica(crDepois?.situacao === 'RECEBIDO', 'a conta a receber ficou RECEBIDA', crDepois?.situacao);
  verifica(igual(crDepois?.valorRecebido ?? 0, valorUnico), 'valor recebido batendo', crDepois?.valorRecebido);

  secao('O mesmo aviso chegando de novo não lança duas vezes');
  const r2 = await processarMensagem(avisoPix('7.777,77', `<baixa-${SUF}@teste>`), caixa2.id, { baixaAutomatica: true });
  verifica(r2 === 'JA_VISTO', 'Message-ID repetido é ignorado', r2);

  secao('Valor ambíguo NÃO dá baixa sozinho: fica pendente');
  const amb = 8888.88;
  await adm.post('/contas-receber', { descricao: `Ambigua A ${SUF}`, vencimento: hojeIso(), valor: amb, situacao: 'ABERTO' }, [200, 201]);
  await adm.post('/contas-receber', { descricao: `Ambigua B ${SUF}`, vencimento: hojeIso(), valor: amb, situacao: 'ABERTO' }, [200, 201]);
  const r3 = await processarMensagem(avisoPix('8.888,88', `<amb-${SUF}@teste>`), caixa2.id, { baixaAutomatica: true });
  // duas candidatas com o mesmo valor: o robô não escolhe, deixa para uma pessoa
  verifica(r3 === 'IMPORTADO', 'duas candidatas iguais → não dá baixa, vira pendência', r3);

  secao('Remetente sem regra não vira lançamento');
  const semRegra: MensagemEmail = { ...avisoPix('100,00', `<semregra-${SUF}@teste>`), de: `estranho${SUF}@golpe.com` };
  verifica(await processarMensagem(semRegra, caixa2.id, { baixaAutomatica: true }) === 'SEM_REGRA', 'remetente desconhecido barrado');

  secao('DKIM reprovado não vira lançamento, mesmo com remetente certo');
  const falso: MensagemEmail = { ...avisoPix('250,00', `<falso-${SUF}@teste>`), autenticado: false };
  verifica(await processarMensagem(falso, caixa2.id, { baixaAutomatica: true }) === 'REMETENTE_SUSPEITO', 'phishing barrado');

  secao('Limpeza');
  await adm.del(`/email-banco/regras/${regra.id}`);
  await adm.del(`/email-banco/caixas/${caixa.id}`);

  encerrar();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
