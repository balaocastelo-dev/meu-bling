import clsx from 'clsx';
import { CalendarClock, Crown, Lock, Target, Trophy } from 'lucide-react';
import { data, inteiro, moeda, numero } from '@/lib/format';
import type { DesafioCard as Desafio, TipoDesafio } from '@/types';

/** Valor de um desafio no formato do tipo (R$, nº de vendas, unidades, R$ de serviços ou nº de OS) */
export function valorDesafio(tipo: TipoDesafio, v: number) {
  if (tipo === 'VALOR' || tipo === 'VALOR_SERVICOS') return moeda(v);
  if (tipo === 'QTD_VENDAS') return `${inteiro(v)} ${v === 1 ? 'venda' : 'vendas'}`;
  if (tipo === 'QTD_OS') return `${inteiro(v)} OS`;
  return `${numero(v)} un.`;
}

export function textoAlvo(d: Pick<Desafio, 'tipo' | 'alvo' | 'produto' | 'categoria'>) {
  const filtro = d.produto ? ` de ${d.produto.nome}` : d.categoria ? ` em ${d.categoria.nome}` : '';
  if (d.tipo === 'VALOR') return `Vender ${moeda(d.alvo)}${filtro}`;
  if (d.tipo === 'QTD_VENDAS') return `Fazer ${inteiro(d.alvo)} ${d.alvo === 1 ? 'venda' : 'vendas'}${filtro ? ` com${filtro.replace(/^ de/, '')}` : ''}`;
  if (d.tipo === 'VALOR_SERVICOS') return `Concluir ${moeda(d.alvo)} em OS`;
  if (d.tipo === 'QTD_OS') return `Concluir ${inteiro(d.alvo)} OS`;
  return `Vender ${numero(d.alvo)} unidade${d.alvo === 1 ? '' : 's'}${filtro}`;
}

function prazo(d: Desafio) {
  if (d.status === 'AGENDADO') return `Começa em ${data(d.inicio)}`;
  if (d.status === 'ENCERRADO' || d.status === 'GANHO_POR_OUTRO') return `Período: ${data(d.inicio)} a ${data(d.fim)}`;
  if (d.diasRestantes <= 1) return 'Termina hoje!';
  return `Faltam ${d.diasRestantes} dias · até ${data(d.fim)}`;
}

/** Card de desafio no painel do vendedor */
export function DesafioCard({ d }: { d: Desafio }) {
  const ganhou = d.status === 'CONQUISTADO';
  const fechado = d.status === 'ENCERRADO' || d.status === 'GANHO_POR_OUTRO';
  return (
    <div
      className={clsx(
        'relative flex flex-col overflow-hidden rounded-xl border bg-white shadow-card transition',
        ganhou ? 'border-emerald-300 ring-2 ring-emerald-200' : fechado ? 'border-slate-200 opacity-70' : 'border-amber-200',
      )}
    >
      <div className={clsx('flex items-center justify-between px-4 py-3 text-white', ganhou ? 'bg-gradient-to-r from-emerald-500 to-emerald-600' : fechado ? 'bg-slate-400' : 'bg-gradient-to-r from-amber-500 to-orange-500')}>
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide">
          {ganhou ? <Trophy className="h-4 w-4" /> : fechado ? <Lock className="h-4 w-4" /> : <Target className="h-4 w-4" />}
          {ganhou ? 'Conquistado!' : d.status === 'GANHO_POR_OUTRO' ? 'Já tem ganhador' : d.status === 'ENCERRADO' ? 'Encerrado' : d.status === 'AGENDADO' ? 'Em breve' : 'Desafio'}
        </div>
        <span className="text-xl font-extrabold tracking-tight num">+{moeda(d.premio)}</span>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div>
          <h3 className="text-base font-semibold leading-snug text-slate-900">{d.titulo}</h3>
          <p className="mt-0.5 text-sm text-slate-600">{textoAlvo(d)}</p>
          {d.descricao && <p className="mt-1 text-xs text-slate-500">{d.descricao}</p>}
        </div>

        <div>
          <div className="mb-1 flex items-baseline justify-between text-xs">
            <span className="font-medium text-slate-700 num">
              {valorDesafio(d.tipo, d.atingido)} <span className="text-slate-400">de {valorDesafio(d.tipo, d.alvo)}</span>
            </span>
            <span className={clsx('font-semibold num', ganhou ? 'text-emerald-600' : 'text-slate-600')}>{numero(d.pct, 0)}%</span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div className={clsx('h-full rounded-full transition-all', ganhou ? 'bg-emerald-500' : fechado ? 'bg-slate-400' : 'bg-amber-500')} style={{ width: `${Math.max(2, d.pct)}%` }} />
          </div>
          {!ganhou && !fechado && d.falta > 0 && <p className="mt-1 text-xs text-slate-500">Falta {valorDesafio(d.tipo, d.falta)}</p>}
        </div>

        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1">
            <CalendarClock className="h-3.5 w-3.5" />
            {ganhou && d.conquistadoEm ? `Batido em ${data(d.conquistadoEm)}` : prazo(d)}
          </span>
          {d.regra === 'PRIMEIRO' && !ganhou && (
            <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 font-medium text-violet-700">
              <Crown className="h-3 w-3" /> Só o primeiro ganha
            </span>
          )}
          {d.status === 'GANHO_POR_OUTRO' && d.ganhador && <span>Ganhador: {d.ganhador}</span>}
          {ganhou && <span className="font-medium text-emerald-700">{d.premioStatus === 'PAGA' ? 'Prêmio pago' : 'Prêmio liberado na comissão'}</span>}
        </div>
      </div>
    </div>
  );
}
