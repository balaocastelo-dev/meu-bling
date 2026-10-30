import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check } from 'lucide-react';
import { api, mensagemErro } from '@/lib/api';
import { Button, Input, Modal } from '@/components/ui';

export interface InfoCanal {
  canal: string;
  rotulo: string;
  modo: 'api' | 'kit';
  observacao: string;
  link?: string;
  limiteTitulo?: number;
}

export interface Rascunho {
  titulo: string;
  descricao: string;
  porCanal: Record<string, string>;
  geradoPorIa: boolean;
  preco: number;
  fotos: string[];
  produtoId: number;
}

/** Canais marcados por padrão: os que funcionam sem depender de conexão externa. */
const PADRAO = ['SITE', 'OLX'];

/**
 * Monta o anúncio de um produto e cria nos canais escolhidos.
 * Usado na Central de Anúncios e no botão Anunciar do produto — um lugar só,
 * para as duas telas não divergirem com o tempo.
 */
export function AnunciarModal({
  produtoId,
  condicao,
  aberto,
  onFechar,
  onCriado,
}: {
  produtoId: number | null;
  condicao: 'novo' | 'usado';
  aberto: boolean;
  onFechar: () => void;
  onCriado?: (anuncioId: number) => void;
}) {
  const qc = useQueryClient();
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const [canaisSel, setCanaisSel] = useState<string[]>(PADRAO);

  const canais = useQuery({
    queryKey: ['jarvis-canais'],
    queryFn: () => api.get<InfoCanal[]>('/jarvis/anuncios/canais'),
    enabled: aberto,
  });

  const montar = useMutation({
    mutationFn: () => api.post<Rascunho>('/jarvis/anuncios/rascunho', { produtoId, condicao }),
    onSuccess: (r) => setRascunho(r),
    onError: (e) => { toast.error(mensagemErro(e)); onFechar(); },
  });

  // ao abrir, monta o texto; ao fechar, limpa para não reaproveitar o anúncio anterior
  useEffect(() => {
    if (aberto && produtoId && !rascunho && !montar.isPending) montar.mutate();
    if (!aberto && rascunho) { setRascunho(null); setCanaisSel(PADRAO); }
  }, [aberto, produtoId]); // eslint-disable-line react-hooks/exhaustive-deps

  const criar = useMutation({
    mutationFn: () => api.post<{ id: number }>('/jarvis/anuncios', {
      produtoId: rascunho?.produtoId,
      titulo: rascunho?.titulo,
      descricao: rascunho?.descricao,
      preco: rascunho?.preco,
      condicao,
      fotos: rascunho?.fotos ?? [],
      canais: canaisSel,
      porCanal: rascunho?.porCanal,
      geradoPorIa: rascunho?.geradoPorIa,
    }),
    onSuccess: (r) => {
      toast.success('Anúncio criado.');
      qc.invalidateQueries({ queryKey: ['jarvis-anuncios'] });
      onFechar();
      onCriado?.(r.id);
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const semFoto = !!rascunho && rascunho.fotos.length === 0;
  const mlMarcado = canaisSel.includes('MERCADO_LIVRE');

  return (
    <Modal
      aberto={aberto}
      onFechar={onFechar}
      titulo="Anunciar"
      tamanho="lg"
      descricao={
        montar.isPending
          ? 'Montando o anúncio…'
          : rascunho?.geradoPorIa
            ? 'Texto escrito pela IA a partir dos dados do produto. Leia antes de publicar.'
            : 'A IA não está configurada, então este é o texto padrão. Dá para editar aqui mesmo.'
      }
      rodape={
        <>
          <Button variante="secundario" onClick={onFechar}>Cancelar</Button>
          <Button
            variante="primario"
            carregando={criar.isPending}
            disabled={!rascunho || !canaisSel.length}
            onClick={() => criar.mutate()}
          >
            Criar anúncio
          </Button>
        </>
      }
    >
      {montar.isPending || !rascunho ? (
        <p className="py-8 text-center text-sm text-slate-500">Montando o texto do anúncio…</p>
      ) : (
        <div className="space-y-3">
          <Input label="Título" value={rascunho.titulo} onChange={(e) => setRascunho({ ...rascunho, titulo: e.target.value })} />
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Descrição</label>
            <textarea
              className="h-40 w-full rounded-lg border border-slate-300 p-3 text-sm"
              value={rascunho.descricao}
              onChange={(e) => setRascunho({ ...rascunho, descricao: e.target.value })}
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">Onde publicar</label>
            <div className="flex flex-wrap gap-2">
              {canais.data?.map((c) => {
                const marcado = canaisSel.includes(c.canal);
                const estoura = !!c.limiteTitulo && rascunho.titulo.length > c.limiteTitulo;
                return (
                  <button
                    key={c.canal}
                    type="button"
                    onClick={() => setCanaisSel((s) => (marcado ? s.filter((x) => x !== c.canal) : [...s, c.canal]))}
                    className={`rounded-lg border px-3 py-1.5 text-sm ${marcado ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-300 text-slate-600'}`}
                  >
                    {marcado ? <Check className="mr-1 inline h-3.5 w-3.5" /> : null}
                    {c.rotulo}
                    {estoura ? <span className="ml-1 text-xs text-amber-600">título passa de {c.limiteTitulo}</span> : null}
                  </button>
                );
              })}
            </div>
          </div>

          {/* o Mercado Livre recusa anúncio sem foto: melhor avisar aqui do que depois do erro */}
          {semFoto && mlMarcado ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
              Este produto não tem foto cadastrada, e o Mercado Livre não aceita anúncio sem imagem. Os outros canais funcionam.
            </p>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
