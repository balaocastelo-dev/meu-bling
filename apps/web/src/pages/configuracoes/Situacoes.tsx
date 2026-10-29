import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import clsx from 'clsx';
import { GitBranch, Lock, Pencil, Plus, Save, Trash2 } from 'lucide-react';
import { api, mensagemErro } from '@/lib/api';
import { useAcoesSituacao, useSituacoes } from '@/hooks/useListas';
import { Badge, BadgeCor, Button, Card, Checkbox, ConfirmDialog, EmptyState, Input, Modal, PageHeader, Segmentado, Skeleton, Tabs } from '@/components/ui';
import type { AcaoSituacao, Modulo, Situacao, SituacaoTransicao } from '@/types';

const CORES_SUGERIDAS = ['#94a3b8', '#3b82f6', '#f59e0b', '#8b5cf6', '#22c55e', '#ef4444', '#0ea5e9', '#f97316', '#64748b', '#06b6d4', '#84cc16', '#16a34a', '#ec4899'];

/** Fallback quando a rota /situacoes/acoes não responde */
const ACOES_PADRAO: AcaoSituacao[] = [
  { nome: 'lancarEstoque', descricao: 'Baixa (venda/OS) ou entrada (compra) de estoque', modulos: ['VENDA', 'COMPRA', 'OS'] },
  { nome: 'estornarEstoque', descricao: 'Reverte o lançamento de estoque', modulos: ['VENDA', 'COMPRA', 'OS'] },
  { nome: 'reservarEstoque', descricao: 'Reserva o estoque sem baixar', modulos: ['VENDA', 'OS'] },
  { nome: 'liberarReserva', descricao: 'Libera a reserva de estoque', modulos: ['VENDA', 'OS'] },
  { nome: 'lancarContas', descricao: 'Gera contas a receber/pagar das parcelas', modulos: ['VENDA', 'COMPRA', 'OS'] },
  { nome: 'estornarContas', descricao: 'Cancela as contas geradas', modulos: ['VENDA', 'COMPRA', 'OS'] },
  { nome: 'gerarNfe', descricao: 'Gera a NF-e pendente', modulos: ['VENDA', 'OS'] },
  { nome: 'notificarCliente', descricao: 'Dispara templates genéricos de notificação', modulos: ['VENDA', 'COMPRA', 'OS', 'ORCAMENTO'] },
];

type FormSit = Partial<Situacao>;

/** Editor de situações por módulo + matriz de transições */
export default function Situacoes() {
  const qc = useQueryClient();
  const [modulo, setModulo] = useState<Modulo>('VENDA');
  const [aba, setAba] = useState('lista');
  const { data: situacoes, isLoading } = useSituacoes(modulo);
  const { data: acoesApi } = useAcoesSituacao();
  const acoes = (acoesApi?.length ? acoesApi : ACOES_PADRAO).filter((a) => !a.modulos?.length || a.modulos.includes(modulo));
  const [editando, setEditando] = useState<FormSit | null>(null);
  const [excluir, setExcluir] = useState<Situacao | null>(null);

  const inv = () => qc.invalidateQueries({ queryKey: ['situacoes', modulo] });
  const salvar = useMutation({
    mutationFn: (f: FormSit) => (f.id ? api.put(`/situacoes/${f.id}`, f) : api.post('/situacoes', { ...f, modulo })),
    onSuccess: () => {
      toast.success('Situação salva.');
      inv();
      setEditando(null);
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });
  const remover = useMutation({
    mutationFn: (id: number) => api.del(`/situacoes/${id}`),
    onSuccess: () => {
      toast.success('Situação excluída.');
      inv();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const lista = situacoes ?? [];

  return (
    <div>
      <PageHeader
        migalhas={[{ rotulo: 'Configurações', para: '/configuracoes' }, { rotulo: 'Situações' }]}
        titulo="Situações"
        descricao="Status de vendas, compras e OS — com ações automáticas ao entrar na situação e matriz de transições permitidas."
        acoes={
          <>
            <Segmentado valor={modulo} onMudar={setModulo} opcoes={[{ valor: 'VENDA', rotulo: 'Vendas' }, { valor: 'ORCAMENTO', rotulo: 'Orçamentos' }, { valor: 'COMPRA', rotulo: 'Compras' }, { valor: 'OS', rotulo: 'Ordens de serviço' }]} />
            <Button variante="primario" icone={<Plus className="h-4 w-4" />} onClick={() => setEditando({ nome: '', cor: CORES_SUGERIDAS[lista.length % CORES_SUGERIDAS.length], ordem: lista.length + 1, acoes: [], inicial: false, final: false, cancelamento: false, ativo: true })}>Nova situação</Button>
          </>
        }
      />
      <Tabs className="mb-4" ativa={aba} onMudar={setAba} abas={[{ id: 'lista', rotulo: 'Situações e ações', contador: lista.length }, { id: 'matriz', rotulo: 'Matriz de transições', icone: <GitBranch className="h-3.5 w-3.5" /> }]} />

      {aba === 'lista' && (
        <Card semPadding>
          {isLoading ? (
            <div className="p-4"><Skeleton className="h-64" /></div>
          ) : !lista.length ? (
            <EmptyState titulo="Nenhuma situação" />
          ) : (
            <div className="overflow-x-auto">
            <table className="tbl tbl-pilha">
              <thead><tr><th className="w-12">#</th><th>Situação</th><th>Marcadores</th><th>Ações ao entrar</th><th className="w-24" /></tr></thead>
              <tbody>
                {lista.map((s) => (
                  <tr key={s.id} className={clsx('clicavel', !s.ativo && 'opacity-50')} onClick={() => setEditando({ ...s })}>
                    <td className="pilha-oculto text-slate-400">{s.ordem}</td>
                    <td data-rotulo="Situação"><BadgeCor cor={s.cor} tamanho="md">{s.nome}</BadgeCor></td>
                    <td className="space-x-1" data-rotulo="Marcadores">
                      {s.inicial && <Badge tom="azul">Inicial</Badge>}
                      {s.final && <Badge tom="verde">Final</Badge>}
                      {s.cancelamento && <Badge tom="vermelho">Cancelamento</Badge>}
                      {s.sistema && <Badge tom="cinza"><Lock className="h-3 w-3" /> Sistema</Badge>}
                      {!s.ativo && <Badge tom="cinza">Inativa</Badge>}
                    </td>
                    <td data-rotulo="Ações ao entrar"><div className="flex flex-wrap gap-1">{s.acoes.length ? s.acoes.map((a) => <code key={a} className="whitespace-nowrap rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700">{a}</code>) : <span className="text-xs text-slate-400">—</span>}</div></td>
                    <td className="pilha-canto">
                      <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                        <Button tamanho="xs" variante="fantasma" icone={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEditando({ ...s })} />
                        {!s.sistema && <Button tamanho="xs" variante="fantasma" icone={<Trash2 className="h-3.5 w-3.5 text-red-500" />} onClick={() => setExcluir(s)} />}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </Card>
      )}

      {aba === 'matriz' && <MatrizTransicoes modulo={modulo} situacoes={lista.filter((s) => s.ativo)} />}

      <Modal
        aberto={!!editando}
        onFechar={() => setEditando(null)}
        titulo={editando?.id ? `Editar "${editando.nome}"` : 'Nova situação'}
        tamanho="lg"
        rodape={<><Button variante="secundario" onClick={() => setEditando(null)}>Cancelar</Button><Button variante="primario" carregando={salvar.isPending} disabled={!editando?.nome?.trim()} onClick={() => editando && salvar.mutate(editando)}>Salvar</Button></>}
      >
        {editando && (
          <div className="space-y-4">
            <div className="grid grid-cols-6 gap-3">
              <Input className="col-span-4" label="Nome" obrigatorio value={editando.nome ?? ''} onChange={(e) => setEditando({ ...editando, nome: e.target.value })} autoFocus />
              <Input className="col-span-2" label="Ordem" type="number" value={editando.ordem ?? 0} onChange={(e) => setEditando({ ...editando, ordem: Number(e.target.value) })} />
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-slate-600">Cor</p>
              <div className="flex flex-wrap items-center gap-2">
                {CORES_SUGERIDAS.map((c) => (
                  <button key={c} type="button" onClick={() => setEditando({ ...editando, cor: c })} className={clsx('h-7 w-7 rounded-full border-2 transition', editando.cor === c ? 'border-slate-900 scale-110' : 'border-transparent')} style={{ backgroundColor: c }} aria-label={c} />
                ))}
                <input type="color" value={editando.cor ?? '#64748b'} onChange={(e) => setEditando({ ...editando, cor: e.target.value })} className="h-7 w-10 cursor-pointer rounded border border-slate-300" />
                <BadgeCor cor={editando.cor} tamanho="md">{editando.nome || 'Prévia'}</BadgeCor>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Checkbox label="Inicial" descricao="Situação padrão ao criar" checked={!!editando.inicial} onChange={(e) => setEditando({ ...editando, inicial: e.target.checked })} />
              <Checkbox label="Final" descricao="Conta em relatórios/faturamento" checked={!!editando.final} onChange={(e) => setEditando({ ...editando, final: e.target.checked })} />
              <Checkbox label="Cancelamento" descricao="Marca como cancelada" checked={!!editando.cancelamento} onChange={(e) => setEditando({ ...editando, cancelamento: e.target.checked })} />
              <Checkbox label="Ativa" checked={editando.ativo ?? true} onChange={(e) => setEditando({ ...editando, ativo: e.target.checked })} />
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-slate-600">Ações executadas ao ENTRAR nesta situação</p>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {acoes.map((a) => (
                  <label key={a.nome} className={clsx('flex cursor-pointer items-start gap-2 rounded-md border p-2 text-sm transition', editando.acoes?.includes(a.nome) ? 'border-brand-300 bg-brand-50' : 'border-slate-200 hover:bg-slate-50')}>
                    <input type="checkbox" className="mt-0.5 accent-red-600" checked={editando.acoes?.includes(a.nome) ?? false} onChange={(e) => setEditando({ ...editando, acoes: e.target.checked ? [...(editando.acoes ?? []), a.nome] : (editando.acoes ?? []).filter((x) => x !== a.nome) })} />
                    <span><code className="text-xs font-semibold">{a.nome}</code><span className="block text-xs text-slate-500">{a.descricao}</span></span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>
      <ConfirmDialog aberto={!!excluir} onFechar={() => setExcluir(null)} titulo={`Excluir "${excluir?.nome}"?`} descricao="Situações em uso por registros não podem ser excluídas; prefira inativar." textoConfirmar="Excluir" onConfirmar={async () => { if (excluir) await remover.mutateAsync(excluir.id); }} />
    </div>
  );
}

/** Matriz origem × destino com checkboxes → PUT /situacoes/transicoes */
function MatrizTransicoes({ modulo, situacoes }: { modulo: Modulo; situacoes: Situacao[] }) {
  const qc = useQueryClient();
  const { data: transicoes, isLoading } = useQuery({ queryKey: ['situacoes-transicoes', modulo], queryFn: () => api.get<SituacaoTransicao[]>('/situacoes/transicoes', { modulo }) });
  const [ativas, setAtivas] = useState<Set<string>>(new Set());
  const [sujo, setSujo] = useState(false);
  const chave = (o: number, d: number) => `${o}-${d}`;

  useEffect(() => {
    if (transicoes) {
      setAtivas(new Set(transicoes.filter((t) => t.ativo).map((t) => chave(t.origemId, t.destinoId))));
      setSujo(false);
    }
  }, [transicoes]);

  const acoesExtras = useMemo(() => new Map((transicoes ?? []).map((t) => [chave(t.origemId, t.destinoId), t.acoes ?? []])), [transicoes]);

  const alternar = (o: number, d: number) => {
    setAtivas((s) => {
      const n = new Set(s);
      const k = chave(o, d);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
    setSujo(true);
  };
  const alternarLinha = (o: number, marcar: boolean) => {
    setAtivas((s) => {
      const n = new Set(s);
      situacoes.forEach((d) => {
        if (d.id === o) return;
        if (marcar) n.add(chave(o, d.id));
        else n.delete(chave(o, d.id));
      });
      return n;
    });
    setSujo(true);
  };

  const salvar = useMutation({
    mutationFn: () => {
      const lista: SituacaoTransicao[] = [];
      situacoes.forEach((o) =>
        situacoes.forEach((d) => {
          if (o.id === d.id) return;
          const k = chave(o.id, d.id);
          if (ativas.has(k)) lista.push({ origemId: o.id, destinoId: d.id, ativo: true, acoes: acoesExtras.get(k) ?? [] });
        }),
      );
      return api.put('/situacoes/transicoes', { modulo, transicoes: lista });
    },
    onSuccess: () => {
      toast.success('Transições salvas.');
      qc.invalidateQueries({ queryKey: ['situacoes-transicoes', modulo] });
      setSujo(false);
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  if (isLoading) return <Skeleton className="h-96" />;

  return (
    <Card
      titulo="Transições permitidas"
      descricao="Linha = situação atual; coluna = destino permitido. Administradores podem forçar transições fora da matriz."
      acoes={<Button variante="primario" tamanho="sm" icone={<Save className="h-3.5 w-3.5" />} disabled={!sujo} carregando={salvar.isPending} onClick={() => salvar.mutate()}>Salvar matriz</Button>}
      semPadding
    >
      <div className="overflow-auto">
        <table className="min-w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-white px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">De ↓ / Para →</th>
              {situacoes.map((d) => (
                <th key={d.id} className="px-1 py-2 align-bottom">
                  <div className="flex h-24 items-end justify-center">
                    <span className="inline-flex origin-bottom-left -rotate-45 items-center gap-1 whitespace-nowrap text-[11px] font-medium text-slate-700" style={{ transform: 'rotate(-45deg) translateX(8px)' }}>
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: d.cor }} />
                      {d.nome}
                    </span>
                  </div>
                </th>
              ))}
              <th className="px-2 text-[10px] text-slate-400">todas</th>
            </tr>
          </thead>
          <tbody>
            {situacoes.map((o) => {
              const total = situacoes.filter((d) => d.id !== o.id && ativas.has(chave(o.id, d.id))).length;
              return (
                <tr key={o.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="sticky left-0 z-10 bg-white px-3 py-1.5"><BadgeCor cor={o.cor}>{o.nome}</BadgeCor></td>
                  {situacoes.map((d) => (
                    <td key={d.id} className="px-1 py-1.5 text-center">
                      {o.id === d.id ? (
                        <span className="inline-block h-4 w-4 rounded bg-slate-100" />
                      ) : (
                        <input type="checkbox" className="h-4 w-4 cursor-pointer accent-red-600" checked={ativas.has(chave(o.id, d.id))} onChange={() => alternar(o.id, d.id)} title={`${o.nome} → ${d.nome}`} />
                      )}
                    </td>
                  ))}
                  <td className="px-2 text-center"><button type="button" className="text-[10px] text-brand-600 hover:underline" onClick={() => alternarLinha(o.id, total < situacoes.length - 1)}>{total < situacoes.length - 1 ? 'marcar' : 'limpar'}</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
