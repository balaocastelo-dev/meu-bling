/**
 * Enfileira uma notificação manual (POST /vendas/:id/notificar e /ordens-servico/:id/notificar).
 * O envio efetivo é feito pelo worker do módulo de notificações.
 */
import { prisma } from '../../lib/prisma.js';
import { AppError, NotFound } from '../../lib/errors.js';
import { formatarData, formatarMoeda, renderTemplate } from '../../lib/util.js';
import { linkPublico } from '../publico/token.js';
import { enderecoLinha, formatarTelefone } from './html.js';

export type Canal = 'EMAIL' | 'WHATSAPP';

interface ItemVar {
  descricao: string;
  quantidade: number;
  total: number;
}

/** Variáveis disponíveis nos templates ({{cliente.nome}}, {{numero}}, {{total}}...). */
export async function variaveisTemplate(p: {
  tipo: 'VENDA' | 'OS';
  id: number;
  numero: number;
  situacao: string;
  total: number;
  data: Date;
  contato: { nome: string; email?: string | null; celular?: string | null; telefone?: string | null };
  itens: ItemVar[];
  vendedor?: string | null;
  tecnico?: string | null;
  equipamento?: string | null;
  defeito?: string | null;
  diagnostico?: string | null;
  garantiaDias?: number | null;
}) {
  const emp = await prisma.empresa.findUnique({ where: { id: 1 } });
  return {
    cliente: {
      nome: p.contato.nome,
      primeiroNome: p.contato.nome.split(' ')[0],
      email: p.contato.email || '',
      celular: p.contato.celular || '',
      telefone: p.contato.telefone || '',
    },
    numero: p.numero,
    situacao: p.situacao,
    total: formatarMoeda(p.total),
    data: formatarData(p.data),
    itens: p.itens.map((i) => `${i.quantidade}x ${i.descricao} — ${formatarMoeda(i.total)}`).join('\n'),
    equipamento: p.equipamento || '',
    defeito: p.defeito || '',
    diagnostico: p.diagnostico || '',
    tecnico: p.tecnico || '',
    vendedor: p.vendedor || '',
    garantiaDias: p.garantiaDias ?? '',
    empresa: {
      nome: emp?.nomeFantasia || emp?.razaoSocial || '',
      telefone: formatarTelefone(emp?.telefone),
      endereco: emp ? enderecoLinha(emp) : '',
      email: emp?.email || '',
    },
    chave: '',
    link: linkPublico(p.tipo === 'OS' ? 'os' : 'venda', p.id),
  };
}

export async function enfileirarNotificacao(p: {
  canal: Canal;
  templateId?: number | null;
  mensagem?: string | null;
  assunto?: string | null;
  origemTipo: 'VENDA' | 'OS';
  origemId: number;
  contatoId: number;
  contato: { nome: string; email?: string | null; celular?: string | null };
  vars: Record<string, unknown>;
}) {
  const destinatario = p.canal === 'WHATSAPP' ? p.contato.celular : p.contato.email;
  if (!destinatario) {
    throw new AppError(
      p.canal === 'WHATSAPP' ? 'O cliente não possui celular (WhatsApp) cadastrado.' : 'O cliente não possui e-mail cadastrado.',
      422,
      'SEM_DESTINATARIO',
    );
  }

  let corpo = p.mensagem?.trim() || '';
  let assunto: string | null = p.assunto || null;
  if (!corpo) {
    if (!p.templateId) throw new AppError('Informe a mensagem ou um template de notificação.', 422, 'SEM_MENSAGEM');
    const t = await prisma.templateNotificacao.findUnique({ where: { id: p.templateId } });
    if (!t) throw new NotFound('Template de notificação');
    corpo = renderTemplate(t.corpo, p.vars);
    assunto = t.assunto ? renderTemplate(t.assunto, p.vars) : assunto;
  } else {
    corpo = renderTemplate(corpo, p.vars);
    if (assunto) assunto = renderTemplate(assunto, p.vars);
  }
  if (p.canal === 'EMAIL' && !assunto) {
    assunto = `${p.origemTipo === 'OS' ? 'Ordem de Serviço' : 'Pedido'} nº ${String(p.vars.numero ?? '')} — ${String((p.vars.empresa as any)?.nome ?? '')}`;
  }

  return prisma.notificacao.create({
    data: {
      canal: p.canal,
      destinatario,
      assunto: p.canal === 'EMAIL' ? assunto : null,
      corpo,
      status: 'PENDENTE',
      origemTipo: p.origemTipo,
      origemId: p.origemId,
      contatoId: p.contatoId,
    },
  });
}
