/** Aba "Webhooks": endereços de outros sistemas que recebem os acontecimentos do MEU BLING. */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Eye, History, Pencil, Plus, Power, RefreshCw, Send, Trash2, Webhook as IconeWebhook } from 'lucide-react';
import { api, mensagemErro } from '@/lib/api';
import { dataHora } from '@/lib/format';
import { Badge, Button, Checkbox, ConfirmDialog, Drawer, EmptyState, Input, MenuAcoes, Modal, Table } from '@/components/ui';
import { BotaoCopiar, Codigo, useCatalogo, type Webhook } from './comum';

interface Form {
  id?: number;
  nome: string;
  url: string;
  eventos: string[];
  ativo: boolean;
}
interface Entrega {
  id: number;
  evento: string;
  status: 'PENDENTE' | 'ENTREGUE' | 'FALHOU';
  tentativas: number;
  respostaStatus: number | null;
  resposta: string | null;
  payload: string;
  proximaTentativa: string;
  criadoEm: string;
}

const VAZIO: Form = { nome: '', url: '', eventos: ['*'], ativo: true };

export function AbaWebhooks() {
  const qc = useQueryClient();
  const { data: catalogo } = useCatalogo();
  const { data: lista, isLoading } = useQuery({ queryKey: ['api-externa', 'webhooks'], queryFn: () => api.get<Webhook[]>('/api-externa/webhooks') });
  const [form, setForm] = useState<Form | null>(null);
  const [segredo, setSegredo] = useState<{ nome: string; segredo: string } | null>(null);
  const [excluir, setExcluir] = useState<Webhook | null>(null);
  const [entregasDe, setEntregasDe] = useState<Webhook | null>(null);
  const nomeEvento = (c: string) => (c === '*' ? 'Todos os eventos' : catalogo?.eventos.find((e) => e.chave === c)?.nome ?? c);

  const atualizar = () => {
    qc.invalidateQueries({ queryKey: ['api-externa', 'webhooks'] });
    qc.invalidateQueries({ queryKey: ['api-externa', 'resumo'] });
  };
  const salvar = useMutation({
    mutationFn: (f: Form) => (f.id ? api.put<Webhook>(`/api-externa/webhooks/${f.id}`, f) : api.post<Webhook>('/api-externa/webhooks', f)),
    onSuccess: (w) => {
      setForm(null);
      atualizar();
      if (w.segredo) setSegredo({ nome: w.nome, segredo: w.segredo });
      else toast.success('Webhook salvo.');
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });
  const testar = useMutation({
    mutationFn: (w: Webhook) => api.post<{ ok: boolean; status: number; resposta: string; ms: number }>(`/api-externa/webhooks/${w.id}/testar`),
    onSuccess: (r) => {
      atualizar();
      if (r.ok) toast.success(`Entregue (HTTP ${r.status}, ${r.ms} ms).`);
      else toast.error(`Não entregou: ${r.status ? `HTTP ${r.status}` : ''} ${r.resposta}`.trim());
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });
  const ativar = useMutation({
    mutationFn: (w: Webhook) => api.put(`/api-externa/webhooks/${w.id}`, { ativo: !w.ativo }),
    onSuccess: atualizar,
    onError: (e) => toast.error(mensagemErro(e)),
  });
  const verSegredo = async (w: Webhook, novo = false) => {
    try {
      const r = novo ? await api.post<{ segredo: string }>(`/api-externa/webhooks/${w.id}/segredo`) : await api.get<{ segredo: string }>(`/api-externa/webhooks/${w.id}/segredo`);
      setSegredo({ nome: w.nome, segredo: r.segredo });
    } catch (e) {
      toast.error(mensagemErro(e));
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 flex-1 text-sm text-slate-500">O MEU BLING avisa outros sistemas na hora em que algo acontece (venda, OS, nota, pagamento…), com um POST assinado. Se o outro lado estiver fora do ar, tenta de novo até 5 vezes.</p>
        <Button variante="primario" icone={<Plus className="h-4 w-4" />} onClick={() => setForm({ ...VAZIO })}>Novo webhook</Button>
      </div>
      <Table<Webhook>
        carregando={isLoading}
        dados={lista}
        chave={(w) => w.id}
        onClickLinha={(w) => setForm({ id: w.id, nome: w.nome, url: w.url, eventos: w.eventos, ativo: w.ativo })}
        vazio={<EmptyState icone={<IconeWebhook className="h-6 w-6" />} titulo="Nenhum webhook" descricao="Cadastre o endereço de um sistema (n8n, CRM, agente) para ele receber os acontecimentos." />}
        colunas={[
          {
            chave: 'nome',
            titulo: 'Destino',
            render: (w) => (
              <div className="min-w-0">
                <p className="truncate font-medium text-slate-800">{w.nome}</p>
                <p className="break-all text-xs text-slate-400">{w.url}</p>
              </div>
            ),
          },
          { chave: 'eventos', titulo: 'Eventos', render: (w) => <span className="text-xs text-slate-600">{w.eventos.includes('*') ? 'Todos' : w.eventos.map(nomeEvento).join(' · ')}</span> },
          {
            chave: 'ultimo',
            titulo: 'Último envio',
            ocultarMobile: true,
            render: (w) =>
              w.ultimoEnvioEm ? (
                <div className="text-xs">
                  <Badge tom={w.ultimoStatus && w.ultimoStatus < 300 ? 'verde' : 'vermelho'}>{w.ultimoStatus ? `HTTP ${w.ultimoStatus}` : 'falhou'}</Badge>
                  <p className="mt-0.5 text-slate-400">{dataHora(w.ultimoEnvioEm)}{w.falhasSeguidas ? ` · ${w.falhasSeguidas} falha(s) seguida(s)` : ''}</p>
                </div>
              ) : (
                <span className="text-xs text-slate-400">nunca</span>
              ),
          },
          { chave: 'sit', titulo: 'Situação', render: (w) => <Badge tom={w.ativo ? 'verde' : 'cinza'}>{w.ativo ? 'Ativo' : 'Desligado'}</Badge> },
          {
            chave: 'acoes',
            titulo: '',
            render: (w) => (
              <MenuAcoes
                itens={[
                  { rotulo: 'Enviar teste agora', icone: <Send className="h-4 w-4" />, onClick: () => testar.mutate(w) },
                  { rotulo: 'Últimas entregas', icone: <History className="h-4 w-4" />, onClick: () => setEntregasDe(w) },
                  { rotulo: 'Editar', icone: <Pencil className="h-4 w-4" />, onClick: () => setForm({ id: w.id, nome: w.nome, url: w.url, eventos: w.eventos, ativo: w.ativo }) },
                  { rotulo: 'Ver segredo da assinatura', icone: <Eye className="h-4 w-4" />, onClick: () => verSegredo(w), separar: true },
                  { rotulo: 'Gerar novo segredo', icone: <RefreshCw className="h-4 w-4" />, onClick: () => verSegredo(w, true) },
                  { rotulo: w.ativo ? 'Desligar' : 'Religar', icone: <Power className="h-4 w-4" />, onClick: () => ativar.mutate(w) },
                  { rotulo: 'Excluir', icone: <Trash2 className="h-4 w-4" />, onClick: () => setExcluir(w), perigo: true },
                ]}
              />
            ),
          },
        ]}
      />

      <Codigo titulo="Como o outro sistema confere a assinatura (Node.js)">{`// cabeçalhos: X-MeuBling-Evento, X-MeuBling-Entrega, X-MeuBling-Assinatura
const crypto = require('crypto');
const esperado = 'sha256=' + crypto.createHmac('sha256', SEGREDO).update(corpoBruto).digest('hex');
if (esperado !== req.headers['x-meubling-assinatura']) return res.status(401).end();
const { evento, dados } = JSON.parse(corpoBruto); // ex.: "venda.criada", { vendaId, venda: {...}, recurso: "/vendas/123" }
res.status(200).end(); // responda 2xx rápido; senão tentamos de novo em 1, 5, 30 min e 2 h`}</Codigo>

      {form && (
        <Modal
          aberto
          tamanho="lg"
          onFechar={() => setForm(null)}
          titulo={form.id ? 'Editar webhook' : 'Novo webhook'}
          rodape={
            <>
              <Button variante="secundario" onClick={() => setForm(null)}>Cancelar</Button>
              <Button variante="primario" carregando={salvar.isPending} disabled={!form.nome.trim() || !form.url.trim()} onClick={() => salvar.mutate(form)}>Salvar</Button>
            </>
          }
        >
          <div className="space-y-3">
            <Input label="Nome" obrigatorio autoFocus value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Ex.: n8n, CRM WhatsApp, agente de cobrança" />
            <Input label="Endereço (URL)" obrigatorio value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://seu-sistema.com/webhooks/meu-bling" />
            <div>
              <p className="mb-1.5 text-sm font-medium text-slate-700">Avisar quando</p>
              <Checkbox label="Todos os eventos" checked={form.eventos.includes('*')} onChange={(e) => setForm({ ...form, eventos: e.target.checked ? ['*'] : [] })} />
              {!form.eventos.includes('*') && (
                <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                  {catalogo?.eventos.map((ev) => (
                    <Checkbox
                      key={ev.chave}
                      label={ev.nome}
                      descricao={ev.chave}
                      checked={form.eventos.includes(ev.chave)}
                      onChange={(e) => setForm({ ...form, eventos: e.target.checked ? [...form.eventos, ev.chave] : form.eventos.filter((x) => x !== ev.chave) })}
                    />
                  ))}
                </div>
              )}
            </div>
            {form.id && <Checkbox label="Ativo" checked={form.ativo} onChange={(e) => setForm({ ...form, ativo: e.target.checked })} />}
          </div>
        </Modal>
      )}

      {segredo && (
        <Modal aberto onFechar={() => setSegredo(null)} titulo={`Segredo da assinatura — ${segredo.nome}`} descricao="Cole no sistema de destino para ele conferir que o aviso veio mesmo do MEU BLING." rodape={<Button variante="primario" onClick={() => setSegredo(null)}>Fechar</Button>}>
          <div className="flex min-w-0 items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded-md bg-slate-900 px-3 py-2 font-mono text-sm text-emerald-300">{segredo.segredo}</code>
            <BotaoCopiar texto={segredo.segredo} />
          </div>
        </Modal>
      )}

      {entregasDe && <Entregas webhook={entregasDe} onFechar={() => setEntregasDe(null)} />}

      <ConfirmDialog
        aberto={!!excluir}
        onFechar={() => setExcluir(null)}
        titulo={`Excluir o webhook "${excluir?.nome}"?`}
        descricao="O sistema de destino deixa de receber os avisos."
        textoConfirmar="Excluir"
        onConfirmar={async () => {
          try {
            await api.del(`/api-externa/webhooks/${excluir!.id}`);
            toast.success('Webhook excluído.');
            atualizar();
          } catch (e) {
            toast.error(mensagemErro(e));
          }
          setExcluir(null);
        }}
      />
    </div>
  );
}

function Entregas({ webhook, onFechar }: { webhook: Webhook; onFechar: () => void }) {
  const qc = useQueryClient();
  const chave = ['api-externa', 'entregas', webhook.id];
  const { data, isLoading } = useQuery({ queryKey: chave, queryFn: () => api.get<Entrega[]>(`/api-externa/webhooks/${webhook.id}/entregas`), refetchInterval: 10_000 });
  const reenviar = useMutation({
    mutationFn: (id: number) => api.post(`/api-externa/entregas/${id}/reenviar`),
    onSuccess: () => {
      toast.success('Reenviado.');
      qc.invalidateQueries({ queryKey: chave });
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });
  return (
    <Drawer aberto onFechar={onFechar} titulo={`Entregas — ${webhook.nome}`} descricao="Últimos 50 avisos enviados (guardados por 30 dias).">
      {isLoading ? (
        <p className="text-sm text-slate-400">Carregando…</p>
      ) : !data?.length ? (
        <EmptyState compacto titulo="Nada enviado ainda" descricao='Use "Enviar teste agora" para conferir a ligação.' />
      ) : (
        <div className="space-y-2">
          {data.map((e) => (
            <details key={e.id} className="rounded-lg border border-slate-200 px-3 py-2">
              <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
                <Badge tom={e.status === 'ENTREGUE' ? 'verde' : e.status === 'FALHOU' ? 'vermelho' : 'amarelo'}>{e.status === 'ENTREGUE' ? 'Entregue' : e.status === 'FALHOU' ? 'Falhou' : 'Aguardando'}</Badge>
                <span className="font-mono text-xs text-slate-700">{e.evento}</span>
                <span className="text-xs text-slate-400">{dataHora(e.criadoEm)} · {e.tentativas} tentativa(s){e.respostaStatus ? ` · HTTP ${e.respostaStatus}` : ''}</span>
              </summary>
              <div className="mt-2 space-y-2">
                {e.status === 'PENDENTE' && e.tentativas > 0 && <p className="text-xs text-amber-600">Próxima tentativa: {dataHora(e.proximaTentativa)}</p>}
                {e.resposta && <p className="break-all text-xs text-slate-500">Resposta: {e.resposta}</p>}
                <Codigo titulo="Corpo enviado">{JSON.stringify(JSON.parse(e.payload), null, 2)}</Codigo>
                {e.status !== 'ENTREGUE' && (
                  <Button tamanho="xs" variante="secundario" icone={<Send className="h-3.5 w-3.5" />} carregando={reenviar.isPending} onClick={() => reenviar.mutate(e.id)}>Reenviar agora</Button>
                )}
              </div>
            </details>
          ))}
        </div>
      )}
    </Drawer>
  );
}
