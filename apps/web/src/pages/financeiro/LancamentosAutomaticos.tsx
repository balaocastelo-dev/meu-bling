/**
 * Lançamentos automáticos – revisão.
 * O bot registra o que leu no e-mail do banco. Pendente não mexe no saldo.
 * Confio grava quem aceitou e quando, e só então o valor entra na conta.
 * Contestar exige observação e também grava quem e quando — sem mexer no saldo.
 * Nenhum dos dois dá baixa em contas a pagar ou a receber.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import clsx from 'clsx';
import { ExternalLink, ShieldCheck, ShieldX } from 'lucide-react';
import { api, mensagemErro } from '@/lib/api';
import { usePaginacao } from '@/hooks/usePaginacao';
import { useContasFinanceiras } from '@/hooks/useListas';
import {
  Badge,
  BarraFiltros,
  Button,
  Card,
  ConfirmDialog,
  DateInput,
  EmptyState,
  Modal,
  MoneyInput,
  PageHeader,
  Pagination,
  SelectFiltro,
  Table,
  Textarea,
  type Coluna,
} from '@/components/ui';
import { data, dataHora, moeda } from '@/lib/format';

type Status = 'PENDENTE' | 'CONFIADO' | 'CONTESTADO';

interface Lancamento {
  id: number;
  tipo: 'ENTRADA' | 'SAIDA';
  data: string;
  valor: number;
  contaFinanceira: { id: number; nome: string };
  contraparte: string;
  categoria: { id: number; nome: string } | null;
  emailOrigemId: string;
  emailOrigemUrl: string | null;
  descricao: string | null;
  botNome: string;
  status: Status;
  movimentoId: number | null;
  confiadoPor: { id: number; nome: string } | null;
  confiadoEm: string | null;
  contestadoPor: { id: number; nome: string } | null;
  contestadoEm: string | null;
  observacaoContestacao: string | null;
  valorAlto: boolean;
  contraparteNova: boolean;
}

interface Resposta {
  data: Lancamento[];
  meta: { total: number; pagina: number; limite: number; totalPaginas: number; pendentes: number; limiteValorAlto: number };
}

const STATUS: { id: Status; rotulo: string }[] = [
  { id: 'PENDENTE', rotulo: 'Pendentes' },
  { id: 'CONFIADO', rotulo: 'Confiados' },
  { id: 'CONTESTADO', rotulo: 'Contestados' },
];

export default function LancamentosAutomaticos() {
  const qc = useQueryClient();
  const pg = usePaginacao();
  const { data: contas } = useContasFinanceiras();
  const status = (pg.getFiltro('status') || 'PENDENTE') as Status;
  const dataInicial = pg.getFiltro('dataInicial');
  const dataFinal = pg.getFiltro('dataFinal');
  const contaFinanceiraId = pg.getFiltro('contaFinanceiraId');

  const params = {
    status,
    dataInicial: dataInicial || undefined,
    dataFinal: dataFinal || undefined,
    contaFinanceiraId: contaFinanceiraId || undefined,
    pagina: pg.pagina,
    limite: pg.limite,
  };
  const { data: resp, isLoading } = useQuery({
    queryKey: ['lancamentos-automaticos', params],
    queryFn: () => api.get<Resposta>('/lancamentos-automaticos', params),
    placeholderData: (p) => p,
  });

  const [limite, setLimite] = useState(1000);
  const [confiarAlvo, setConfiarAlvo] = useState<Lancamento | null>(null);
  const [contestarAlvo, setContestarAlvo] = useState<Lancamento | null>(null);
  const [observacao, setObservacao] = useState('');

  useEffect(() => {
    if (resp?.meta.limiteValorAlto != null) setLimite(resp.meta.limiteValorAlto);
  }, [resp?.meta.limiteValorAlto]);

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ['lancamentos-automaticos'] });
    qc.invalidateQueries({ queryKey: ['dashboard-geral'] });
    qc.invalidateQueries({ queryKey: ['contas-financeiras'] });
    qc.invalidateQueries({ queryKey: ['financeiro-resumo'] });
  };

  const salvarLimite = useMutation({
    mutationFn: () => api.put('/lancamentos-automaticos/config', { limiteValorAlto: limite }),
    onSuccess: () => {
      toast.success('Limite de valor alto atualizado.');
      invalidar();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const aceitar = useMutation({
    mutationFn: (id: number) => api.post(`/lancamentos-automaticos/${id}/confiar`, {}),
    onSuccess: () => {
      toast.success('Lançamento aceito. O saldo da conta foi atualizado — nenhuma conta a pagar ou a receber foi baixada.');
      invalidar();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const discordar = useMutation({
    mutationFn: (p: { id: number; observacao: string }) => api.post(`/lancamentos-automaticos/${p.id}/contestar`, { observacao: p.observacao }),
    onSuccess: () => {
      toast.success('Contestação registrada. O saldo não foi alterado.');
      setContestarAlvo(null);
      setObservacao('');
      invalidar();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const colunas: Coluna<Lancamento>[] = [
    { chave: 'data', titulo: 'Data', largura: '100px', render: (l) => data(l.data) },
    {
      chave: 'valor',
      titulo: 'Valor',
      direita: true,
      largura: '140px',
      render: (l) => (
        <div className="flex flex-col items-end gap-1">
          <span className={clsx('font-semibold', l.tipo === 'SAIDA' ? 'text-red-700' : 'text-emerald-700', l.valorAlto && 'underline decoration-amber-400 decoration-2')}>
            {l.tipo === 'SAIDA' ? '−' : '+'} {moeda(l.valor)}
          </span>
          {l.valorAlto && <Badge tom="amarelo">Valor alto</Badge>}
        </div>
      ),
    },
    { chave: 'conta', titulo: 'Conta', render: (l) => l.contaFinanceira.nome },
    {
      chave: 'contraparte',
      titulo: 'Quem pagou / recebeu',
      noCartao: 'titulo',
      render: (l) => (
        <div className="min-w-0">
          <p className="font-medium text-slate-900">{l.contraparte}</p>
          <div className="mt-1 flex flex-wrap gap-1">
            <Badge tom={l.tipo === 'ENTRADA' ? 'verde' : 'vermelho'}>{l.tipo === 'ENTRADA' ? 'Entrada' : 'Saída'}</Badge>
            {l.contraparteNova && <Badge tom="roxo">Novo</Badge>}
          </div>
          {l.descricao && <p className="mt-1 max-w-xs truncate text-xs text-slate-500" title={l.descricao}>{l.descricao}</p>}
        </div>
      ),
    },
    { chave: 'categoria', titulo: 'Categoria', ocultarMobile: true, render: (l) => l.categoria?.nome ?? '—' },
    {
      chave: 'email',
      titulo: 'E-mail de origem',
      render: (l) => (
        <div className="max-w-[220px]">
          {l.emailOrigemUrl ? (
            <a href={l.emailOrigemUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-brand-700 hover:underline">
              Abrir e-mail <ExternalLink className="h-3.5 w-3.5" />
            </a>
          ) : (
            <span className="text-xs text-slate-400">sem link</span>
          )}
          <p className="truncate font-mono text-[11px] text-slate-500" title={l.emailOrigemId}>{l.emailOrigemId}</p>
        </div>
      ),
    },
    { chave: 'bot', titulo: 'Bot', ocultarMobile: true, render: (l) => <span className="text-sm text-slate-600">{l.botNome}</span> },
    {
      chave: 'revisao',
      titulo: 'Revisão',
      render: (l) => {
        if (l.status === 'CONFIADO') {
          return (
            <div className="text-xs text-emerald-800">
              <p className="font-medium">Confiou: {l.confiadoPor?.nome ?? '—'}</p>
              <p className="text-slate-500">{dataHora(l.confiadoEm)}</p>
            </div>
          );
        }
        if (l.status === 'CONTESTADO') {
          return (
            <div className="max-w-[220px] text-xs text-red-800">
              <p className="font-medium">Contestou: {l.contestadoPor?.nome ?? '—'}</p>
              <p className="text-slate-500">{dataHora(l.contestadoEm)}</p>
              {l.observacaoContestacao && <p className="mt-1 text-slate-600" title={l.observacaoContestacao}>{l.observacaoContestacao}</p>}
            </div>
          );
        }
        return <Badge tom="amarelo">Pendente</Badge>;
      },
    },
    {
      chave: 'acoes',
      titulo: '',
      largura: '180px',
      render: (l) =>
        l.status === 'PENDENTE' ? (
          <div className="flex flex-wrap justify-end gap-1">
            <Button tamanho="xs" variante="sucesso" icone={<ShieldCheck className="h-3.5 w-3.5" />} onClick={() => setConfiarAlvo(l)}>
              Confio
            </Button>
            <Button tamanho="xs" variante="perigo" icone={<ShieldX className="h-3.5 w-3.5" />} onClick={() => { setContestarAlvo(l); setObservacao(''); }}>
              Contestar
            </Button>
          </div>
        ) : null,
    },
  ];

  const pendentes = resp?.meta.pendentes ?? 0;

  return (
    <div>
      <PageHeader
        migalhas={[{ rotulo: 'Financeiro', para: '/financeiro/receber' }, { rotulo: 'Lançamentos automáticos – revisão' }]}
        titulo="Lançamentos automáticos – revisão"
        descricao="O que um bot registrou a partir de e-mails de bancos. Pendente não altera saldo e não dá baixa. Confio lança o valor na conta; a baixa de um título continua manual."
        extra={
          <Badge tom={pendentes > 0 ? 'amarelo' : 'verde'}>
            {pendentes} pendente{pendentes === 1 ? '' : 's'}
          </Badge>
        }
      />

      <Card className="mb-4" titulo="Destaques" descricao="Valor alto usa este limite (padrão R$ 1.000). Novo é quem ainda não foi aceito num Confio e não está no cadastro de contatos.">
        <div className="flex flex-wrap items-end gap-3">
          <MoneyInput label="Destacar a partir de" value={limite} onChange={setLimite} className="w-48" />
          <Button variante="secundario" carregando={salvarLimite.isPending} onClick={() => salvarLimite.mutate()}>
            Salvar limite
          </Button>
        </div>
      </Card>

      <Card semPadding>
        <BarraFiltros>
          <div className="flex flex-wrap gap-1.5">
            {STATUS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => pg.setFiltro('status', s.id)}
                className={clsx(
                  'rounded-full border px-3 py-1 text-xs font-medium',
                  status === s.id ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
                )}
              >
                {s.rotulo}
              </button>
            ))}
          </div>
          <DateInput label="De" value={dataInicial} onChange={(v) => pg.setFiltro('dataInicial', v)} className="w-40" />
          <DateInput label="Até" value={dataFinal} onChange={(v) => pg.setFiltro('dataFinal', v)} className="w-40" />
          <SelectFiltro
            label="Conta"
            valor={contaFinanceiraId}
            onChange={(v) => pg.setFiltro('contaFinanceiraId', v)}
            placeholder="Todas as contas"
            opcoes={(contas ?? []).map((c) => ({ valor: c.id, rotulo: c.nome }))}
          />
        </BarraFiltros>
        <Table
          colunas={colunas}
          dados={resp?.data}
          carregando={isLoading}
          chave={(l) => l.id}
          destacar={(l) => l.valorAlto || l.contraparteNova}
          vazio={<EmptyState titulo={status === 'PENDENTE' ? 'Nenhum lançamento pendente' : 'Nenhum lançamento neste filtro'} descricao="Os bots registram aqui o que leram nos e-mails dos bancos. Nada entra no saldo antes do Confio." />}
        />
        <Pagination pagina={pg.pagina} totalPaginas={resp?.meta.totalPaginas ?? 1} total={resp?.meta.total ?? 0} limite={pg.limite} onPagina={pg.setPagina} onLimite={pg.setLimite} />
      </Card>

      <ConfirmDialog
        aberto={!!confiarAlvo}
        onFechar={() => setConfiarAlvo(null)}
        perigo={false}
        titulo="Confiar neste lançamento?"
        textoConfirmar="Confio"
        descricao={
          confiarAlvo ? (
            <span>
              {confiarAlvo.tipo === 'ENTRADA' ? 'Entra' : 'Sai'} {moeda(confiarAlvo.valor)} em {confiarAlvo.contaFinanceira.nome}, de {confiarAlvo.contraparte}. O saldo muda agora. Nenhuma conta a pagar ou a receber é baixada.
            </span>
          ) : null
        }
        onConfirmar={async () => {
          if (confiarAlvo) await aceitar.mutateAsync(confiarAlvo.id);
        }}
      />

      <Modal
        aberto={!!contestarAlvo}
        onFechar={() => setContestarAlvo(null)}
        titulo="Contestar lançamento"
        descricao={contestarAlvo ? `${contestarAlvo.contraparte} · ${moeda(contestarAlvo.valor)}` : undefined}
        tamanho="sm"
        rodape={
          <>
            <Button variante="secundario" onClick={() => setContestarAlvo(null)}>Cancelar</Button>
            <Button
              variante="perigo"
              carregando={discordar.isPending}
              disabled={observacao.trim().length < 3}
              onClick={() => contestarAlvo && discordar.mutate({ id: contestarAlvo.id, observacao: observacao.trim() })}
            >
              Contestar
            </Button>
          </>
        }
      >
        <Textarea
          label="Observação"
          obrigatorio
          rows={4}
          value={observacao}
          onChange={(e) => setObservacao(e.target.value)}
          placeholder="Por que este lançamento não deve entrar no caixa?"
          ajuda="Obrigatória. Fica gravado quem contestou e a data."
        />
      </Modal>
    </div>
  );
}
