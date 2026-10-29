/** Caixa de entrada: busca, abas (Conversas · Pessoas · Todas [ADMIN]) e o botão "Nova sala". */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { Plus, Search, Users, Wifi, WifiOff } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/stores/auth';
import { useChat } from '@/stores/chat';
import { mensagemErro } from '@/lib/api';
import { rotulo } from '@/lib/format';
import { horaRelativa, resumoMensagem, primeiroNome } from '@/lib/chat/formato';
import type { Conversa } from '@/lib/chat/tipos';
import { AvatarUsuario, ROTULO_PRESENCA } from '@/components/chat/AvatarUsuario';
import { NovaSalaModal } from './NovaSalaModal';

type Aba = 'conversas' | 'pessoas' | 'todas';

function ItemConversa({ c, ativa, onClick, mostrarQuem }: { c: Conversa; ativa: boolean; onClick: () => void; mostrarQuem?: boolean }) {
  const m = c.ultimaMensagem;
  const outro = c.tipo === 'DIRETA' ? c.participantes.find((p) => p.id === c.outroUsuarioId) : null;
  const autor = m?.autor ? primeiroNome(m.autor.nome) : '';
  return (
    <button type="button" onClick={onClick} className={clsx('flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-slate-50', ativa && 'bg-brand-50/70 hover:bg-brand-50')}>
      <AvatarUsuario id={c.outroUsuarioId ?? c.id} nome={c.nome} sala={c.tipo === 'SALA'} presenca={outro ? (outro.online ? outro.estado : null) : null} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className={clsx('truncate text-sm', c.naoLidas ? 'font-semibold text-slate-900' : 'font-medium text-slate-800')}>{c.nome}</span>
          <span className={clsx('shrink-0 text-[11px] num', c.naoLidas ? 'font-semibold text-brand-600' : 'text-slate-400')}>{horaRelativa(c.ultimaMensagemEm)}</span>
        </span>
        <span className="flex items-center justify-between gap-2">
          <span className={clsx('truncate text-xs', c.naoLidas ? 'text-slate-700' : 'text-slate-500')}>
            {mostrarQuem && c.tipo === 'SALA' && (
              <span className="mr-1 text-slate-400">
                {c.participantes
                  .slice(0, 3)
                  .map((p) => primeiroNome(p.nome))
                  .join(', ')}
                {c.participantes.length > 3 ? '…' : ''} ·
              </span>
            )}
            {m ? (
              <>
                {(c.tipo === 'SALA' || mostrarQuem) && autor && m.tipo !== 'SISTEMA' ? `${autor}: ` : ''}
                {resumoMensagem(m)}
              </>
            ) : (
              <span className="italic text-slate-400">Sem mensagens ainda</span>
            )}
          </span>
          {c.naoLidas > 0 && <span className="min-w-[20px] shrink-0 rounded-full bg-brand-600 px-1.5 text-center text-[11px] font-bold leading-5 text-white">{c.naoLidas > 99 ? '99+' : c.naoLidas}</span>}
        </span>
      </span>
    </button>
  );
}

export function ListaConversas({ conversaAtiva }: { conversaAtiva: number | null }) {
  const nav = useNavigate();
  const admin = useAuth((s) => s.usuario?.perfil === 'ADMIN');
  const conversas = useChat((s) => s.conversas);
  const todas = useChat((s) => s.todas);
  const colegas = useChat((s) => s.colegas);
  const ligacao = useChat((s) => s.ligacao);
  const carregarTodas = useChat((s) => s.carregarTodas);
  const abrirDireta = useChat((s) => s.abrirDireta);
  const [aba, setAba] = useState<Aba>('conversas');
  const [busca, setBusca] = useState('');
  const [novaSala, setNovaSala] = useState(false);

  useEffect(() => {
    if (aba === 'todas') void carregarTodas().catch((e) => toast.error(mensagemErro(e)));
  }, [aba, carregarTodas]);

  const termo = busca.trim().toLowerCase();
  const lista = useMemo(() => {
    const base = aba === 'todas' ? todas : conversas;
    if (!termo) return base;
    return base.filter((c) => c.nome.toLowerCase().includes(termo) || c.participantes.some((p) => p.nome.toLowerCase().includes(termo)));
  }, [aba, conversas, todas, termo]);
  const pessoas = useMemo(() => {
    const outros = colegas.filter((c) => !c.eu && (!termo || c.nome.toLowerCase().includes(termo)));
    return [...outros].sort((a, b) => Number(b.online) - Number(a.online) || a.nome.localeCompare(b.nome));
  }, [colegas, termo]);

  const abrirPessoa = async (id: number) => {
    try {
      const c = await abrirDireta(id);
      setAba('conversas');
      setBusca('');
      nav(`/chat/${c.id}`);
    } catch (e) {
      toast.error(mensagemErro(e));
    }
  };

  const abas: { id: Aba; rotulo: string; qtd?: number }[] = [
    { id: 'conversas', rotulo: 'Conversas', qtd: conversas.reduce((t, c) => t + (c.naoLidas || 0), 0) || undefined },
    { id: 'pessoas', rotulo: 'Pessoas', qtd: colegas.filter((c) => !c.eu && c.online).length || undefined },
    ...(admin ? [{ id: 'todas' as Aba, rotulo: 'Todas' }] : []),
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-slate-100 px-3 pt-3">
        <div className="flex items-center gap-2">
          <h1 className="min-w-0 flex-1 truncate text-base font-semibold text-slate-900">Chat da equipe</h1>
          <span title={ligacao === 'websocket' ? 'Tempo real ligado' : ligacao === 'polling' ? 'Ligação de reserva (sem WebSocket)' : ligacao === 'ligando' ? 'Ligando…' : 'Desligado'} className={clsx('inline-flex items-center', ligacao === 'websocket' ? 'text-emerald-600' : ligacao === 'polling' ? 'text-amber-500' : 'text-slate-300')}>
            {ligacao === 'desligado' ? <WifiOff className="h-4 w-4" /> : <Wifi className="h-4 w-4" />}
          </span>
          <button type="button" onClick={() => setNovaSala(true)} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-brand-600 px-2.5 text-xs font-medium text-white hover:bg-brand-700" title="Criar sala de reunião privada">
            <Plus className="h-4 w-4" /> Nova sala
          </button>
        </div>
        <div className="relative mt-2">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar pessoa ou conversa" className="input-base h-9 pl-8 text-sm" aria-label="Buscar" />
        </div>
        <div className="-mb-px mt-2 flex gap-1">
          {abas.map((a) => (
            <button key={a.id} type="button" onClick={() => setAba(a.id)} className={clsx('relative inline-flex h-9 items-center gap-1.5 border-b-2 px-2.5 text-sm transition', aba === a.id ? 'border-brand-600 font-semibold text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-700')}>
              {a.rotulo}
              {a.qtd ? <span className={clsx('rounded-full px-1.5 text-[10px] font-bold leading-4', a.id === 'pessoas' ? 'bg-emerald-100 text-emerald-700' : 'bg-brand-600 text-white')}>{a.qtd}</span> : null}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {aba === 'pessoas' ? (
          pessoas.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-slate-500">{termo ? 'Ninguém com esse nome.' : 'Nenhum outro usuário ativo. Crie usuários em Configurações → Usuários.'}</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {pessoas.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => void abrirPessoa(p.id)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-slate-50">
                    <AvatarUsuario id={p.id} nome={p.nome} presenca={p.online ? p.estado : null} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-slate-800">{p.nome}</span>
                      <span className="block truncate text-xs text-slate-500">
                        {rotulo(p.perfil)} · {p.online ? ROTULO_PRESENCA[p.estado] : 'Offline'}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : lista.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <Users className="mx-auto h-6 w-6 text-slate-300" />
            <p className="mt-2 text-sm text-slate-500">{termo ? 'Nada encontrado.' : aba === 'todas' ? 'Ainda não há conversas no sistema.' : 'Nenhuma conversa ainda. Escolha alguém na aba Pessoas ou crie uma sala.'}</p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {lista.map((c) => (
              <li key={c.id}>
                <ItemConversa c={c} ativa={c.id === conversaAtiva} onClick={() => nav(`/chat/${c.id}`)} mostrarQuem={aba === 'todas'} />
              </li>
            ))}
          </ul>
        )}
      </div>

      <NovaSalaModal
        aberto={novaSala}
        onFechar={() => setNovaSala(false)}
        onCriada={(c) => {
          setNovaSala(false);
          setAba('conversas');
          nav(`/chat/${c.id}`);
        }}
      />
    </div>
  );
}
