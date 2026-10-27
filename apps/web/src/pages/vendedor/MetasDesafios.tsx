import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import clsx from 'clsx';
import { format, endOfMonth } from 'date-fns';
import { Ban, Check, Crown, LayoutDashboard, Pencil, Plus, RotateCcw, Save, Target, Trash2, Trophy } from 'lucide-react';
import { api, mensagemErro } from '@/lib/api';
import { buscarProdutos } from '@/lib/buscas';
import { useCategoriasProduto, useVendedores } from '@/hooks/useListas';
import { Badge, Button, Card, Checkbox, DateInput, EmptyState, Input, Modal, MoneyInput, PageHeader, SearchSelect, Segmentado, Select, Skeleton, Tabs, Textarea } from '@/components/ui';
import { textoAlvo, valorDesafio } from '@/components/compartilhados/DesafioCard';
import { competenciaAtual, competenciaLabel, data, hoje, moeda, numero } from '@/lib/format';
import type { Desafio, MetaLinha, TipoDesafio } from '@/types';

/** Metas mensais e desafios de vendas (ADMIN e GERENTE) */
export default function MetasDesafios() {
  const [params, setParams] = useSearchParams();
  const aba = params.get('aba') === 'metas' ? 'metas' : 'desafios';
  return (
    <div>
      <PageHeader
        titulo="Metas e desafios"
        descricao="Defina a meta de cada vendedor e lance desafios que valem prêmio em comissão."
        acoes={
          <Link to="/meu-painel">
            <Button variante="secundario" icone={<LayoutDashboard className="h-4 w-4" />}>Ver painel do vendedor</Button>
          </Link>
        }
      />
      <Tabs
        className="mb-4"
        abas={[
          { id: 'desafios', rotulo: 'Desafios', icone: <Trophy className="h-4 w-4" /> },
          { id: 'metas', rotulo: 'Metas do mês', icone: <Target className="h-4 w-4" /> },
        ]}
        ativa={aba}
        onMudar={(id) => setParams(id === 'metas' ? { aba: 'metas' } : {})}
      />
      {aba === 'desafios' ? <AbaDesafios /> : <AbaMetas />}
    </div>
  );
}

// =====================================================================================
// DESAFIOS
// =====================================================================================
const SITUACAO: Record<Desafio['situacao'], { rotulo: string; tom: 'verde' | 'azul' | 'cinza' | 'amarelo' }> = {
  EM_ANDAMENTO: { rotulo: 'Em andamento', tom: 'verde' },
  AGENDADO: { rotulo: 'Agendado', tom: 'azul' },
  FINALIZADO: { rotulo: 'Período encerrado', tom: 'cinza' },
  ENCERRADO: { rotulo: 'Encerrado pela gestão', tom: 'amarelo' },
};

function AbaDesafios() {
  const qc = useQueryClient();
  const [filtro, setFiltro] = useState<'vigentes' | 'todos'>('vigentes');
  const [editar, setEditar] = useState<Desafio | 'novo' | null>(null);
  const { data: lista, isLoading } = useQuery({ queryKey: ['desafios', filtro], queryFn: () => api.get<Desafio[]>('/desafios', { situacao: filtro }) });

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ['desafios'] });
    qc.invalidateQueries({ queryKey: ['painel-vendedor'] });
    qc.invalidateQueries({ queryKey: ['comissoes'] });
  };
  const acao = useMutation({
    mutationFn: ({ id, tipo }: { id: number; tipo: 'encerrar' | 'reabrir' | 'excluir' }) => (tipo === 'excluir' ? api.del(`/desafios/${id}`) : api.post(`/desafios/${id}/${tipo}`, {})),
    onSuccess: (_r, v) => {
      toast.success(v.tipo === 'excluir' ? 'Desafio excluído.' : v.tipo === 'encerrar' ? 'Desafio encerrado.' : 'Desafio reaberto.');
      invalidar();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Segmentado opcoes={[{ valor: 'vigentes', rotulo: 'Vigentes e recentes' }, { valor: 'todos', rotulo: 'Todos' }]} valor={filtro} onMudar={setFiltro} />
        <Button icone={<Plus className="h-4 w-4" />} onClick={() => setEditar('novo')}>Novo desafio</Button>
      </div>

      {isLoading ? (
        <div className="grid gap-3 lg:grid-cols-2"><Skeleton className="h-56" /><Skeleton className="h-56" /></div>
      ) : !lista?.length ? (
        <Card>
          <EmptyState
            icone={<Trophy className="h-5 w-5" />}
            titulo="Nenhum desafio lançado"
            descricao='Ex.: "Vender R$ 10.000 até sexta" valendo +R$ 100. Aparece como card na tela do vendedor e o prêmio entra sozinho na comissão quando ele bate o alvo.'
            acao={<Button icone={<Plus className="h-4 w-4" />} onClick={() => setEditar('novo')}>Lançar o primeiro desafio</Button>}
          />
        </Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {lista.map((d) => {
            const s = SITUACAO[d.situacao];
            return (
              <Card key={d.id} semPadding className={clsx(!d.ativo && 'opacity-75')}>
                <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-slate-900">{d.titulo}</h3>
                      <Badge tom={s.tom}>{s.rotulo}</Badge>
                      {d.regra === 'PRIMEIRO' && <Badge tom="roxo"><Crown className="h-3 w-3" /> Só o primeiro</Badge>}
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">{textoAlvo(d)} · {data(d.inicio)} a {data(d.fim)}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-lg font-extrabold text-amber-600 num">+{moeda(d.premio)}</p>
                    {d.totalPremios > 0 && <p className="text-[11px] text-slate-500">pago/liberado: {moeda(d.totalPremios)}</p>}
                  </div>
                </div>
                <ul className="max-h-60 divide-y divide-slate-50 overflow-y-auto px-4 py-1">
                  {d.participantes.map((p) => (
                    <li key={p.vendedorId} className="flex items-center gap-3 py-2 text-sm">
                      <span className="w-32 shrink-0 truncate text-slate-700">{p.nome}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                        <div className={clsx('h-full rounded-full', p.conquistou ? 'bg-emerald-500' : 'bg-amber-500')} style={{ width: `${Math.max(2, p.pct)}%` }} />
                      </div>
                      <span className="w-28 shrink-0 text-right text-xs text-slate-500 num">{valorDesafio(d.tipo, p.atingido)}</span>
                      {p.conquistou ? <Trophy className="h-4 w-4 shrink-0 text-emerald-600" aria-label="Conquistou" /> : <span className="w-4" />}
                    </li>
                  ))}
                  {!d.participantes.length && <li className="py-3 text-center text-xs text-slate-400">Nenhum vendedor ativo participando.</li>}
                </ul>
                <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 px-4 py-2.5">
                  <Button tamanho="sm" variante="fantasma" icone={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEditar(d)}>Editar</Button>
                  {d.ativo ? (
                    <Button tamanho="sm" variante="fantasma" icone={<Ban className="h-3.5 w-3.5" />} onClick={() => confirm('Encerrar este desafio? Ninguém mais conquista o prêmio; quem já conquistou continua com ele.') && acao.mutate({ id: d.id, tipo: 'encerrar' })}>Encerrar</Button>
                  ) : (
                    <Button tamanho="sm" variante="fantasma" icone={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => acao.mutate({ id: d.id, tipo: 'reabrir' })}>Reabrir</Button>
                  )}
                  <Button tamanho="sm" variante="fantasma" className="text-red-600" icone={<Trash2 className="h-3.5 w-3.5" />} onClick={() => confirm('Excluir este desafio?') && acao.mutate({ id: d.id, tipo: 'excluir' })}>Excluir</Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {editar && <FormDesafio desafio={editar === 'novo' ? null : editar} onFechar={() => setEditar(null)} onSalvo={invalidar} />}
    </>
  );
}

interface FormState {
  titulo: string;
  descricao: string;
  tipo: TipoDesafio;
  alvo: number;
  premio: number;
  inicio: string;
  fim: string;
  regra: 'TODOS' | 'PRIMEIRO';
  todosVendedores: boolean;
  vendedoresIds: number[];
  filtro: 'NENHUM' | 'PRODUTO' | 'CATEGORIA';
  produtoId: number | null;
  produtoNome: string | null;
  categoriaId: number | null;
}

function FormDesafio({ desafio, onFechar, onSalvo }: { desafio: Desafio | null; onFechar: () => void; onSalvo: () => void }) {
  const { data: vendedores } = useVendedores();
  const { data: categorias } = useCategoriasProduto();
  const [f, setF] = useState<FormState>(() =>
    desafio
      ? {
          titulo: desafio.titulo,
          descricao: desafio.descricao ?? '',
          tipo: desafio.tipo,
          alvo: desafio.alvo,
          premio: desafio.premio,
          inicio: format(new Date(desafio.inicio), 'yyyy-MM-dd'),
          fim: format(new Date(desafio.fim), 'yyyy-MM-dd'),
          regra: desafio.regra,
          todosVendedores: desafio.todosVendedores,
          vendedoresIds: desafio.vendedoresIds,
          filtro: desafio.produtoId ? 'PRODUTO' : desafio.categoriaId ? 'CATEGORIA' : 'NENHUM',
          produtoId: desafio.produtoId ?? null,
          produtoNome: desafio.produto?.nome ?? null,
          categoriaId: desafio.categoriaId ?? null,
        }
      : { titulo: '', descricao: '', tipo: 'VALOR', alvo: 0, premio: 50, inicio: hoje(), fim: format(endOfMonth(new Date()), 'yyyy-MM-dd'), regra: 'TODOS', todosVendedores: true, vendedoresIds: [], filtro: 'NENHUM', produtoId: null, produtoNome: null, categoriaId: null },
  );
  const set = (p: Partial<FormState>) => setF((x) => ({ ...x, ...p }));

  const salvar = useMutation({
    mutationFn: () => {
      const body = {
        titulo: f.titulo,
        descricao: f.descricao || null,
        tipo: f.tipo,
        alvo: f.alvo,
        premio: f.premio,
        inicio: f.inicio,
        fim: f.fim,
        regra: f.regra,
        todosVendedores: f.todosVendedores,
        vendedoresIds: f.todosVendedores ? [] : f.vendedoresIds,
        produtoId: f.filtro === 'PRODUTO' ? f.produtoId : null,
        categoriaId: f.filtro === 'CATEGORIA' ? f.categoriaId : null,
      };
      return desafio ? api.put(`/desafios/${desafio.id}`, body) : api.post('/desafios', body);
    },
    onSuccess: () => {
      toast.success(desafio ? 'Desafio atualizado.' : 'Desafio lançado! Já aparece no painel dos vendedores.');
      onSalvo();
      onFechar();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const erro = !f.titulo.trim()
    ? 'Informe o título.'
    : f.alvo <= 0
      ? 'Informe o alvo.'
      : f.premio <= 0
        ? 'Informe o prêmio.'
        : !f.todosVendedores && !f.vendedoresIds.length
          ? 'Escolha os vendedores.'
          : f.filtro === 'PRODUTO' && !f.produtoId
            ? 'Escolha o produto.'
            : f.filtro === 'CATEGORIA' && !f.categoriaId
              ? 'Escolha a categoria.'
              : null;

  return (
    <Modal
      aberto
      onFechar={onFechar}
      tamanho="lg"
      titulo={desafio ? 'Editar desafio' : 'Novo desafio'}
      descricao="O prêmio entra como comissão extra (já liberada) quando o vendedor bate o alvo. Contam todas as vendas salvas, menos as canceladas."
      rodape={
        <>
          {erro && <span className="mr-auto text-xs text-slate-500">{erro}</span>}
          <Button variante="secundario" onClick={onFechar}>Cancelar</Button>
          <Button icone={<Check className="h-4 w-4" />} disabled={!!erro} carregando={salvar.isPending} onClick={() => salvar.mutate()}>{desafio ? 'Salvar' : 'Lançar desafio'}</Button>
        </>
      }
    >
      <div className="space-y-3">
        <Input label="Título" obrigatorio placeholder='Ex.: "Semana do notebook"' value={f.titulo} onChange={(e) => set({ titulo: e.target.value })} autoFocus />
        <Textarea label="Descrição (opcional)" rows={2} placeholder="Regras ou recado para a equipe" value={f.descricao} onChange={(e) => set({ descricao: e.target.value })} />

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Select
            label="O que conta"
            value={f.tipo}
            onChange={(e) => set({ tipo: e.target.value as TipoDesafio, alvo: 0 })}
            opcoes={[
              { valor: 'VALOR', rotulo: 'Valor vendido (R$)' },
              { valor: 'QTD_VENDAS', rotulo: 'Número de vendas' },
              { valor: 'QTD_ITENS', rotulo: 'Unidades vendidas' },
            ]}
          />
          <MoneyInput label="Alvo" obrigatorio prefixo={f.tipo === 'VALOR' ? 'R$' : ''} casas={f.tipo === 'VALOR' ? 2 : 0} value={f.alvo} onChange={(v) => set({ alvo: v })} />
          <MoneyInput label="Prêmio (comissão extra)" obrigatorio value={f.premio} onChange={(v) => set({ premio: v })} />
        </div>
        <div className="flex flex-wrap gap-2">
          {[50, 100, 150, 200].map((v) => (
            <button key={v} type="button" onClick={() => set({ premio: v })} className={clsx('rounded-full border px-3 py-1 text-xs font-semibold', f.premio === v ? 'border-amber-500 bg-amber-50 text-amber-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50')}>+{moeda(v)}</button>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <DateInput label="Início" obrigatorio value={f.inicio} onChange={(v) => set({ inicio: v })} />
          <DateInput label="Fim" obrigatorio value={f.fim} onChange={(v) => set({ fim: v })} />
        </div>

        <div>
          <p className="mb-1 text-xs font-medium text-slate-600">Quem ganha</p>
          <Segmentado opcoes={[{ valor: 'TODOS', rotulo: 'Todos que baterem o alvo' }, { valor: 'PRIMEIRO', rotulo: 'Só o primeiro a bater' }]} valor={f.regra} onMudar={(v) => set({ regra: v })} />
        </div>

        <div>
          <p className="mb-1 text-xs font-medium text-slate-600">Contar só um produto ou categoria? (opcional)</p>
          <Segmentado opcoes={[{ valor: 'NENHUM', rotulo: 'Todas as vendas' }, { valor: 'PRODUTO', rotulo: 'Um produto' }, { valor: 'CATEGORIA', rotulo: 'Uma categoria' }]} valor={f.filtro} onMudar={(v) => set({ filtro: v })} />
          {f.filtro === 'PRODUTO' && (
            <SearchSelect className="mt-2" valor={f.produtoId} rotuloAtual={f.produtoNome} onChange={(id, op) => set({ produtoId: id, produtoNome: op?.rotulo ?? null })} buscar={(t) => buscarProdutos(t)} placeholder="Buscar produto…" />
          )}
          {f.filtro === 'CATEGORIA' && (
            <Select className="mt-2" value={f.categoriaId ?? ''} onChange={(e) => set({ categoriaId: e.target.value ? Number(e.target.value) : null })} placeholder="Escolha a categoria" opcoes={(categorias ?? []).map((c) => ({ valor: c.id, rotulo: c.nome }))} />
          )}
        </div>

        <div>
          <Checkbox label="Todos os vendedores participam" checked={f.todosVendedores} onChange={(e) => set({ todosVendedores: e.target.checked })} />
          {!f.todosVendedores && (
            <div className="mt-2 grid grid-cols-2 gap-1.5 rounded-md border border-slate-200 p-3 sm:grid-cols-3">
              {(vendedores ?? []).map((v) => (
                <Checkbox
                  key={v.id}
                  label={v.nome}
                  checked={f.vendedoresIds.includes(v.id)}
                  onChange={(e) => set({ vendedoresIds: e.target.checked ? [...f.vendedoresIds, v.id] : f.vendedoresIds.filter((x) => x !== v.id) })}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

// =====================================================================================
// METAS
// =====================================================================================
function AbaMetas() {
  const qc = useQueryClient();
  const [competencia, setCompetencia] = useState(competenciaAtual());
  const { data: resp, isLoading } = useQuery({ queryKey: ['metas', competencia], queryFn: () => api.get<{ competencia: string; vendedores: MetaLinha[] }>('/metas', { competencia }) });
  const [linhas, setLinhas] = useState<MetaLinha[]>([]);
  useEffect(() => setLinhas(resp?.vendedores ?? []), [resp]);
  const alterou = JSON.stringify(linhas) !== JSON.stringify(resp?.vendedores ?? []);
  const atualizar = (id: number, p: Partial<MetaLinha>) => setLinhas((ls) => ls.map((l) => (l.vendedorId === id ? { ...l, ...p } : l)));

  const salvar = useMutation({
    mutationFn: () => api.put('/metas', { competencia, itens: linhas.map((l) => ({ vendedorId: l.vendedorId, metaPadrao: l.metaPadrao, metaMes: l.metaMes })) }),
    onSuccess: () => {
      toast.success('Metas salvas.');
      qc.invalidateQueries({ queryKey: ['metas'] });
      qc.invalidateQueries({ queryKey: ['painel-vendedor'] });
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const totalMeta = linhas.reduce((s, l) => s + (l.metaMes ?? l.metaPadrao), 0);
  const totalVendido = linhas.reduce((s, l) => s + l.vendido, 0);

  return (
    <Card
      semPadding
      titulo={`Metas de ${competenciaLabel(competencia)}`}
      descricao="A meta padrão vale para todo mês. Para um mês diferente, ligue “Só neste mês” e informe o valor."
      acoes={
        <>
          <Input type="month" value={competencia} onChange={(e) => e.target.value && setCompetencia(e.target.value)} className="w-40" />
          <Button icone={<Save className="h-4 w-4" />} disabled={!alterou} carregando={salvar.isPending} onClick={() => salvar.mutate()}>Salvar metas</Button>
        </>
      }
    >
      {isLoading ? (
        <div className="p-4"><Skeleton className="h-32 w-full" /></div>
      ) : !linhas.length ? (
        <EmptyState compacto titulo="Nenhum vendedor ativo" descricao="Cadastre os vendedores em Configurações → Vendedores." />
      ) : (
        <div className="overflow-x-auto">
          <table className="tbl tbl-pilha">
            <thead>
              <tr>
                <th>Vendedor</th>
                <th className="w-40">Meta padrão (todo mês)</th>
                <th className="w-80">Meta deste mês</th>
                <th className="text-right">Vendido</th>
                <th className="w-48">Atingido</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => {
                const meta = l.metaMes ?? l.metaPadrao;
                const pct = meta ? (l.vendido / meta) * 100 : 0;
                return (
                  <tr key={l.vendedorId}>
                    <td className="font-medium text-slate-800" data-rotulo="Vendedor">{l.nome}</td>
                    <td data-rotulo="Meta padrão (todo mês)"><MoneyInput value={l.metaPadrao} onChange={(v) => atualizar(l.vendedorId, { metaPadrao: v })} /></td>
                    <td data-rotulo="Meta deste mês">
                      <div className="flex items-center gap-2">
                        <Checkbox label="Só neste mês" checked={l.metaMes !== null} onChange={(e) => atualizar(l.vendedorId, { metaMes: e.target.checked ? l.metaPadrao : null })} />
                        {l.metaMes !== null && <MoneyInput className="w-36" value={l.metaMes} onChange={(v) => atualizar(l.vendedorId, { metaMes: v })} />}
                      </div>
                    </td>
                    <td className="text-right num" data-rotulo="Vendido">{moeda(l.vendido)}</td>
                    <td data-rotulo="Atingido">
                      {meta ? (
                        <div className="flex items-center gap-2">
                          <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                            <div className={clsx('h-full rounded-full', pct >= 100 ? 'bg-emerald-500' : 'bg-brand-500')} style={{ width: `${Math.min(100, Math.max(2, pct))}%` }} />
                          </div>
                          <span className="w-12 text-right text-xs font-semibold text-slate-600 num">{numero(pct, 0)}%</span>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">sem meta</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-200 bg-slate-50 font-semibold [&>td]:px-3 [&>td]:py-2.5">
                <td>Total da loja</td>
                <td />
                <td className="num">{moeda(totalMeta)}</td>
                <td className="text-right num">{moeda(totalVendido)}</td>
                <td className="text-right text-xs text-slate-500 num">{totalMeta ? `${numero((totalVendido / totalMeta) * 100, 0)}%` : ''}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Card>
  );
}
