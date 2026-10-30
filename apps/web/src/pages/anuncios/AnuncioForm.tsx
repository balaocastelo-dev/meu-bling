/**
 * Criar / editar um anúncio da vitrine da equipe.
 *
 * O formulário é curto de propósito: o objetivo é a pessoa publicar, não preencher cadastro.
 * Quem cria um anúncio cria também o produto/serviço por trás dele, sem precisar saber disso.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { ImageOff, Megaphone } from 'lucide-react';
import { ApiError, api, mensagemErro } from '@/lib/api';
import { Button, Input, Modal, MoneyInput, Segmentado, Switch, Textarea } from '@/components/ui';
import { FotoProduto } from '@/components/compartilhados/ProdutoSite';
import { frasePercentual, type Anuncio } from './comum';

interface Form {
  tipo: 'PRODUTO' | 'SERVICO';
  titulo: string;
  descricao: string;
  fotos: string;
  preco: number;
  precoCusto: number;
  precoAPartirDe: number;
  prazoDias: string;
  garantiaDias: string;
  naVitrine: boolean;
}

const VAZIO: Form = { tipo: 'SERVICO', titulo: '', descricao: '', fotos: '', preco: 0, precoCusto: 0, precoAPartirDe: 0, prazoDias: '', garantiaDias: '90', naVitrine: true };

function doAnuncio(a: Anuncio): Form {
  return {
    tipo: a.produto.tipo === 'S' ? 'SERVICO' : 'PRODUTO',
    titulo: a.titulo,
    descricao: a.descricao ?? '',
    fotos: a.fotos ?? '',
    preco: a.produto.preco,
    precoCusto: a.produto.precoCusto,
    precoAPartirDe: a.precoAPartirDe ?? 0,
    prazoDias: a.prazoDias != null ? String(a.prazoDias) : '',
    garantiaDias: String(a.produto.garantiaDias ?? 90),
    naVitrine: a.naVitrine,
  };
}

export function AnuncioForm({
  aberto,
  onFechar,
  anuncio,
  meuPercentual,
}: {
  aberto: boolean;
  onFechar: () => void;
  /** null = criar */
  anuncio: Anuncio | null;
  meuPercentual: number | null;
}) {
  const qc = useQueryClient();
  const [f, setF] = useState<Form>(VAZIO);
  const [erros, setErros] = useState<Record<string, string>>({});
  const [semCadastro, setSemCadastro] = useState<string | null>(null);
  const editando = !!anuncio;
  const pct = anuncio?.comissaoPct ?? meuPercentual;

  useEffect(() => {
    if (!aberto) return;
    setF(anuncio ? doAnuncio(anuncio) : VAZIO);
    setErros({});
    setSemCadastro(null);
  }, [aberto, anuncio]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setF((x) => ({ ...x, [k]: v }));
    setErros((e) => (e[k as string] ? { ...e, [k]: '' } : e));
  };

  const salvar = useMutation({
    mutationFn: async () => {
      const comum = {
        titulo: f.titulo.trim(),
        descricao: f.descricao.trim() || null,
        fotos: f.fotos.trim() || null,
        preco: f.preco,
        precoCusto: f.precoCusto,
        precoAPartirDe: f.precoAPartirDe > 0 ? f.precoAPartirDe : null,
        prazoDias: f.prazoDias ? Number(f.prazoDias) : null,
        naVitrine: f.naVitrine,
      };
      if (anuncio) return api.put<Anuncio>(`/anuncios/${anuncio.id}`, comum);
      return api.post<Anuncio>('/anuncios', { ...comum, tipo: f.tipo, garantiaDias: f.garantiaDias ? Number(f.garantiaDias) : 90 });
    },
    onSuccess: (a) => {
      qc.invalidateQueries({ queryKey: ['anuncios'] });
      qc.invalidateQueries({ queryKey: ['dashboard-anuncios'] });
      toast.success(editando ? 'Anúncio salvo.' : `Anúncio publicado! Mande o link para os clientes: /a/${a?.codigo ?? ''}`);
      onFechar();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'SEM_CADASTRO_DONO') {
        const link = (e.detalhes as { link?: string } | undefined)?.link ?? '/configuracoes/usuarios';
        setSemCadastro(link);
        return;
      }
      toast.error(mensagemErro(e));
    },
  });

  const enviar = () => {
    const e: Record<string, string> = {};
    if (f.titulo.trim().length < 3) e.titulo = 'Escreva um título com pelo menos 3 letras.';
    if (f.preco <= 0 && f.precoAPartirDe <= 0) e.preco = 'Informe o preço (ou um valor em "a partir de").';
    if (f.prazoDias && (Number(f.prazoDias) < 0 || Number(f.prazoDias) > 365)) e.prazoDias = 'De 0 a 365 dias.';
    setErros(e);
    if (Object.keys(e).length) return;
    salvar.mutate();
  };

  const previa = f.fotos.split(',').map((s) => s.trim()).filter(Boolean)[0] ?? anuncio?.produto.imagemUrl ?? null;
  const servico = f.tipo === 'SERVICO';

  return (
    <Modal
      aberto={aberto}
      onFechar={onFechar}
      titulo={editando ? 'Editar anúncio' : 'Criar anúncio'}
      descricao={editando ? 'O que você mudar aqui aparece na vitrine do site.' : 'Publique um produto ou serviço seu na vitrine do site com o seu nome.'}
      tamanho="lg"
      rodape={
        <>
          <Button onClick={onFechar} disabled={salvar.isPending}>Cancelar</Button>
          <Button variante="primario" icone={<Megaphone className="h-4 w-4" />} carregando={salvar.isPending} onClick={enviar}>
            {editando ? 'Salvar anúncio' : 'Publicar anúncio'}
          </Button>
        </>
      }
    >
      {semCadastro ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <p className="font-semibold">Falta ligar o seu usuário a um cadastro de vendedor ou de técnico.</p>
          <p className="mt-1">
            É esse cadastro que diz quem recebe o pagamento extra do anúncio. Peça ao administrador para ligar o seu usuário em Cadastros → Vendedores ou Técnicos.
          </p>
          <Link to={semCadastro} className="mt-3 inline-flex font-medium underline" onClick={onFechar}>
            Abrir a tela de usuários
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {pct != null && (
            <div className="flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-3">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
                <Megaphone className="h-4 w-4" />
              </span>
              <div className="min-w-0 text-sm text-emerald-900">
                <p className="font-semibold">{frasePercentual(pct)}</p>
                <p className="text-xs text-emerald-800">
                  O percentual fica gravado no anúncio: se a regra da loja mudar depois, este anúncio continua pagando os {pct}% combinados.
                </p>
              </div>
            </div>
          )}

          {!editando && (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-slate-600">O que você está anunciando</span>
              <Segmentado
                valor={f.tipo}
                onMudar={(v) => set('tipo', v)}
                opcoes={[
                  { valor: 'SERVICO', rotulo: 'Serviço' },
                  { valor: 'PRODUTO', rotulo: 'Produto' },
                ]}
              />
              <span className="text-xs text-slate-400">
                {servico ? 'Serviço não controla estoque (conserto, instalação, manutenção).' : 'Produto entra no estoque, como qualquer item da loja.'}
              </span>
            </div>
          )}

          <Input
            label="Título do anúncio"
            obrigatorio
            value={f.titulo}
            erro={erros.titulo}
            onChange={(e) => set('titulo', e.target.value)}
            placeholder={servico ? 'Ex.: Troca de tela de iPhone com garantia' : 'Ex.: Notebook Dell i5 8GB revisado'}
            ajuda="É o que o cliente lê primeiro na vitrine."
          />

          <Textarea
            label="Descrição"
            rows={3}
            value={f.descricao}
            onChange={(e) => set('descricao', e.target.value)}
            placeholder={servico ? 'O que está incluído, o que o cliente precisa trazer, o que é cobrado à parte…' : 'Estado, acessórios que vão junto, detalhes que valorizam…'}
          />

          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-3">
            <Input
              className="min-w-0 flex-1"
              label="Foto (link da imagem)"
              value={f.fotos}
              onChange={(e) => set('fotos', e.target.value)}
              placeholder="https://…/foto.jpg"
              ajuda="Cole o endereço da imagem. Para várias fotos, separe por vírgula."
            />
            <div className="flex items-center gap-2 pt-1 sm:pt-5">
              {previa ? <FotoProduto url={previa} tamanho="md" alt="Prévia da foto" /> : (
                <span className="flex h-12 w-12 items-center justify-center rounded-md border border-dashed border-slate-200 bg-slate-50 text-slate-300">
                  <ImageOff className="h-4 w-4" />
                </span>
              )}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <MoneyInput label="Preço de venda" obrigatorio value={f.preco} erro={erros.preco} onChange={(v) => set('preco', v)} ajuda="O que o cliente paga." />
            {/* custo: entra na conta do lucro, então fica escondido com olhinho (o cliente vê a tela no balcão) */}
            <MoneyInput label="Custo" oculto value={f.precoCusto} onChange={(v) => set('precoCusto', v)} ajuda="Peça, produto ou o que você paga. Sem ele o lucro sai errado." />
            <MoneyInput label="A partir de" value={f.precoAPartirDe} onChange={(v) => set('precoAPartirDe', v)} ajuda={servico ? 'Serviço sem preço fechado: a vitrine mostra “a partir de”.' : 'Opcional.'} />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Input
              label="Prazo de execução (dias)"
              type="number"
              min={0}
              max={365}
              value={f.prazoDias}
              erro={erros.prazoDias}
              onChange={(e) => set('prazoDias', e.target.value)}
              ajuda="Aparece na vitrine. Em branco = não mostra."
            />
            {!editando && (
              <Input
                label="Garantia (dias)"
                type="number"
                min={0}
                max={3650}
                value={f.garantiaDias}
                onChange={(e) => set('garantiaDias', e.target.value)}
                ajuda="Padrão da loja: 90 dias."
              />
            )}
            <div className="flex items-end pb-1">
              <Switch checked={f.naVitrine} onChange={(v) => set('naVitrine', v)} label={f.naVitrine ? 'Aparecendo na vitrine do site' : 'Fora da vitrine (só você vê)'} />
            </div>
          </div>

          {editando && (
            <p className="text-xs text-slate-400">
              Garantia de {f.garantiaDias} dia(s), definida na criação. Para mudar, altere o produto em Estoque → Produtos.
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
