/**
 * PAINEL DE AUDITORIA (só ADMIN, com a senha do dia: 56676009 + DDMMAAAA)
 *
 * Tudo o que acontece no sistema, ao vivo e desde o primeiro dia, separado por categoria e por
 * funcionário, com o conteúdo antes/depois de cada registro — e o botão para reverter qualquer
 * operação. Agentes de IA rodam 24h apontando padrões, inconsistências e coisas suspeitas.
 */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import clsx from 'clsx';
import { Activity, AlertOctagon, AlertTriangle, Bot, History, Lock, LogOut, Radio, ShieldCheck, Users } from 'lucide-react';
import { Button, Input, PageHeader, Tabs } from '@/components/ui';
import { FaixaKpis, KpiV18, PaginaV18 } from '@/components/dashboard/v18';
import { mensagemErro } from '@/lib/api';
import { data as fmtData, dataHora, inteiro } from '@/lib/format';
import { guardarTokenPainel, painel, sairDoPainel, SenhaDoPainelError, tokenPainel, type AgentesResposta, type Resumo } from './apiPainel';
import { Achados, Agentes, AoVivo, FILTROS_PADRAO, Funcionarios, Historico, type FiltrosHistorico } from './abas';
import { OperacaoDrawer } from './partes';

type Aba = 'vivo' | 'historico' | 'funcionarios' | 'achados' | 'agentes';

export default function PainelAuditoria() {
  const [liberado, setLiberado] = useState(() => !!tokenPainel());
  const qc = useQueryClient();
  // qualquer resposta "senha do painel" (token venceu) volta para o cofre
  useEffect(() => {
    const h = (ev: PromiseRejectionEvent) => {
      if (ev.reason instanceof SenhaDoPainelError) {
        ev.preventDefault();
        setLiberado(false);
      }
    };
    window.addEventListener('unhandledrejection', h);
    return () => window.removeEventListener('unhandledrejection', h);
  }, []);
  if (!liberado) return <Cofre onLiberar={() => { setLiberado(true); void qc.invalidateQueries({ queryKey: ['painel'] }); }} />;
  return <Painel onSair={() => { sairDoPainel(); setLiberado(false); }} onSenhaVenceu={() => setLiberado(false)} />;
}

/** O cofre: a senha do dia */
function Cofre({ onLiberar }: { onLiberar: () => void }) {
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setEnviando(true);
    setErro(null);
    try {
      const r = await painel.post<{ token: string; expiraEm: string }>('/entrar', { senha: senha.trim() });
      guardarTokenPainel(r.token, r.expiraEm);
      onLiberar();
    } catch (err) {
      setErro(mensagemErro(err));
    } finally {
      setEnviando(false);
    }
  };
  return (
    <PaginaV18 className="mx-auto max-w-md pt-6 sm:pt-12">
      <form onSubmit={enviar} className="v18-card rounded-2xl border border-slate-200/80 bg-white p-6 shadow-card">
        <div className="mb-4 flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-50 text-brand-600"><Lock className="h-5 w-5" /></span>
          <div>
            <h1 className="text-lg font-semibold text-slate-900">Painel de auditoria</h1>
            <p className="text-sm text-slate-500">Só o administrador entra, e só com a senha do dia.</p>
          </div>
        </div>
        <Input label="Senha do dia" type="password" inputMode="numeric" autoFocus autoComplete="off" value={senha} onChange={(e) => setSenha(e.target.value)} erro={erro ?? undefined} placeholder="••••••••••••••••" />
        <p className="mt-2 text-xs text-slate-400">A senha muda todo dia. Cada tentativa (certa ou errada) fica registrada na trilha.</p>
        <Button type="submit" variante="primario" className="mt-4 w-full" carregando={enviando} disabled={!senha.trim()}>
          Abrir o painel
        </Button>
      </form>
    </PaginaV18>
  );
}

function Painel({ onSair, onSenhaVenceu }: { onSair: () => void; onSenhaVenceu: () => void }) {
  const [params, setParams] = useSearchParams();
  const aba = (params.get('aba') as Aba) || 'vivo';
  const opAberta = params.get('op');
  const [filtros, setFiltros] = useState<FiltrosHistorico>(FILTROS_PADRAO);

  const resumo = useQuery({
    queryKey: ['painel', 'resumo'],
    queryFn: () => painel.get<Resumo>('/resumo'),
    refetchInterval: 15_000,
    retry: (n, e) => !(e instanceof SenhaDoPainelError) && n < 2,
  });
  useEffect(() => {
    if (resumo.error instanceof SenhaDoPainelError) onSenhaVenceu();
    else if (resumo.error) toast.error(mensagemErro(resumo.error));
  }, [resumo.error, onSenhaVenceu]);
  const usuarios = useQuery({ queryKey: ['painel', 'usuarios'], queryFn: () => painel.get<{ id: number; nome: string }[]>('/usuarios') });
  const agentes = useQuery({ queryKey: ['painel', 'agentes'], queryFn: () => painel.get<AgentesResposta>('/agentes') });

  const mudarAba = useCallback(
    (a: Aba) => {
      const p = new URLSearchParams(params);
      p.set('aba', a);
      setParams(p, { replace: true });
    },
    [params, setParams],
  );
  const abrirOp = useCallback(
    (id: string | null) => {
      const p = new URLSearchParams(params);
      if (id) p.set('op', id);
      else p.delete('op');
      setParams(p, { replace: true });
    },
    [params, setParams],
  );
  const verRegistro = useCallback(
    (tabela: string, id: number) => {
      setFiltros({ ...FILTROS_PADRAO, tabela, registroId: String(id) });
      abrirOp(null);
      mudarAba('historico');
    },
    [abrirOp, mudarAba],
  );
  const verFuncionario = (usuarioId: number) => {
    setFiltros({ ...FILTROS_PADRAO, usuarioId: String(usuarioId) });
    mudarAba('historico');
  };

  const r = resumo.data;
  const achadosAbertos = (r?.achados.alto ?? 0) + (r?.achados.medio ?? 0) + (r?.achados.baixo ?? 0);
  const categorias = useMemo(() => r?.categorias ?? [], [r]);

  return (
    <PaginaV18>
      <PageHeader
        titulo={<span className="flex items-center gap-2"><ShieldCheck className="h-6 w-6 text-brand-600" /> Painel de auditoria</span>}
        descricao={r?.historicoDesde ? `Tudo o que acontece no sistema, ao vivo e desde ${fmtData(r.historicoDesde)} · toda operação pode ser revertida` : 'Tudo o que acontece no sistema, ao vivo e desde o início'}
        acoes={
          <Button variante="secundario" icone={<LogOut className="h-4 w-4" />} onClick={onSair}>
            Fechar o painel
          </Button>
        }
      />

      <FaixaKpis colunas={6} className="mb-4">
        <KpiV18 rotulo="Operações hoje" valor={r?.hoje.operacoes} formato={inteiro} icone={<Activity className="h-4 w-4" />} tom="azul" carregando={!r} sub={r?.ultimaOperacao ? `última ${dataHora(r.ultimaOperacao).slice(-5)}` : undefined} onClick={() => mudarAba('vivo')} />
        <KpiV18 rotulo="Pessoas ativas hoje" valor={r?.hoje.usuarios.length} formato={inteiro} icone={<Users className="h-4 w-4" />} tom="verde" carregando={!r} sub={r?.hoje.usuarios.slice(0, 2).map((u) => u.usuario.split(' ')[0]).join(', ')} onClick={() => mudarAba('funcionarios')} />
        <KpiV18 rotulo="Achados altos" valor={r?.achados.alto} formato={inteiro} icone={<AlertOctagon className="h-4 w-4" />} tom="vermelho" carregando={!r} sub="precisam de você" onClick={() => mudarAba('achados')} />
        <KpiV18 rotulo="Achados médios/baixos" valor={(r?.achados.medio ?? 0) + (r?.achados.baixo ?? 0)} formato={inteiro} icone={<AlertTriangle className="h-4 w-4" />} tom="amarelo" carregando={!r} sub={`${achadosAbertos} abertos no total`} onClick={() => mudarAba('achados')} />
        <KpiV18 rotulo="Histórico total" valor={r?.totalOperacoes} formato={inteiro} icone={<History className="h-4 w-4" />} tom="neutro" carregando={!r} sub="operações na trilha" onClick={() => mudarAba('historico')} />
        <KpiV18 rotulo="Agentes" valor={agentes.data?.agentes.filter((a) => a.ligado).length ?? 0} formato={(n) => `${n} de ${agentes.data?.agentes.length ?? 8}`} icone={<Bot className="h-4 w-4" />} tom={r?.agentes.ligado ? 'verde' : 'amarelo'} carregando={!r} sub={r?.agentes.ultimaVez ? `rodaram ${dataHora(r.agentes.ultimaVez).slice(-5)}` : 'ainda não rodaram'} onClick={() => mudarAba('agentes')} />
      </FaixaKpis>

      {r && r.hoje.porCategoria.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5 text-xs">
          {r.hoje.porCategoria
            .sort((a, b) => b.n - a.n)
            .map((c) => (
              <button key={c.categoria} type="button" onClick={() => { setFiltros({ ...FILTROS_PADRAO, categoria: c.categoria, ...intervaloHoje() }); mudarAba('historico'); }} className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-slate-600 shadow-xs hover:border-slate-300">
                {categorias.find((x) => x.chave === c.categoria)?.rotulo ?? c.categoria} <span className="num font-semibold text-slate-900">{c.n}</span>
              </button>
            ))}
        </div>
      )}

      <Tabs
        className="mb-3"
        ativa={aba}
        onMudar={(a) => mudarAba(a as Aba)}
        abas={[
          { id: 'vivo', rotulo: 'Ao vivo', icone: <Radio className="h-4 w-4" /> },
          { id: 'historico', rotulo: 'Histórico', icone: <History className="h-4 w-4" /> },
          { id: 'funcionarios', rotulo: 'Funcionários', icone: <Users className="h-4 w-4" /> },
          { id: 'achados', rotulo: 'Achados', icone: <AlertTriangle className="h-4 w-4" />, contador: achadosAbertos || undefined },
          { id: 'agentes', rotulo: 'Agentes de IA', icone: <Bot className="h-4 w-4" /> },
        ]}
      />

      <div className={clsx(aba !== 'vivo' && 'hidden')}>{aba === 'vivo' && <AoVivo onAbrir={(id) => abrirOp(id)} />}</div>
      {aba === 'historico' && <Historico filtros={filtros} onFiltros={setFiltros} onAbrir={(id) => abrirOp(id)} usuarios={usuarios.data ?? []} categorias={categorias} />}
      {aba === 'funcionarios' && <Funcionarios onVerTrilha={verFuncionario} />}
      {aba === 'achados' && <Achados onAbrirOperacao={(id) => abrirOp(id)} onVerRegistro={verRegistro} agentes={agentes.data?.agentes ?? []} />}
      {aba === 'agentes' && <Agentes />}

      <OperacaoDrawer id={opAberta} onFechar={() => abrirOp(null)} onAbrirOutra={(id) => abrirOp(id)} onTrilha={verRegistro} />
    </PaginaV18>
  );
}

function intervaloHoje() {
  const d = new Date();
  const s = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { dataInicial: s, dataFinal: s };
}
