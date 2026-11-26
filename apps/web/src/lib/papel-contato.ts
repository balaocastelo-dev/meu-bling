/**
 * Espelho de apps/api/src/modules/comum/papel-contato.ts:
 * cliente e fornecedor são papéis do mesmo contato (AMBOS). Transportadora não entra nessa conta.
 */
import type { QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, mensagemErro } from '@/lib/api';
import type { Contato } from '@/types';

export type PapelComercial = 'CLIENTE' | 'FORNECEDOR';

export function papelComercial(tipoAtual: string | null | undefined, papel: PapelComercial): 'CLIENTE' | 'FORNECEDOR' | 'AMBOS' {
  if (tipoAtual === 'AMBOS') return 'AMBOS';
  if (tipoAtual === papel) return papel;
  if (tipoAtual === 'CLIENTE' || tipoAtual === 'FORNECEDOR') return 'AMBOS';
  return papel;
}

export function rotuloPapel(tipo: string | null | undefined): string {
  switch (tipo) {
    case 'CLIENTE':
      return 'Cliente';
    case 'FORNECEDOR':
      return 'Fornecedor';
    case 'AMBOS':
      return 'Cliente e fornecedor';
    case 'TRANSPORTADORA':
      return 'Transportadora';
    default:
      return 'Contato';
  }
}

/** AMBOS quando ainda falta o papel; null quando não deve gravar (já tem o papel, ou é transportadora). */
export function tipoParaPromover(tipoAtual: string | null | undefined, papel: PapelComercial): 'AMBOS' | null {
  if (tipoAtual !== 'CLIENTE' && tipoAtual !== 'FORNECEDOR' && tipoAtual !== 'AMBOS') return null;
  const novo = papelComercial(tipoAtual, papel);
  return novo === tipoAtual ? null : 'AMBOS';
}

export async function promoverSePrecisar(qc: QueryClient, contato: Contato, papel: PapelComercial): Promise<Contato> {
  const tipo = tipoParaPromover(contato.tipo, papel);
  if (!tipo) return contato;
  const atualizado = await api.put<Contato>(`/contatos/${contato.id}`, { tipo });
  await qc.invalidateQueries({ queryKey: ['contatos'] });
  return atualizado;
}

/** Ao escolher na busca: promove em segundo plano. Se falhar, o salvamento da compra/venda ainda promove. */
export function aoEscolherPapel(qc: QueryClient, dados: unknown, papel: PapelComercial) {
  const c = dados as Contato | undefined;
  if (!c?.id) return;
  void promoverSePrecisar(qc, c, papel).catch((e) => toast.error(mensagemErro(e, 'Não foi possível marcar o papel do contato.')));
}

export function mensagemContatoExistente(papel: PapelComercial, promoveu: boolean, reativou: boolean): string {
  const nome = papel === 'FORNECEDOR' ? 'fornecedor' : 'cliente';
  if (reativou && promoveu) return `Contato reativado, selecionado e marcado também como ${nome}.`;
  if (reativou) return 'Contato reativado e selecionado.';
  if (promoveu) return `Contato existente selecionado e marcado também como ${nome}.`;
  return 'Contato existente selecionado.';
}
