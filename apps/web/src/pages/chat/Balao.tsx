/** Balão de mensagem: texto (com links), áudio, imagem, arquivo, registro de chamada e mensagem do sistema. */
import { useState } from 'react';
import clsx from 'clsx';
import { Check, CheckCheck, Clock, CornerUpLeft, MoreHorizontal, Phone, Trash2, AlertCircle, Zap } from 'lucide-react';
import type { Mensagem } from '@/lib/chat/tipos';
import { horaMensagem, primeiroNome, resumoMensagem } from '@/lib/chat/formato';
import { ArquivoChat, ImagemChat, PlayerAudio } from '@/components/chat/ArquivoProtegido';
import { corDoUsuario } from '@/components/chat/AvatarUsuario';

const URL_RE = /((?:https?:\/\/|www\.)[^\s<]+)/gi;

/** Texto com quebras de linha e links clicáveis. */
export function TextoMensagem({ texto, escuro }: { texto: string; escuro?: boolean }) {
  const partes = texto.split(URL_RE);
  return (
    <span className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
      {partes.map((p, i) =>
        // o split com grupo de captura põe os links nas posições ímpares
        i % 2 === 1 ? (
          <a key={i} href={p.startsWith('http') ? p : `https://${p}`} target="_blank" rel="noreferrer" className={clsx('underline', escuro ? 'text-white' : 'text-brand-700')}>
            {p}
          </a>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </span>
  );
}

export function Balao({
  m,
  minha,
  mostrarAutor,
  lidaPorTodos,
  respondida,
  onResponder,
  onApagar,
  podeApagar,
}: {
  m: Mensagem;
  minha: boolean;
  mostrarAutor: boolean;
  /** só para as minhas: todos os outros já leram até aqui */
  lidaPorTodos: boolean;
  respondida?: Mensagem | null;
  onResponder: () => void;
  onApagar: () => void;
  podeApagar: boolean;
}) {
  const [menu, setMenu] = useState(false);

  if (m.tipo === 'SISTEMA') {
    const atencao = /chamou sua atenção/.test(m.texto || '');
    return (
      <div className="my-1 flex justify-center px-2">
        <span className={clsx('inline-flex max-w-[90%] items-center gap-1.5 rounded-full px-3 py-1 text-center text-[11px]', atencao ? 'bg-amber-50 font-medium text-amber-800 ring-1 ring-amber-200' : 'bg-slate-100 text-slate-500')}>
          {atencao && <Zap className="h-3 w-3 shrink-0" />}
          {m.texto}
        </span>
      </div>
    );
  }
  if (m.tipo === 'CHAMADA') {
    return (
      <div className="my-1 flex justify-center px-2">
        <span className="inline-flex max-w-[90%] items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] text-slate-600">
          <Phone className="h-3 w-3" /> {m.texto?.replace(/^📞\s*/, '')} · {horaMensagem(m.criadoEm)}
        </span>
      </div>
    );
  }

  const escuro = minha;
  const apagada = !!m.apagadaEm;
  const ehImagem = m.tipo === 'ARQUIVO' && (m.arquivoMime || '').startsWith('image/');

  return (
    <div className={clsx('group relative flex w-full items-end gap-1.5 px-2', minha ? 'justify-end' : 'justify-start')}>
      <div className={clsx('relative max-w-[85%] sm:max-w-[70%]', minha && 'order-2')}>
        {mostrarAutor && !minha && m.autor && <p className={clsx('mb-0.5 ml-1 text-[11px] font-semibold', corDoUsuario(m.autorId).replace('bg-', 'text-'))}>{primeiroNome(m.autor.nome)}</p>}
        <div className={clsx('rounded-2xl px-3 py-2 text-sm shadow-xs', minha ? 'rounded-br-md bg-brand-600 text-white' : 'rounded-bl-md border border-slate-200 bg-white text-slate-800', m.erro && 'ring-2 ring-red-400')}>
          {respondida && (
            <div className={clsx('mb-1.5 rounded-lg border-l-2 px-2 py-1 text-xs', minha ? 'border-white/70 bg-white/15 text-white/90' : 'border-brand-500 bg-slate-50 text-slate-600')}>
              <span className="block font-semibold">{respondida.autor ? primeiroNome(respondida.autor.nome) : 'Mensagem'}</span>
              <span className="line-clamp-2">{resumoMensagem(respondida)}</span>
            </div>
          )}
          {apagada ? (
            <span className={clsx('italic', minha ? 'text-white/70' : 'text-slate-400')}>Mensagem apagada</span>
          ) : m.tipo === 'AUDIO' && m.arquivo ? (
            <PlayerAudio caminho={m.arquivo} duracaoSeg={m.duracaoSeg} escuro={escuro} />
          ) : m.tipo === 'ARQUIVO' && m.arquivo ? (
            ehImagem ? <ImagemChat caminho={m.arquivo} nome={m.arquivoNome} /> : <ArquivoChat caminho={m.arquivo} nome={m.arquivoNome} tamanho={m.arquivoTamanho} escuro={escuro} />
          ) : (
            <TextoMensagem texto={m.texto || ''} escuro={escuro} />
          )}
          <span className={clsx('mt-0.5 flex items-center justify-end gap-1 text-[10px] num', minha ? 'text-white/75' : 'text-slate-400')}>
            {m.erro && (
              <span className="mr-1 inline-flex items-center gap-0.5 text-red-200">
                <AlertCircle className="h-3 w-3" /> não enviada
              </span>
            )}
            {horaMensagem(m.criadoEm)}
            {minha && !apagada && (m.enviando ? <Clock className="h-3 w-3" /> : lidaPorTodos ? <CheckCheck className="h-3.5 w-3.5 text-sky-200" /> : <Check className="h-3.5 w-3.5" />)}
          </span>
        </div>
      </div>
      {!apagada && !m.enviando && (
        <div className={clsx('relative mb-1 shrink-0 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100', minha ? 'order-1' : 'order-3')}>
          <button type="button" onClick={() => setMenu((v) => !v)} className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Opções da mensagem">
            <MoreHorizontal className="h-4 w-4" />
          </button>
          {menu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
              <div className={clsx('absolute bottom-full z-20 mb-1 w-36 rounded-md border border-slate-200 bg-white py-1 text-sm shadow-pop', minha ? 'right-0' : 'left-0')}>
                <button type="button" onClick={() => { setMenu(false); onResponder(); }} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-slate-700 hover:bg-slate-50">
                  <CornerUpLeft className="h-3.5 w-3.5" /> Responder
                </button>
                {podeApagar && (
                  <button type="button" onClick={() => { setMenu(false); onApagar(); }} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-red-600 hover:bg-red-50">
                    <Trash2 className="h-3.5 w-3.5" /> Apagar
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
