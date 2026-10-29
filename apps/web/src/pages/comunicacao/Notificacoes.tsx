import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { TextoValores } from '@/components/compartilhados/TextoValores';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Bell, Mail, MessageCircle, RefreshCw, X } from 'lucide-react';
import { api, mensagemErro } from '@/lib/api';
import { usePaginacao } from '@/hooks/usePaginacao';
import { Badge, BarraFiltros, Button, Card, EmptyState, PageHeader, Pagination, PeriodoFiltro, SelectFiltro, Table, tomPorStatus, type Coluna } from '@/components/ui';
import { dataHora, rotulo, truncar } from '@/lib/format';
import type { Notificacao, Paginado } from '@/types';

function linkOrigem(n: Notificacao): string | null {
  if (!n.origemTipo || !n.origemId) return null;
  switch (n.origemTipo) {
    case 'VENDA':
      return `/vendas/${n.origemId}`;
    case 'OS':
      return `/ordens-servico/${n.origemId}`;
    case 'COMPRA':
      return `/compras/${n.origemId}`;
    case 'NFE':
      return `/notas-fiscais/${n.origemId}`;
    default:
      return null;
  }
}

/** Fila de notificações (e-mail / WhatsApp) */
export default function Notificacoes() {
  const qc = useQueryClient();
  const pg = usePaginacao();
  const params = { ...pg.filtros, pagina: pg.pagina, limite: pg.limite };
  const { data: resp, isLoading } = useQuery({ queryKey: ['notificacoes', params], queryFn: () => api.get<Paginado<Notificacao>>('/notificacoes', params), placeholderData: (p) => p, refetchInterval: 15_000 });

  const reenviar = useMutation({ mutationFn: (id: number) => api.post(`/notificacoes/${id}/reenviar`), onSuccess: () => { toast.success('Notificação reenfileirada.'); qc.invalidateQueries({ queryKey: ['notificacoes'] }); }, onError: (e) => toast.error(mensagemErro(e)) });
  const cancelar = useMutation({ mutationFn: (id: number) => api.post(`/notificacoes/${id}/cancelar`), onSuccess: () => { toast.success('Notificação cancelada.'); qc.invalidateQueries({ queryKey: ['notificacoes'] }); }, onError: (e) => toast.error(mensagemErro(e)) });

  const colunas: Coluna<Notificacao>[] = [
    { chave: 'canal', titulo: 'Canal', largura: '90px', render: (n) => <span className="inline-flex items-center gap-1.5 text-xs text-slate-600">{n.canal === 'WHATSAPP' ? <MessageCircle className="h-4 w-4 text-emerald-600" /> : <Mail className="h-4 w-4 text-blue-600" />}{rotulo(n.canal)}</span> },
    { chave: 'data', titulo: 'Data', largura: '130px', render: (n) => <span className="text-xs text-slate-500">{dataHora(n.enviadaEm || n.agendadaPara || n.criadoEm)}</span> },
    { chave: 'dest', titulo: 'Destinatário', render: (n) => <div><p className="font-medium text-slate-800">{n.contato?.nome ?? n.destinatario}</p>{n.contato && <p className="text-xs text-slate-400">{n.destinatario}</p>}</div> },
    { chave: 'conteudo', titulo: 'Mensagem', render: (n) => <div className="max-w-[360px]">{n.assunto && <p className="truncate text-xs font-medium text-slate-700">{n.assunto}</p>}<p className="truncate text-xs text-slate-500" title={n.corpo}><TextoValores texto={truncar(n.corpo, 120)} /></p></div> },
    {
      chave: 'origem',
      titulo: 'Origem',
      ocultarMobile: true,
      render: (n) => {
        const l = linkOrigem(n);
        const t = n.origemTipo ? `${rotulo(n.origemTipo)} #${n.origemId}` : '—';
        return l ? <Link to={l} className="text-xs text-brand-600 hover:underline">{t}</Link> : <span className="text-xs text-slate-400">{t}</span>;
      },
    },
    { chave: 'status', titulo: 'Status', render: (n) => <div><Badge tom={tomPorStatus(n.status)}>{rotulo(n.status)}</Badge>{n.erro && <p className="mt-0.5 max-w-[200px] truncate text-[10px] text-red-500" title={n.erro}>{n.erro}</p>}{n.tentativas > 0 && <p className="text-[10px] text-slate-400">{n.tentativas} tentativa(s)</p>}</div> },
    {
      chave: 'acoes',
      titulo: '',
      largura: '90px',
      render: (n) => (
        <div className="flex justify-end gap-1">
          {(n.status === 'ERRO' || n.status === 'CANCELADA' || n.status === 'ENVIADA') && <Button tamanho="xs" variante="fantasma" icone={<RefreshCw className="h-3.5 w-3.5" />} title="Reenviar" onClick={() => reenviar.mutate(n.id)} />}
          {n.status === 'PENDENTE' && <Button tamanho="xs" variante="fantasma" icone={<X className="h-3.5 w-3.5" />} title="Cancelar" onClick={() => cancelar.mutate(n.id)} />}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader titulo="Notificações" descricao="Fila de envios por WhatsApp e e-mail. O worker processa a cada 5 segundos com até 3 tentativas." />
      <Card semPadding>
        <BarraFiltros>
          <PeriodoFiltro inicial={pg.getFiltro('dataInicial')} final={pg.getFiltro('dataFinal')} onChange={(i, f) => pg.setFiltros({ dataInicial: i, dataFinal: f })} label="" />
          <SelectFiltro valor={pg.getFiltro('status')} onChange={(v) => pg.setFiltro('status', v)} placeholder="Todos status" opcoes={['PENDENTE', 'ENVIANDO', 'ENVIADA', 'ERRO', 'CANCELADA'].map((s) => ({ valor: s, rotulo: rotulo(s) }))} />
          <SelectFiltro valor={pg.getFiltro('canal')} onChange={(v) => pg.setFiltro('canal', v)} placeholder="Todos canais" opcoes={[{ valor: 'WHATSAPP', rotulo: 'WhatsApp' }, { valor: 'EMAIL', rotulo: 'E-mail' }]} />
          <SelectFiltro valor={pg.getFiltro('origemTipo')} onChange={(v) => pg.setFiltro('origemTipo', v)} placeholder="Todas origens" opcoes={['VENDA', 'OS', 'COMPRA', 'NFE', 'CONTA', 'MANUAL'].map((s) => ({ valor: s, rotulo: rotulo(s) }))} />
        </BarraFiltros>
        <Table colunas={colunas} dados={resp?.data} carregando={isLoading} chave={(n) => n.id} vazio={<EmptyState icone={<Bell className="h-5 w-5" />} titulo="Nenhuma notificação" descricao="As mensagens disparadas por mudanças de situação e envios manuais aparecem aqui." />} />
        {resp && <Pagination pagina={resp.meta.pagina} totalPaginas={resp.meta.totalPaginas} total={resp.meta.total} limite={resp.meta.limite} onPagina={pg.setPagina} onLimite={pg.setLimite} />}
      </Card>
    </div>
  );
}
