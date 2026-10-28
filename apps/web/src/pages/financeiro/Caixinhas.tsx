/**
 * CAIXINHAS (Nubank): dinheiro guardado para compromissos grandes.
 * Valor, para que é e dia de uso → o sistema mostra quanto falta e quanto guardar por dia.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import clsx from 'clsx';
import { ArrowDownToLine, ArrowUpFromLine, CheckCircle2, Pencil, PiggyBank, Plus, Trash2 } from 'lucide-react';
import { api, mensagemErro } from '@/lib/api';
import { useContasFinanceiras, opcoesDe } from '@/hooks/useListas';
import { Badge, Button, Card, DateInput, EmptyState, Input, Modal, MoneyInput, PageHeader, Select, Skeleton, Textarea } from '@/components/ui';
import { data as fmtData, hoje, moeda } from '@/lib/format';

interface Caixinha {
  id: number;
  nome: string;
  valorMeta: number;
  dataUso: string;
  dataInicio: string;
  contaFinanceira: { id: number; nome: string };
  observacoes: string | null;
  ativo: boolean;
  saldo: number;
  falta: number;
  pct: number;
  diasRestantes: number;
  porDia: number;
  guardadoHoje: number;
  sugestaoHoje: number;
  esperadoHoje: number;
  situacao: 'COMPLETA' | 'EM_DIA' | 'ATRASADA' | 'VENCIDA' | 'USADA';
}

const SIT: Record<Caixinha['situacao'], { rotulo: string; tom: 'verde' | 'azul' | 'vermelho' | 'amarelo' | 'cinza' }> = {
  COMPLETA: { rotulo: 'Completa', tom: 'verde' },
  EM_DIA: { rotulo: 'Em dia', tom: 'azul' },
  ATRASADA: { rotulo: 'Atrasada', tom: 'vermelho' },
  VENCIDA: { rotulo: 'Passou do prazo', tom: 'vermelho' },
  USADA: { rotulo: 'Usada', tom: 'cinza' },
};

const isoDia = (s: string) => s.slice(0, 10);

export default function Caixinhas() {
  const qc = useQueryClient();
  const { data: lista, isLoading } = useQuery({ queryKey: ['caixinhas'], queryFn: () => api.get<Caixinha[]>('/caixinhas') });
  const [editar, setEditar] = useState<Partial<Caixinha> | null>(null);
  const [mov, setMov] = useState<{ c: Caixinha; tipo: 'guardar' | 'retirar' } | null>(null);
  const invalidar = () => ['caixinhas', 'avisos', 'contas-financeiras', 'dashboard-geral', 'movimentos-fin'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

  const ativas = (lista ?? []).filter((c) => c.ativo);
  const usadas = (lista ?? []).filter((c) => !c.ativo);
  const totalHoje = ativas.reduce((s, c) => s + c.sugestaoHoje, 0);
  const totalGuardado = ativas.reduce((s, c) => s + c.saldo, 0);

  const usar = useMutation({
    mutationFn: (c: Caixinha) => api.put(`/caixinhas/${c.id}`, { ativo: false }),
    onSuccess: () => { toast.success('Caixinha marcada como usada.'); invalidar(); },
    onError: (e) => toast.error(mensagemErro(e)),
  });
  const excluir = useMutation({
    mutationFn: (c: Caixinha) => api.del(`/caixinhas/${c.id}`),
    onSuccess: () => { toast.success('Caixinha excluída.'); invalidar(); },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  return (
    <div className="pb-6">
      <PageHeader
        titulo="Caixinhas"
        descricao="Dinheiro guardado no Nubank para os compromissos grandes. O sistema calcula quanto guardar por dia para chegar no prazo."
        acoes={<Button variante="primario" icone={<Plus className="h-4 w-4" />} onClick={() => setEditar({ nome: '', valorMeta: 0, dataUso: hoje(), observacoes: '' })}>Nova caixinha</Button>}
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Card><p className="text-xs text-slate-500">Guardar hoje (todas)</p><p className="num text-2xl font-bold text-brand-700">{moeda(totalHoje)}</p></Card>
        <Card><p className="text-xs text-slate-500">Já guardado</p><p className="num text-2xl font-bold text-slate-900">{moeda(totalGuardado)}</p></Card>
        <Card><p className="text-xs text-slate-500">Caixinhas ativas</p><p className="num text-2xl font-bold text-slate-900">{ativas.length}</p></Card>
      </div>

      {isLoading && <Skeleton className="h-40" />}
      {!isLoading && !ativas.length && (
        <EmptyState icone={<PiggyBank className="h-5 w-5" />} titulo="Nenhuma caixinha" descricao="Crie uma caixinha para cada compromisso grande: valor, para que é e o dia de uso." />
      )}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {ativas.map((c) => (
          <Card key={c.id} className={clsx(c.situacao === 'ATRASADA' || c.situacao === 'VENCIDA' ? 'border-red-200' : '')}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-semibold text-slate-900">{c.nome}</p>
                <p className="text-xs text-slate-500">usar em {fmtData(c.dataUso)} · {c.diasRestantes > 0 ? `faltam ${c.diasRestantes} dia${c.diasRestantes > 1 ? 's' : ''}` : c.diasRestantes === 0 ? 'é hoje' : `há ${-c.diasRestantes} dia(s)`} · {c.contaFinanceira.nome}</p>
              </div>
              <Badge tom={SIT[c.situacao].tom}>{SIT[c.situacao].rotulo}</Badge>
            </div>
            <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-slate-100">
              <div className={clsx('h-full rounded-full', c.situacao === 'ATRASADA' || c.situacao === 'VENCIDA' ? 'bg-red-500' : c.situacao === 'COMPLETA' ? 'bg-emerald-500' : 'bg-brand-600')} style={{ width: `${c.pct}%` }} />
            </div>
            <div className="mt-2 flex justify-between text-sm">
              <span className="num font-semibold">{moeda(c.saldo)}</span>
              <span className="num text-slate-500">de {moeda(c.valorMeta)}</span>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-md bg-slate-50 p-2"><dt className="text-slate-500">Falta</dt><dd className="num font-semibold text-slate-800">{moeda(c.falta)}</dd></div>
              <div className="rounded-md bg-slate-50 p-2"><dt className="text-slate-500">Por dia</dt><dd className="num font-semibold text-slate-800">{moeda(c.porDia)}</dd></div>
              <div className={clsx('col-span-2 rounded-md p-2', c.sugestaoHoje > 0 ? 'bg-amber-50' : 'bg-emerald-50')}>
                <dt className="text-slate-500">Sugestão de hoje</dt>
                <dd className={clsx('num font-semibold', c.sugestaoHoje > 0 ? 'text-amber-800' : 'text-emerald-700')}>{c.sugestaoHoje > 0 ? `Guardar ${moeda(c.sugestaoHoje)}` : c.falta > 0 ? `Hoje já foi (${moeda(c.guardadoHoje)})` : 'Completa'}</dd>
              </div>
            </dl>
            {c.observacoes && <p className="mt-2 text-xs text-slate-500">{c.observacoes}</p>}
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Button tamanho="sm" variante="primario" icone={<ArrowDownToLine className="h-3.5 w-3.5" />} onClick={() => setMov({ c, tipo: 'guardar' })}>Guardar</Button>
              <Button tamanho="sm" variante="secundario" icone={<ArrowUpFromLine className="h-3.5 w-3.5" />} disabled={c.saldo <= 0} onClick={() => setMov({ c, tipo: 'retirar' })}>Retirar</Button>
              <Button tamanho="sm" variante="secundario" icone={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEditar(c)}>Editar</Button>
              <Button tamanho="sm" variante="secundario" icone={<CheckCircle2 className="h-3.5 w-3.5" />} carregando={usar.isPending} onClick={() => usar.mutate(c)}>Usada</Button>
              {c.saldo === 0 && <Button tamanho="sm" variante="secundario" icone={<Trash2 className="h-3.5 w-3.5" />} onClick={() => excluir.mutate(c)}>Excluir</Button>}
            </div>
          </Card>
        ))}
      </div>

      {usadas.length > 0 && (
        <Card className="mt-4" titulo="Já usadas">
          <ul className="divide-y divide-slate-100 text-sm">
            {usadas.map((c) => (
              <li key={c.id} className="flex justify-between py-2"><span>{c.nome} · {fmtData(c.dataUso)}</span><span className="num text-slate-500">{moeda(c.saldo)} de {moeda(c.valorMeta)}</span></li>
            ))}
          </ul>
        </Card>
      )}

      {editar && <EditarModal c={editar} onFechar={() => setEditar(null)} onSalvo={invalidar} />}
      {mov && <MovimentoModal c={mov.c} tipo={mov.tipo} onFechar={() => setMov(null)} onSalvo={invalidar} />}
    </div>
  );
}

function EditarModal({ c, onFechar, onSalvo }: { c: Partial<Caixinha>; onFechar: () => void; onSalvo: () => void }) {
  const { data: contas } = useContasFinanceiras();
  const [f, setF] = useState({ nome: c.nome ?? '', valorMeta: c.valorMeta ?? 0, dataUso: c.dataUso ? isoDia(c.dataUso) : hoje(), observacoes: c.observacoes ?? '', contaFinanceiraId: (c.contaFinanceira?.id ?? '') as number | '' });
  const salvar = useMutation({
    mutationFn: () => (c.id ? api.put(`/caixinhas/${c.id}`, { ...f, contaFinanceiraId: undefined }) : api.post('/caixinhas', { ...f, contaFinanceiraId: f.contaFinanceiraId || null })),
    onSuccess: () => { toast.success('Caixinha salva.'); onSalvo(); onFechar(); },
    onError: (e) => toast.error(mensagemErro(e)),
  });
  return (
    <Modal aberto onFechar={onFechar} titulo={c.id ? 'Editar caixinha' : 'Nova caixinha'} rodape={<><Button variante="secundario" onClick={onFechar}>Cancelar</Button><Button variante="primario" carregando={salvar.isPending} disabled={!f.nome.trim() || f.valorMeta <= 0 || !f.dataUso} onClick={() => salvar.mutate()}>Salvar</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Input className="col-span-2" label="Para que é?" value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} placeholder="Ex.: 13º dos funcionários, IPTU, estoque Black Friday" autoFocus />
        <MoneyInput label="Valor" value={f.valorMeta} onChange={(v) => setF({ ...f, valorMeta: v })} />
        <DateInput label="Dia de uso" value={f.dataUso} onChange={(v) => setF({ ...f, dataUso: v })} />
        {!c.id && <Select className="col-span-2" label="Onde fica guardado" value={f.contaFinanceiraId} onChange={(e) => setF({ ...f, contaFinanceiraId: e.target.value ? Number(e.target.value) : '' })} opcoes={opcoesDe(contas)} placeholder="Nubank (padrão)" />}
        <Textarea className="col-span-2" label="Observação" rows={2} value={f.observacoes} onChange={(e) => setF({ ...f, observacoes: e.target.value })} />
      </div>
    </Modal>
  );
}

function MovimentoModal({ c, tipo, onFechar, onSalvo }: { c: Caixinha; tipo: 'guardar' | 'retirar'; onFechar: () => void; onSalvo: () => void }) {
  const { data: contas } = useContasFinanceiras();
  const outras = (contas ?? []).filter((x) => x.id !== c.contaFinanceira.id);
  const [valor, setValor] = useState(tipo === 'guardar' ? c.sugestaoHoje || c.porDia : c.saldo);
  const [conta, setConta] = useState<number | ''>(outras.find((x) => x.padrao)?.id ?? '');
  const [dia, setDia] = useState(hoje());
  const salvar = useMutation({
    mutationFn: () => api.post(`/caixinhas/${c.id}/${tipo}`, tipo === 'guardar' ? { valor, origemId: conta, data: dia } : { valor, destinoId: conta, data: dia }),
    onSuccess: () => { toast.success(tipo === 'guardar' ? `${moeda(valor)} guardado em "${c.nome}".` : `${moeda(valor)} retirado de "${c.nome}".`); onSalvo(); onFechar(); },
    onError: (e) => toast.error(mensagemErro(e)),
  });
  return (
    <Modal aberto onFechar={onFechar} titulo={`${tipo === 'guardar' ? 'Guardar em' : 'Retirar de'} "${c.nome}"`} descricao={tipo === 'guardar' ? `Sugestão de hoje: ${moeda(c.sugestaoHoje)} · falta ${moeda(c.falta)}` : `Saldo da caixinha: ${moeda(c.saldo)}`} rodape={<><Button variante="secundario" onClick={onFechar}>Cancelar</Button><Button variante="primario" carregando={salvar.isPending} disabled={!conta || valor <= 0} onClick={() => salvar.mutate()}>{tipo === 'guardar' ? 'Guardar' : 'Retirar'}</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <MoneyInput label="Valor" value={valor} onChange={setValor} />
        <DateInput label="Data" value={dia} onChange={setDia} />
        <Select className="col-span-2" label={tipo === 'guardar' ? 'Sai de qual banco' : 'Vai para qual banco'} value={conta} onChange={(e) => setConta(e.target.value ? Number(e.target.value) : '')} opcoes={opcoesDe(outras)} placeholder="—" />
        <p className="col-span-2 text-xs text-slate-500">É uma transferência entre contas ({c.contaFinanceira.nome}): não entra no DRE.</p>
      </div>
    </Modal>
  );
}
