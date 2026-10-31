/**
 * EXTRATO DA CONTA (banco/caixa): de onde veio e para onde foi cada lançamento, com o saldo depois dele.
 * Abre ao clicar no card do banco em Financeiro → Bancos.
 */
import { useState } from 'react';
import { TextoValores } from '@/components/compartilhados/TextoValores';
import { ICONE_NATUREZA, ROTULO_NATUREZA, type NaturezaLancamento } from '@/components/compartilhados/natureza';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import clsx from 'clsx';
import { ExternalLink, Trash2 } from 'lucide-react';
import { api, mensagemErro } from '@/lib/api';
import { Badge, Button, Card, EmptyState, PageHeader, PeriodoFiltro, Skeleton } from '@/components/ui';
import { data as fmtData, dataHora, moeda } from '@/lib/format';
import { intervaloPeriodo } from '@/lib/periodo';

interface Linha {
  id: number;
  data: string;
  criadoEm: string;
  tipo: 'ENTRADA' | 'SAIDA';
  valor: number;
  descricao: string;
  natureza: NaturezaLancamento;
  contraparte: string;
  link: string | null;
  categoria: string | null;
  observacoes: string | null;
  foraDoResultado: boolean;
  podeExcluir: boolean;
  saldo: number;
}
interface Extrato {
  conta: { id: number; nome: string; tipo: string; cor: string | null; saldoAtual: number };
  saldoAnterior: number;
  entradas: number;
  saidas: number;
  saldoFinal: number;
  total: number;
  cortado: boolean;
  lancamentos: Linha[];
}

export default function ExtratoConta() {
  const { id } = useParams();
  const qc = useQueryClient();
  const mes = intervaloPeriodo('mes');
  const [periodo, setPeriodo] = useState({ i: mes.dataInicial, f: mes.dataFinal });
  const { data: e, isLoading, error } = useQuery({
    queryKey: ['extrato-conta', id, periodo.i, periodo.f],
    queryFn: () => api.get<Extrato>(`/contas-financeiras/${id}/extrato`, { dataInicial: periodo.i || undefined, dataFinal: periodo.f || undefined }),
  });
  const excluir = useMutation({
    mutationFn: (l: Linha) => api.del(`/financeiro/movimentos/${l.id}`),
    onSuccess: () => {
      toast.success('Lançamento excluído (transferência: as duas contas foram acertadas).');
      ['extrato-conta', 'contas-financeiras', 'dashboard-geral', 'caixinhas', 'movimentos-fin'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
    onError: (err) => toast.error(mensagemErro(err)),
  });

  return (
    <div className="pb-6">
      <PageHeader
        migalhas={[{ rotulo: 'Bancos', para: '/financeiro/bancos' }, { rotulo: e?.conta.nome ?? 'Extrato' }]}
        titulo={e ? `Extrato · ${e.conta.nome}` : 'Extrato'}
        descricao="De onde veio e para onde foi cada lançamento, com o saldo depois de cada um."
      />
      <div className="mb-3">
        <PeriodoFiltro inicial={periodo.i} final={periodo.f} onChange={(i, f) => setPeriodo({ i, f })} />
      </div>
      {error && <p className="text-sm text-red-600">{mensagemErro(error)}</p>}
      {isLoading && <Skeleton className="h-60" />}
      {e && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5">
            <Card><p className="text-xs text-slate-500">Saldo antes do período</p><p className="num whitespace-nowrap text-lg font-semibold">{moeda(e.saldoAnterior)}</p></Card>
            <Card><p className="text-xs text-slate-500">Entrou</p><p className="num whitespace-nowrap text-lg font-semibold text-emerald-700">{moeda(e.entradas)}</p></Card>
            <Card><p className="text-xs text-slate-500">Saiu</p><p className="num whitespace-nowrap text-lg font-semibold text-red-600">{moeda(e.saidas)}</p></Card>
            <Card><p className="text-xs text-slate-500">Saldo no fim do período</p><p className="num whitespace-nowrap text-lg font-semibold">{moeda(e.saldoFinal)}</p></Card>
            <Card><p className="text-xs text-slate-500">Saldo hoje</p><p className={clsx('num whitespace-nowrap text-lg font-bold', e.conta.saldoAtual < 0 ? 'text-red-600' : 'text-slate-900')}>{moeda(e.conta.saldoAtual)}</p></Card>
          </div>
          {e.cortado && <p className="mb-2 text-xs text-amber-700">Período com {e.total} lançamentos: mostrando os 3.000 mais recentes. Escolha um período menor para ver os mais antigos.</p>}
          {!e.lancamentos.length ? (
            <EmptyState titulo="Nenhum lançamento no período" descricao="Escolha outro período ou 'Tudo'." />
          ) : (
            <Card semPadding>
              <div className="overflow-x-auto">
                <table className="tbl-pilha w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Data</th>
                      <th className="px-3 py-2">O que foi</th>
                      <th className="px-3 py-2">De onde veio / para onde foi</th>
                      <th className="px-3 py-2 text-right">Entrou</th>
                      <th className="px-3 py-2 text-right">Saiu</th>
                      <th className="px-3 py-2 text-right">Saldo</th>
                      <th className="px-1 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {e.lancamentos.map((l) => (
                      <tr key={l.id} className="align-top hover:bg-slate-50/60">
                        <td data-rotulo="Data" className="whitespace-nowrap px-3 py-2 text-xs text-slate-600" title={`lançado em ${dataHora(l.criadoEm)}`}>{fmtData(l.data)}</td>
                        <td className="pilha-cheio px-3 py-2">
                          <div className="flex items-start gap-2">
                            <span className={clsx('mt-0.5', l.tipo === 'ENTRADA' ? 'text-emerald-600' : 'text-red-500')}>{ICONE_NATUREZA[l.natureza]}</span>
                            <div className="min-w-0">
                              <p className="text-slate-800"><TextoValores texto={l.descricao} /></p>
                              <div className="mt-0.5 flex flex-wrap gap-1">
                                <Badge tom={l.natureza === 'AJUSTE' ? 'amarelo' : l.foraDoResultado ? 'cinza' : 'azul'}>{ROTULO_NATUREZA[l.natureza]}</Badge>
                                {l.foraDoResultado && <span className="text-[10px] text-slate-400">fora do DRE</span>}
                              </div>
                              {l.observacoes && <p className="mt-0.5 text-[11px] text-slate-400">{l.observacoes}</p>}
                            </div>
                          </div>
                        </td>
                        <td data-rotulo="De onde veio / para onde foi" className="pilha-cheio px-3 py-2 text-xs text-slate-600">
                          {l.link ? (
                            <Link to={l.link} className="inline-flex items-center gap-1 text-brand-700 hover:underline">
                              {l.contraparte} <ExternalLink className="h-3 w-3" />
                            </Link>
                          ) : (
                            l.contraparte
                          )}
                        </td>
                        <td data-rotulo="Entrou" className="num whitespace-nowrap px-3 py-2 text-right text-emerald-700">{l.tipo === 'ENTRADA' ? moeda(l.valor) : ''}</td>
                        <td data-rotulo="Saiu" className="num whitespace-nowrap px-3 py-2 text-right text-red-600">{l.tipo === 'SAIDA' ? moeda(l.valor) : ''}</td>
                        <td data-rotulo="Saldo" className={clsx('num whitespace-nowrap px-3 py-2 text-right font-medium', l.saldo < 0 ? 'text-red-600' : 'text-slate-900')}>{moeda(l.saldo)}</td>
                        <td className="pilha-canto px-1 py-2">
                          {l.podeExcluir && (
                            <Button
                              tamanho="xs"
                              variante="fantasma"
                              aria-label="Excluir lançamento"
                              icone={<Trash2 className="h-3.5 w-3.5" />}
                              onClick={() => {
                                if (confirm(l.natureza === 'TRANSFERENCIA' || l.natureza === 'CAIXINHA' ? 'Excluir esta transferência? As DUAS contas voltam ao que eram.' : 'Excluir este lançamento?')) excluir.mutate(l);
                              }}
                            />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
