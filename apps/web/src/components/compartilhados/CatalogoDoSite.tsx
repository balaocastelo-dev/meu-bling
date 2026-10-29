/**
 * Faixa "Produtos do site" na lista de produtos: de onde vêm, quando foi a
 * última sincronização e os botões (sincronizar agora; desativar os que não são do site).
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Globe, RefreshCw } from 'lucide-react';
import { api, mensagemErro } from '@/lib/api';
import { Button, ConfirmDialog } from '@/components/ui';
import { dataHora, numero } from '@/lib/format';
import { useAuth } from '@/stores/auth';

interface EstadoCatalogo {
  rodando: boolean;
  url: string;
  intervaloMinutos: number;
  produtosDoSite: number;
  prontaEntrega: number;
  foraDoSite: { total: number; exemplos: { id: number; nome: string; codigo: string | null }[] };
  ligacaoPdv: boolean;
  ultimo: null | { fim: string; criados: number; atualizados: number; desativados: number; validos: number; erros: string[] };
  ultimoErro: null | { em: string; mensagem: string };
}

export function CatalogoDoSite() {
  const qc = useQueryClient();
  const perfil = useAuth((s) => s.usuario?.perfil);
  const gestao = perfil === 'ADMIN' || perfil === 'GERENTE';
  const [confirmar, setConfirmar] = useState(false);
  const { data: e } = useQuery({ queryKey: ['site-catalogo'], queryFn: () => api.get<EstadoCatalogo>('/site/catalogo'), refetchInterval: (q) => (q.state.data?.rodando ? 3000 : 60000) });

  const sincronizar = useMutation({
    mutationFn: () => api.post<{ criados: number; atualizados: number; desativados: number; erros: string[] }>('/site/catalogo/sincronizar'),
    onSuccess: (r) => {
      toast.success(`Produtos do site sincronizados: ${r.criados} novos, ${r.atualizados} atualizados${r.desativados ? `, ${r.desativados} saíram do site` : ''}.`);
      if (r.erros.length) toast.warning(r.erros[0]);
      qc.invalidateQueries({ queryKey: ['site-catalogo'] });
      qc.invalidateQueries({ queryKey: ['produtos'] });
    },
    onError: (err) => toast.error(mensagemErro(err)),
  });

  if (!e) return null;
  const quando = e.ultimo?.fim ? dataHora(e.ultimo.fim) : null;

  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-sky-200 bg-sky-50/60 px-4 py-3 text-sm">
      <Globe className="h-5 w-5 shrink-0 self-start text-sky-600" />
      <div className="min-w-0 flex-[1_1_16rem]">
        <p className="font-medium text-slate-900">
          Produtos do site www.balao.info: {numero(e.produtosDoSite)} ativos · {numero(e.prontaEntrega)} em pronta entrega
        </p>
        <p className="text-xs text-slate-500">
          {e.rodando
            ? 'Sincronizando agora…'
            : quando
              ? `Última sincronização ${quando} (automática a cada ${e.intervaloMinutos} min). Foto, preço e disponibilidade vêm do site; dados fiscais e estoque são do sistema.`
              : 'Ainda não sincronizou. A primeira volta roda 1 minuto depois do sistema subir.'}
          {e.ultimoErro && <span className="text-red-600"> Última tentativa falhou: {e.ultimoErro.mensagem}</span>}
        </p>
        {gestao && e.foraDoSite.total > 0 && (
          <p className="mt-1 text-xs text-amber-700">
            {e.foraDoSite.total === 1 ? '1 produto ativo não é do site (veio do Bling ou foi cadastrado à mão).' : `${numero(e.foraDoSite.total)} produtos ativos não são do site (vieram do Bling ou foram cadastrados à mão).`}
            {perfil === 'ADMIN' && (
              <button type="button" className="ml-1 font-medium underline hover:text-amber-900" onClick={() => setConfirmar(true)}>
                {e.foraDoSite.total === 1 ? 'Desativar' : 'Desativar esses'}
              </button>
            )}
          </p>
        )}
      </div>
      {gestao && (
        <Button tamanho="sm" variante="secundario" icone={<RefreshCw className={e.rodando || sincronizar.isPending ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />} disabled={e.rodando || sincronizar.isPending} onClick={() => sincronizar.mutate()}>
          Sincronizar agora
        </Button>
      )}
      <ConfirmDialog
        aberto={confirmar}
        onFechar={() => setConfirmar(false)}
        titulo="Desativar os produtos que não são do site?"
        descricao={`${numero(e.foraDoSite.total)} produtos saem da busca das vendas (ex.: ${e.foraDoSite.exemplos.slice(0, 3).map((x) => x.nome).join('; ')}). Continuam nas vendas antigas e podem ser reativados um a um. Serviços não são afetados.`}
        textoConfirmar="Desativar"
        onConfirmar={async () => {
          try {
            const r = await api.post<{ desativados: number }>('/site/catalogo/desativar-fora-do-site');
            toast.success(`${numero(r.desativados)} produtos desativados.`);
            qc.invalidateQueries({ queryKey: ['site-catalogo'] });
            qc.invalidateQueries({ queryKey: ['produtos'] });
          } catch (err) {
            toast.error(mensagemErro(err));
          }
        }}
      />
    </div>
  );
}
