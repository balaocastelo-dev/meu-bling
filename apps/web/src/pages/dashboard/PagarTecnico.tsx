import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { AlertTriangle, HandCoins, Send } from 'lucide-react';
import { api, ApiError, mensagemErro } from '@/lib/api';
import { useTecnicos, opcoesDe } from '@/hooks/useListas';
import { useDebounce } from '@/hooks/useDebounce';
import { Badge, Button, DateInput, Input, Modal, Select, Skeleton } from '@/components/ui';
import { data as fmtData, hoje, moeda, numero, rotulo } from '@/lib/format';

type Escopo = 'SOMENTE_CONCLUIDAS' | 'TODAS';

interface Previa {
  tecnico: { id: number; nome: string };
  qtdOs: number;
  lucro: number;
  percentual: number;
  valor: number;
  descricao: string;
  contaPagar?: { id: number; valor: number };
}

interface PagamentoTecnico {
  id: number;
  descricao: string;
  valor: number;
  valorPago: number;
  vencimento: string;
  situacao: string;
}

/**
 * "Pagar técnico": define uma % do lucro da assistência no período do dashboard,
 * escolhe o técnico e lança o valor no contas a pagar.
 */
export function PagarTecnicoModal({
  aberto,
  onFechar,
  dataInicial,
  dataFinal,
  base,
  filtroTecnicoId,
}: {
  aberto: boolean;
  onFechar: () => void;
  dataInicial: string;
  dataFinal: string;
  base: 'entrada' | 'conclusao';
  filtroTecnicoId: string;
}) {
  const qc = useQueryClient();
  const { data: tecnicos } = useTecnicos();
  const [tecnicoId, setTecnicoId] = useState(filtroTecnicoId);
  const [percentual, setPercentual] = useState('10');
  const [escopo, setEscopo] = useState<Escopo>('SOMENTE_CONCLUIDAS');
  const [vencimento, setVencimento] = useState(hoje());
  const [duplicado, setDuplicado] = useState<string | null>(null);

  // ao abrir, já sugere o técnico filtrado no dashboard
  useEffect(() => {
    if (aberto) {
      setTecnicoId(filtroTecnicoId);
      setDuplicado(null);
    }
  }, [aberto, filtroTecnicoId]);

  const pct = Number(String(percentual).replace(',', '.'));
  const pctValido = Number.isFinite(pct) && pct > 0 && pct <= 100;
  const pctDeb = useDebounce(pct, 300);
  const corpo = {
    dataInicial,
    dataFinal,
    base,
    filtroTecnicoId: filtroTecnicoId ? Number(filtroTecnicoId) : null,
    tecnicoId: Number(tecnicoId),
    percentual: pctDeb,
    escopo,
    vencimento,
  };

  const { data: previa, isFetching } = useQuery({
    queryKey: ['pagar-tecnico-previa', dataInicial, dataFinal, base, filtroTecnicoId, tecnicoId, pctDeb, escopo],
    queryFn: () => api.post<Previa>('/dashboard/assistencia/pagar-tecnico', { ...corpo, simular: true }),
    enabled: aberto && !!tecnicoId && Number.isFinite(pctDeb) && pctDeb > 0 && pctDeb <= 100,
    retry: 0,
  });

  const { data: historico, isLoading: carregandoHist } = useQuery({
    queryKey: ['pagamentos-tecnico'],
    queryFn: () => api.get<PagamentoTecnico[]>('/dashboard/assistencia/pagamentos-tecnico'),
    enabled: aberto,
  });

  const lancar = useMutation({
    mutationFn: (confirmarDuplicado: boolean) => api.post<Previa>('/dashboard/assistencia/pagar-tecnico', { ...corpo, percentual: pct, confirmarDuplicado }),
    onSuccess: (r) => {
      toast.success(`Lançado no contas a pagar: ${moeda(r.valor)} para ${r.tecnico.nome}.`);
      setDuplicado(null);
      qc.invalidateQueries({ queryKey: ['pagamentos-tecnico'] });
      qc.invalidateQueries({ queryKey: ['contas-pagar'] });
      onFechar();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409) setDuplicado(e.message);
      else toast.error(mensagemErro(e));
    },
  });

  const faixa = `${dataInicial.split('-').reverse().join('/')} a ${dataFinal.split('-').reverse().join('/')}`;
  const nomeFiltro = filtroTecnicoId ? tecnicos?.find((t) => String(t.id) === filtroTecnicoId)?.nome : null;
  const podeLancar = !!tecnicoId && pctValido && !!previa && previa.valor > 0 && !isFetching;

  return (
    <Modal
      aberto={aberto}
      onFechar={onFechar}
      titulo="Pagar técnico"
      descricao={`Uma % do lucro da assistência de ${faixa} vira uma conta a pagar para o técnico.`}
      tamanho="lg"
      rodape={
        <div className="flex w-full flex-wrap justify-end gap-2">
          <Button variante="secundario" onClick={onFechar}>Fechar</Button>
          {duplicado ? (
            <Button variante="perigo" icone={<Send className="h-4 w-4" />} carregando={lancar.isPending} onClick={() => lancar.mutate(true)}>Lançar mesmo assim</Button>
          ) : (
            <Button variante="primario" icone={<Send className="h-4 w-4" />} carregando={lancar.isPending} disabled={!podeLancar} onClick={() => lancar.mutate(false)}>
              Lançar no contas a pagar{previa && previa.valor > 0 ? ` · ${moeda(previa.valor)}` : ''}
            </Button>
          )}
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Técnico que vai receber" obrigatorio value={tecnicoId} onChange={(e) => { setTecnicoId(e.target.value); setDuplicado(null); }} opcoes={opcoesDe(tecnicos)} placeholder="Selecione o técnico" />
          <Input label="Porcentagem do lucro (%)" obrigatorio inputMode="decimal" value={percentual} onChange={(e) => { setPercentual(e.target.value); setDuplicado(null); }} erro={percentual && !pctValido ? 'Entre 0,01 e 100' : undefined} />
          <Select
            label="Lucro de quais OS"
            value={escopo}
            onChange={(e) => { setEscopo(e.target.value as Escopo); setDuplicado(null); }}
            opcoes={[
              { valor: 'SOMENTE_CONCLUIDAS', rotulo: 'Só as concluídas (dinheiro certo)' },
              { valor: 'TODAS', rotulo: 'Todas, inclusive em andamento' },
            ]}
          />
          <DateInput label="Vencimento" value={vencimento} onChange={setVencimento} />
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          {!tecnicoId ? (
            <p className="text-sm text-slate-500">Selecione o técnico para ver o valor.</p>
          ) : isFetching && !previa ? (
            <Skeleton className="h-16" />
          ) : previa ? (
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between gap-2">
                <span className="text-slate-500">Lucro {nomeFiltro ? `das OS de ${nomeFiltro}` : 'da assistência'} ({previa.qtdOs} OS)</span>
                <span className={`num font-medium ${previa.lucro < 0 ? 'text-red-600' : ''}`}>{moeda(previa.lucro)}</span>
              </div>
              <div className="flex justify-between gap-2"><span className="text-slate-500">Porcentagem</span><span className="num">× {numero(previa.percentual, 2)}%</span></div>
              <div className="flex items-baseline justify-between gap-2 border-t border-slate-200 pt-2">
                <span className="font-semibold text-slate-700">A pagar para {previa.tecnico.nome}</span>
                <span className="num text-2xl font-bold text-emerald-600">{moeda(previa.valor)}</span>
              </div>
              {previa.valor <= 0 && <p className="text-xs text-amber-700">Não há lucro no período com esse filtro — nada a lançar.</p>}
              <p className="text-[11px] text-slate-400">{base === 'conclusao' ? 'OS pela data de conclusão' : 'OS pela data de entrada'} · canceladas ficam fora · o valor é recalculado na hora de lançar.</p>
            </div>
          ) : null}
        </div>

        {duplicado && (
          <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{duplicado}</span>
          </div>
        )}

        <div>
          <p className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-400">
            <span className="flex items-center gap-1.5"><HandCoins className="h-3.5 w-3.5" /> Últimos pagamentos de técnico</span>
            <Link to="/financeiro/pagar" className="normal-case tracking-normal text-brand-600 hover:underline">Contas a pagar</Link>
          </p>
          {carregandoHist ? (
            <Skeleton className="h-16" />
          ) : historico?.length ? (
            <ul className="divide-y divide-slate-100 rounded-md border border-slate-200 bg-white text-sm">
              {historico.map((h) => (
                <li key={h.id} className="flex items-center gap-2 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-slate-700" title={h.descricao}>{h.descricao}</span>
                  <span className="num hidden text-xs text-slate-400 sm:inline">venc. {fmtData(h.vencimento)}</span>
                  <Badge tom={h.situacao === 'PAGO' ? 'verde' : h.situacao === 'CANCELADO' ? 'cinza' : 'amarelo'}>{rotulo(h.situacao)}</Badge>
                  <span className="num w-24 text-right font-medium">{moeda(h.valor)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-slate-400">Nenhum pagamento de técnico lançado ainda.</p>
          )}
        </div>
      </div>
    </Modal>
  );
}
