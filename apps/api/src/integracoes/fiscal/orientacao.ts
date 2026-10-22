/**
 * Traduz a rejeição/erro da SEFAZ (cStat + motivo) para o que fazer, com a tela onde corrigir.
 * Usado na tela da nota: em vez de só "cStat 230: IE do emitente não cadastrada", mostra
 * "A IE da empresa está errada → [Corrigir IE da empresa]".
 */
import type { AcaoPendencia } from '../../modules/comum/nfe-checagem.js';

export interface OrientacaoNota {
  titulo: string;
  detalhe?: string;
  acoes: AcaoPendencia[];
  /** a nota precisa de um número novo (duplicidade) — a tela oferece "Usar o próximo número" */
  renumerar?: boolean;
}

interface NotaMin {
  id: number;
  situacao: string;
  cStat?: string | null;
  motivo?: string | null;
  contatoId?: number | null;
  venda?: { id: number; numero: number } | null;
  os?: { id: number; numero: number } | null;
  itens?: { produtoId: number | null; descricao: string; ncm: string | null }[];
}

const EMPRESA = { rotulo: 'Abrir dados da empresa', rota: '/configuracoes/empresa' };
const FISCAL = { rotulo: 'Abrir configuração fiscal', rota: '/configuracoes/fiscal' };

export function orientacaoNota(n: NotaMin): OrientacaoNota | null {
  if (!['REJEITADA', 'ERRO', 'DENEGADA'].includes(n.situacao)) return null;
  const c = String(n.cStat || '').trim();
  const m = (n.motivo || '').toLowerCase();
  const cliente = n.contatoId ? { rotulo: 'Corrigir cadastro do cliente', rota: `/contatos/${n.contatoId}/editar` } : null;
  const origem = n.venda ? { rotulo: `Abrir a venda nº ${n.venda.numero}`, rota: `/vendas/${n.venda.id}` } : n.os ? { rotulo: `Abrir a OS nº ${n.os.numero}`, rota: `/ordens-servico/${n.os.id}` } : null;
  const produtos = (n.itens || []).filter((i) => i.produtoId).map((i) => ({ rotulo: `Produto: ${i.descricao.slice(0, 40)}`, rota: `/produtos/${i.produtoId}/editar` }));
  const com = (...a: (AcaoPendencia | null)[]) => a.filter((x): x is AcaoPendencia => !!x);
  const final = 'Depois de corrigir, volte aqui e clique em "Transmitir à SEFAZ" de novo.';

  if (['204', '539'].includes(c) || m.includes('duplicidade')) {
    return {
      titulo: 'Este número de nota já foi usado (provavelmente uma nota emitida pelo Bling).',
      detalhe: 'Clique em "Usar o próximo número livre" e transmita de novo. Confira também em Configurações → Fiscal se o próximo número está depois do último emitido no Bling.',
      acoes: [FISCAL],
      renumerar: true,
    };
  }
  if (['209', '230', '231'].includes(c)) {
    return { titulo: 'A Inscrição Estadual (IE) da empresa está faltando ou errada.', detalhe: `Confira a IE no cabeçalho de um DANFE já emitido. ${final}`, acoes: [EMPRESA] };
  }
  if (/\bie\b|inscri/.test(m) && m.includes('emit')) return { titulo: 'Problema na Inscrição Estadual da empresa.', detalhe: final, acoes: [EMPRESA] };
  if (['213', '280', '281', '282', '283', '284', '285', '286', '290', '291', '292', '293', '294', '295', '296', '297', '298', '299'].includes(c) || m.includes('certificado')) {
    return { titulo: 'Problema com o certificado digital A1 (vencido, de outro CNPJ ou com senha errada).', detalhe: `Envie de novo o .pfx e a senha. ${final}`, acoes: [FISCAL] };
  }
  if (['207', '208', '237', '238'].includes(c) || ((m.includes('cpf') || m.includes('cnpj')) && m.includes('dest'))) {
    return { titulo: 'O CPF/CNPJ do cliente está inválido.', detalhe: final, acoes: com(cliente) };
  }
  if (['232', '233', '234', '235', '236'].includes(c) || (/\bie\b|inscri/.test(m) && m.includes('dest'))) {
    return { titulo: 'A Inscrição Estadual do cliente está errada ou não bate com a situação dele.', detalhe: `Se o cliente não é contribuinte do ICMS, deixe a IE vazia e marque "Isento"/não contribuinte. ${final}`, acoes: com(cliente) };
  }
  if (m.includes('munic') || /\bcep\b/.test(m) || m.includes('endere') || /\buf\b/.test(m)) {
    return { titulo: 'O endereço do cliente (cidade/código IBGE/UF/CEP) não confere.', detalhe: `No cadastro do cliente, apague e digite o CEP de novo para preencher o código IBGE. ${final}`, acoes: com(cliente) };
  }
  if (['777', '778'].includes(c) || m.includes('ncm')) {
    return { titulo: 'O NCM de algum produto está errado ou faltando.', detalhe: `Corrija o NCM no cadastro do produto (8 dígitos). ${final}`, acoes: produtos.length ? produtos : com(origem) };
  }
  if (['703', '228'].includes(c) || m.includes('data')) {
    return { titulo: 'Data/hora da nota fora do prazo aceito pela SEFAZ.', detalhe: 'Clique em "Transmitir à SEFAZ" de novo: o sistema usa a data e hora atuais.', acoes: [] };
  }
  if (c === '225' || m.includes('schema')) {
    return { titulo: 'A SEFAZ recusou o formato da nota (falha de schema): algum campo está vazio ou com tamanho errado.', detalhe: `Normalmente é dado do cliente ou do produto. Use "Verificar de novo" na venda e confira os campos apontados. ${final}`, acoes: com(origem, cliente) };
  }
  if (n.situacao === 'DENEGADA') {
    return { titulo: 'Nota DENEGADA: a SEFAZ bloqueou por irregularidade cadastral (empresa ou cliente).', detalhe: 'Essa numeração fica registrada; não é possível reaproveitar. Confira a situação cadastral na SEFAZ.', acoes: com(cliente) };
  }
  if (n.situacao === 'ERRO') {
    return { titulo: 'A nota não chegou a ser aceita (erro antes ou durante o envio).', detalhe: 'Pode ser internet/SEFAZ fora do ar: aguarde um minuto e transmita de novo. Se repetir, o motivo acima diz o campo.', acoes: com(origem) };
  }
  return { titulo: 'A SEFAZ rejeitou a nota pelo motivo acima.', detalhe: final, acoes: com(origem, cliente) };
}
