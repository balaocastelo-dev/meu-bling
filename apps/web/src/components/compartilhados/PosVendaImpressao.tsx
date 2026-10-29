/**
 * IMPRESSÃO LOGO DEPOIS DE FINALIZAR A VENDA (pedido do Thiago, 28/10/2026).
 *
 * Abre sozinha quando a venda vira "Fechada"/"NF emitida" — pelo botão Finalizar, pela troca de situação
 * ou ao salvar a venda já finalizada. Quando a venda tem aparelho com certificado (PC, PC Gamer,
 * Notebook, iPhone, Games), a opção principal já é "Recibo A4 + certificados": um clique e sai tudo.
 * (O navegador só deixa abrir a impressão depois de um clique, por isso é um aviso com botão.)
 */
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Award, FileText, Printer, Receipt } from 'lucide-react';
import { abrirEmNovaAba, api, mensagemErro } from '@/lib/api';
import { Button, Modal } from '@/components/ui';

interface Resumo {
  certificados: { descricao: string; tipo: string; quantidade?: number }[];
  temKit: boolean;
  temLicenca: boolean;
}

const NOMES: Record<string, string> = { PC: 'PC', PC_GAMER: 'PC Gamer', NOTEBOOK: 'Notebook', IPHONE: 'iPhone', GAMES: 'Games' };

export function PosVendaImpressao({ vendaId, numero, aberto, onFechar }: { vendaId: number; numero: number; aberto: boolean; onFechar: () => void }) {
  const resumo = useQuery({
    queryKey: ['documentos-resumo', vendaId],
    queryFn: () => api.get<Resumo>(`/vendas/${vendaId}/documentos/resumo`),
    enabled: aberto,
    staleTime: 0,
  });
  const r = resumo.data;
  const qtdCert = r ? r.certificados.reduce((s, c) => s + Math.max(1, Math.min(Math.round(c.quantidade ?? 1), 10)), 0) : 0;

  const abrir = async (formato: 'cupom' | 'a4' | 'garantia') => {
    try {
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
      descricao="Imprima os documentos do cliente agora."
      rodape={
        <>
          <Button variante="secundario" onClick={onFechar}>
            Agora não
          </Button>
          <Button variante="secundario" icone={<Receipt className="h-4 w-4" />} onClick={() => abrir('cupom')}>
            Recibo 80mm
          </Button>
          <Button variante="sucesso" icone={<Printer className="h-4 w-4" />} carregando={resumo.isLoading} onClick={() => abrir('a4')}>
            {r?.temKit ? `Imprimir recibo A4 + ${qtdCert} certificado${qtdCert > 1 ? 's' : ''}` : 'Imprimir recibo A4'}
          </Button>
        </>
      }
    >
      {r?.temKit ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            <Award className="h-4 w-4 text-emerald-600" /> Esta venda tem aparelho com certificado de garantia:
          </div>
          <ul className="space-y-1 pl-1 text-sm text-slate-700">
            {r.certificados.map((c, i) => (
              <li key={i}>
                • <b>{NOMES[c.tipo] || c.tipo}</b> — {c.descricao}
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
