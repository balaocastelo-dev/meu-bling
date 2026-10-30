/**
 * O que um anúncio já rendeu, comissão por comissão.
 *
 * Mostra a conta inteira — lucro da venda × percentual = o que você recebe — para o pagamento
 * nunca virar discussão no fim do mês. O lucro aparece escondido com olhinho porque entrega o
 * custo da loja, e o cliente às vezes está olhando a tela.
 */
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { BadgePercent } from 'lucide-react';
import { api, mensagemErro } from '@/lib/api';
import { Badge, Button, EmptyState, Modal, Skeleton, ValorOculto, tomPorStatus } from '@/components/ui';
import { competenciaLabel, data, moeda, numero, rotulo } from '@/lib/format';
import type { Anuncio, ComissaoDoAnuncio, RetornoAnuncio } from './comum';

export function ComissoesAnuncio({ anuncio, onFechar }: { anuncio: Anuncio | null; onFechar: () => void }) {
  const { data: resp, isLoading, error } = useQuery({
    queryKey: ['anuncio-comissoes', anuncio?.id],
    enabled: !!anuncio,
    queryFn: () => api.get<{ data: ComissaoDoAnuncio[]; retorno: RetornoAnuncio }>(`/anuncios/${anuncio!.id}/comissoes`),
  });
  const r = resp?.retorno ?? anuncio?.retorno;

  return (
    <Modal
      aberto={!!anuncio}
      onFechar={onFechar}
      titulo={anuncio ? `Quanto rendeu — ${anuncio.titulo}` : 'Quanto rendeu'}
      descricao={anuncio ? `Você recebe ${anuncio.comissaoPct}% do lucro de cada venda deste anúncio.` : undefined}
      tamanho="lg"
      rodape={<Button onClick={onFechar}>Fechar</Button>}
    >
      {error ? (
        <EmptyState icone={<BadgePercent className="h-5 w-5" />} titulo="Não foi possível carregar" descricao={mensagemErro(error)} />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <Quadro rotuloTexto="Já rendeu" valor={moeda(r?.comissaoTotal)} tom="azul" />
            <Quadro rotuloTexto="A receber" valor={moeda(r?.comissaoAReceber)} tom={r && r.comissaoAReceber > 0 ? 'amarelo' : 'neutro'} />
            <Quadro rotuloTexto="Já pago" valor={moeda(r?.comissaoPaga)} tom="verde" />
            <Quadro rotuloTexto="Vendas pelo anúncio" valor={numero(r?.vendas ?? 0, 0)} tom="neutro" />
          </div>

          {isLoading ? (
            <Skeleton className="h-40" />
          ) : resp?.data.length ? (
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200/80">
              {resp.data.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5 text-sm">
                  <div className="min-w-0 flex-[1_1_14rem]">
                    <p className="truncate font-medium text-slate-800">{c.descricao}</p>
                    <p className="truncate text-xs text-slate-400">
                      {data(c.criadoEm)} · competência {competenciaLabel(c.competencia)}
                      {c.vendaId ? <> · <Link to={`/vendas/${c.vendaId}`} className="text-brand-600 hover:underline">venda</Link></> : null}
                      {c.osId ? <> · <Link to={`/ordens-servico/${c.osId}`} className="text-brand-600 hover:underline">OS</Link></> : null}
                    </p>
                  </div>
                  <span className="text-xs text-slate-500">
                    lucro <ValorOculto>{moeda(c.base)}</ValorOculto> × {numero(c.pct, 0)}%
                  </span>
                  <Badge tom={tomPorStatus(c.status)}>{rotulo(c.status)}</Badge>
                  <span className="num ml-auto shrink-0 font-semibold text-slate-900">{moeda(c.valor)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              compacto
              icone={<BadgePercent className="h-5 w-5" />}
              titulo="Este anúncio ainda não gerou pagamento"
              descricao="A comissão aparece aqui quando uma venda ou OS atribuída ao anúncio tem as contas lançadas. Lucro zero ou negativo não gera pagamento."
            />
          )}

          <p className="text-xs text-slate-400">
            O percentual incide sobre o lucro de verdade (receita − custo − imposto − taxa de cartão − frete), a mesma conta do dashboard da loja.
          </p>
        </div>
      )}
    </Modal>
  );
}

const TONS = {
  neutro: 'border-slate-200/80 bg-slate-50 text-slate-700',
  azul: 'border-blue-200 bg-blue-50 text-blue-700',
  verde: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  amarelo: 'border-amber-200 bg-amber-50 text-amber-700',
} as const;

function Quadro({ rotuloTexto, valor, tom }: { rotuloTexto: string; valor: string; tom: keyof typeof TONS }) {
  return (
    <div className={`min-w-0 rounded-xl border px-3 py-2 ${TONS[tom]}`}>
      <p className="truncate text-[11px] font-medium uppercase tracking-wide opacity-80">{rotuloTexto}</p>
      <p className="num truncate text-base font-bold">{valor}</p>
    </div>
  );
}
