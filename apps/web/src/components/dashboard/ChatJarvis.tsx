/**
 * Chat do JARVIS — a conversa com fio.
 * O gestor vai pedindo as coisas em sequência e o JARVIS lembra do que já foi dito,
 * com os números da loja na mão a cada resposta. Dá para ter várias conversas e retomar.
 */
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { Bot, Check, MessageSquarePlus, Mic, Phone, PhoneOff, Send, ShieldAlert, Trash2, User, Volume2, VolumeX, Wrench } from 'lucide-react';
import { api, mensagemErro } from '@/lib/api';
import { Button, EmptyState, Skeleton } from '@/components/ui';
import { CardV18 } from '@/components/dashboard/v18';
import { dataHora } from '@/lib/format';
import {
  escutar,
  falar,
  monitorarVoz,
  pararDeFalar,
  pareceEco,
  STT_DISPONIVEL,
  TTS_DISPONIVEL,
  type Escuta,
  type MonitorVoz,
} from '@/lib/voz';

interface Mensagem {
  id: number;
  papel: 'usuario' | 'jarvis' | string;
  texto: string;
  em: string;
}
interface ResumoConversa {
  id: number;
  titulo: string;
  atualizadaEm: string;
  mensagens: number;
}

const EXEMPLOS = [
  'O que faço com o dinheiro que entrou hoje?',
  'Vale a pena quitar os empréstimos agora?',
  'Onde estou perdendo margem?',
];

/** O que a página de fora pode mandar o chat fazer (os atalhos do JARVIS). */
export type ControleChat = { perguntar: (texto: string) => void; ligar: () => void };

export default function ChatJarvis({ controle }: { controle?: { current: ControleChat | null } } = {}) {
  const qc = useQueryClient();
  const [conversaId, setConversaId] = useState<number | null>(null);
  const [texto, setTexto] = useState('');
  const lista = useRef<HTMLDivElement>(null);

  // ---- voz
  const [falando, setFalando] = useState(false);
  const [emLigacao, setEmLigacao] = useState(false);
  const [ouvindo, setOuvindo] = useState('');
  const [falarSempre, setFalarSempre] = useState(() => localStorage.getItem('jarvis-falar') === '1');
  const escuta = useRef<Escuta | null>(null);
  const monitor = useRef<MonitorVoz | null>(null);
  const ultimaFalada = useRef<number | null>(null);
  /** o que o JARVIS acabou de falar — serve para descartar o próprio eco */
  const ecoRecente = useRef<string>('');
  /** enquanto ele fala, a transcrição fica desligada (senão ele responde a si mesmo) */
  const falandoAgora = useRef(false);
  const emLigacaoRef = useRef(false);

  // o que ele fez e o que está esperando a sua confirmação
  const [fez, setFez] = useState<string[]>([]);
  const [pendentes, setPendentes] = useState<{ nome: string; descricao: string; argumentos: Record<string, unknown> }[]>([]);

  const { data: conversas } = useQuery({
    queryKey: ['jarvis-conversas'],
    queryFn: () => api.get<{ data: ResumoConversa[] }>('/jarvis/conversas'),
    retry: 0,
  });

  const { data: conversa, isLoading } = useQuery({
    queryKey: ['jarvis-conversa', conversaId],
    queryFn: () => api.get<{ id: number; titulo: string; mensagens: Mensagem[] }>(`/jarvis/conversas/${conversaId}`),
    enabled: !!conversaId,
    retry: 0,
  });

  const mensagens = conversa?.mensagens ?? [];

  // rola só a lista de mensagens — scrollIntoView arrastaria a página inteira ao abrir o painel
  useEffect(() => {
    if (!mensagens.length) return;
    const el = lista.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [mensagens.length]);

  const enviar = useMutation({
    mutationFn: (pergunta: string) =>
      api.post<{
        conversaId: number;
        resposta: string;
        fez?: string[];
        pendentes?: { nome: string; descricao: string; argumentos: Record<string, unknown> }[];
      }>('/jarvis/perguntar', { pergunta, conversaId }),
    onSuccess: (r) => {
      setTexto('');
      setConversaId(r.conversaId);
      setFez(r.fez ?? []);
      setPendentes(r.pendentes ?? []);
      qc.invalidateQueries({ queryKey: ['jarvis-conversa', r.conversaId] });
      qc.invalidateQueries({ queryKey: ['jarvis-conversas'] });
      if (emLigacaoRef.current || falarSempre) void dizer(r.resposta);
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  // Falar e ouvir ao mesmo tempo dá eco: o microfone capta a voz dele e o reconhecedor
  // devolve como pergunta. Então enquanto ele fala a transcrição é DESLIGADA, e quem vigia
  // o microfone é um medidor de volume: se o chefe falar, a fala é cortada e a escuta volta.
  const dizer = async (texto: string) => {
    if (!TTS_DISPONIVEL) return;
    falandoAgora.current = true;
    ecoRecente.current = texto;
    escuta.current?.parar();
    escuta.current = null;
    setFalando(true);

    await falar(texto);

    falandoAgora.current = false;
    setFalando(false);
    // de volta à escuta, se a ligação continua
    if (emLigacaoRef.current) religar();
  };

  const calar = () => {
    pararDeFalar();
    falandoAgora.current = false;
    setFalando(false);
  };

  // ---------------------------------------------------------------- modo ligação

  const religar = () => {
    if (!emLigacaoRef.current || escuta.current) return;
    const e = escutar({
      onParcial: (t) => {
        if (falandoAgora.current) return; // não mostra o próprio eco
        setOuvindo(t);
      },
      onFrase: (t) => {
        setOuvindo('');
        if (falandoAgora.current) return;
        const frase = t.trim();
        if (frase.length < 3 || enviar.isPending) return;
        // segunda rede contra eco: se é quase o que ele acabou de dizer, ignora
        if (ecoRecente.current && pareceEco(ecoRecente.current, frase)) return;
        if (/^(desligar|tchau|pode parar|encerrar)\b/i.test(frase)) {
          desligar();
          return;
        }
        ecoRecente.current = '';
        enviar.mutate(frase);
      },
      onErro: (motivo) => {
        if (motivo === 'microfone-negado') {
          toast.error('Preciso da permissão do microfone para conversar por voz.');
          desligar();
        }
      },
    });
    escuta.current = e;
  };

  const desligar = () => {
    emLigacaoRef.current = false;
    escuta.current?.parar();
    escuta.current = null;
    monitor.current?.parar();
    monitor.current = null;
    calar();
    setEmLigacao(false);
    setOuvindo('');
  };

  const atender = async () => {
    if (!STT_DISPONIVEL) {
      toast.error('Para conversar por voz, use o Chrome ou o Edge — são os que ouvem o microfone.');
      return;
    }

    // o medidor de volume fica ligado a ligação inteira: é ele que permite interromper
    monitor.current = await monitorarVoz(() => {
      if (falandoAgora.current) calar(); // o chefe falou por cima: cala e escuta
    });
    if (!monitor.current) {
      toast.error('Preciso da permissão do microfone para conversar por voz.');
      return;
    }

    emLigacaoRef.current = true;
    setEmLigacao(true);
    await dizer('Pode falar, chefe. Estou ouvindo.');
  };

  // desliga o microfone e a fala ao sair da tela
  useEffect(() => {
    return () => {
      emLigacaoRef.current = false;
      escuta.current?.parar();
      monitor.current?.parar();
      pararDeFalar();
    };
  }, []);

  // fora da ligação, lê sozinho a resposta nova quando "falar sempre" está marcado
  useEffect(() => {
    if (!falarSempre || emLigacao || !mensagens.length) return;
    const ultima = mensagens[mensagens.length - 1];
    if (ultima.papel !== 'jarvis' || ultimaFalada.current === ultima.id) return;
    ultimaFalada.current = ultima.id;
    void dizer(ultima.texto);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mensagens.length, falarSempre, emLigacao]);

  const confirmar = useMutation({
    mutationFn: (p: { nome: string; argumentos: Record<string, unknown> }) =>
      api.post<{ texto: string }>('/jarvis/confirmar', { conversaId, nome: p.nome, argumentos: p.argumentos }),
    onSuccess: (r, v) => {
      toast.success(r.texto.slice(0, 160));
      setPendentes((ps) => ps.filter((x) => x.nome !== v.nome));
      qc.invalidateQueries({ queryKey: ['jarvis-conversa', conversaId] });
      qc.invalidateQueries({ queryKey: ['jarvis-painel'] });
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const apagar = useMutation({
    mutationFn: (id: number) => api.del(`/jarvis/conversas/${id}`),
    onSuccess: () => {
      setConversaId(null);
      qc.invalidateQueries({ queryKey: ['jarvis-conversas'] });
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const mandar = () => {
    const p = texto.trim();
    if (p.length < 3 || enviar.isPending) return;
    enviar.mutate(p);
  };

  // deixa os atalhos da página pedirem as coisas por aqui
  useEffect(() => {
    if (!controle) return;
    controle.current = {
      perguntar: (t: string) => {
        if (enviar.isPending) {
          toast.info('Espera ele terminar de responder.');
          return;
        }
        enviar.mutate(t);
      },
      ligar: () => atender(),
    };
    return () => {
      controle.current = null;
    };
  });

  return (
    <CardV18
      titulo="Conversar com o JARVIS"
      descricao="Ele responde com os números da loja e lembra do que já foi dito"
      icone={<Bot className="h-4 w-4" />}
      tom="azul"
      acoes={
        <div className="flex flex-wrap items-center gap-2">
          {TTS_DISPONIVEL && (
            <Button
              variante={falarSempre ? 'primario' : 'secundario'}
              tamanho="sm"
              icone={falarSempre ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
              onClick={() => {
                const novo = !falarSempre;
                setFalarSempre(novo);
                localStorage.setItem('jarvis-falar', novo ? '1' : '0');
                if (!novo) calar();
              }}
            >
              {falarSempre ? 'Falando' : 'Mudo'}
            </Button>
          )}
          {STT_DISPONIVEL &&
            (emLigacao ? (
              <Button variante="perigo" tamanho="sm" icone={<PhoneOff className="h-4 w-4" />} onClick={desligar}>
                Desligar
              </Button>
            ) : (
              <Button variante="sucesso" tamanho="sm" icone={<Phone className="h-4 w-4" />} onClick={atender}>
                Conversar
              </Button>
            ))}
          {(conversas?.data?.length ?? 0) > 0 && (
            <select
              className="h-8 max-w-[14rem] rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-700"
              value={conversaId ?? ''}
              onChange={(e) => setConversaId(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">Conversa nova</option>
              {conversas!.data.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.titulo}
                </option>
              ))}
            </select>
          )}
          {conversaId && (
            <>
              <Button variante="secundario" tamanho="sm" icone={<MessageSquarePlus className="h-4 w-4" />} onClick={() => setConversaId(null)}>
                Nova
              </Button>
              <Button
                variante="secundario"
                tamanho="sm"
                icone={<Trash2 className="h-4 w-4" />}
                carregando={apagar.isPending}
                onClick={() => apagar.mutate(conversaId)}
              >
                Apagar
              </Button>
            </>
          )}
        </div>
      }
    >
      {emLigacao && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-emerald-200">
          <Mic className="h-4 w-4 animate-pulse" />
          <span className="font-medium">{falando ? 'JARVIS falando — pode interromper' : 'Na linha, pode falar'}</span>
          {ouvindo && <span className="min-w-0 flex-1 truncate text-emerald-700">“{ouvindo}”</span>}
          <span className="text-xs text-emerald-600">diga “desligar” para encerrar</span>
        </div>
      )}

      <div ref={lista} className="flex max-h-[26rem] min-h-[12rem] flex-col gap-3 overflow-y-auto pr-1">
        {isLoading && conversaId ? (
          <>
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </>
        ) : mensagens.length === 0 ? (
          <EmptyState
            compacto
            titulo="Pergunte o que quiser sobre a loja"
            descricao="Ele enxerga caixa, contas, estoque, consignados e empréstimos — e responde com os números."
          />
        ) : (
          mensagens.map((m) => (
            <Balao key={m.id} m={m} aoFalar={m.papel === 'jarvis' ? () => (falando ? calar() : void dizer(m.texto)) : undefined} falando={falando} />
          ))
        )}
        {enviar.isPending && (
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <Bot className="h-4 w-4 animate-pulse" /> JARVIS está pensando…
          </div>
        )}
      </div>

      {mensagens.length === 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {EXEMPLOS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => enviar.mutate(e)}
              className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-600 transition hover:bg-slate-50"
            >
              {e}
            </button>
          ))}
        </div>
      )}

      {fez.length > 0 && (
        <div className="mt-3 rounded-xl bg-sky-50 px-3 py-2 text-sm text-sky-900 ring-1 ring-sky-200">
          <p className="mb-1 flex items-center gap-1.5 font-medium">
            <Wrench className="h-4 w-4" /> O que ele fez no sistema
          </p>
          <ul className="space-y-0.5 text-sky-800">
            {fez.map((f, i) => (
              <li key={i} className="break-words">· {f}</li>
            ))}
          </ul>
        </div>
      )}

      {pendentes.length > 0 && (
        <div className="mt-3 space-y-2 rounded-xl bg-amber-50 px-3 py-2 ring-1 ring-amber-200">
          <p className="flex items-center gap-1.5 text-sm font-medium text-amber-900">
            <ShieldAlert className="h-4 w-4" /> Precisa da sua confirmação
          </p>
          {pendentes.map((p2, i) => (
            <div key={i} className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0 flex-1 break-words text-sm text-amber-800">{p2.descricao}</span>
              <Button
                variante="primario"
                tamanho="sm"
                icone={<Check className="h-4 w-4" />}
                carregando={confirmar.isPending}
                onClick={() => confirmar.mutate({ nome: p2.nome, argumentos: p2.argumentos })}
              >
                Pode fazer
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 flex items-end gap-2">
        <textarea
          className="min-h-[2.5rem] max-h-32 min-w-0 flex-1 resize-y rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-800 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
          rows={1}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              mandar();
            }
          }}
          placeholder="Pergunte alguma coisa… (Enter manda, Shift+Enter pula linha)"
        />
        {STT_DISPONIVEL && !emLigacao && (
          <Button variante="secundario" icone={<Mic className="h-4 w-4" />} onClick={atender} title="Conversar por voz">
            Voz
          </Button>
        )}
        <Button
          variante="primario"
          icone={<Send className="h-4 w-4" />}
          carregando={enviar.isPending}
          disabled={texto.trim().length < 3}
          onClick={mandar}
        >
          Mandar
        </Button>
      </div>
    </CardV18>
  );
}

function Balao({ m, aoFalar, falando }: { m: Mensagem; aoFalar?: () => void; falando?: boolean }) {
  const meu = m.papel === 'usuario';
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex gap-2 ${meu ? 'flex-row-reverse' : ''}`}
    >
      <div
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
          meu ? 'bg-slate-200 text-slate-600' : 'bg-brand-100 text-brand-700'
        }`}
      >
        {meu ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>
      <div className={`min-w-0 max-w-[85%] ${meu ? 'text-right' : ''}`}>
        <div
          className={`inline-block whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-left text-sm ${
            meu ? 'bg-brand-600 text-white' : 'bg-slate-50 text-slate-700 ring-1 ring-slate-200'
          }`}
        >
          {m.texto}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-400">
          <span>{dataHora(m.em)}</span>
          {aoFalar && TTS_DISPONIVEL && (
            <button type="button" onClick={aoFalar} className="inline-flex items-center gap-1 text-slate-400 transition hover:text-brand-600">
              {falando ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
              {falando ? 'parar' : 'ouvir'}
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}
