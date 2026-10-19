/**
 * Serviço fiscal: orquestra transmissão, consulta, cancelamento, CC-e, inutilização,
 * arquivos (XML/DANFE) e eventos do sistema.
 */
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../lib/env.js';
import { AppError, NotFound } from '../../lib/errors.js';
import { eventos } from '../../core/eventos.js';
import { obterProvedor } from './provedor.js';
import { gerarDanfe, gerarDanfeNfce } from './danfe.js';
import type { NotaCompleta } from './xml.js';

const INCLUDE_NOTA = {
  itens: { orderBy: { numeroItem: 'asc' as const } },
  contato: true,
  eventos: { orderBy: { data: 'desc' as const } },
  venda: { select: { id: true, numero: true } },
  os: { select: { id: true, numero: true } },
};

export async function carregarNota(id: number): Promise<NotaCompleta & { eventos: any[] }> {
  const nota = await prisma.notaFiscal.findUnique({ where: { id }, include: INCLUDE_NOTA });
  if (!nota) throw new NotFound('Nota fiscal');
  return nota as any;
}

export async function empresa() {
  const emp = await prisma.empresa.findUnique({ where: { id: 1 } });
  if (!emp) throw new AppError('Empresa não configurada.', 500);
  return emp;
}

/** Percentual aproximado de tributos (Lei 12.741/2012) por capítulo do NCM — tabela simplificada baseada no IBPT. */
const IBPT_APROX: Record<string, number> = {
  '84': 30.0, '85': 33.9, '90': 32.0, '39': 35.0, '48': 28.0, '49': 15.0, '73': 33.0, '94': 36.0, '95': 37.0, '87': 42.0, '33': 40.0, '22': 45.0,
};
export function percentualTributosAprox(ncm: string | null | undefined): number {
  const cap = (ncm || '').replace(/\D/g, '').slice(0, 2);
  return IBPT_APROX[cap] ?? 30.0;
}

export function caminhoXml(chave: string) {
  return path.join(env.STORAGE_DIR, 'nfe', `${chave}.xml`);
}
export function caminhoDanfe(chave: string) {
  return path.join(env.STORAGE_DIR, 'danfe', `${chave}.pdf`);
}

/** Gera (ou regenera) o PDF do DANFE e salva em storage/danfe/<chave>.pdf */
export async function gerarPdfDanfe(notaId: number): Promise<{ buffer: Buffer; caminho: string | null }> {
  const nota = await carregarNota(notaId);
  const emp = await empresa();
  const buffer = nota.modelo === 65 ? await gerarDanfeNfce(emp, nota) : await gerarDanfe(emp, nota);
  let caminho: string | null = null;
  if (nota.chave) {
    caminho = caminhoDanfe(nota.chave);
    fs.writeFileSync(caminho, buffer);
    await prisma.notaFiscal.update({ where: { id: notaId }, data: { danfePath: `/uploads/danfe/${nota.chave}.pdf` } });
  }
  return { buffer, caminho };
}

export async function transmitir(notaId: number) {
  const nota = await carregarNota(notaId);
  if (!['PENDENTE', 'REJEITADA', 'ERRO'].includes(nota.situacao)) {
    throw new AppError(`A nota está "${nota.situacao}" e não pode ser transmitida.`, 422, 'NOTA_SITUACAO');
  }
  const emp = await empresa();
  const provedor = await obterProvedor(emp);

  // garante que o ambiente da nota segue a configuração atual
  if (nota.ambiente !== emp.ambienteFiscal) {
    await prisma.notaFiscal.update({ where: { id: notaId }, data: { ambiente: emp.ambienteFiscal } });
    nota.ambiente = emp.ambienteFiscal;
  }
  // preenche tributos aproximados nos itens, se vazios
  for (const it of nota.itens) {
    if (!it.valorTributosAprox) {
      const pct = percentualTributosAprox(it.ncm);
      it.valorTributosAprox = Math.round(it.valorTotal * pct) / 100;
      await prisma.notaFiscalItem.update({ where: { id: it.id }, data: { valorTributosAprox: it.valorTributosAprox, informacoesAdicionais: it.informacoesAdicionais || `Trib. aprox. R$ ${it.valorTributosAprox.toFixed(2)} (${pct}%) Fonte: IBPT` } });
    }
  }
  if (!nota.dataEmissao || nota.situacao === 'REJEITADA') {
    nota.dataEmissao = new Date();
  }

  await prisma.notaFiscal.update({ where: { id: notaId }, data: { situacao: 'PROCESSANDO', dataEmissao: nota.dataEmissao } });

  let r;
  try {
    r = await provedor.transmitir(nota, emp);
  } catch (e: any) {
    await prisma.notaFiscal.update({ where: { id: notaId }, data: { situacao: 'ERRO', motivo: String(e?.message || e).slice(0, 1000), cStat: e?.code || 'ERRO' } });
    throw e;
  }

  const data: any = {
    situacao: r.situacao,
    chave: r.chave,
    protocolo: r.protocolo ?? null,
    recibo: r.recibo ?? null,
    cStat: r.cStat,
    motivo: r.motivo,
    xml: r.xmlAssinado,
    xmlProtocolo: r.xmlProc ?? null,
    dataAutorizacao: r.dataAutorizacao ?? null,
    qrCode: r.qrCode ?? null,
    urlChave: r.urlChave ?? null,
  };
  if (r.situacao === 'REJEITADA') {
    // nota rejeitada pode ser corrigida e reenviada com o MESMO número; limpa a chave para gerar outra (cNF novo)
    data.chave = null;
  }
  // chave já usada por outra nota (ex.: retransmissão) → evita violar unique
  if (data.chave) {
    const dup = await prisma.notaFiscal.findFirst({ where: { chave: data.chave, NOT: { id: notaId } } });
    if (dup) data.chave = null;
  }
  const atualizada = await prisma.notaFiscal.update({ where: { id: notaId }, data });

  if (r.situacao === 'AUTORIZADA' && r.chave) {
    fs.writeFileSync(caminhoXml(r.chave), r.xmlProc || r.xmlAssinado, 'utf8');
    try {
      await gerarPdfDanfe(notaId);
    } catch (e) {
      console.error('[fiscal] falha ao gerar DANFE', e);
    }
    eventos.emitir('nfe.autorizada', { notaId });
  }
  return { situacao: atualizada.situacao, chave: atualizada.chave, protocolo: atualizada.protocolo, cStat: atualizada.cStat, motivo: atualizada.motivo };
}

export async function consultar(notaId: number) {
  const nota = await carregarNota(notaId);
  if (!nota.chave) throw new AppError('A nota ainda não possui chave de acesso (não foi transmitida).', 422);
  const emp = await empresa();
  const provedor = await obterProvedor(emp);
  const r = await provedor.consultar(nota.chave, emp, nota.modelo as 55 | 65);
  const data: any = { cStat: r.cStat, motivo: r.motivo };
  if (r.situacao === 'AUTORIZADA') {
    data.situacao = 'AUTORIZADA';
    if (r.protocolo) data.protocolo = r.protocolo;
    if (r.xmlProt && nota.xml && !nota.xmlProtocolo) data.xmlProtocolo = `<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">${nota.xml}${r.xmlProt}</nfeProc>`;
  } else if (r.situacao === 'CANCELADA') data.situacao = 'CANCELADA';
  else if (r.situacao === 'DENEGADA') data.situacao = 'DENEGADA';
  await prisma.notaFiscal.update({ where: { id: notaId }, data });
  return r;
}

export async function cancelar(notaId: number, justificativa: string, usuarioId: number | null) {
  if (justificativa.trim().length < 15) throw new AppError('A justificativa deve ter no mínimo 15 caracteres.', 422);
  const nota = await carregarNota(notaId);
  if (nota.situacao !== 'AUTORIZADA') throw new AppError('Só é possível cancelar notas autorizadas.', 422);
  const emp = await empresa();
  const provedor = await obterProvedor(emp);
  const seq = (await prisma.notaFiscalEvento.count({ where: { notaId, tipo: 'CANCELAMENTO' } })) + 1;
  const r = await provedor.cancelar(nota, emp, justificativa, seq);
  await prisma.notaFiscalEvento.create({
    data: { notaId, tipo: 'CANCELAMENTO', sequencia: seq, justificativa, protocolo: r.protocolo, cStat: r.cStat, motivo: r.motivo, xml: r.xml, status: r.sucesso ? 'AUTORIZADO' : 'REJEITADO' },
  });
  if (!r.sucesso) throw new AppError(`Cancelamento rejeitado pela SEFAZ: ${r.cStat} - ${r.motivo}`, 422, 'SEFAZ_REJEICAO');
  await prisma.notaFiscal.update({ where: { id: notaId }, data: { situacao: 'CANCELADA', motivo: r.motivo, cStat: r.cStat } });
  if (nota.chave && r.xml) fs.writeFileSync(path.join(env.STORAGE_DIR, 'nfe', `${nota.chave}-canc.xml`), r.xml, 'utf8');
  try { await gerarPdfDanfe(notaId); } catch { /* ignore */ }
  eventos.emitir('nfe.cancelada', { notaId });
  void usuarioId;
  return r;
}

export async function cartaCorrecao(notaId: number, texto: string) {
  if (texto.trim().length < 15) throw new AppError('O texto da correção deve ter no mínimo 15 caracteres.', 422);
  const nota = await carregarNota(notaId);
  if (nota.situacao !== 'AUTORIZADA') throw new AppError('Carta de correção só para notas autorizadas.', 422);
  if (nota.modelo === 65) throw new AppError('NFC-e não admite carta de correção.', 422);
  const emp = await empresa();
  const provedor = await obterProvedor(emp);
  const seq = (await prisma.notaFiscalEvento.count({ where: { notaId, tipo: 'CARTA_CORRECAO' } })) + 1;
  const r = await provedor.cartaCorrecao(nota, emp, texto, seq);
  await prisma.notaFiscalEvento.create({
    data: { notaId, tipo: 'CARTA_CORRECAO', sequencia: seq, justificativa: texto, protocolo: r.protocolo, cStat: r.cStat, motivo: r.motivo, xml: r.xml, status: r.sucesso ? 'AUTORIZADO' : 'REJEITADO' },
  });
  if (!r.sucesso) throw new AppError(`Carta de correção rejeitada: ${r.cStat} - ${r.motivo}`, 422, 'SEFAZ_REJEICAO');
  return r;
}

export async function inutilizar(modelo: 55 | 65, serie: number, inicio: number, fim: number, justificativa: string) {
  if (justificativa.trim().length < 15) throw new AppError('A justificativa deve ter no mínimo 15 caracteres.', 422);
  if (fim < inicio) throw new AppError('Número final deve ser maior ou igual ao inicial.', 422);
  const emp = await empresa();
  const provedor = await obterProvedor(emp);
  const r = await provedor.inutilizar(emp, modelo, serie, inicio, fim, justificativa, emp.ambienteFiscal as 1 | 2);
  if (!r.sucesso) throw new AppError(`Inutilização rejeitada: ${r.cStat} - ${r.motivo}`, 422, 'SEFAZ_REJEICAO');
  // registra notas "fantasma" inutilizadas para manter a sequência
  for (let n = inicio; n <= fim; n++) {
    const existente = await prisma.notaFiscal.findUnique({ where: { modelo_serie_numero: { modelo, serie, numero: n } } });
    if (existente) {
      if (existente.situacao === 'AUTORIZADA') continue;
      await prisma.notaFiscal.update({ where: { id: existente.id }, data: { situacao: 'INUTILIZADA', protocolo: r.protocolo, motivo: r.motivo, cStat: r.cStat } });
    } else {
      await prisma.notaFiscal.create({ data: { tipo: 1, modelo, serie, numero: n, situacao: 'INUTILIZADA', ambiente: emp.ambienteFiscal, protocolo: r.protocolo, motivo: r.motivo, cStat: r.cStat, naturezaOperacao: 'INUTILIZADA' } });
    }
  }
  return r;
}

export async function statusSefaz() {
  const emp = await empresa();
  const provedor = await obterProvedor(emp);
  try {
    const r = await provedor.statusServico(emp, 55, emp.ambienteFiscal as 1 | 2);
    return { ...r, ambiente: emp.ambienteFiscal, provedor: provedor.nome };
  } catch (e: any) {
    return { online: false, cStat: e?.code || 'ERRO', motivo: e?.message || String(e), ambiente: emp.ambienteFiscal, provedor: provedor.nome };
  }
}

/** Próximo número de nota, incrementando o contador da empresa dentro de uma transação. */
export async function proximoNumeroNota(modelo: 55 | 65) {
  return prisma.$transaction(async (tx) => {
    const emp = await tx.empresa.findUnique({ where: { id: 1 } });
    if (!emp) throw new AppError('Empresa não configurada.', 500);
    const serie = modelo === 65 ? emp.serieNfce : emp.serieNfe;
    let numero = modelo === 65 ? emp.proximoNumeroNfce : emp.proximoNumeroNfe;
    // pula números já existentes
    while (await tx.notaFiscal.findUnique({ where: { modelo_serie_numero: { modelo, serie, numero } } })) numero++;
    await tx.empresa.update({ where: { id: 1 }, data: modelo === 65 ? { proximoNumeroNfce: numero + 1 } : { proximoNumeroNfe: numero + 1 } });
    return { serie, numero, ambiente: emp.ambienteFiscal };
  });
}
