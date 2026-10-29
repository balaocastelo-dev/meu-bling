/** Criar sala de reunião privada: nome + as pessoas da equipe (qualquer um pode criar). */
import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { Check, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Button, Input, Modal } from '@/components/ui';
import { useChat } from '@/stores/chat';
import { mensagemErro } from '@/lib/api';
import { rotulo } from '@/lib/format';
import type { Conversa } from '@/lib/chat/tipos';
import { AvatarUsuario } from '@/components/chat/AvatarUsuario';

/** Lista de pessoas com marcação (usada na criação da sala e para incluir gente numa sala existente). */
export function EscolherPessoas({ selecionados, onMudar, excluir = [] }: { selecionados: number[]; onMudar: (ids: number[]) => void; excluir?: number[] }) {
  const colegas = useChat((s) => s.colegas);
  const [busca, setBusca] = useState('');
  const termo = busca.trim().toLowerCase();
  const lista = useMemo(() => colegas.filter((c) => !c.eu && !excluir.includes(c.id) && (!termo || c.nome.toLowerCase().includes(termo))).sort((a, b) => a.nome.localeCompare(b.nome)), [colegas, excluir, termo]);
  const alternar = (id: number) => onMudar(selecionados.includes(id) ? selecionados.filter((x) => x !== id) : [...selecionados, id]);
  return (
    <div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar pessoa" className="input-base h-9 pl-8 text-sm" aria-label="Buscar pessoa" />
      </div>
      <ul className="mt-2 max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
        {lista.length === 0 && <li className="px-3 py-4 text-center text-sm text-slate-500">Ninguém para escolher.</li>}
        {lista.map((p) => {
          const marcado = selecionados.includes(p.id);
          return (
            <li key={p.id}>
              <button type="button" onClick={() => alternar(p.id)} className={clsx('flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-slate-50', marcado && 'bg-brand-50/60')}>
                <AvatarUsuario id={p.id} nome={p.nome} tamanho="sm" presenca={p.online ? p.estado : null} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-slate-800">{p.nome}</span>
                  <span className="block text-[11px] text-slate-500">{rotulo(p.perfil)}</span>
                </span>
                <span className={clsx('flex h-5 w-5 items-center justify-center rounded border', marcado ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 bg-white')}>{marcado && <Check className="h-3.5 w-3.5" />}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function NovaSalaModal({ aberto, onFechar, onCriada }: { aberto: boolean; onFechar: () => void; onCriada: (c: Conversa) => void }) {
  const criarSala = useChat((s) => s.criarSala);
  const [nome, setNome] = useState('');
  const [ids, setIds] = useState<number[]>([]);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (aberto) {
      setNome('');
      setIds([]);
    }
  }, [aberto]);

  const criar = async () => {
    if (nome.trim().length < 2) return toast.error('Dê um nome à sala.');
    if (!ids.length) return toast.error('Escolha pelo menos uma pessoa.');
    setSalvando(true);
    try {
      const c = await criarSala(nome.trim(), ids);
      toast.success('Sala criada.');
      onCriada(c);
    } catch (e) {
      toast.error(mensagemErro(e));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Modal
      aberto={aberto}
      onFechar={onFechar}
      titulo="Nova sala de reunião"
      descricao="Só quem você escolher participa. Dá para conversar por texto, áudio, voz e vídeo."
      rodape={
        <>
          <Button variante="fantasma" onClick={onFechar}>Cancelar</Button>
          <Button variante="primario" onClick={() => void criar()} carregando={salvando}>Criar sala</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input label="Nome da sala" obrigatorio value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Reunião de sexta, Assistência, Vendas" maxLength={80} autoFocus />
        <div>
          <p className="mb-1 text-xs font-medium text-slate-600">
            Pessoas <span className="text-brand-600">*</span> {ids.length > 0 && <span className="text-slate-400">· {ids.length} escolhida{ids.length > 1 ? 's' : ''}</span>}
          </p>
          <EscolherPessoas selecionados={ids} onMudar={setIds} />
        </div>
      </div>
    </Modal>
  );
}
