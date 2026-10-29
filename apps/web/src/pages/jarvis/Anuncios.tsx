import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, Copy, ExternalLink, Megaphone, Send, Sparkles } from 'lucide-react';
import { api, mensagemErro } from '@/lib/api';
import { Badge, Button, EmptyState, Input, Modal, PageHeader, Secao, SearchSelect } from '@/components/ui';

interface InfoCanal { canal: string; rotulo: string; modo: 'api' | 'kit'; observacao: string; link?: string; limiteTitulo?: number }
interface CanalAnuncio { id: number; canal: string; situacao: string; url: string | null; erro: string | null; texto: string | null; publicadoEm: string | null; publicadoPor: string | null }
interface Anuncio {
  id: number; criadoEm: string; titulo: string; descricao: string; preco: number; condicao: string;
  fotos: string[]; geradoPorIa: boolean; canais: CanalAnuncio[]; produto?: { id: number; nome: string; imagemUrl: string | null } | null;
}
interface Rascunho { titulo: string; descricao: string; porCanal: Record<string, string>; geradoPorIa: boolean; preco: number; fotos: string[]; produtoId: number }

const TOM: Record<string, 'verde' | 'amarelo' | 'vermelho' | 'cinza' | 'azul'> = {
  PUBLICADO: 'verde', KIT_PRONTO: 'azul', PENDENTE: 'amarelo', PRECISA_CONFIGURAR: 'amarelo', ERRO: 'vermelho',
};
const ROTULO: Record<string, string> = {
  PUBLICADO: 'Publicado', KIT_PRONTO: 'Pronto para publicar', PENDENTE: 'Aguardando', PRECISA_CONFIGURAR: 'Falta configurar', ERRO: 'Erro',
};
const dinheiro = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Central de Anúncios: monta o anúncio uma vez e leva para cada canal. */
export default function Anuncios() {
  const qc = useQueryClient();
  const [novo, setNovo] = useState<Rascunho | null>(null);
  const [canaisSel, setCanaisSel] = useState<string[]>([]);
  const [kit, setKit] = useState<{ anuncio: Anuncio; canal: CanalAnuncio; info: InfoCanal } | null>(null);
  const [urlKit, setUrlKit] = useState('');
  const [produtoId, setProdutoId] = useState<number | null>(null);
  const [condicao, setCondicao] = useState<'novo' | 'usado'>('novo');

  const canais = useQuery({ queryKey: ['jarvis-canais'], queryFn: () => api.get<InfoCanal[]>('/jarvis/anuncios/canais') });
  const anuncios = useQuery({ queryKey: ['jarvis-anuncios'], queryFn: () => api.get<{ data: Anuncio[] }>('/jarvis/anuncios') });
  const info = (c: string) => canais.data?.find((x) => x.canal === c);

  const recarregar = () => qc.invalidateQueries({ queryKey: ['jarvis-anuncios'] });

  const rascunhar = useMutation({
    mutationFn: () => api.post<Rascunho>('/jarvis/anuncios/rascunho', { produtoId, condicao }),
    onSuccess: (r) => { setNovo(r); setCanaisSel(['SITE', 'OLX']); },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const criar = useMutation({
    mutationFn: () => api.post<Anuncio>('/jarvis/anuncios', {
      produtoId: novo?.produtoId, titulo: novo?.titulo, descricao: novo?.descricao, preco: novo?.preco,
      condicao, fotos: novo?.fotos ?? [], canais: canaisSel, porCanal: novo?.porCanal, geradoPorIa: novo?.geradoPorIa,
    }),
    onSuccess: () => { toast.success('Anúncio criado.'); setNovo(null); setProdutoId(null); recarregar(); },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const publicar = useMutation({
    mutationFn: (p: { id: number; canal: string }) => api.post<CanalAnuncio>(`/jarvis/anuncios/${p.id}/publicar`, { canal: p.canal }),
    onSuccess: (r) => {
      if (r.situacao === 'PUBLICADO') toast.success('Publicado.');
      else toast.warning(r.erro ?? 'Esse canal ainda não está ligado.');
      recarregar();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const publiquei = useMutation({
    mutationFn: (p: { id: number; canal: string; url: string }) => api.post(`/jarvis/anuncios/${p.id}/publiquei`, { canal: p.canal, url: p.url || null }),
    onSuccess: () => { toast.success('Marcado como publicado.'); setKit(null); setUrlKit(''); recarregar(); },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const copiar = async (texto: string) => {
    try { await navigator.clipboard.writeText(texto); toast.success('Copiado.'); }
    catch { toast.error('Não consegui copiar. Selecione o texto e copie à mão.'); }
  };

  const lista = anuncios.data?.data ?? [];

  return (
    <div className="pb-6">
      <PageHeader
        migalhas={[{ rotulo: 'JARVIS', para: '/jarvis' }, { rotulo: 'Central de Anúncios' }]}
        titulo="Central de Anúncios"
        descricao="Monta o anúncio uma vez e leva para cada canal. Onde existe API oficial, publica sozinho; onde não existe, deixa tudo pronto para você publicar em um minuto."
      />

      <div className="space-y-4">
        <Secao titulo="Novo anúncio" descricao="Escolha o produto; o texto é montado a partir dos dados dele.">
          <div className="grid items-end gap-3 md:grid-cols-[1fr_auto_auto]">
            <SearchSelect
              label="Produto"
              placeholder="Buscar por nome, código ou GTIN…"
              valor={produtoId}
              onChange={(id) => setProdutoId(id)}
              buscar={async (texto) => {
                const r = await api.get<{ data: { id: number; nome: string; codigo?: string | null; preco?: number }[] }>('/produtos', { busca: texto, limite: 20 });
                return (r.data ?? []).map((p) => ({ id: p.id, rotulo: p.nome, sub: p.codigo ?? undefined, direita: p.preco != null ? dinheiro(p.preco) : undefined }));
              }}
            />
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Condição</label>
              <select className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={condicao} onChange={(e) => setCondicao(e.target.value as 'novo' | 'usado')}>
                <option value="novo">Novo (1 ano de garantia)</option>
                <option value="usado">Usado (3 meses)</option>
              </select>
            </div>
            <Button variante="primario" icone={<Sparkles className="h-4 w-4" />} carregando={rascunhar.isPending} disabled={!produtoId} onClick={() => rascunhar.mutate()}>
              Montar anúncio
            </Button>
          </div>
        </Secao>

        <Secao titulo="Canais" descricao="Onde o anúncio pode ir, e o que cada um exige.">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {canais.data?.map((c) => (
              <div key={c.canal} className="rounded-lg border border-slate-200 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-slate-800">{c.rotulo}</span>
                  <Badge tom={c.modo === 'api' ? 'verde' : 'azul'}>{c.modo === 'api' ? 'Automático' : 'Kit pronto'}</Badge>
                </div>
                <p className="mt-1 text-xs text-slate-500">{c.observacao}</p>
              </div>
            ))}
          </div>
        </Secao>

        <Secao titulo="Anúncios" descricao="O que já foi montado e onde cada um está.">
          {lista.length === 0 ? (
            <EmptyState icone={<Megaphone className="h-8 w-8" />} titulo="Nenhum anúncio ainda" descricao="Escolha um produto acima e clique em Montar anúncio." />
          ) : (
            <div className="space-y-3">
              {lista.map((a) => (
                <div key={a.id} className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-slate-800">{a.titulo}</span>
                        <Badge tom="cinza">{a.geradoPorIa ? 'texto da IA' : 'texto padrão'}</Badge>
                      </div>
                      <div className="mt-0.5 text-sm text-slate-500">
                        {dinheiro(a.preco)} · {a.condicao === 'usado' ? 'Usado' : 'Novo'}{a.produto ? ` · ${a.produto.nome}` : ''}
                      </div>
                    </div>
                    <Button variante="secundario" tamanho="sm" icone={<Copy className="h-3.5 w-3.5" />} onClick={() => copiar(`${a.titulo}\n\n${a.descricao}\n\n${dinheiro(a.preco)}`)}>Copiar</Button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {a.canais.map((c) => {
                      const i = info(c.canal);
                      const precisaPessoa = i?.modo === 'kit' || c.situacao === 'PRECISA_CONFIGURAR' || c.situacao === 'KIT_PRONTO';
                      return (
                        <div key={c.id} className="flex items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5">
                          <span className="text-sm text-slate-700">{i?.rotulo ?? c.canal}</span>
                          <Badge tom={TOM[c.situacao] ?? 'cinza'}>{ROTULO[c.situacao] ?? c.situacao}</Badge>
                          {c.url ? (
                            <a href={c.url} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline" title="Abrir anúncio"><ExternalLink className="h-3.5 w-3.5" /></a>
                          ) : precisaPessoa ? (
                            <Button variante="secundario" tamanho="xs" onClick={() => i && setKit({ anuncio: a, canal: c, info: i })}>Abrir kit</Button>
                          ) : (
                            <Button variante="secundario" tamanho="xs" icone={<Send className="h-3 w-3" />} carregando={publicar.isPending} onClick={() => publicar.mutate({ id: a.id, canal: c.canal })}>Publicar</Button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {a.canais.find((c) => c.erro) ? (
                    <p className="mt-2 text-xs text-amber-700">{a.canais.find((c) => c.erro)?.erro}</p>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </Secao>
      </div>

      {/* revisão antes de criar */}
      <Modal aberto={!!novo} onFechar={() => setNovo(null)} titulo="Conferir antes de publicar" tamanho="lg"
        descricao={novo?.geradoPorIa ? 'Texto escrito pela IA a partir dos dados do produto. Leia antes de publicar.' : 'A IA não está configurada, então este é o texto padrão. Dá para editar aqui mesmo.'}
        rodape={<><Button variante="secundario" onClick={() => setNovo(null)}>Cancelar</Button><Button variante="primario" carregando={criar.isPending} disabled={!canaisSel.length} onClick={() => criar.mutate()}>Criar anúncio</Button></>}>
        {novo ? (
          <div className="space-y-3">
            <Input label="Título" value={novo.titulo} onChange={(e) => setNovo({ ...novo, titulo: e.target.value })} />
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Descrição</label>
              <textarea className="h-40 w-full rounded-lg border border-slate-300 p-3 text-sm" value={novo.descricao} onChange={(e) => setNovo({ ...novo, descricao: e.target.value })} />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">Onde publicar</label>
              <div className="flex flex-wrap gap-2">
                {canais.data?.map((c) => {
                  const marcado = canaisSel.includes(c.canal);
                  const estoura = !!c.limiteTitulo && novo.titulo.length > c.limiteTitulo;
                  return (
                    <button key={c.canal} type="button"
                      onClick={() => setCanaisSel((s) => (marcado ? s.filter((x) => x !== c.canal) : [...s, c.canal]))}
                      className={`rounded-lg border px-3 py-1.5 text-sm ${marcado ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-300 text-slate-600'}`}>
                      {marcado ? <Check className="mr-1 inline h-3.5 w-3.5" /> : null}{c.rotulo}
                      {estoura ? <span className="ml-1 text-xs text-amber-600">título passa de {c.limiteTitulo}</span> : null}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        ) : null}
      </Modal>

      {/* kit pronto */}
      <Modal aberto={!!kit} onFechar={() => { setKit(null); setUrlKit(''); }} titulo={`Publicar no ${kit?.info.rotulo ?? ''}`} tamanho="lg"
        descricao={kit?.info.observacao}
        rodape={<><Button variante="secundario" onClick={() => { setKit(null); setUrlKit(''); }}>Fechar</Button><Button variante="primario" carregando={publiquei.isPending} onClick={() => kit && publiquei.mutate({ id: kit.anuncio.id, canal: kit.canal.canal, url: urlKit })}>Já publiquei</Button></>}>
        {kit ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-slate-200 p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-700">Título</span>
                <Button variante="secundario" tamanho="xs" icone={<Copy className="h-3 w-3" />} onClick={() => copiar(kit.anuncio.titulo)}>Copiar</Button>
              </div>
              <p className="mt-1 text-sm text-slate-800">{kit.anuncio.titulo}</p>
            </div>
            <div className="rounded-lg border border-slate-200 p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-700">Texto para o {kit.info.rotulo}</span>
                <Button variante="secundario" tamanho="xs" icone={<Copy className="h-3 w-3" />} onClick={() => copiar(kit.canal.texto ?? kit.anuncio.descricao)}>Copiar</Button>
              </div>
              <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap font-sans text-sm text-slate-700">{kit.canal.texto ?? kit.anuncio.descricao}</pre>
            </div>
            <div className="rounded-lg border border-slate-200 p-3">
              <span className="text-sm font-medium text-slate-700">Preço</span>
              <p className="mt-1 text-sm text-slate-800">{dinheiro(kit.anuncio.preco)}</p>
            </div>
            {kit.info.link ? (
              <a href={kit.info.link} target="_blank" rel="noreferrer">
                <Button variante="secundario" icone={<ExternalLink className="h-4 w-4" />}>Abrir o {kit.info.rotulo}</Button>
              </a>
            ) : null}
            <Input label="Link do anúncio publicado (opcional)" value={urlKit} onChange={(e) => setUrlKit(e.target.value)} placeholder="https://..." />
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
