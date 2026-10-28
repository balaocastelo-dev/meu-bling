/**
 * IMPRIMIR A VENDA — o funcionário escolhe o documento:
 *   Recibo 80mm  → cupom da impressora térmica (o kit de garantia em A4 sai num segundo clique)
 *   Recibo A4    → recibo completo + certificados de garantia + termo + folha de licenças
 *   NF A4        → emite a NF-e (se o robô diz "Pronto pra NF") e abre o DANFE A4 + kit de garantia
 * Sempre pela tela de impressão do navegador ("Salvar como PDF" também funciona).
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Award, FileText, Printer, Receipt, ScrollText } from 'lucide-react';
import { abrirEmNovaAba, api, mensagemErro } from '@/lib/api';
import { Button, ConfirmDialog, MenuAcoes } from '@/components/ui';
import type { EstadoRoboNf } from './RoboNf';

interface Resumo {
  certificados: { descricao: string; tipo: string }[];
  temKit: boolean;
  temLicenca: boolean;
  nota: { id: number; numero: number; situacao: string } | null;
}

export function ImprimirVenda({ vendaId, orcamento, aoImprimirPedido }: { vendaId: number; orcamento?: boolean; aoImprimirPedido: () => void }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [confirmarNf, setConfirmarNf] = useState(false);
  const [emitindo, setEmitindo] = useState(false);

  const abrir = (formato: 'cupom' | 'a4' | 'garantia') => abrirEmNovaAba(`/vendas/${vendaId}/documentos`, { formato });
  const resumo = () => api.get<Resumo>(`/vendas/${vendaId}/documentos/resumo`);

  /** 80mm e NF: o kit de garantia vai para a impressora A4 → oferece num segundo clique (o navegador bloqueia 2 abas de uma vez) */
  const oferecerKit = (r: Resumo) => {
    if (!r.temKit) return;
    toast('Certificado de garantia', {
      description: `${r.certificados.length} certificado${r.certificados.length > 1 ? 's' : ''} + termo${r.temLicenca ? ' + folha de licenças' : ''} para imprimir em A4.`,
      duration: 30_000,
      action: { label: 'Imprimir A4', onClick: () => abrir('garantia').catch((e) => toast.error(mensagemErro(e))) },
    });
  };

  const cupom = async () => {
    try {
      await abrir('cupom');
      oferecerKit(await resumo());
    } catch (e) {
      toast.error(mensagemErro(e));
    }
  };

  const a4 = () => abrir('a4').catch((e) => toast.error(mensagemErro(e)));

  const nfA4 = async () => {
    try {
      const r = await resumo();
      if (r.nota?.situacao === 'AUTORIZADA') {
        await abrirEmNovaAba(`/notas-fiscais/${r.nota.id}/danfe`);
        oferecerKit(r);
        return;
      }
      const e = await api.get<EstadoRoboNf>(`/vendas/${vendaId}/robo-nf`);
      if (e.status === 'PRONTA') setConfirmarNf(true);
      else if (r.nota) {
        toast.error(`A NF-e nº ${r.nota.numero} está ${r.nota.situacao.toLowerCase()}.`, { description: 'Abra a nota para ver o que a SEFAZ pediu.', action: { label: 'Abrir nota', onClick: () => nav(`/notas-fiscais/${r.nota!.id}`) } });
      } else toast.error(`A NF ainda não está pronta: ${e.resumo.toLowerCase()}.`, { description: 'Clique no botão amarelo do robô de NF no topo da venda para ver o que falta.' });
    } catch (e) {
      toast.error(mensagemErro(e));
    }
  };

  const emitirEImprimir = async () => {
    setEmitindo(true);
    try {
      const r = await api.post<{ notaId: number; numero: number; situacao: string; motivo?: string | null }>(`/vendas/${vendaId}/emitir-nf`, {});
      qc.invalidateQueries({ queryKey: ['venda', String(vendaId)] });
      qc.invalidateQueries({ queryKey: ['robo-nf', vendaId] });
      if (r.situacao !== 'AUTORIZADA') {
        toast.error(`NF-e nº ${r.numero}: ${r.situacao.toLowerCase()}`, { description: r.motivo || 'Abra a nota para ver o que a SEFAZ pediu.' });
        nav(`/notas-fiscais/${r.notaId}`);
        return;
      }
      toast.success(`NF-e nº ${r.numero} autorizada.`);
      await abrirEmNovaAba(`/notas-fiscais/${r.notaId}/danfe`);
      oferecerKit(await resumo());
    } catch (e) {
      toast.error(mensagemErro(e));
    } finally {
      setEmitindo(false);
      setConfirmarNf(false);
    }
  };

  if (orcamento) {
    return (
      <Button variante="secundario" icone={<Printer className="h-4 w-4" />} onClick={aoImprimirPedido}>
        Imprimir
      </Button>
    );
  }

  return (
    <>
      <MenuAcoes
        titulo="Imprimir"
        tamanho="md"
        gatilho={
          <>
            <Printer className="h-4 w-4" /> Imprimir
          </>
        }
        itens={[
          { rotulo: 'Recibo 80mm (térmica)', icone: <Receipt className="h-4 w-4" />, onClick: cupom },
          { rotulo: 'Recibo A4 + garantia', icone: <FileText className="h-4 w-4" />, onClick: a4 },
          { rotulo: 'NF A4 (DANFE) + garantia', icone: <ScrollText className="h-4 w-4" />, onClick: nfA4 },
          { rotulo: 'Só certificado e termo de garantia', icone: <Award className="h-4 w-4" />, onClick: () => abrir('garantia').catch((e) => toast.error(mensagemErro(e))), separar: true },
          { rotulo: 'Pedido de venda (modelo antigo)', icone: <Printer className="h-4 w-4" />, onClick: aoImprimirPedido },
        ]}
      />
      <ConfirmDialog
        aberto={confirmarNf}
        onFechar={() => setConfirmarNf(false)}
        titulo="Emitir a NF-e e imprimir?"
        descricao="O robô conferiu tudo. A NF-e vai para a SEFAZ e o DANFE em A4 abre para imprimir; depois o certificado de garantia."
        textoConfirmar={emitindo ? 'Emitindo…' : 'Emitir e imprimir'}
        perigo={false}
        onConfirmar={emitirEImprimir}
      />
    </>
  );
}
