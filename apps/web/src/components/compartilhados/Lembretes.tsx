/**
 * LEMBRETES DO ROBÔ DA SAÚDE PARA A EQUIPE (29/10/2026)
 * O robô monitora as OS e as vendas: OS com peça sem custo vira lembrete para o técnico; venda com produto
 * sem custo vira lembrete para o vendedor. Aparece no painel de quem precisa agir e some sozinho quando o
 * custo é preenchido. ADMIN e GERENTE veem também os lembretes da equipe, com o nome de quem precisa agir.
 *   <LembretesParaVoce />   card para o painel (OS, painel do vendedor, início da gerente)
 *   <SinoLembretes />       sino no topo para quem não é ADMIN (o ADMIN tem o sino do robô)
 */
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { AlertTriangle, Bell, ChevronRight, Info, Users, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { Card } from '@/components/ui';
import { dataHora } from '@/lib/format';

export interface Lembrete {
  id: number;
  chave: string;
  nivel: 'erro' | 'aviso' | 'info';
  area: string;
  titulo: string;
  mensagem: string;
  link: string | null;
  criadoEm: string;
  tecnicoId: number | null;
  vendedorId: number | null;
  /** nome de quem precisa agir (só na lista da equipe) */
  quem?: string | null;
}
export interface Lembretes {
  meus: Lembrete[];
  equipe: Lembrete[];
  /** OS com peça sem custo e sem técnico: ninguém recebe o lembrete */
  semDono: number;
}

export const CHAVE_LEMBRETES = ['lembretes-robo'] as const;

export function useLembretes(ativo = true) {
  return useQuery({ queryKey: CHAVE_LEMBRETES, queryFn: () => api.get<Lembretes>('/robo-saude/lembretes'), refetchInterval: 60_000, refetchOnWindowFocus: true, enabled: ativo });
}

const ICONE = { erro: AlertTriangle, aviso: AlertTriangle, info: Info };
const COR = { erro: 'text-red-600', aviso: 'text-amber-600', info: 'text-sky-600' };

function Linha({ l, mostrarQuem }: { l: Lembrete; mostrarQuem?: boolean }) {
  const Icone = ICONE[l.nivel] ?? Info;
  const conteudo = (
    <>
      <Icone className={clsx('mt-0.5 h-4 w-4 shrink-0', COR[l.nivel])} />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-slate-800">
          {mostrarQuem && l.quem && <span className="mr-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600">{l.quem.split(' ')[0]}</span>}
          {l.titulo}
        </span>
        <span className="block text-xs text-slate-500">{l.mensagem}</span>
        <span className="block text-[11px] text-slate-400">{l.area} · desde {dataHora(l.criadoEm)}</span>
      </span>
      {l.link && <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-slate-300" />}
    </>
  );
  return l.link ? (
    <Link to={l.link} className="flex items-start gap-3 px-4 py-2.5 hover:bg-amber-50/60">{conteudo}</Link>
  ) : (
    <div className="flex items-start gap-3 px-4 py-2.5">{conteudo}</div>
  );
}

/**
 * Card "Lembretes para você" (+ "Lembretes da equipe" para a gestão). Some quando não há nada.
 * `area` filtra os da equipe por área (ex.: só "Assistência" na tela de OS); os seus aparecem sempre.
 */
export function LembretesParaVoce({ className, area }: { className?: string; area?: string }) {
  const perfil = useAuth((s) => s.usuario?.perfil);
  const { data } = useLembretes();
  if (!data) return null;
  const gestao = perfil === 'ADMIN' || perfil === 'GERENTE';
  const meusIds = new Set(data.meus.map((l) => l.id));
  const equipe = gestao ? data.equipe.filter((l) => !meusIds.has(l.id) && (!area || l.area === area)) : [];
  if (!data.meus.length && !equipe.length && !(gestao && data.semDono)) return null;
  return (
    <Card
      className={clsx('border-amber-200', className)}
      titulo={
        <span className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-amber-600" /> {data.meus.length ? 'Lembretes para você' : 'Lembretes da equipe'}
        </span>
      }
      descricao={data.meus.length ? `${data.meus.length} ${data.meus.length === 1 ? 'coisa que precisa' : 'coisas que precisam'} do seu preenchimento — some sozinho quando você resolver` : 'O que a equipe ainda precisa preencher'}
      semPadding
    >
      {data.meus.length > 0 && (
        <ul className="divide-y divide-slate-100">
          {data.meus.map((l) => (
            <li key={l.id}><Linha l={l} /></li>
          ))}
        </ul>
      )}
      {equipe.length > 0 && (
        <>
          {data.meus.length > 0 && (
            <p className="flex items-center gap-1.5 border-t border-slate-100 bg-slate-50 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400"><Users className="h-3.5 w-3.5" /> Equipe</p>
          )}
          <ul className="divide-y divide-slate-100">
            {equipe.slice(0, 12).map((l) => (
              <li key={l.id}><Linha l={l} mostrarQuem /></li>
            ))}
          </ul>
          {equipe.length > 12 && <p className="px-4 py-2 text-xs text-slate-400">… e mais {equipe.length - 12}. O ADMIN vê tudo no Robô da Saúde.</p>}
        </>
      )}
      {gestao && data.semDono > 0 && (
        <p className="border-t border-slate-100 px-4 py-2 text-xs text-amber-700">
          {data.semDono === 1 ? '1 OS com peça sem custo está sem técnico' : `${data.semDono} OS com peça sem custo estão sem técnico`} — ninguém recebe o lembrete. Defina o técnico na OS.
        </p>
      )}
    </Card>
  );
}

/** Sino no topo para quem não é ADMIN: número de lembretes para você, com a lista ao clicar. */
export function SinoLembretes() {
  const usuario = useAuth((s) => s.usuario);
  const [aberto, setAberto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const ativo = !!usuario && usuario.perfil !== 'ADMIN';
  const { data } = useLembretes(ativo);

  useEffect(() => {
    if (!aberto) return;
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setAberto(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [aberto]);

  if (!ativo) return null;
  const lista = data?.meus ?? [];
  const n = lista.length;
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        title={n ? `${n} lembrete${n > 1 ? 's' : ''} para você` : 'Sem lembretes'}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100"
        aria-label="Lembretes"
      >
        <Bell className="h-5 w-5" />
        {n > 0 && <span className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-amber-500 px-1 text-center text-[10px] font-bold leading-[18px] text-white">{n > 99 ? '99+' : n}</span>}
      </button>
      {aberto && (
        <div className="fixed inset-x-2 top-14 z-40 rounded-xl border border-slate-200 bg-white shadow-pop anim-in sm:absolute sm:inset-x-auto sm:right-0 sm:top-11 sm:w-96">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
            <p className="text-sm font-semibold text-slate-800">Lembretes para você</p>
            <button type="button" onClick={() => setAberto(false)} className="rounded p-1 text-slate-400 hover:bg-slate-100" aria-label="Fechar"><X className="h-4 w-4" /></button>
          </div>
          {n === 0 ? (
            <p className="px-4 py-4 text-sm text-emerald-700">Tudo em dia: nada pendente para você.</p>
          ) : (
            <ul className="max-h-[70dvh] divide-y divide-slate-100 overflow-y-auto">
              {lista.map((l) => (
                <li key={l.id} onClick={() => setAberto(false)}><Linha l={l} /></li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
