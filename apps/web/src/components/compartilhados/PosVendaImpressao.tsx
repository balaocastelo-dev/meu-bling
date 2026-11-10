/**
 * IMPRESSÃO LOGO DEPOIS DE FINALIZAR A VENDA (pedido do Thiago, 28/10/2026).
 *
 * Abre sozinha quando a venda vira "Fechada"/"NF emitida" — pelo botão Finalizar, pela troca de situação
 * ou ao salvar a venda já finalizada. Quando a venda tem aparelho com certificado (PC, PC Gamer,
 * Notebook, iPhone, Games), a opção principal já é "Recibo A4 + certificados": um clique e sai tudo.
 * (O navegador só deixa abrir a impressão depois de um clique, por isso é um aviso com botão.)
 *
 * PRAZO DA GARANTIA (pedido do Thiago, 10/11/2026): antes de sair o certificado, o vendedor
 * confirma aqui o prazo de cada aparelho — 3, 6 ou 12 meses. O sistema já vem com o prazo da
 * regra da loja marcado (12 meses novo / 3 meses seminovo); o vendedor só troca quando o
 * combinado com o cliente foi outro. A escolha é gravada no item da venda, então a 2ª via e o
 * recibo saem sempre com o mesmo prazo.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Award, FileText, Printer, Receipt, ShieldCheck } from 'lucide-react';
import { abrirEmNovaAba, api, mensagemErro } from '@/lib/api';
import { Button, Modal } from '@/components/ui';

interface Certificado {
  itemId: number;
  descricao: string;
  tipo: string;
  seminovo?: boolean;
  garantia: string;
  garantiaMeses: number | null;
  garantiaEscolhida: boolean;
  quantidade?: number;
}

interface Resumo {
  certificados: Certificado[];
  temKit: boolean;
  temLicenca: boolean;
}

const NOMES: Record<string, string> = { PC: 'PC', PC_GAMER: 'PC Gamer', NOTEBOOK: 'Notebook', IPHONE: 'iPhone', GAMES: 'Games' };
const PRAZOS = [3, 6, 12] as const;

export function PosVendaImpressao({ vendaId, numero, aberto, onFechar }: { vendaId: number; numero: number; aberto: boolean; onFechar: () => void }) {
  const qc = useQueryClient();
  const resumo = useQuery({
    queryKey: ['documentos-resumo', vendaId],
    queryFn: () => api.get<Resumo>(`/vendas/${vendaId}/documentos/resumo`),
    enabled: aberto,
    staleTime: 0,
  });
  const r = resumo.data;
  const qtdCert = r ? r.certificados.reduce((s, c) => s + Math.max(1, Math.min(Math.round(c.quantidade ?? 1), 10)), 0) : 0;

  /** prazo escolhido por item (itemId → meses), começando no que o sistema calculou */
  const [prazos, setPrazos] = useState<Record<number, number>>({});
  useEffect(() => {
    if (!r?.certificados.length) return;
    setPrazos(Object.fromEntries(r.certificados.map((c) => [c.itemId, PRAZOS.includes((c.garantiaMeses ?? 12) as 3 | 6 | 12) ? (c.garantiaMeses as number) : 12])));
  }, [r]);

  const gravarPrazos = useMutation({
    mutationFn: () => api.put(`/vendas/${vendaId}/documentos/garantia`, { itens: Object.entries(prazos).map(([itemId, meses]) => ({ itemId: Number(itemId), meses })) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['documentos-resumo', vendaId] });
      qc.invalidateQueries({ queryKey: ['venda', String(vendaId)] });
    },
  });

  const abrir = async (formato: 'cupom' | 'a4' | 'garantia') => {
    try {
      // grava o prazo antes de gerar o documento, para o certificado sair com o que está na tela
      if (r?.temKit && Object.keys(prazos).length) await gravarPrazos.mutateAsync();
      await abrirEmNovaAba(`/vendas/${vendaId}/documentos`, { formato });
      if (formato === 'cupom' && r?.temKit) {
        // a térmica não imprime A4: os certificados ficam a um clique
        toast('Certificados de garantia', {
          description: `${qtdCert} certificado${qtdCert > 1 ? 's' : ''} + termo${r.temLicenca ? ' + licenças' : ''} em A4.`,
          duration: 30_000,
          action: { label: 'Imprimir A4', onClick: () => abrirEmNovaAba(`/vendas/${vendaId}/documentos`, { formato: 'garantia' }).catch((e) => toast.error(mensagemErro(e))) },
        });
      }
      onFechar();
    } catch (e) {
      toast.error(mensagemErro(e));
    }
  };

  return (
    <Modal
      aberto={aberto}
      onFechar={onFechar}
      titulo={`Venda nº ${numero} finalizada`}
      descricao={r?.temKit ? 'Confirme a garantia e imprima os documentos do cliente.' : 'Imprima os documentos do cliente agora.'}
      rodape={
        <>
          <Button variante="secundario" onClick={onFechar}>
            Agora não
          </Button>
          <Button variante="secundario" icone={<Receipt className="h-4 w-4" />} onClick={() => abrir('cupom')}>
            Recibo 80mm
          </Button>
          <Button variante="sucesso" icone={<Printer className="h-4 w-4" />} carregando={resumo.isLoading || gravarPrazos.isPending} onClick={() => abrir('a4')}>
            {r?.temKit ? `Imprimir recibo A4 + ${qtdCert} certificado${qtdCert > 1 ? 's' : ''}` : 'Imprimir recibo A4'}
          </Button>
        </>
      }
    >
      {r?.temKit ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            <Award className="h-4 w-4 shrink-0 text-emerald-600" /> Confirme o prazo de garantia antes de imprimir o certificado:
          </div>

          <ul className="space-y-2">
            {r.certificados.map((c) => (
              <li key={c.itemId} className="rounded-lg border border-slate-200 p-2.5">
                <p className="text-sm text-slate-800">
                  <b>{NOMES[c.tipo] || c.tipo}</b> — {c.descricao}
                  {c.seminovo && <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-800">seminovo</span>}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                  <div className="inline-flex overflow-hidden rounded-lg border border-slate-300">
                    {PRAZOS.map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setPrazos((p) => ({ ...p, [c.itemId]: m }))}
                        className={
                          'px-3 py-1.5 text-xs font-medium transition ' +
                          (prazos[c.itemId] === m ? 'bg-emerald-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50') +
                          (m !== PRAZOS[0] ? ' border-l border-slate-300' : '')
                        }
                      >
                        {m} meses
                      </button>
                    ))}
                  </div>
                  {!c.garantiaEscolhida && prazos[c.itemId] === c.garantiaMeses && <span className="text-[11px] text-slate-400">padrão da loja</span>}
                </div>
              </li>
            ))}
          </ul>

          <p className="text-xs text-slate-500">
            Sai junto: recibo A4, {qtdCert > 1 ? 'os certificados' : 'o certificado'}, o termo de garantia{r.temLicenca ? ' e a folha das licenças Windows + Office' : ''}.
          </p>
        </div>
      ) : (
        <p className="flex items-center gap-2 text-sm text-slate-600">
          <FileText className="h-4 w-4" /> Recibo completo com a garantia de cada item.
        </p>
      )}
    </Modal>
  );
}
