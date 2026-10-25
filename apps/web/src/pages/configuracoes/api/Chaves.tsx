/** Aba "Chaves de acesso": cada sistema/agente ganha uma chave com leitura e gravação por área. */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, KeyRound, Pencil, Plus, Power, RefreshCw, ScrollText, Trash2 } from 'lucide-react';
import { api, mensagemErro } from '@/lib/api';
import { dataHora, data as fmtData, inteiro } from '@/lib/format';
import { Badge, Button, Checkbox, ConfirmDialog, EmptyState, Input, MenuAcoes, Modal, Segmentado, Table, Textarea } from '@/components/ui';
import { BotaoCopiar, Codigo, NIVEL_CURTO, NIVEL_ROTULO, useCatalogo, type ChaveApi, type Nivel, type Permissoes, type Recurso } from './comum';

type NivelOuNada = Nivel | 'NENHUM';

interface Form {
  id?: number;
  nome: string;
  descricao: string;
  permissoes: Permissoes;
  ipsPermitidos: string;
  limitePorMinuto: number;
  permitirNaUrl: boolean;
  expiraEm: string;
  ativo: boolean;
}

const VAZIO: Form = { nome: '', descricao: '', permissoes: {}, ipsPermitidos: '', limitePorMinuto: 120, permitirNaUrl: false, expiraEm: '', ativo: true };

function resumoPermissoes(p: Permissoes, recursos: Recurso[] | undefined) {
  const itens = (recursos || []).filter((r) => p[r.chave]);
  if (!itens.length) return <span className="text-xs text-slate-400">nenhuma</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {itens.map((r) => (
        <Badge key={r.chave} tom={p[r.chave] === 'LEITURA' ? 'azul' : p[r.chave] === 'TOTAL' ? 'vermelho' : 'laranja'} className="text-[11px]">
          {r.nome.split(' ')[0]} · {NIVEL_CURTO[p[r.chave]]}
        </Badge>
      ))}
    </div>
  );
}

export function AbaChaves({ urlBase, aoVerRegistro }: { urlBase: string; aoVerRegistro: (chaveId: number) => void }) {
  const qc = useQueryClient();
  const { data: catalogo } = useCatalogo();
  const { data: chaves, isLoading } = useQuery({ queryKey: ['api-externa', 'chaves'], queryFn: () => api.get<ChaveApi[]>('/api-externa/chaves') });
  const [form, setForm] = useState<Form | null>(null);
  const [recemCriada, setRecemCriada] = useState<ChaveApi | null>(null);
  const [excluir, setExcluir] = useState<ChaveApi | null>(null);
  const [regenerar, setRegenerar] = useState<ChaveApi | null>(null);

  const atualizar = () => {
    qc.invalidateQueries({ queryKey: ['api-externa', 'chaves'] });
    qc.invalidateQueries({ queryKey: ['api-externa', 'resumo'] });
  };

  const salvar = useMutation({
    mutationFn: (f: Form) => {
      const corpo = { nome: f.nome, descricao: f.descricao || null, permissoes: f.permissoes, ipsPermitidos: f.ipsPermitidos, limitePorMinuto: f.limitePorMinuto, permitirNaUrl: f.permitirNaUrl, expiraEm: f.expiraEm || null, ativo: f.ativo };
      return f.id ? api.put<ChaveApi>(`/api-externa/chaves/${f.id}`, corpo) : api.post<ChaveApi>('/api-externa/chaves', corpo);
    },
    onSuccess: (c) => {
      setForm(null);
      atualizar();
      if (c.chave) setRecemCriada(c);
      else toast.success('Chave salva. Vale na hora para o sistema que a usa.');
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });
  const ativar = useMutation({
    mutationFn: (c: ChaveApi) => api.put(`/api-externa/chaves/${c.id}`, { ativo: !c.ativo }),
    onSuccess: (_r, c) => {
      toast.success(c.ativo ? 'Chave desativada: o sistema que a usa perdeu o acesso.' : 'Chave reativada.');
      atualizar();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const editar = (c: ChaveApi) =>
    setForm({ id: c.id, nome: c.nome, descricao: c.descricao ?? '', permissoes: { ...c.permissoes }, ipsPermitidos: c.ipsPermitidos ?? '', limitePorMinuto: c.limitePorMinuto, permitirNaUrl: c.permitirNaUrl, expiraEm: c.expiraEm ? c.expiraEm.slice(0, 10) : '', ativo: c.ativo });

  const situacao = (c: ChaveApi) =>
    !c.ativo ? <Badge tom="cinza">Desativada</Badge> : c.vencida ? <Badge tom="vermelho">Vencida</Badge> : <Badge tom="verde" ponto>Ativa</Badge>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 flex-1 text-sm text-slate-500">Uma chave para cada sistema ou agente. Você escolhe o que cada um pode ler e gravar, e pode desligar a qualquer momento.</p>
        <Button variante="primario" icone={<Plus className="h-4 w-4" />} onClick={() => setForm({ ...VAZIO })}>Nova chave</Button>
      </div>

      <Table<ChaveApi>
        carregando={isLoading}
        dados={chaves}
        chave={(c) => c.id}
        onClickLinha={editar}
        vazio={<EmptyState icone={<KeyRound className="h-6 w-6" />} titulo="Nenhuma chave ainda" descricao="Crie a primeira para conectar um sistema, o n8n ou um agente de IA." acao={<Button variante="primario" icone={<Plus className="h-4 w-4" />} onClick={() => setForm({ ...VAZIO })}>Nova chave</Button>} />}
        colunas={[
          {
            chave: 'nome',
            titulo: 'Chave',
            render: (c) => (
              <div className="min-w-0">
                <p className="truncate font-medium text-slate-800">{c.nome}</p>
                <p className="font-mono text-xs text-slate-400">{c.prefixo}…</p>
              </div>
            ),
          },
          { chave: 'perm', titulo: 'Pode', render: (c) => resumoPermissoes(c.permissoes, catalogo?.recursos) },
          {
            chave: 'uso',
            titulo: 'Uso',
            ocultarMobile: true,
            render: (c) => (
              <div className="text-xs text-slate-500">
                <p>{c.ultimoUsoEm ? `último: ${dataHora(c.ultimoUsoEm)}` : 'nunca usada'}</p>
                <p>{inteiro(c.chamadas24h)} chamadas em 24 h · {inteiro(c.totalChamadas)} no total</p>
              </div>
            ),
          },
          { chave: 'sit', titulo: 'Situação', render: situacao },
          {
            chave: 'acoes',
            titulo: '',
            render: (c) => (
              <MenuAcoes
                itens={[
                  { rotulo: 'Editar permissões', icone: <Pencil className="h-4 w-4" />, onClick: () => editar(c) },
                  { rotulo: 'Ver chamadas', icone: <ScrollText className="h-4 w-4" />, onClick: () => aoVerRegistro(c.id) },
                  { rotulo: c.ativo ? 'Desativar' : 'Reativar', icone: <Power className="h-4 w-4" />, onClick: () => ativar.mutate(c) },
                  { rotulo: 'Gerar nova chave', icone: <RefreshCw className="h-4 w-4" />, onClick: () => setRegenerar(c), separar: true },
                  { rotulo: 'Excluir', icone: <Trash2 className="h-4 w-4" />, onClick: () => setExcluir(c), perigo: true },
                ]}
              />
            ),
          },
        ]}
      />

      {form && <ChaveModal form={form} setForm={setForm} recursos={catalogo?.recursos ?? []} salvando={salvar.isPending} onSalvar={() => salvar.mutate(form)} />}
      {recemCriada?.chave && <ChaveCriada chave={recemCriada} urlBase={urlBase} onFechar={() => setRecemCriada(null)} />}

      <ConfirmDialog
        aberto={!!excluir}
        onFechar={() => setExcluir(null)}
        titulo={`Excluir a chave "${excluir?.nome}"?`}
        descricao="O sistema que usa esta chave perde o acesso na hora. O registro de chamadas dela também é apagado."
        textoConfirmar="Excluir chave"
        onConfirmar={async () => {
          try {
            await api.del(`/api-externa/chaves/${excluir!.id}`);
            toast.success('Chave excluída.');
            atualizar();
          } catch (e) {
            toast.error(mensagemErro(e));
          }
          setExcluir(null);
        }}
      />
      <ConfirmDialog
        aberto={!!regenerar}
        onFechar={() => setRegenerar(null)}
        titulo={`Gerar nova chave para "${regenerar?.nome}"?`}
        descricao="A chave atual para de funcionar na hora (use se ela vazou). As permissões continuam as mesmas; você vai precisar colar a nova no sistema que a usa."
        textoConfirmar="Gerar nova chave"
        onConfirmar={async () => {
          try {
            const c = await api.post<ChaveApi>(`/api-externa/chaves/${regenerar!.id}/regenerar`);
            setRecemCriada(c);
            atualizar();
          } catch (e) {
            toast.error(mensagemErro(e));
          }
          setRegenerar(null);
        }}
      />
    </div>
  );
}

// ------------------------------------------------------------------ formulário
function ChaveModal({ form, setForm, recursos, salvando, onSalvar }: { form: Form; setForm: (f: Form | null) => void; recursos: Recurso[]; salvando: boolean; onSalvar: () => void }) {
  const set = (p: Partial<Form>) => setForm({ ...form, ...p });
  const setNivel = (r: string, n: NivelOuNada) => {
    const p = { ...form.permissoes };
    if (n === 'NENHUM') delete p[r];
    else p[r] = n;
    set({ permissoes: p });
  };
  const preset = (n: NivelOuNada) => {
    const p: Permissoes = {};
    if (n !== 'NENHUM') for (const r of recursos) p[r.chave] = r.maximo === 'LEITURA' ? 'LEITURA' : n;
    set({ permissoes: p });
  };
  const algum = Object.keys(form.permissoes).length > 0;
  return (
    <Modal
      aberto
      tamanho="xl"
      onFechar={() => setForm(null)}
      titulo={form.id ? 'Editar chave de API' : 'Nova chave de API'}
      descricao="Libere só o que o sistema ou agente precisa. Gravação inclui leitura; Total também deixa excluir."
      rodape={
        <>
          <Button variante="secundario" onClick={() => setForm(null)}>Cancelar</Button>
          <Button variante="primario" carregando={salvando} disabled={!form.nome.trim() || !algum} onClick={onSalvar}>{form.id ? 'Salvar' : 'Criar chave'}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Nome" obrigatorio autoFocus value={form.nome} onChange={(e) => set({ nome: e.target.value })} placeholder="Ex.: Agente de vendas, n8n, CRM WhatsApp" />
          <Input label="Validade (opcional)" type="date" value={form.expiraEm} onChange={(e) => set({ expiraEm: e.target.value })} ajuda="Em branco = não vence" />
          <Textarea className="sm:col-span-2" label="Para que serve (opcional)" rows={2} value={form.descricao} onChange={(e) => set({ descricao: e.target.value })} />
        </div>

        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-slate-700">O que esta chave pode fazer</p>
            <div className="flex flex-wrap gap-1">
              <Button tamanho="xs" variante="secundario" onClick={() => preset('LEITURA')}>Ler tudo</Button>
              <Button tamanho="xs" variante="secundario" onClick={() => preset('GRAVACAO')}>Ler e gravar tudo</Button>
              <Button tamanho="xs" variante="secundario" onClick={() => preset('TOTAL')}>Liberar tudo</Button>
              <Button tamanho="xs" variante="fantasma" onClick={() => preset('NENHUM')}>Limpar</Button>
            </div>
          </div>
          <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {recursos.map((r) => {
              const opcoes = (['NENHUM', 'LEITURA', 'GRAVACAO', 'TOTAL'] as NivelOuNada[]).filter((n) => r.maximo !== 'LEITURA' || n === 'NENHUM' || n === 'LEITURA');
              return (
                <div key={r.chave} className="flex flex-col gap-2 px-3 py-2.5 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800">{r.nome}</p>
                    <p className="text-xs text-slate-400">{r.descricao}</p>
                  </div>
                  <Segmentado<NivelOuNada>
                    tamanho="xs"
                    className="shrink-0 self-start md:self-center"
                    valor={form.permissoes[r.chave] ?? 'NENHUM'}
                    onMudar={(v) => setNivel(r.chave, v)}
                    opcoes={opcoes.map((n) => ({ valor: n, rotulo: NIVEL_CURTO[n] }))}
                  />
                </div>
              );
            })}
          </div>
          {!algum && <p className="mt-1 text-xs text-amber-600">Libere pelo menos uma área.</p>}
          <p className="mt-1 text-xs text-slate-400">Usuários, certificado, SMTP, Bling, configurações e as próprias chaves nunca ficam disponíveis para chaves de API.</p>
        </div>

        <details className="rounded-lg border border-slate-200 px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium text-slate-700">Segurança avançada</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Input label="IPs liberados (opcional)" value={form.ipsPermitidos} onChange={(e) => set({ ipsPermitidos: e.target.value })} placeholder="Ex.: 179.199.148.87, 10.0.0.5" ajuda="Em branco = qualquer IP. Separe vários por vírgula." />
            <Input label="Limite por minuto" type="number" min={1} max={5000} value={form.limitePorMinuto} onChange={(e) => set({ limitePorMinuto: Number(e.target.value) || 1 })} ajuda="Acima disso a API responde 429 até o minuto virar." />
            <div className="sm:col-span-2">
              <Checkbox label="Permitir a chave dentro do endereço do MCP" descricao="Só para conectores de IA que não deixam mandar cabeçalho (ex.: conector personalizado do claude.ai). Quem tiver o endereço tem o acesso: trate como senha." checked={form.permitirNaUrl} onChange={(e) => set({ permitirNaUrl: e.target.checked })} />
            </div>
            {form.id && (
              <div className="sm:col-span-2">
                <Checkbox label="Chave ativa" checked={form.ativo} onChange={(e) => set({ ativo: e.target.checked })} />
              </div>
            )}
          </div>
        </details>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ chave recém-criada (aparece uma vez)
function ChaveCriada({ chave, urlBase, onFechar }: { chave: ChaveApi; urlBase: string; onFechar: () => void }) {
  const k = chave.chave!;
  return (
    <Modal aberto tamanho="lg" onFechar={onFechar} titulo={`Chave "${chave.nome}"`} rodape={<Button variante="primario" onClick={onFechar}>Já guardei a chave</Button>}>
      <div className="space-y-4">
        <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>Copie agora e cole no sistema ou agente. <strong>Ela não aparece de novo</strong> — se perder, use “Gerar nova chave”.</p>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <code className="min-w-0 flex-1 break-all rounded-md bg-slate-900 px-3 py-2 font-mono text-sm text-emerald-300">{k}</code>
          <BotaoCopiar texto={k} rotulo="Copiar chave" />
        </div>
        <Codigo titulo="Teste rápido (terminal)">{`curl -H "X-API-Key: ${k}" "${urlBase}/externo/eu"`}</Codigo>
        <Codigo titulo="Agente de IA — Claude Code">{`claude mcp add --transport http meu-bling ${urlBase}/mcp --header "X-API-Key: ${k}"`}</Codigo>
        <p className="text-xs text-slate-500">Mais exemplos (Claude Desktop, n8n, ChatGPT, Python) na aba “Conectar agente de IA”.{chave.expiraEm ? ` Esta chave vence em ${fmtData(chave.expiraEm)}.` : ''}</p>
      </div>
    </Modal>
  );
}
