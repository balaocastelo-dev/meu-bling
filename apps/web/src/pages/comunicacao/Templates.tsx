import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import clsx from 'clsx';
import { Eye, FileCode2, Mail, MessageCircle, Plus, Save, Trash2 } from 'lucide-react';
import { api, mensagemErro } from '@/lib/api';
import { useSituacoes, opcoesDe } from '@/hooks/useListas';
import { Badge, Button, Card, Checkbox, ConfirmDialog, EmptyState, Input, Modal, PageHeader, Select, Skeleton, Textarea } from '@/components/ui';
import { rotulo } from '@/lib/format';
import type { Modulo, TemplateNotificacao } from '@/types';

const EVENTOS = ['VENDA_SITUACAO', 'OS_SITUACAO', 'COMPRA_SITUACAO', 'VENDA_CRIADA', 'OS_CRIADA', 'NFE_AUTORIZADA', 'CONTA_VENCENDO', 'ORCAMENTO_OS'];
const VARIAVEIS_PADRAO = ['cliente.nome', 'cliente.primeiroNome', 'numero', 'situacao', 'total', 'data', 'itens', 'equipamento', 'defeito', 'diagnostico', 'tecnico', 'vendedor', 'garantiaDias', 'empresa.nome', 'empresa.telefone', 'empresa.endereco', 'chave', 'link'];

type Form = Omit<TemplateNotificacao, 'id' | 'situacao'>;
const vazio: Form = { nome: '', evento: 'VENDA_SITUACAO', canal: 'WHATSAPP', situacaoId: null, assunto: '', corpo: '', anexarPdf: false, ativo: true };

interface VariavelInfo {
  nome: string;
  descricao?: string;
}
interface EventoVariaveis {
  evento: string;
  variaveis: (VariavelInfo | string)[];
}
/** A API devolve { eventos: [{evento, variaveis:[{nome,descricao}]}] }; aceita também formatos simples */
type VariaveisResposta = { eventos: EventoVariaveis[] } | Record<string, string[]> | string[] | VariavelInfo[];

function normalizar(v: VariavelInfo | string): VariavelInfo {
  return typeof v === 'string' ? { nome: v } : v;
}

function extrairVariaveis(r: VariaveisResposta | null | undefined, evento: string): VariavelInfo[] {
  if (!r) return VARIAVEIS_PADRAO.map((nome) => ({ nome }));
  if (Array.isArray(r)) return r.map(normalizar);
  if ('eventos' in r && Array.isArray(r.eventos)) {
    const eventos = r.eventos as EventoVariaveis[];
    const ev = eventos.find((e) => e.evento === evento) ?? eventos[0];
    return (ev?.variaveis ?? []).map(normalizar);
  }
  const mapa = r as Record<string, string[]>;
  const lista = mapa[evento] ?? Object.values(mapa).flat();
  return lista.map((nome) => ({ nome }));
}

function moduloDoEvento(ev: string): Modulo | null {
  if (ev.startsWith('VENDA')) return 'VENDA';
  if (ev.startsWith('OS') || ev === 'ORCAMENTO_OS') return 'OS';
  if (ev.startsWith('COMPRA')) return 'COMPRA';
  return null;
}

/** CRUD de templates de notificação com editor, variáveis clicáveis e preview */
export default function Templates() {
  const qc = useQueryClient();
  const [sel, setSel] = useState<number | 'novo' | null>(null);
  const [form, setForm] = useState<Form>(vazio);
  const [excluir, setExcluir] = useState(false);
  const [preview, setPreview] = useState<{ assunto?: string; corpo: string } | null>(null);
  const [origemPreview, setOrigemPreview] = useState({ tipo: 'VENDA', id: '' });
  const corpoRef = useRef<HTMLTextAreaElement>(null);

  const { data: templates, isLoading } = useQuery({ queryKey: ['templates', 'todos'], queryFn: () => api.get<TemplateNotificacao[]>('/templates-notificacao') });
  const { data: variaveis } = useQuery({ queryKey: ['templates-variaveis'], queryFn: () => api.get<VariaveisResposta>('/templates-notificacao/variaveis').catch(() => null) });
  const modulo = moduloDoEvento(form.evento);
  const { data: situacoes } = useSituacoes(modulo ?? 'VENDA');

  useEffect(() => {
    if (sel === 'novo') setForm(vazio);
    else if (typeof sel === 'number') {
      const t = templates?.find((x) => x.id === sel);
      if (t) {
        const { id: _i, situacao: _s, ...resto } = t;
        setForm({ ...vazio, ...resto, assunto: resto.assunto ?? '' });
      }
    }
  }, [sel, templates]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const salvar = useMutation({
    mutationFn: (p: Form) => (typeof sel === 'number' ? api.put<TemplateNotificacao>(`/templates-notificacao/${sel}`, p) : api.post<TemplateNotificacao>('/templates-notificacao', p)),
    onSuccess: (t) => {
      toast.success('Template salvo.');
      qc.invalidateQueries({ queryKey: ['templates'] });
      setSel(t.id);
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });
  const remover = useMutation({
    mutationFn: () => api.del(`/templates-notificacao/${sel}`),
    onSuccess: () => {
      toast.success('Template excluído.');
      qc.invalidateQueries({ queryKey: ['templates'] });
      setSel(null);
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });
  const previewM = useMutation({
    mutationFn: () => api.post<{ assunto?: string; corpo: string }>(`/templates-notificacao/${sel}/preview`, { origemTipo: origemPreview.tipo, origemId: Number(origemPreview.id) }),
    onSuccess: (r) => setPreview(r),
    onError: (e) => toast.error(mensagemErro(e)),
  });

  // Lista de variáveis: do backend (por evento) ou padrão
  const listaVars = extrairVariaveis(variaveis, form.evento);

  const inserirVariavel = (v: string) => {
    const ta = corpoRef.current;
    const token = `{{${v}}}`;
    if (!ta) return set('corpo', form.corpo + token);
    const ini = ta.selectionStart ?? form.corpo.length;
    const fim = ta.selectionEnd ?? ini;
    const novo = form.corpo.slice(0, ini) + token + form.corpo.slice(fim);
    set('corpo', novo);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(ini + token.length, ini + token.length);
    });
  };

  // Preview local simples (substitui variáveis por exemplos)
  const exemplo: Record<string, string> = { 'cliente.nome': 'Maria Silva', 'cliente.primeiroNome': 'Maria', numero: '1234', situacao: 'Fechada', total: 'R$ 1.299,90', data: '19/10/2026', itens: '1x Notebook Dell', equipamento: 'Notebook Dell Inspiron', defeito: 'Não liga', diagnostico: 'Fonte queimada', tecnico: 'Jairlem', vendedor: 'Júlia', garantiaDias: '90', 'empresa.nome': 'Balão da Informática', 'empresa.telefone': '(19) 3255-0000', 'empresa.endereco': 'Av. Anchieta, 789 — Cambuí', chave: '3526…', link: 'https://balao.info/p/os/abc123' };
  const previewLocal = form.corpo.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) => exemplo[k] ?? `{{${k}}}`);

  return (
    <div>
      <PageHeader titulo="Templates de notificação" descricao="Mensagens automáticas por mudança de situação e envios manuais." acoes={<Button variante="primario" icone={<Plus className="h-4 w-4" />} onClick={() => setSel('novo')}>Novo template</Button>} />
      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Card semPadding className="lg:col-span-1">
          {isLoading ? (
            <div className="p-4"><Skeleton className="h-64" /></div>
          ) : !templates?.length ? (
            <EmptyState compacto icone={<FileCode2 className="h-5 w-5" />} titulo="Nenhum template" acao={<Button variante="primario" onClick={() => setSel('novo')}>Criar o primeiro</Button>} />
          ) : (
            <ul className="divide-y divide-slate-100">
              {templates.map((t) => (
                <li key={t.id}>
                  <button onClick={() => setSel(t.id)} className={clsx('flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-slate-50', sel === t.id && 'bg-brand-50/60')}>
                    <span className="mt-0.5 text-slate-400">{t.canal === 'WHATSAPP' ? <MessageCircle className="h-4 w-4 text-emerald-600" /> : <Mail className="h-4 w-4 text-blue-600" />}</span>
                    <span className="min-w-0 flex-1">
                      <span className={clsx('block text-sm font-medium leading-snug', t.ativo ? 'text-slate-800' : 'text-slate-400 line-through')}>{t.nome}</span>
                      <span className="block text-xs leading-snug text-slate-400">{rotulo(t.evento)}{t.situacao ? ` → ${t.situacao.nome}` : t.situacaoId ? ` → #${t.situacaoId}` : ''}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="lg:col-span-2">
          {sel === null ? (
            <Card><EmptyState compacto titulo="Selecione um template" descricao="Ou crie um novo para começar." /></Card>
          ) : (
            <Card
              titulo={sel === 'novo' ? 'Novo template' : form.nome}
              acoes={
                <>
                  {typeof sel === 'number' && <Button tamanho="sm" variante="perigo" icone={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setExcluir(true)}>Excluir</Button>}
                  <Button tamanho="sm" variante="primario" icone={<Save className="h-3.5 w-3.5" />} carregando={salvar.isPending} disabled={!form.nome.trim() || !form.corpo.trim()} onClick={() => salvar.mutate(form)}>Salvar</Button>
                </>
              }
            >
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-12">
                <Input className="xl:col-span-6" label="Nome" obrigatorio value={form.nome} onChange={(e) => set('nome', e.target.value)} />
                <Select className="xl:col-span-3" label="Canal" value={form.canal} onChange={(e) => set('canal', e.target.value as Form['canal'])} opcoes={[{ valor: 'WHATSAPP', rotulo: 'WhatsApp' }, { valor: 'EMAIL', rotulo: 'E-mail' }]} />
                <div className="flex items-end gap-4 pb-2 xl:col-span-3">
                  <Checkbox label="Ativo" checked={form.ativo} onChange={(e) => set('ativo', e.target.checked)} />
                  {form.canal === 'EMAIL' && <Checkbox label="Anexar PDF" checked={form.anexarPdf} onChange={(e) => set('anexarPdf', e.target.checked)} />}
                </div>
                <Select className="xl:col-span-6" label="Evento" value={form.evento} onChange={(e) => { set('evento', e.target.value); set('situacaoId', null); }} opcoes={EVENTOS.map((ev) => ({ valor: ev, rotulo: rotulo(ev) }))} />
                {modulo && form.evento.endsWith('_SITUACAO') && (
                  <Select className="xl:col-span-6" label="Disparar ao entrar na situação" value={form.situacaoId ?? ''} onChange={(e) => set('situacaoId', e.target.value ? Number(e.target.value) : null)} opcoes={opcoesDe(situacoes)} placeholder="Qualquer situação com ação “notificarCliente”" />
                )}
                {form.canal === 'EMAIL' && <Input className="sm:col-span-2 xl:col-span-12" label="Assunto" value={form.assunto ?? ''} onChange={(e) => set('assunto', e.target.value)} />}
                <div className="sm:col-span-2 xl:col-span-12">
                  <Textarea ref={corpoRef} label="Mensagem" obrigatorio rows={8} value={form.corpo} onChange={(e) => set('corpo', e.target.value)} className="font-mono" />
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <span className="mr-1 text-xs text-slate-400">Inserir variável:</span>
                    {listaVars.map((v) => (
                      <button key={v.nome} type="button" title={v.descricao} onClick={() => inserirVariavel(v.nome)} className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[11px] text-slate-700 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700">{`{{${v.nome}}}`}</button>
                    ))}
                  </div>
                </div>
                <div className="sm:col-span-2 xl:col-span-12">
                  <p className="mb-1 text-xs font-medium text-slate-600">Pré-visualização (dados de exemplo)</p>
                  <div className={clsx('rounded-lg border p-3 text-sm whitespace-pre-line', form.canal === 'WHATSAPP' ? 'border-emerald-200 bg-[#e7ffdb] text-slate-800' : 'border-slate-200 bg-white text-slate-700')}>
                    {form.canal === 'EMAIL' && form.assunto && <p className="mb-2 border-b border-slate-100 pb-2 font-semibold">{form.assunto}</p>}
                    {previewLocal || <span className="text-slate-400">Digite a mensagem…</span>}
                  </div>
                </div>
                {typeof sel === 'number' && (
                  <div className="flex flex-wrap items-end gap-2 sm:col-span-2 xl:col-span-12">
                    <Select label="Preview com dados reais" value={origemPreview.tipo} onChange={(e) => setOrigemPreview({ ...origemPreview, tipo: e.target.value })} opcoes={[{ valor: 'VENDA', rotulo: 'Venda' }, { valor: 'OS', rotulo: 'OS' }, { valor: 'COMPRA', rotulo: 'Compra' }]} className="w-40" />
                    <Input label="ID" type="number" value={origemPreview.id} onChange={(e) => setOrigemPreview({ ...origemPreview, id: e.target.value })} className="w-28" placeholder="ex.: 12" />
                    <Button variante="secundario" icone={<Eye className="h-4 w-4" />} disabled={!origemPreview.id} carregando={previewM.isPending} onClick={() => previewM.mutate()}>Renderizar</Button>
                  </div>
                )}
              </div>
            </Card>
          )}
        </div>
      </div>

      <Modal aberto={!!preview} onFechar={() => setPreview(null)} titulo="Preview renderizado" rodape={<Button onClick={() => setPreview(null)}>Fechar</Button>}>
        {preview && (
          <div className="space-y-2">
            {preview.assunto && <p className="font-semibold">{preview.assunto}</p>}
            <div className="whitespace-pre-line rounded-lg border border-emerald-200 bg-[#e7ffdb] p-3 text-sm">{preview.corpo}</div>
            <Badge tom="verde">OK</Badge>
          </div>
        )}
      </Modal>
      <ConfirmDialog aberto={excluir} onFechar={() => setExcluir(false)} titulo="Excluir template?" textoConfirmar="Excluir" onConfirmar={async () => { await remover.mutateAsync(); }} />
    </div>
  );
}
