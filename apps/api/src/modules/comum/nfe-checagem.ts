/**
 * Verificação da NF-e/NFC-e ANTES de gerar: em vez de um erro genérico, devolve a lista
 * completa do que falta, cada item com a tela onde se corrige (`acoes[].rota`, rota do frontend).
 *
 * nivel "erro"  → impede gerar a nota (a SEFAZ rejeitaria ou o XML nem sai)
 * nivel "aviso" → dá para emitir, mas vale conferir
 */
import { somenteDigitos } from '../../lib/util.js';
import type { Db } from './nfe.js';

export interface AcaoPendencia {
  rotulo: string;
  /** rota do frontend (ex.: /contatos/12/editar) */
  rota: string;
}
export interface PendenciaNfe {
  nivel: 'erro' | 'aviso';
  codigo: string;
  /** onde está o problema: empresa, cliente, item, venda, configuração */
  grupo: 'EMPRESA' | 'CONFIGURACAO' | 'CLIENTE' | 'ITENS' | 'DOCUMENTO';
  titulo: string;
  detalhe?: string;
  acoes?: AcaoPendencia[];
}
export interface ResultadoChecagem {
  podeEmitir: boolean;
  modelo: 55 | 65;
  erros: number;
  avisos: number;
  pendencias: PendenciaNfe[];
  /** o que já está certo (para a tela mostrar o checklist completo) */
  ok: string[];
  resumo: { cliente: string; itensNota: number; proximoNumero: number; serie: number; ambiente: 'PRODUÇÃO' | 'HOMOLOGAÇÃO'; provedor: string };
}

export interface ItemChecagem {
  produtoId: number | null;
  descricao: string;
}
export interface ParamsChecagem {
  modelo: 55 | 65;
  contatoId: number;
  itens: ItemChecagem[];
  /** documento de origem, para os links de edição */
  origem: { tipo: 'VENDA' | 'OS'; id: number; numero: number; notaExistente?: { id: number; numero: number; situacao: string } | null };
}

export function cpfValido(v: string): boolean {
  const d = somenteDigitos(v);
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  const calc = (n: number) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
}
export function cnpjValido(v: string): boolean {
  const d = somenteDigitos(v);
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const calc = (n: number) => {
    const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const s = pesos.reduce((acc, p, i) => acc + Number(d[i]) * p, 0);
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
}

const vazio = (v: string | null | undefined) => !v || !String(v).trim();

export async function verificarNfe(db: Db, p: ParamsChecagem): Promise<ResultadoChecagem> {
  const pend: PendenciaNfe[] = [];
  const ok: string[] = [];
  const nfce = p.modelo === 65;
  const rotaOrigem = p.origem.tipo === 'VENDA' ? `/vendas/${p.origem.id}/editar` : `/ordens-servico/${p.origem.id}/editar`;
  const nomeOrigem = p.origem.tipo === 'VENDA' ? `a venda nº ${p.origem.numero}` : `a OS nº ${p.origem.numero}`;

  // ------------------------------------------------------------ documento de origem
  const n = p.origem.notaExistente;
  if (n && !['CANCELADA', 'INUTILIZADA', 'DENEGADA'].includes(n.situacao)) {
    pend.push({
      nivel: 'erro',
      codigo: 'NOTA_EXISTENTE',
      grupo: 'DOCUMENTO',
      titulo: `Já existe a nota nº ${n.numero} (${n.situacao.toLowerCase()}) para ${nomeOrigem}.`,
      detalhe: n.situacao === 'REJEITADA' || n.situacao === 'ERRO' || n.situacao === 'PENDENTE'
        ? 'Abra a nota, corrija o que a SEFAZ apontou e transmita de novo — não é preciso gerar outra.'
        : 'Para emitir outra, cancele a nota atual primeiro.',
      acoes: [{ rotulo: 'Abrir a nota', rota: `/notas-fiscais/${n.id}` }],
    });
  }

  // ------------------------------------------------------------ empresa / configuração fiscal
  const emp = await db.empresa.findUnique({ where: { id: 1 } });
  const rotaEmpresa = '/configuracoes/empresa';
  const rotaFiscal = '/configuracoes/fiscal';
  if (!emp) {
    pend.push({ nivel: 'erro', codigo: 'EMPRESA', grupo: 'EMPRESA', titulo: 'Os dados da empresa não foram cadastrados.', acoes: [{ rotulo: 'Cadastrar empresa', rota: rotaEmpresa }] });
  } else {
    const faltaEmp: string[] = [];
    if (vazio(emp.razaoSocial)) faltaEmp.push('razão social');
    if (!cnpjValido(emp.cnpj || '')) faltaEmp.push('CNPJ válido');
    if (vazio(emp.logradouro)) faltaEmp.push('endereço');
    if (vazio(emp.bairro)) faltaEmp.push('bairro');
    if (somenteDigitos(emp.codigoMunicipio).length !== 7) faltaEmp.push('código IBGE do município (7 dígitos)');
    if (vazio(emp.municipio)) faltaEmp.push('município');
    if (vazio(emp.uf)) faltaEmp.push('UF');
    if (somenteDigitos(emp.cep).length !== 8) faltaEmp.push('CEP');
    if (faltaEmp.length) {
      pend.push({ nivel: 'erro', codigo: 'EMPRESA_INCOMPLETA', grupo: 'EMPRESA', titulo: `Faltam dados da empresa: ${faltaEmp.join(', ')}.`, acoes: [{ rotulo: 'Completar dados da empresa', rota: rotaEmpresa }] });
    } else ok.push('Dados e endereço da empresa');

    if (vazio(emp.ie)) {
      pend.push({
        nivel: 'erro',
        codigo: 'EMPRESA_SEM_IE',
        grupo: 'EMPRESA',
        titulo: 'A Inscrição Estadual (IE) da empresa não está cadastrada.',
        detalhe: 'Sem IE a nota sai como "ISENTO" e a SEFAZ-SP rejeita. A IE está no cabeçalho de qualquer DANFE emitido pela loja.',
        acoes: [{ rotulo: 'Informar a IE', rota: rotaEmpresa }],
      });
    } else ok.push('Inscrição Estadual da empresa');

    if (emp.provedorFiscal === 'mock') {
      pend.push({
        nivel: 'aviso',
        codigo: 'MODO_SIMULADO',
        grupo: 'CONFIGURACAO',
        titulo: 'O sistema está em modo SIMULADO: a nota não vai para a SEFAZ e não tem validade fiscal.',
        acoes: [{ rotulo: 'Ativar emissão pela SEFAZ', rota: rotaFiscal }],
      });
    } else {
      if (!emp.certificadoPfx || !emp.certificadoSenha) {
        pend.push({ nivel: 'erro', codigo: 'SEM_CERTIFICADO', grupo: 'CONFIGURACAO', titulo: 'O certificado digital A1 não foi enviado.', detalhe: 'Envie o arquivo .pfx e a senha do certificado.', acoes: [{ rotulo: 'Enviar certificado', rota: rotaFiscal }] });
      } else if (emp.certificadoValidade && emp.certificadoValidade.getTime() < Date.now()) {
        pend.push({ nivel: 'erro', codigo: 'CERTIFICADO_VENCIDO', grupo: 'CONFIGURACAO', titulo: `O certificado A1 venceu em ${emp.certificadoValidade.toLocaleDateString('pt-BR')}.`, acoes: [{ rotulo: 'Enviar certificado novo', rota: rotaFiscal }] });
      } else {
        const dias = emp.certificadoValidade ? Math.floor((emp.certificadoValidade.getTime() - Date.now()) / 86400000) : null;
        if (dias !== null && dias <= 30) pend.push({ nivel: 'aviso', codigo: 'CERTIFICADO_VENCENDO', grupo: 'CONFIGURACAO', titulo: `O certificado A1 vence em ${dias} dia(s).`, acoes: [{ rotulo: 'Renovar certificado', rota: rotaFiscal }] });
        else ok.push('Certificado digital A1');
      }
      if (nfce && (vazio(emp.cscId) || vazio(emp.cscToken))) {
        pend.push({
          nivel: 'erro',
          codigo: 'SEM_CSC',
          grupo: 'CONFIGURACAO',
          titulo: 'Falta o CSC (código de segurança) para emitir NFC-e.',
          detalhe: 'O CSC e o ID do CSC são gerados no site da SEFAZ-SP (área da NFC-e). Enquanto isso, emita NF-e (modelo 55).',
          acoes: [{ rotulo: 'Cadastrar CSC', rota: rotaFiscal }],
        });
      }
    }
    if (emp.ambienteFiscal === 2) {
      pend.push({ nivel: 'aviso', codigo: 'HOMOLOGACAO', grupo: 'CONFIGURACAO', titulo: 'Ambiente de HOMOLOGAÇÃO (teste): a nota não vale como documento fiscal.', acoes: [{ rotulo: 'Mudar para produção', rota: rotaFiscal }] });
    }

    // numeração: o próximo número já existe no sistema?
    const serie = nfce ? emp.serieNfce : emp.serieNfe;
    const prox = nfce ? emp.proximoNumeroNfce : emp.proximoNumeroNfe;
    const jaUsada = await db.notaFiscal.findFirst({ where: { modelo: p.modelo, serie, numero: prox, tipo: 1 }, select: { id: true } });
    if (jaUsada) {
      pend.push({
        nivel: 'erro',
        codigo: 'NUMERO_USADO',
        grupo: 'CONFIGURACAO',
        titulo: `O próximo número (${prox}, série ${serie}) já foi usado por outra nota.`,
        acoes: [{ rotulo: 'Ajustar a numeração', rota: rotaFiscal }],
      });
    } else {
      const emitidasAqui = await db.notaFiscal.count({ where: { modelo: p.modelo, serie, ambiente: 1, situacao: { in: ['AUTORIZADA', 'CANCELADA'] } } });
      if (!emitidasAqui && emp.ambienteFiscal === 1 && emp.provedorFiscal !== 'mock') {
        pend.push({
          nivel: 'aviso',
          codigo: 'PRIMEIRA_NOTA',
          grupo: 'CONFIGURACAO',
          titulo: `Primeira nota deste sistema: ela sairá com o nº ${prox} (série ${serie}).`,
          detalhe: 'Se o Bling ainda emite notas, confira que esse número é o seguinte ao último emitido lá — número repetido é rejeitado pela SEFAZ.',
          acoes: [{ rotulo: 'Conferir numeração', rota: rotaFiscal }],
        });
      }
    }
  }

  // ------------------------------------------------------------ itens
  const ids = p.itens.map((i) => i.produtoId).filter((x): x is number => !!x);
  const produtos = ids.length ? await db.produto.findMany({ where: { id: { in: ids } }, select: { id: true, nome: true, tipo: true, ncm: true, unidade: true } }) : [];
  const mapa = new Map(produtos.map((pr) => [pr.id, pr]));
  let itensNota = 0;
  p.itens.forEach((it, idx) => {
    const nItem = `Item ${idx + 1} ("${(it.descricao || '').trim().slice(0, 60)}")`;
    if (!it.produtoId) {
      pend.push({
        nivel: 'erro',
        codigo: 'ITEM_SEM_PRODUTO',
        grupo: 'ITENS',
        titulo: `${nItem} foi lançado como linha livre, sem produto cadastrado.`,
        detalhe: 'A nota precisa do produto cadastrado (NCM, unidade, origem). Troque a linha livre pelo produto na venda — se ele ainda não existe, cadastre antes.',
        acoes: [
          { rotulo: p.origem.tipo === 'VENDA' ? 'Editar a venda' : 'Editar a OS', rota: rotaOrigem },
          { rotulo: 'Cadastrar produto', rota: `/produtos/novo?nome=${encodeURIComponent((it.descricao || '').trim().slice(0, 120))}` },
        ],
      });
      return;
    }
    const pr = mapa.get(it.produtoId);
    if (!pr) {
      pend.push({ nivel: 'erro', codigo: 'PRODUTO_INEXISTENTE', grupo: 'ITENS', titulo: `${nItem}: o produto não existe mais no cadastro.`, acoes: [{ rotulo: 'Editar', rota: rotaOrigem }] });
      return;
    }
    if (pr.tipo !== 'P') {
      pend.push({ nivel: 'aviso', codigo: 'ITEM_SERVICO', grupo: 'ITENS', titulo: `${nItem} é serviço e fica fora da NF-e de produto.`, detalhe: 'Serviço é emitido por nota de serviço (NFS-e, prefeitura).' });
      return;
    }
    itensNota += 1;
    const ncm = somenteDigitos(pr.ncm);
    if (!ncm) {
      pend.push({
        nivel: 'aviso',
        codigo: 'PRODUTO_SEM_NCM',
        grupo: 'ITENS',
        titulo: `${nItem}: o produto está sem NCM (sairá como 0000.00.00).`,
        detalhe: 'Informe o NCM do produto para a nota sair correta (ex.: notebook 8471.30.12, monitor 8528.52.00).',
        acoes: [{ rotulo: 'Informar NCM do produto', rota: `/produtos/${pr.id}/editar` }],
      });
    } else if (ncm.length !== 8) {
      pend.push({ nivel: 'erro', codigo: 'PRODUTO_NCM_INVALIDO', grupo: 'ITENS', titulo: `${nItem}: NCM "${pr.ncm}" inválido (precisa de 8 dígitos).`, acoes: [{ rotulo: 'Corrigir NCM', rota: `/produtos/${pr.id}/editar` }] });
    }
  });
  if (!p.itens.length) pend.push({ nivel: 'erro', codigo: 'SEM_ITENS', grupo: 'ITENS', titulo: `${nomeOrigem[0].toUpperCase()}${nomeOrigem.slice(1)} não tem itens.`, acoes: [{ rotulo: 'Editar', rota: rotaOrigem }] });
  else if (!pend.some((x) => x.grupo === 'ITENS' && x.nivel === 'erro')) ok.push(`${itensNota} item(ns) de produto`);

  // ------------------------------------------------------------ cliente
  const c = await db.contato.findUnique({ where: { id: p.contatoId } });
  const rotaCliente = c ? `/contatos/${c.id}/editar` : '/contatos';
  if (!c) {
    pend.push({ nivel: 'erro', codigo: 'SEM_CLIENTE', grupo: 'CLIENTE', titulo: 'O cliente não foi encontrado.', acoes: [{ rotulo: 'Editar', rota: rotaOrigem }] });
  } else {
    const doc = somenteDigitos(c.documento);
    const pj = c.tipoPessoa === 'J' || doc.length === 14;
    const docOk = pj ? cnpjValido(doc) : cpfValido(doc);
    const nomeCli = `O cliente ${c.nome}`;
    if (!doc) {
      if (!nfce) pend.push({ nivel: 'erro', codigo: 'CLIENTE_SEM_DOCUMENTO', grupo: 'CLIENTE', titulo: `${nomeCli} está sem CPF/CNPJ.`, detalhe: 'A NF-e (modelo 55) exige o documento do destinatário. Para consumidor sem cadastro use NFC-e.', acoes: [{ rotulo: 'Informar CPF/CNPJ', rota: rotaCliente }] });
    } else if (!docOk) {
      pend.push({ nivel: 'erro', codigo: 'CLIENTE_DOCUMENTO_INVALIDO', grupo: 'CLIENTE', titulo: `${nomeCli} tem ${pj ? 'CNPJ' : 'CPF'} inválido (${c.documento}).`, acoes: [{ rotulo: 'Corrigir documento', rota: rotaCliente }] });
    }
    if (!nfce) {
      const falta: string[] = [];
      if (vazio(c.logradouro)) falta.push('endereço (rua)');
      if (vazio(c.bairro)) falta.push('bairro');
      if (somenteDigitos(c.cep).length !== 8) falta.push('CEP');
      if (vazio(c.municipio)) falta.push('cidade');
      if (somenteDigitos(c.codigoMunicipio).length !== 7) falta.push('código IBGE da cidade');
      if (vazio(c.uf)) falta.push('UF');
      if (falta.length) {
        pend.push({
          nivel: 'erro',
          codigo: 'CLIENTE_SEM_ENDERECO',
          grupo: 'CLIENTE',
          titulo: `${nomeCli} está sem endereço completo: falta ${falta.join(', ')}.`,
          detalhe: 'Digite o CEP no cadastro do cliente que rua, bairro, cidade, UF e código IBGE são preenchidos sozinhos; depois só o número.',
          acoes: [{ rotulo: 'Completar endereço do cliente', rota: rotaCliente }],
        });
      } else if (vazio(c.numero)) {
        pend.push({ nivel: 'aviso', codigo: 'CLIENTE_SEM_NUMERO', grupo: 'CLIENTE', titulo: `${nomeCli} está sem o número do endereço (sairá "S/N").`, acoes: [{ rotulo: 'Informar número', rota: rotaCliente }] });
      }
      if (pj && !c.ie && !c.ieIsento) {
        pend.push({ nivel: 'aviso', codigo: 'CLIENTE_PJ_SEM_IE', grupo: 'CLIENTE', titulo: `${nomeCli} é empresa e está sem Inscrição Estadual.`, detalhe: 'Se a empresa for contribuinte do ICMS, informe a IE; se não, marque "Isento". Sem isso a nota sai como não contribuinte.', acoes: [{ rotulo: 'Informar IE do cliente', rota: rotaCliente }] });
      }
      if (emp?.uf && c.uf && emp.uf.toUpperCase() !== c.uf.toUpperCase()) {
        pend.push({ nivel: 'aviso', codigo: 'CLIENTE_OUTRO_ESTADO', grupo: 'CLIENTE', titulo: `Cliente de outro estado (${c.uf}): a nota usará CFOP de venda interestadual.` });
      }
    }
    if (!pend.some((x) => x.grupo === 'CLIENTE' && x.nivel === 'erro')) ok.push(nfce ? 'Cliente (NFC-e)' : 'Documento e endereço do cliente');
  }

  const erros = pend.filter((x) => x.nivel === 'erro').length;
  return {
    podeEmitir: erros === 0,
    modelo: p.modelo,
    erros,
    avisos: pend.length - erros,
    pendencias: pend.sort((a, b) => (a.nivel === b.nivel ? 0 : a.nivel === 'erro' ? -1 : 1)),
    ok,
    resumo: {
      cliente: c?.nome || '—',
      itensNota,
      proximoNumero: emp ? (nfce ? emp.proximoNumeroNfce : emp.proximoNumeroNfe) : 0,
      serie: emp ? (nfce ? emp.serieNfce : emp.serieNfe) : 0,
      ambiente: emp?.ambienteFiscal === 1 ? 'PRODUÇÃO' : 'HOMOLOGAÇÃO',
      provedor: emp?.provedorFiscal || 'mock',
    },
  };
}

/** Mensagem curta para o erro 422 quando alguém tenta gerar com pendências. */
export function mensagemPendencias(r: ResultadoChecagem): string {
  const erros = r.pendencias.filter((x) => x.nivel === 'erro');
  if (erros.length === 1) return `Não dá para emitir a nota ainda: ${erros[0].titulo}`;
  return `Não dá para emitir a nota ainda — ${erros.length} pendências: ${erros.map((e) => e.titulo).join(' · ')}`;
}

