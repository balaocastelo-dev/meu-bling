/**
 * Listas auxiliares cacheadas (react-query) para preencher selects:
 * vendedores, técnicos, depósitos, formas de pagamento, categorias, situações, contas.
 * Em caso de rota indisponível devolvem array vazio (nunca quebram a tela).
 */
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type {
  AcaoSituacao,
  CategoriaFinanceira,
  CategoriaProduto,
  ContaFinanceira,
  Deposito,
  FormaPagamento,
  Modulo,
  Situacao,
  Tecnico,
  Vendedor,
} from '@/types';

const OPCOES = { staleTime: 5 * 60 * 1000, retry: 0 } as const;

async function lista<T>(caminho: string, params?: Record<string, string | boolean | undefined>): Promise<T[]> {
  try {
    const r = await api.get<T[] | { data: T[] }>(caminho, params);
    return Array.isArray(r) ? r : r?.data ?? [];
  } catch {
    return [];
  }
}

export function useVendedores(somenteAtivos = true) {
  return useQuery({ queryKey: ['vendedores', somenteAtivos], queryFn: () => lista<Vendedor>('/vendedores', somenteAtivos ? { ativo: true } : undefined), ...OPCOES });
}

export function useTecnicos(somenteAtivos = true) {
  return useQuery({ queryKey: ['tecnicos', somenteAtivos], queryFn: () => lista<Tecnico>('/tecnicos', somenteAtivos ? { ativo: true } : undefined), ...OPCOES });
}

export function useDepositos(somenteAtivos = true) {
  return useQuery({ queryKey: ['depositos', somenteAtivos], queryFn: () => lista<Deposito>('/depositos', somenteAtivos ? { ativo: true } : undefined), ...OPCOES });
}

export function useFormasPagamento(somenteAtivos = true) {
  return useQuery({ queryKey: ['formas-pagamento', somenteAtivos], queryFn: () => lista<FormaPagamento>('/formas-pagamento', somenteAtivos ? { ativo: true } : undefined), ...OPCOES });
}

export function useCategoriasFinanceiras(somenteAtivos = true) {
  return useQuery({ queryKey: ['categorias-financeiras', somenteAtivos], queryFn: () => lista<CategoriaFinanceira>('/categorias-financeiras', somenteAtivos ? { ativo: true } : undefined), ...OPCOES });
}

export function useCategoriasProduto() {
  return useQuery({ queryKey: ['categorias-produto'], queryFn: () => lista<CategoriaProduto>('/categorias-produto'), ...OPCOES });
}

export function useContasFinanceiras(somenteAtivos = true) {
  // a conta técnica "Encontro de contas (empréstimos)" nunca aparece para escolher
  return useQuery({ queryKey: ['contas-financeiras', somenteAtivos], queryFn: async () => (await lista<ContaFinanceira>('/contas-financeiras', somenteAtivos ? { ativo: true } : undefined)).filter((c) => c.tipo !== 'COMPENSACAO'), ...OPCOES });
}

export function useSituacoes(modulo: Modulo) {
  return useQuery({
    queryKey: ['situacoes', modulo],
    queryFn: async () => (await lista<Situacao>('/situacoes', { modulo })).sort((a, b) => a.ordem - b.ordem),
    ...OPCOES,
  });
}

export function useAcoesSituacao() {
  return useQuery({ queryKey: ['situacoes-acoes'], queryFn: () => lista<AcaoSituacao>('/situacoes/acoes'), ...OPCOES });
}

/** Converte uma lista em opções de <Select> */
export function opcoesDe<T extends { id: number; nome: string }>(itens: T[] | undefined) {
  return (itens ?? []).map((i) => ({ valor: i.id, rotulo: i.nome }));
}
