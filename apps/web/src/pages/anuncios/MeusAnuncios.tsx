/**
 * MEUS ANÚNCIOS — a vitrine da equipe pelo lado de quem publica (ver docs/VITRINE-EQUIPE.md).
 *
 * O técnico ganha 33% e o vendedor 20% do lucro do que vender pelo anúncio dele. A tela existe
 * para a pessoa PUBLICAR: por isso o convite com o percentual e o botão "Criar anúncio" vêm
 * antes de qualquer número, e cada card mostra o que já rendeu e o que está a receber.
 * A gestão (ADMIN/GERENTE) abre a mesma tela e vê os anúncios de todo mundo.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  BadgePercent, Copy, Eye, ExternalLink, Megaphone, Pencil, Plus, ShoppingBag, Store, Trash2, TrendingUp, Wrench,
} from 'lucide-react';
import { api, mensagemErro } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import {
  Badge, BarraFiltros, BuscaFiltro, Button, Card, ConfirmDialog, EmptyState, MenuAcoes, PageHeader, Segmentado, Skeleton, StatCard, ValorOculto,
} from '@/components/ui';
import { inteiro, moeda } from '@/lib/format';
import { AnuncioForm } from './AnuncioForm';
import { ComissoesAnuncio } from './ComissoesAnuncio';
import { copiarLink, ehServico, fotosDe, linkDoAnuncio, nomeDoDono, rotuloDono, type Anuncio, type RespostaAnuncios } from './comum';

const FILTROS = [
  { valor: 'ATIVOS', rotulo: 'Ativos' },
  { valor: 'TODOS', rotulo: 'Todos' },
] as const;

export default function MeusAnuncios() {
  const qc = useQueryClient();
  const gestao = useAuth((s) => s.temPerfil('ADMIN', 'GERENTE'));
  const [filtro, setFiltro] = useState<(typeof FILTROS)[number]['valor']>('ATIVOS');
  const [pesquisa, setPesquisa] = useState('');
  const [form, setForm] = useState<{ aberto: boolean; anuncio: Anuncio | null }>({ aberto: false, anuncio: null });
  const [comissoes, setComissoes] = useState<Anuncio | null>(null);
  const [excluir, setExcluir] = useState<Anuncio | null>(null);

  const params = { ativo: filtro === 'ATIVOS' ? true : undefined, pesquisa: pesquisa || undefined };
  const { data: resp, isLoading } = useQuery({
    queryKey: ['anuncios', params],
    queryFn: () => api.get<RespostaAnuncios>('/anuncios', params),
    placeholderData: (p) => p,
    refetchInterval: 60_000,
  });

  const lista = resp?.data ?? [];
  const souDono = resp?.souDono ?? null;
  const pct = resp?.meuPercentual ?? null;
  const podeCriar = !!souDono;

  const total = useMemo(() => {
    const t = { rendeu: 0, aReceber: 0, vendas: 0, visitas: 0, ativos: 0 };
    for (const a of lista) {
      t.rendeu += a.retorno.comissaoTotal;
      t.aReceber += a.retorno.comissaoAReceber;
      t.vendas += a.retorno.vendas;
      t.visitas += a.visitas;
      if (a.ativo && a.naVitrine) t.ativos += 1;
    }
    return t;
  }, [lista]);

  const vitrine = useMutation({
    mutationFn: (a: Anuncio) => api.put<Anuncio>(`/anuncios/${a.id}`, { naVitrine: !a.naVitrine }),
    onSuccess: (a) => {
      qc.invalidateQueries({ queryKey: ['anuncios'] });
      toast.success(a?.naVitrine ? 'Anúncio voltou para a vitrine do site.' : 'Anúncio saiu da vitrine do site.');
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const apagar = useMutation({
    mutationFn: (a: Anuncio) => api.del<{ desativado?: boolean; mensagem?: string } | undefined>(`/anuncios/${a.id}`),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['anuncios'] });
      qc.invalidateQueries({ queryKey: ['dashboard-anuncios'] });
      if (r?.desativado) toast.info(r.mensagem ?? 'Anúncio desligado — o histórico de pagamento continua.');
      else toast.success('Anúncio excluído.');
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const abrirNovo = () => setForm({ aberto: true, anuncio: null });

  return (
    <div>
      <PageHeader
        titulo="Meus anúncios"
        descricao={
          gestao && !souDono
            ? 'Os anúncios que a equipe publicou na vitrine do site, com o que cada um já rendeu.'
            : 'Publique seus produtos e serviços na vitrine do site com o seu nome e receba por cada venda que vier por ali.'
        }
        acoes={podeCriar ? <Button variante="primario" tamanho="lg" icone={<Plus className="h-4 w-4" />} onClick={abrirNovo}>Criar anúncio</Button> : undefined}
      />

      {!souDono ? (
        <SemCadastro gestao={gestao} />
      ) : (
        <Convite pct={pct} souDono={souDono} onCriar={abrirNovo} />
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          rotulo="Já rendeu para você"
          valor={moeda(total.rendeu)}
          sub={total.aReceber > 0 ? `${moeda(total.aReceber)} ainda a receber` : 'tudo já pago'}
          tom="verde"
          carregando={isLoading && !resp}
          icone={<TrendingUp className="h-4 w-4" />}
        />
        <StatCard
          rotulo="A receber"
          valor={moeda(total.aReceber)}
          sub="comissão de anúncio aprovada e ainda não paga"
          tom={total.aReceber > 0 ? 'amarelo' : 'neutro'}
          carregando={isLoading && !resp}
          icone={<BadgePercent className="h-4 w-4" />}
        />
        <StatCard
          rotulo="Vendas pelos anúncios"
          valor={inteiro(total.vendas)}
          sub={`${inteiro(total.visitas)} visita(s) na vitrine`}
          tom="azul"
          carregando={isLoading && !resp}
          icone={<ShoppingBag className="h-4 w-4" />}
        />
        <StatCard
          rotulo="Na vitrine agora"
          valor={inteiro(total.ativos)}
          sub={`de ${inteiro(lista.length)} anúncio(s)`}
          tom="neutro"
          carregando={isLoading && !resp}
          icone={<Store className="h-4 w-4" />}
        />
      </div>

      <Card semPadding className="overflow-hidden">
        <BarraFiltros>
          <Segmentado opcoes={FILTROS.map((f) => ({ valor: f.valor, rotulo: f.rotulo }))} valor={filtro} onMudar={setFiltro} />
          <BuscaFiltro valor={pesquisa} onChange={setPesquisa} placeholder="Buscar pelo título…" />
        </BarraFiltros>

        <div className="p-3 sm:p-4">
          {isLoading && !resp ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-72 rounded-2xl" />
              ))}
            </div>
          ) : lista.length ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {lista.map((a) => (
                <CardAnuncio
                  key={a.id}
                  a={a}
                  mostrarDono={gestao}
                  onEditar={() => setForm({ aberto: true, anuncio: a })}
                  onComissoes={() => setComissoes(a)}
                  onVitrine={() => vitrine.mutate(a)}
                  onExcluir={() => setExcluir(a)}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              icone={<Megaphone className="h-5 w-5" />}
              titulo={pesquisa ? 'Nenhum anúncio com esse título' : 'Você ainda não tem anúncios'}
              descricao={
                pesquisa
                  ? 'Tente outro termo ou veja todos.'
                  : 'Publique o primeiro: título, foto, preço e pronto — o link sai na hora para você mandar no WhatsApp.'
              }
              acao={podeCriar ? <Button variante="primario" icone={<Plus className="h-4 w-4" />} onClick={abrirNovo}>Criar anúncio</Button> : undefined}
            />
          )}
        </div>
      </Card>

      <AnuncioForm aberto={form.aberto} onFechar={() => setForm({ aberto: false, anuncio: null })} anuncio={form.anuncio} meuPercentual={pct} />
      <ComissoesAnuncio anuncio={comissoes} onFechar={() => setComissoes(null)} />
      <ConfirmDialog
        aberto={!!excluir}
        onFechar={() => setExcluir(null)}
        onConfirmar={async () => {
          if (excluir) await apagar.mutateAsync(excluir);
        }}
        titulo="Excluir este anúncio?"
        descricao="Ele sai da vitrine do site na hora. Se já tiver gerado pagamento, o anúncio é apenas desligado e o histórico de comissão continua."
        textoConfirmar="Excluir anúncio"
      />
    </div>
  );
}

/** O convite para publicar — é o motivo da tela existir, então vem antes dos números. */
function Convite({ pct, souDono, onCriar }: { pct: number | null; souDono: 'TECNICO' | 'VENDEDOR'; onCriar: () => void }) {
  return (
    <div className="mb-4 overflow-hidden rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-white shadow-card">
      <div className="flex flex-wrap items-center gap-4 p-4 sm:p-5">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
          <Megaphone className="h-6 w-6" />
        </span>
        <div className="min-w-0 flex-[1_1_18rem]">
          <p className="text-base font-bold text-slate-900 sm:text-lg">
            {pct != null ? <>Você ganha <span className="text-emerald-700">{pct}% do lucro</span> de cada venda dos seus anúncios</> : 'Publique na vitrine do site e receba por cada venda'}
          </p>
          <p className="mt-0.5 text-sm text-slate-600">
            {souDono === 'TECNICO'
              ? 'Cadastre seus serviços e produtos de assistência: eles aparecem na vitrine com o seu nome e o pagamento extra entra junto com as suas comissões.'
              : 'Monte um anúncio, mande o link no WhatsApp e, quando o cliente comprar por ali, o pagamento extra é seu — somado à sua comissão normal de venda.'}
          </p>
        </div>
        <Button variante="sucesso" tamanho="lg" icone={<Plus className="h-4 w-4" />} onClick={onCriar} className="max-sm:w-full">
          Criar anúncio
        </Button>
      </div>
    </div>
  );
}

/** Sem cadastro de vendedor/técnico ligado ao usuário não há a quem pagar — a API recusa publicar. */
function SemCadastro({ gestao }: { gestao: boolean }) {
  return (
    <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 sm:p-5">
      <p className="font-semibold">
        {gestao ? 'Seu usuário não tem cadastro de vendedor nem de técnico' : 'Falta ligar o seu usuário a um cadastro de vendedor ou de técnico'}
      </p>
      <p className="mt-1">
        É esse cadastro que diz quem recebe o pagamento extra do anúncio, então sem ele não é possível publicar.
        {gestao ? ' Você continua vendo os anúncios da equipe nesta tela.' : ' Peça ao administrador para fazer essa ligação.'}
      </p>
      <Link to="/configuracoes/usuarios" className="mt-3 inline-flex font-medium underline">Abrir Configurações → Usuários</Link>
    </div>
  );
}

function CardAnuncio({
  a,
  mostrarDono,
  onEditar,
  onComissoes,
  onVitrine,
  onExcluir,
}: {
  a: Anuncio;
  mostrarDono: boolean;
  onEditar: () => void;
  onComissoes: () => void;
  onVitrine: () => void;
  onExcluir: () => void;
}) {
  const foto = fotosDe(a)[0] ?? null;
  const servico = ehServico(a);
  const link = linkDoAnuncio(a.codigo);
  const r = a.retorno;

  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-card transition hover:-translate-y-0.5 hover:border-slate-300">
      {/* foto */}
      <div className="relative flex h-36 items-center justify-center overflow-hidden bg-slate-50">
        {foto ? (
          <img src={foto} alt={a.titulo} loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-contain" />
        ) : (
          <span className="flex flex-col items-center gap-1 text-slate-300">
            {servico ? <Wrench className="h-7 w-7" /> : <ShoppingBag className="h-7 w-7" />}
            <span className="text-[11px]">sem foto</span>
          </span>
        )}
        <div className="absolute left-2 top-2 flex flex-wrap gap-1">
          <Badge tom={servico ? 'roxo' : 'azul'}>{servico ? 'Serviço' : 'Produto'}</Badge>
          {!a.ativo ? <Badge tom="cinza">Desligado</Badge> : !a.naVitrine ? <Badge tom="amarelo">Fora da vitrine</Badge> : <Badge tom="verde">Na vitrine</Badge>}
        </div>
        <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-medium text-slate-600 shadow-xs">
          <Eye className="h-3 w-3" /> <span className="num">{inteiro(a.visitas)}</span>
        </span>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-3 p-3.5">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900" title={a.titulo}>{a.titulo}</p>
          <p className="truncate text-xs text-slate-400">
            {a.codigo} · {a.comissaoPct}% do lucro para {mostrarDono ? nomeDoDono(a) : 'você'}
            {mostrarDono && <> · {rotuloDono(a.donoTipo)}</>}
          </p>
        </div>

        {/* preço e custo (o custo fica escondido: o cliente às vezes olha a tela) */}
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="num text-lg font-bold text-slate-900">{moeda(a.produto.preco)}</span>
          {a.precoAPartirDe ? <span className="num text-xs text-slate-500">a partir de {moeda(a.precoAPartirDe)}</span> : null}
          <span className="text-xs text-slate-400">custo <ValorOculto>{moeda(a.produto.precoCusto)}</ValorOculto></span>
          {a.prazoDias != null && <span className="text-xs text-slate-400">prazo {inteiro(a.prazoDias)} dia(s)</span>}
        </div>

        {/* o que já rendeu — é o número que a pessoa abre a tela para ver */}
        <div className="grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-2.5">
          <div className="min-w-0">
            <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-slate-400">Já rendeu</p>
            <p className="num truncate text-sm font-bold text-slate-900">{moeda(r.comissaoTotal)}</p>
          </div>
          <div className="min-w-0">
            <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-slate-400">A receber</p>
            <p className={`num truncate text-sm font-bold ${r.comissaoAReceber > 0 ? 'text-emerald-600' : 'text-slate-400'}`}>{moeda(r.comissaoAReceber)}</p>
          </div>
          <div className="min-w-0">
            <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-slate-400">Vendas</p>
            <p className="num truncate text-sm font-bold text-slate-900">{inteiro(r.vendas)}</p>
          </div>
        </div>

        {/* link do anúncio: o que vai para o WhatsApp do cliente */}
        <div className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2 py-1.5">
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-slate-500" title={link}>{link}</span>
          <Button tamanho="xs" variante="secundario" icone={<Copy className="h-3.5 w-3.5" />} onClick={() => copiarLink(a.codigo)}>Copiar</Button>
          <a href={link} target="_blank" rel="noreferrer" className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Abrir no site" aria-label="Abrir no site">
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>

        <div className="mt-auto flex items-center gap-2">
          <Button tamanho="sm" variante="secundario" icone={<Pencil className="h-3.5 w-3.5" />} onClick={onEditar} className="flex-1">Editar</Button>
          <Button tamanho="sm" variante="secundario" icone={<BadgePercent className="h-3.5 w-3.5" />} onClick={onComissoes} className="flex-1">Quanto rendeu</Button>
          <MenuAcoes
            itens={[
              { rotulo: a.naVitrine ? 'Tirar da vitrine do site' : 'Colocar na vitrine do site', icone: <Store className="h-4 w-4" />, onClick: onVitrine },
              { rotulo: 'Excluir anúncio', icone: <Trash2 className="h-4 w-4" />, onClick: onExcluir, perigo: true, separar: true },
            ]}
          />
        </div>
      </div>
    </div>
  );
}
