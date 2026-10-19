import { useCategoriasFinanceiras } from '@/hooks/useListas';
import { CrudSimples } from '@/components/compartilhados/CrudSimples';
import { Badge, Checkbox, Input, Select } from '@/components/ui';
import { rotulo } from '@/lib/format';
import type { CategoriaFinanceira, GrupoDre } from '@/types';

const GRUPOS: GrupoDre[] = ['RECEITA_BRUTA', 'DEDUCAO', 'CMV', 'DESPESA_OPERACIONAL', 'DESPESA_PESSOAL', 'DESPESA_FINANCEIRA', 'RECEITA_FINANCEIRA', 'OUTRAS'];

/** Categorias financeiras (plano de contas gerencial) */
export default function CategoriasFinanceiras() {
  const { data: todas } = useCategoriasFinanceiras(false);
  return (
    <CrudSimples<CategoriaFinanceira>
      titulo="Categorias financeiras"
      descricao="Classificam receitas e despesas e definem a linha do DRE."
      rota="/categorias-financeiras"
      invalidar={['categorias-financeiras']}
      rotuloNovo="Nova categoria"
      vazio={{ nome: '', tipo: 'DESPESA', grupoDre: 'DESPESA_OPERACIONAL', paiId: null, ativo: true }}
      validar={(f) => (!f.nome?.trim() ? 'Informe o nome.' : null)}
      colunas={[
        { titulo: 'Nome', render: (c) => <span className="font-medium">{c.paiId ? <span className="text-slate-300">└ </span> : null}{c.nome}</span> },
        { titulo: 'Tipo', render: (c) => <Badge tom={c.tipo === 'RECEITA' ? 'verde' : 'vermelho'}>{rotulo(c.tipo)}</Badge> },
        { titulo: 'Grupo DRE', render: (c) => <span className="text-slate-500">{rotulo(c.grupoDre)}</span> },
        { titulo: 'Situação', render: (c) => <Badge tom={c.ativo ? 'verde' : 'cinza'}>{c.ativo ? 'Ativa' : 'Inativa'}</Badge> },
      ]}
      formulario={(f, set) => (
        <>
          <Input label="Nome" obrigatorio value={f.nome ?? ''} onChange={(e) => set({ nome: e.target.value })} autoFocus />
          <div className="grid grid-cols-2 gap-3">
            <Select label="Tipo" value={f.tipo ?? 'DESPESA'} onChange={(e) => set({ tipo: e.target.value as 'RECEITA' | 'DESPESA' })} opcoes={[{ valor: 'RECEITA', rotulo: 'Receita' }, { valor: 'DESPESA', rotulo: 'Despesa' }]} />
            <Select label="Grupo no DRE" value={f.grupoDre ?? 'DESPESA_OPERACIONAL'} onChange={(e) => set({ grupoDre: e.target.value as GrupoDre })} opcoes={GRUPOS.map((g) => ({ valor: g, rotulo: rotulo(g) }))} />
          </div>
          <Select label="Categoria pai (opcional)" value={f.paiId ?? ''} onChange={(e) => set({ paiId: e.target.value ? Number(e.target.value) : null })} opcoes={(todas ?? []).filter((c) => c.id !== f.id && !c.paiId).map((c) => ({ valor: c.id, rotulo: c.nome }))} placeholder="Nenhuma" />
          <Checkbox label="Ativa" checked={f.ativo ?? true} onChange={(e) => set({ ativo: e.target.checked })} />
        </>
      )}
    />
  );
}
