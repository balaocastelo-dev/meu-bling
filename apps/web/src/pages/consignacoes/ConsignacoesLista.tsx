import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { AlertTriangle, BadgeDollarSign, CalendarClock, Handshake, PackageCheck, Plus, Settings2, Store } from 'lucide-react';
import { api, mensagemErro } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { Badge, BarraFiltros, BuscaFiltro, Button, Card, EmptyState, Input, Modal, MoneyInput, PageHeader, Segmentado, StatCard, Switch, Table, type Coluna } from '@/components/ui';
import { data, moeda } from '@/lib/format';
import { FotoProduto } from '@/components/compartilhados/ProdutoSite';
import { corTexto, nomeTipo, tomStatus, type Consignacao } from './comum';

interface Totais { qtdNoPrazo: number; qtdEmDiarias: number; qtdAguardandoRetirada: number; qtdVendidosAPagar: number; valorEmLoja: number; devidoConsignantes: number; pagarHoje: number; atrasado: number; vendidosAPagar: number; pago: number }
interface Painel {
  totais: Totais;
  caixa: number;
  diariaHoje: number;
  compromisso: { dia: string; valor: number; acimaDoTeto: boolean }[];
  pagarAgora: { id: number; numero: number; descricao: string; consignante: string; status: string; valor: number; atrasado: number; motivo: string }[];
  sugestoesQuitar: { id: number; numero: number; descricao: string; consignante: string; saldo: number; diariasRestantes: number; recomendado: boolean; texto: string }[];
  vencendo: { id: number; numero: number; descricao: string; consignante: string; diasParaPrazo: number; precoVenda: number; diaria: number }[];
  semAssinatura: { id: number; numero: number; descricao: string; consignante: string; link: string }[];
  avisos: { tom: 'vermelho' | 'amarelo' | 'azul' | 'verde'; texto: string; id?: number }[];
}

const FILTROS = [
  { valor: 'ATIVAS', rotulo: 'Ativas' },
  { valor: 'NO_PRAZO', rotulo: 'No prazo' },
  { valor: 'EM_DIARIAS', rotulo: 'Em diárias' },
  { valor: 'VENDIDO', rotulo: 'Vendidas' },
  { valor: 'QUITADO', rotulo: 'Quitadas' },
  { valor: 'RETIRADO', rotulo: 'Retiradas' },
  { valor: 'TODAS', rotulo: 'Todas' },
] as const;

/** Consignação: equipamentos de clientes à venda na loja (contrato, prazo, diárias e pagamento ao consignante). */
export default function ConsignacoesLista() {
  const navigate = useNavigate();
  const temPerfil = useAuth((s) => s.temPerfil);
  const fin = temPerfil('ADMIN', 'GERENTE', 'FINANCEIRO');
  const admin = temPerfil('ADMIN');
  const [sp, setSp] = useSearchParams();
  const filtro = (sp.get('status') ?? 'ATIVAS') as (typeof FILTROS)[number]['valor'];
  const pesquisa = sp.get('pesquisa') ?? '';
  const setFiltro = (k: string, v: string) => {
    const n = new URLSearchParams(sp);
    if (v) n.set(k, v);
    else n.delete(k);
    setSp(n, { replace: true });
  };
  const params = { status: filtro === 'ATIVAS' || filtro === 'TODAS' ? undefined : filtro, ativas: filtro === 'ATIVAS' ? true : undefined, pesquisa: pesquisa || undefined };
  const { data: resp, isLoading } = useQuery({ queryKey: ['consignacoes', params], queryFn: () => api.get<{ data: Consignacao[]; totais: Totais }>('/consignacoes', params), placeholderData: (p) => p });
  const { data: painel } = useQuery({ queryKey: ['consignacoes-painel'], enabled: fin, queryFn: () => api.get<Painel>('/consignacoes/painel'), refetchInterval: 120_000 });
  const [regras, setRegras] = useState(false);
  const t = painel?.totais;

  const colunas: Coluna<Consignacao>[] = [
    {
      chave: 'eq',
      titulo: 'Equipamento',
      noCartao: 'titulo',
      render: (c) => (
        <div className="flex min-w-0 items-center gap-3">
          <FotoProduto url={c.fotosUrls?.[0]?.url ?? null} tamanho="sm" />
          <div className="min-w-0">
            <p className="truncate font-medium text-slate-900">{c.descricao}</p>
            <p className="truncate text-xs text-slate-400">Nº {c.numero} · {nomeTipo(c.tipoEquipamento)} · {c.consignante.nome}</p>
          </div>
        </div>
      ),
    },
    { chave: 'preco', titulo: 'Preço', direita: true, render: (c) => <div><p className="num">{moeda(c.precoVenda)}</p><p className="num text-[11px] text-slate-400">consignante {moeda(c.valorConsignante)}</p></div> },
    { chave: 'prazo', titulo: 'Prazo', ocultarMobile: true, render: (c) => <div><p>{data(c.dataLimite)}</p><p className="text-[11px] text-slate-400">{c.diasConsignado} dia(s) na loja</p></div> },
    { chave: 'saldo', titulo: 'A pagar', direita: true, render: (c) => <div><p className={c.saldo > 0 ? 'num font-semibold text-slate-900' : 'num text-slate-400'}>{moeda(c.saldo)}</p>{c.diariasTotal > 0 && <p className="text-[11px] text-slate-400">diárias {c.diariasPagas}/{c.diariasTotal}</p>}</div> },
    {
      chave: 'st',
      titulo: 'Situação',
      render: (c) => (
        <div className="space-y-1">
          <div className="flex flex-wrap gap-1">
            <Badge tom={tomStatus(c.status)}>{c.rotuloStatus}</Badge>
            {!c.assinadoEm && c.status === 'NO_PRAZO' && <Badge tom="laranja">Sem assinatura</Badge>}
            {c.descontoPendente && <Badge tom="roxo">Desconto pedido</Badge>}
          </div>
          {c.alerta && <p className={`max-w-[260px] text-[11px] leading-snug ${corTexto(c.alerta.tom)}`}>{c.alerta.texto}</p>}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        titulo="Consignação"
        descricao="Equipamentos de clientes à venda na loja: contrato, prazo, diárias e pagamento ao consignante."
        acoes={
          <div className="flex flex-wrap gap-2">
            {admin && <Button icone={<Settings2 className="h-4 w-4" />} onClick={() => setRegras(true)}>Regras</Button>}
            <Button variante="primario" icone={<Plus className="h-4 w-4" />} onClick={() => navigate('/consignacoes/nova')}>Novo contrato</Button>
          </div>
        }
      />

      {fin && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard rotulo="Pagar hoje" valor={moeda(t?.pagarHoje)} sub={t?.atrasado ? `${moeda(t.atrasado)} atrasado` : 'diárias e vendidos'} tom={t?.atrasado ? 'vermelho' : t?.pagarHoje ? 'amarelo' : 'neutro'} carregando={!t} icone={<BadgeDollarSign className="h-4 w-4" />} />
            <StatCard rotulo="Vendidos a pagar" valor={moeda(t?.vendidosAPagar)} sub={t ? `${t.qtdVendidosAPagar} consignante(s)` : undefined} tom={t?.vendidosAPagar ? 'vermelho' : 'neutro'} carregando={!t} icone={<PackageCheck className="h-4 w-4" />} onClick={() => setFiltro('status', 'VENDIDO')} />
            <StatCard rotulo="Em diárias" valor={String(t?.qtdEmDiarias ?? 0)} sub={painel ? `${moeda(painel.diariaHoje)} saem hoje` : undefined} tom="amarelo" carregando={!t} icone={<CalendarClock className="h-4 w-4" />} onClick={() => setFiltro('status', 'EM_DIARIAS')} />
            <StatCard rotulo="Na loja à venda" valor={moeda(t?.valorEmLoja)} sub={t ? `${t.qtdNoPrazo + t.qtdEmDiarias} equipamento(s)` : undefined} tom="azul" carregando={!t} icone={<Store className="h-4 w-4" />} />
          </div>
          {painel && <PainelAdm painel={painel} />}
        </>
      )}

      <Card semPadding>
        <BarraFiltros>
          <Segmentado opcoes={FILTROS.map((f) => ({ valor: f.valor, rotulo: f.rotulo }))} valor={filtro} onMudar={(v) => setFiltro('status', v === 'ATIVAS' ? '' : v)} />
          <BuscaFiltro valor={pesquisa} onChange={(v) => setFiltro('pesquisa', v)} placeholder="Nº, equipamento, IMEI, consignante…" />
        </BarraFiltros>
        <Table
          colunas={colunas}
          dados={resp?.data ?? []}
          carregando={isLoading}
          chave={(c) => c.id}
          onClickLinha={(c) => navigate(`/consignacoes/${c.id}`)}
          destacar={(c) => !!c.alerta && c.alerta.tom === 'vermelho'}
          vazio={<EmptyState icone={<Handshake className="h-5 w-5" />} titulo="Nenhuma consignação" descricao="Cadastre o equipamento do cliente: o contrato sai na hora e ele assina pelo celular." acao={<Button tamanho="sm" variante="primario" icone={<Plus className="h-4 w-4" />} onClick={() => navigate('/consignacoes/nova')}>Novo contrato</Button>} />}
          compacta
        />
      </Card>

      {admin && <RegrasModal aberto={regras} onFechar={() => setRegras(false)} />}
    </div>
  );
}

function PainelAdm({ painel }: { painel: Painel }) {
  const tem = painel.pagarAgora.length || painel.sugestoesQuitar.length || painel.vencendo.length || painel.semAssinatura.length || painel.avisos.length;
  if (!tem) return null;
  const max = Math.max(1, ...painel.compromisso.map((c) => c.valor));
  return (
    <div className="mb-4 grid gap-3 lg:grid-cols-2">
      {painel.pagarAgora.length > 0 && (
        <Card titulo="Pagar agora" descricao="Diárias do dia (ou atrasadas) e consignados vendidos" semPadding>
          <ul className="divide-y divide-slate-100">
            {painel.pagarAgora.map((p) => (
              <li key={p.id}>
                <Link to={`/consignacoes/${p.id}`} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-slate-50">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-slate-800">{p.consignante} · nº {p.numero}</p>
                    <p className="truncate text-xs text-slate-500">{p.descricao} — {p.motivo}</p>
                  </div>
                  <span className={`num font-semibold ${p.atrasado > 0 || p.status === 'VENDIDO' ? 'text-red-600' : 'text-slate-900'}`}>{moeda(p.valor)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {painel.sugestoesQuitar.length > 0 && (
        <Card titulo="Vendidos durante as diárias" descricao="Sugestão: quitar o saldo ou seguir nas diárias" semPadding>
          <ul className="divide-y divide-slate-100">
            {painel.sugestoesQuitar.map((s) => (
              <li key={s.id}>
                <Link to={`/consignacoes/${s.id}`} className="block px-4 py-2.5 text-sm hover:bg-slate-50">
                  <p className="font-medium text-slate-800">{s.descricao} · falta <span className="num">{moeda(s.saldo)}</span></p>
                  <p className={`text-xs ${s.recomendado ? 'text-emerald-700' : 'text-slate-500'}`}>{s.texto}</p>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {painel.compromisso.length > 0 && (
        <Card titulo="Compromisso de caixa" descricao="Quanto sai por dia em diárias nos próximos dias">
          <div className="space-y-1.5">
            {painel.compromisso.slice(0, 10).map((c) => (
              <div key={c.dia} className="flex items-center gap-2 text-xs">
                <span className="w-20 shrink-0 text-slate-500">{c.dia === 'atrasado' ? 'Atrasado' : c.dia.split('-').reverse().slice(0, 2).join('/')}</span>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <div className={`h-full rounded-full ${c.dia === 'atrasado' || c.acimaDoTeto ? 'bg-red-500' : 'bg-brand-500'}`} style={{ width: `${(c.valor / max) * 100}%` }} />
                </div>
                <span className="num w-24 shrink-0 text-right font-medium text-slate-700">{moeda(c.valor)}</span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-slate-400">Saldo nos bancos e caixa: {moeda(painel.caixa)}</p>
        </Card>
      )}
      {(painel.vencendo.length > 0 || painel.semAssinatura.length > 0 || painel.avisos.some((a) => a.tom === 'vermelho')) && (
        <Card titulo="Atenção" semPadding>
          <ul className="divide-y divide-slate-100 text-sm">
            {painel.avisos.filter((a) => a.tom === 'vermelho').map((a, i) => (
              <li key={`a${i}`} className="flex items-center gap-2 px-4 py-2.5 text-red-700"><AlertTriangle className="h-4 w-4 shrink-0" />{a.texto}</li>
            ))}
            {painel.vencendo.map((v) => (
              <li key={`v${v.id}`}>
                <Link to={`/consignacoes/${v.id}`} className="block px-4 py-2.5 hover:bg-slate-50">
                  <p className="text-slate-800">{v.descricao} <span className="text-xs text-slate-400">· {v.consignante}</span></p>
                  <p className="text-xs text-amber-700">{v.diasParaPrazo <= 0 ? 'Prazo termina hoje' : `Faltam ${v.diasParaPrazo} dia(s)`} — depois começam diárias de {moeda(v.diaria)}. Dê destaque ou peça desconto.</p>
                </Link>
              </li>
            ))}
            {painel.semAssinatura.map((s) => (
              <li key={`s${s.id}`}>
                <Link to={`/consignacoes/${s.id}`} className="block px-4 py-2.5 hover:bg-slate-50">
                  <p className="text-slate-800">{s.descricao} <span className="text-xs text-slate-400">· {s.consignante}</span></p>
                  <p className="text-xs text-sky-700">Falta a assinatura do contrato (não aparece no site até assinar).</p>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

interface Regras { percentualConsignante: number; prazoDias: number; diariaPct: number; diariaMinima: number; diariaMaxima: number; taxaRetirada: number; descontoPct: number; diasPedirDesconto: number[]; tetoDiarioLoja: number; feriadosExtras: string[]; whatsapp: boolean }

function RegrasModal({ aberto, onFechar }: { aberto: boolean; onFechar: () => void }) {
  const qc = useQueryClient();
  const { data: r } = useQuery({ queryKey: ['consignacoes-regras'], enabled: aberto, queryFn: () => api.get<{ regras: Regras }>('/consignacoes/regras') });
  const [f, setF] = useState<Regras | null>(null);
  const [dias, setDias] = useState('');
  const [feriados, setFeriados] = useState('');
  useEffect(() => {
    if (r?.regras && aberto) {
      setF(r.regras);
      setDias(r.regras.diasPedirDesconto.join(', '));
      setFeriados(r.regras.feriadosExtras.map((d) => d.split('-').reverse().join('/')).join(', '));
    }
  }, [r, aberto]);
  const set = <K extends keyof Regras>(k: K, v: Regras[K]) => setF((x) => (x ? { ...x, [k]: v } : x));
  const salvar = useMutation({
    mutationFn: () =>
      api.put<{ aviso: string }>('/consignacoes/regras', {
        ...f,
        diasPedirDesconto: dias.split(/[,;\s]+/).map(Number).filter((n) => n > 0),
        feriadosExtras: feriados
          .split(/[,;\s]+/)
          .filter(Boolean)
          .map((d) => {
            const [dd, mm, aa] = d.split('/');
            return `${aa}-${mm?.padStart(2, '0')}-${dd?.padStart(2, '0')}`;
          }),
      }),
    onSuccess: (x) => {
      toast.success(x.aviso);
      qc.invalidateQueries({ queryKey: ['consignacoes-regras'] });
      onFechar();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });
  return (
    <Modal aberto={aberto} onFechar={onFechar} titulo="Regras da consignação" descricao="Valem para os próximos contratos. Os já assinados seguem as regras deles." tamanho="lg" rodape={<><Button onClick={onFechar}>Cancelar</Button><Button variante="primario" carregando={salvar.isPending} disabled={!f} onClick={() => salvar.mutate()}>Salvar regras</Button></>}>
      {!f ? (
        <p className="text-sm text-slate-400">Carregando…</p>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <MoneyInput label="Consignante fica com (%)" prefixo="" value={f.percentualConsignante} onChange={(v) => set('percentualConsignante', v)} />
            <Input label="Prazo (dias corridos)" type="number" min={1} value={f.prazoDias} onChange={(e) => set('prazoDias', Number(e.target.value) || 1)} />
            <MoneyInput label="Taxa de retirada antes do prazo" value={f.taxaRetirada} onChange={(v) => set('taxaRetirada', v)} />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <MoneyInput label="Diária (% do valor)" prefixo="" value={f.diariaPct} onChange={(v) => set('diariaPct', v)} />
            <MoneyInput label="Diária mínima" value={f.diariaMinima} onChange={(v) => set('diariaMinima', v)} />
            <MoneyInput label="Diária máxima" value={f.diariaMaxima} onChange={(v) => set('diariaMaxima', v)} />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <MoneyInput label="Desconto que o robô pede (%)" prefixo="" value={f.descontoPct} onChange={(v) => set('descontoPct', v)} />
            <Input label="Pedir desconto nos dias" value={dias} onChange={(e) => setDias(e.target.value)} ajuda="Ex.: 3, 7 (contados da entrada)" />
            <MoneyInput label="Teto de diárias por dia (loja)" value={f.tetoDiarioLoja} onChange={(v) => set('tetoDiarioLoja', v)} ajuda="0 = sem limite; passou, o painel avisa" />
          </div>
          <Input label="Outros dias sem expediente" value={feriados} onChange={(e) => setFeriados(e.target.value)} ajuda="Além dos feriados nacionais, 9/7 (SP) e 8/12 (Campinas). Ex.: 24/12/2026, 31/12/2026" />
          <Switch checked={f.whatsapp} onChange={(v) => set('whatsapp', v)} label="Mandar WhatsApp automático ao consignante" />
        </div>
      )}
    </Modal>
  );
}
