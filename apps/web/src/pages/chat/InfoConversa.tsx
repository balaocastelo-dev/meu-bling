/**
 * Painel de informações da conversa: participantes (com presença), incluir pessoas, tirar/sair da sala,
 * renomear, silenciar avisos e ativar o aviso no celular (Web Push).
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, BellOff, LogOut, Pencil, Smartphone, UserMinus, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { api, mensagemErro } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { useChat } from '@/stores/chat';
import { Button, Drawer, Input } from '@/components/ui';
import { rotulo } from '@/lib/format';
import type { Conversa } from '@/lib/chat/tipos';
import { ativarPush, desativarPush, ehIosNoNavegador, estadoPush, type EstadoPush } from '@/lib/chat/pwa';
import { AvatarUsuario, ROTULO_PRESENCA } from '@/components/chat/AvatarUsuario';
import { EscolherPessoas } from './NovaSalaModal';

/** Botão "Avisar no celular": inscreve este navegador/celular para receber mensagens e chamadas com o sistema fechado. */
export function AvisoCelular() {
  const config = useChat((s) => s.config);
  const [estado, setEstado] = useState<EstadoPush>('indisponivel');
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => {
    void estadoPush().then(setEstado);
  }, []);
  const ios = ehIosNoNavegador();
  const alternar = async () => {
    setOcupado(true);
    try {
      if (estado === 'ativo') {
        await desativarPush();
        setEstado('inativo');
        toast.success('Avisos neste aparelho desligados.');
      } else {
        if (!config?.pushPublicKey) throw new Error('O servidor ainda não está pronto para avisos. Tente de novo em instantes.');
        const r = await ativarPush(config.pushPublicKey);
        setEstado(r);
        if (r === 'ativo') toast.success('Pronto: você recebe aviso de mensagem e chamada neste aparelho mesmo com o sistema fechado.');
        else if (r === 'negado') toast.error('O navegador está bloqueando notificações. Libere no cadeado da barra de endereço.');
      }
    } catch (e) {
      toast.error(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  };
  if (estado === 'indisponivel' && !ios) return null;
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <p className="flex items-center gap-2 text-sm font-medium text-slate-800">
        <Smartphone className="h-4 w-4 text-slate-500" /> Aviso no celular com o sistema fechado
      </p>
      {ios ? (
        <p className="mt-1 text-xs text-slate-500">No iPhone, primeiro adicione o MEU BLING à tela de início: toque em Compartilhar e depois em "Adicionar à Tela de Início". Abra por lá e volte aqui para ligar os avisos.</p>
      ) : (
        <>
          <p className="mt-1 text-xs text-slate-500">{estado === 'ativo' ? 'Ligado neste aparelho: mensagens e chamadas avisam mesmo com o navegador fechado.' : estado === 'negado' ? 'Bloqueado pelo navegador — libere as notificações no cadeado da barra de endereço.' : 'Receba mensagens e chamadas neste aparelho mesmo com o sistema fechado.'}</p>
          {estado !== 'negado' && (
            <Button className="mt-2" tamanho="sm" variante={estado === 'ativo' ? 'secundario' : 'primario'} carregando={ocupado} onClick={() => void alternar()} icone={estado === 'ativo' ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}>
              {estado === 'ativo' ? 'Desligar neste aparelho' : 'Ligar neste aparelho'}
            </Button>
          )}
        </>
      )}
    </div>
  );
}

export function InfoConversa({ aberto, onFechar, conversa }: { aberto: boolean; onFechar: () => void; conversa: Conversa }) {
  const nav = useNavigate();
  const eu = useAuth((s) => s.usuario);
  const carregarConversa = useChat((s) => s.carregarConversa);
  const carregarConversas = useChat((s) => s.carregarConversas);
  const [incluindo, setIncluindo] = useState(false);
  const [novos, setNovos] = useState<number[]>([]);
  const [renomeando, setRenomeando] = useState(false);
  const [nome, setNome] = useState(conversa.nome);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => setNome(conversa.nome), [conversa.nome]);

  const gestor = eu?.perfil === 'ADMIN' || eu?.perfil === 'GERENTE';
  const criador = conversa.criadoPorId === eu?.id;
  const sala = conversa.tipo === 'SALA';
  const silenciada = !!conversa.silenciadaAte && new Date(conversa.silenciadaAte) > new Date();

  const executar = async (fn: () => Promise<unknown>, ok?: string) => {
    setOcupado(true);
    try {
      await fn();
      await carregarConversa(conversa.id);
      if (ok) toast.success(ok);
    } catch (e) {
      toast.error(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  };

  return (
    <Drawer aberto={aberto} onFechar={onFechar} titulo={sala ? 'Sala de reunião' : 'Conversa'} largura="max-w-md">
      <div className="space-y-5">
        <div className="flex flex-col items-center text-center">
          <AvatarUsuario id={conversa.outroUsuarioId ?? conversa.id} nome={conversa.nome} sala={sala} tamanho="xl" />
          {renomeando ? (
            <div className="mt-3 flex w-full gap-2">
              <Input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={80} className="flex-1" />
              <Button variante="primario" carregando={ocupado} onClick={() => void executar(() => api.put(`/chat/conversas/${conversa.id}`, { nome }), 'Nome alterado.').then(() => setRenomeando(false))}>
                Salvar
              </Button>
            </div>
          ) : (
            <p className="mt-3 flex items-center gap-2 text-base font-semibold text-slate-900">
              {conversa.nome}
              {sala && (gestor || criador) && (
                <button type="button" onClick={() => setRenomeando(true)} className="rounded p-1 text-slate-400 hover:bg-slate-100" aria-label="Renomear sala">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              )}
            </p>
          )}
          <p className="text-xs text-slate-500">
            {sala ? `${conversa.participantes.length} pessoas${conversa.criadoPor ? ` · criada por ${conversa.criadoPor.nome.split(' ')[0]}` : ''}` : 'Conversa direta'}
          </p>
        </div>

        <div className="flex flex-wrap justify-center gap-2">
          <Button tamanho="sm" variante="secundario" icone={silenciada ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />} carregando={ocupado} onClick={() => void executar(() => api.post(`/chat/conversas/${conversa.id}/silenciar`, { ate: silenciada ? null : new Date(Date.now() + 8 * 3600 * 1000).toISOString() }), silenciada ? 'Avisos ligados.' : 'Avisos desta conversa silenciados por 8 horas.')}>
            {silenciada ? 'Reativar avisos' : 'Silenciar 8 h'}
          </Button>
          {sala && conversa.souParticipante && (
            <Button tamanho="sm" variante="secundario" icone={<UserPlus className="h-4 w-4" />} onClick={() => setIncluindo((v) => !v)}>
              Incluir pessoas
            </Button>
          )}
          {sala && conversa.souParticipante && (
            <Button
              tamanho="sm"
              variante="perigo"
              icone={<LogOut className="h-4 w-4" />}
              carregando={ocupado}
              onClick={() => {
                if (!confirm('Sair desta sala? Você deixa de receber as mensagens dela.')) return;
                void executar(() => api.del(`/chat/conversas/${conversa.id}/participantes/${eu?.id}`)).then(async () => {
                  await carregarConversas();
                  onFechar();
                  nav('/chat');
                });
              }}
            >
              Sair da sala
            </Button>
          )}
        </div>

        {incluindo && sala && (
          <div className="rounded-xl border border-slate-200 p-3">
            <p className="mb-2 text-xs font-medium text-slate-600">Quem mais entra na sala</p>
            <EscolherPessoas selecionados={novos} onMudar={setNovos} excluir={conversa.participantes.map((p) => p.id)} />
            <div className="mt-2 flex justify-end gap-2">
              <Button tamanho="sm" variante="fantasma" onClick={() => setIncluindo(false)}>Cancelar</Button>
              <Button tamanho="sm" variante="primario" disabled={!novos.length} carregando={ocupado} onClick={() => void executar(() => api.post(`/chat/conversas/${conversa.id}/participantes`, { usuarioIds: novos }), 'Pessoas incluídas.').then(() => { setNovos([]); setIncluindo(false); })}>
                Incluir
              </Button>
            </div>
          </div>
        )}

        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Participantes</p>
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {conversa.participantes.map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-3 py-2">
                <AvatarUsuario id={p.id} nome={p.nome} tamanho="sm" presenca={p.online ? p.estado : null} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-slate-800">
                    {p.nome}
                    {p.id === eu?.id && <span className="text-slate-400"> (você)</span>}
                  </span>
                  <span className="block text-[11px] text-slate-500">
                    {rotulo(p.perfil)} · {p.online ? ROTULO_PRESENCA[p.estado] : 'Offline'}
                  </span>
                </span>
                {sala && p.id !== eu?.id && (gestor || criador) && (
                  <button type="button" disabled={ocupado} onClick={() => confirm(`Tirar ${p.nome.split(' ')[0]} da sala?`) && void executar(() => api.del(`/chat/conversas/${conversa.id}/participantes/${p.id}`))} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label={`Tirar ${p.nome} da sala`} title="Tirar da sala">
                    <UserMinus className="h-4 w-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>

        <AvisoCelular />
      </div>
    </Drawer>
  );
}
