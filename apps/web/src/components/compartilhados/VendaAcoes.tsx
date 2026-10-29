/**
 * Ações de um pedido de venda / orçamento — o menu "⋯" da lista e do detalhe.
 * Imprimir, PDF, e-mail, WhatsApp, NF-e, clonar, transferir vendedor, cancelar, excluir;
 * no orçamento: aprovar, converter em venda e copiar o link de aprovação do cliente.
 */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Ban,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Link2,
  Mail,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Printer,
  ShoppingCart,
  Trash2,
  UserRoundCog,
} from 'lucide-react';
import { abrirEmNovaAba, api, mensagemErro } from '@/lib/api';
import { moeda } from '@/lib/format';
import { useAuth } from '@/stores/auth';
import { useSituacoes, useVendedores, opcoesDe } from '@/hooks/useListas';
import { Button, ConfirmDialog, MenuAcoes, Modal, Select, Textarea, type ItemMenu } from '@/components/ui';
import { NotificarModal } from './NotificarModal';
import { EmitirNfModal } from './EmitirNfModal';
import { FinalizarVendaModal } from './FinalizarVenda';
import type { CanalNotificacao, Venda, VendaResumo } from '@/types';

type CompraDesfeita = { compraId: number; numero: number; desfeita: boolean; motivo?: string; devolvido: { contaFinanceiraId: number; valor: number }[] };

type VendaAlvo = Pick<VendaResumo, 'id' | 'tipo' | 'numero' | 'situacao' | 'nota' | 'estoqueLancado' | 'contasLancadas' | 'vendedorId' | 'vendaGerada' | 'aprovadoEm'> & {
  contato?: { nome?: string; email?: string | null; celular?: string | null } | null;
  vendedor?: { id: number; nome: string } | null;
};

/** caminho base da tela conforme o tipo */
export const rotaDe = (tipo: string | undefined) => (tipo === 'ORCAMENTO' ? '/orcamentos' : '/vendas');

interface Props {
  venda: VendaAlvo;
  /** na lista mostra "Abrir"; no detalhe o botão vira "Mais ações" */
  contexto?: 'lista' | 'detalhe';
}

export function VendaAcoes({ venda, contexto = 'lista' }: Props) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const usuario = useAuth((s) => s.usuario);
  const gestao = usuario?.perfil === 'ADMIN' || usuario?.perfil === 'GERENTE';
  const orcamento = venda.tipo === 'ORCAMENTO';
  const rotulo = orcamento ? 'orçamento' : 'venda';
  const base = rotaDe(venda.tipo);
  const { data: situacoes } = useSituacoes(orcamento ? 'ORCAMENTO' : 'VENDA');
  const { data: vendedores } = useVendedores();

  const [enviar, setEnviar] = useState<CanalNotificacao | null>(null);
  const [nfe, setNfe] = useState<{ modelo: 55 | 65; info: string } | null>(null);
  const [transferir, setTransferir] = useState<{ vendedorId: number | null; observacao: string } | null>(null);
  const [cancelar, setCancelar] = useState(false);
  const [excluir, setExcluir] = useState(false);
  const [converter, setConverter] = useState(false);
  const [finalizar, setFinalizar] = useState(false);

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ['vendas'] });
    qc.invalidateQueries({ queryKey: ['venda', String(venda.id)] });
    qc.invalidateQueries({ queryKey: ['dashboard-geral'] });
  };
  const erro = (e: unknown) => toast.error(mensagemErro(e));
  /** aviso sobre a compra registrada ao finalizar a venda (desfeita junto com o cancelamento/exclusão, ou mantida) */
  const avisarCompra = (c: CompraDesfeita | null | undefined) => {
    if (!c) return;
    if (c.desfeita) {
      const devolvido = c.devolvido.reduce((s, d) => s + d.valor, 0);
      toast.info(`A compra nº ${c.numero}, registrada ao finalizar esta venda, foi desfeita${devolvido > 0 ? `: ${moeda(devolvido)} voltaram para o banco` : ''}.`, { duration: 8000 });
    } else {
      toast.warning(`A compra nº ${c.numero} (registrada ao finalizar) foi mantida: ${c.motivo}.`, { duration: 10000 });
    }
  };

  const clonar = useMutation({
    mutationFn: () => api.post<Venda>(`/vendas/${venda.id}/duplicar`),
    onSuccess: (v) => {
      toast.success(`${orcamento ? 'Orçamento' : 'Venda'} clonado: nº ${v.numero}`, { description: 'Revise e salve as alterações.' });
      invalidar();
      nav(`${base}/${v.id}/editar`);
    },
    onError: erro,
  });


  const transferirM = useMutation({
    mutationFn: (p: { vendedorId: number | null; observacao?: string }) => api.post<{ alterado: boolean }>(`/vendas/${venda.id}/transferir-vendedor`, p),
    onSuccess: (r, p) => {
      const nome = vendedores?.find((v) => v.id === p.vendedorId)?.nome ?? 'sem vendedor';
      toast.success(r.alterado ? `${orcamento ? 'Orçamento' : 'Venda'} nº ${venda.numero} transferido para ${nome}.` : 'O vendedor já era esse.');
      invalidar();
      qc.invalidateQueries({ queryKey: ['comissoes'] });
      setTransferir(null);
    },
    onError: erro,
  });

  const aprovar = useMutation({
    mutationFn: () => api.post(`/vendas/${venda.id}/aprovar`, {}),
    onSuccess: () => {
      toast.success(`Orçamento nº ${venda.numero} marcado como aprovado.`);
      invalidar();
    },
    onError: erro,
  });

  const converterM = useMutation({
    mutationFn: () => api.post<Venda>(`/vendas/${venda.id}/converter`, {}),
    onSuccess: (v) => {
      toast.success(`Orçamento nº ${venda.numero} virou a venda nº ${v.numero}.`);
      invalidar();
      setConverter(false);
      nav(`/vendas/${v.id}`);
    },
    onError: erro,
  });

  const imprimir = async () => {
    try {
      await abrirEmNovaAba(`/vendas/${venda.id}/imprimir`);
    } catch (e) {
      erro(e);
    }
  };

  const baixarPdf = async () => {
    try {
      const { blob, nome } = await api.blob(`/vendas/${venda.id}/pdf`, { download: 1 });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = nome || `${orcamento ? 'Orcamento' : 'Pedido'}-${venda.numero}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (e) {
      erro(e);
    }
  };

  const copiarLink = async () => {
    try {
      const v = await api.get<Venda>(`/vendas/${venda.id}`);
      if (!v.linkPublico) throw new Error('Link indisponível.');
      await navigator.clipboard.writeText(v.linkPublico);
      toast.success('Link copiado.', { description: 'O cliente vê o orçamento e aprova por ele, sem precisar de login.' });
    } catch (e) {
      erro(e);
    }
  };

  // situação de cancelamento do módulo: "Cancelado" (venda) / "Reprovado" (orçamento)
  const sitCancelar = (situacoes ?? []).find((s) => s.cancelamento && s.ativo && (orcamento ? s.nome === 'Reprovado' : s.nome === 'Cancelada' || s.nome === 'Cancelado')) ?? (situacoes ?? []).find((s) => s.cancelamento && s.ativo);
  const jaCancelada = !!(venda.situacao as { cancelamento?: boolean }).cancelamento;
  const notaAtiva = venda.nota && !['CANCELADA', 'INUTILIZADA', 'DENEGADA'].includes(venda.nota.situacao);
  const podeExcluir = gestao && !venda.estoqueLancado && !venda.contasLancadas && !(venda.nota && venda.nota.situacao === 'AUTORIZADA');
  const podeTransferir = gestao || !venda.vendedorId || venda.vendedorId === usuario?.vendedorId;
  const convertido = !!venda.vendaGerada;

  const itens: ItemMenu[] = [
    { rotulo: `Abrir ${rotulo}`, icone: <ExternalLink className="h-4 w-4" />, onClick: () => nav(`${base}/${venda.id}`), oculto: contexto !== 'lista' },
    { rotulo: 'Editar', icone: <Pencil className="h-4 w-4" />, onClick: () => nav(`${base}/${venda.id}/editar`), oculto: contexto !== 'lista' || convertido },
    // ---- documento
    { rotulo: 'Imprimir', icone: <Printer className="h-4 w-4" />, onClick: imprimir, separar: true },
    { rotulo: 'Baixar PDF', icone: <Download className="h-4 w-4" />, onClick: baixarPdf },
    { rotulo: 'Enviar por e-mail', icone: <Mail className="h-4 w-4" />, onClick: () => setEnviar('EMAIL') },
    { rotulo: 'Enviar por WhatsApp', icone: <MessageCircle className="h-4 w-4" />, onClick: () => setEnviar('WHATSAPP') },
    { rotulo: 'Copiar link de aprovação', icone: <Link2 className="h-4 w-4" />, onClick: copiarLink, oculto: !orcamento },
    // ---- orçamento
    { rotulo: 'Converter em venda', icone: <ShoppingCart className="h-4 w-4" />, onClick: () => setConverter(true), oculto: !orcamento || convertido, desabilitado: jaCancelada, dica: 'Reabra o orçamento antes de converter', separar: true },
    { rotulo: `Ver venda nº ${venda.vendaGerada?.numero ?? ''}`, icone: <ShoppingCart className="h-4 w-4" />, onClick: () => nav(`/vendas/${venda.vendaGerada?.id}`), oculto: !orcamento || !convertido, separar: true },
    { rotulo: 'Marcar como aprovado', icone: <CheckCircle2 className="h-4 w-4" />, onClick: () => aprovar.mutate(), oculto: !orcamento || convertido || !!venda.aprovadoEm || jaCancelada },
    // ---- venda
    { rotulo: 'Finalizar venda', icone: <CheckCircle2 className="h-4 w-4" />, onClick: () => setFinalizar(true), oculto: orcamento || (!!(venda.situacao as { final?: boolean }).final && !jaCancelada), separar: true },
    {
      rotulo: notaAtiva ? `Ver NF-e nº ${venda.nota?.numero}` : 'Emitir NF de venda',
      icone: <FileText className="h-4 w-4" />,
      onClick: () => (notaAtiva ? nav(`/notas-fiscais/${venda.nota!.id}`) : setNfe({ modelo: 55, info: '' })),
      oculto: orcamento,
      desabilitado: !notaAtiva && jaCancelada,
      dica: 'Venda cancelada',
      separar: true,
    },
    { rotulo: orcamento ? 'Clonar orçamento' : 'Clonar venda', icone: <Copy className="h-4 w-4" />, onClick: () => clonar.mutate(), desabilitado: clonar.isPending, separar: orcamento },
    {
      rotulo: 'Transferir para vendedor',
      icone: <UserRoundCog className="h-4 w-4" />,
      onClick: () => setTransferir({ vendedorId: venda.vendedorId ?? venda.vendedor?.id ?? null, observacao: '' }),
      desabilitado: !podeTransferir,
      dica: 'Você só pode transferir as suas próprias vendas',
    },
    // ---- perigosas
    {
      rotulo: orcamento ? 'Reprovar orçamento' : 'Cancelar venda',
      icone: <Ban className="h-4 w-4" />,
      onClick: () => setCancelar(true),
      perigo: true,
      separar: true,
      oculto: jaCancelada || convertido || !sitCancelar,
    },
    { rotulo: `Excluir ${rotulo}`, icone: <Trash2 className="h-4 w-4" />, onClick: () => setExcluir(true), perigo: true, oculto: !podeExcluir, separar: jaCancelada || convertido },
  ];

  return (
    <>
      <MenuAcoes
        itens={itens}
        titulo={`Ações ${orcamento ? "do orçamento" : "da venda"} nº ${venda.numero}`}
        tamanho={contexto === 'lista' ? 'sm' : 'md'}
        gatilho={contexto === 'detalhe' ? <><MoreHorizontal className="h-4 w-4" /> Mais ações</> : undefined}
      />

      <NotificarModal
        aberto={!!enviar}
        onFechar={() => setEnviar(null)}
        canalInicial={enviar ?? undefined}
        titulo={`Enviar ${rotulo} nº ${venda.numero}`}
        caminho={`/vendas/${venda.id}`}
        eventoTemplate={orcamento ? 'ORCAMENTO_VENDA' : 'VENDA_SITUACAO'}
        eventosExtras={orcamento ? [] : ['VENDA_CRIADA']}
        permiteAnexo
        destinatarios={{ email: venda.contato?.email, celular: venda.contato?.celular }}
        onEnviado={invalidar}
      />

      {!orcamento && <FinalizarVendaModal vendaId={venda.id} numero={venda.numero} aberto={finalizar} onFechar={() => setFinalizar(false)} />}

      <EmitirNfModal
        aberto={!!nfe}
        onFechar={() => setNfe(null)}
        origem="vendas"
        id={venda.id}
        numero={venda.numero}
        onGerada={(notaId) => {
          invalidar();
          setNfe(null);
          nav(`/notas-fiscais/${notaId}`);
        }}
      />

      <Modal
        aberto={!!transferir}
        onFechar={() => setTransferir(null)}
        titulo={`Transferir ${rotulo} nº ${venda.numero}`}
        descricao={venda.contasLancadas ? 'As contas já foram lançadas: a comissão pendente passa para o novo vendedor.' : 'A comissão será calculada para o novo vendedor.'}
        rodape={
          <>
            <Button variante="secundario" onClick={() => setTransferir(null)}>Cancelar</Button>
            <Button variante="primario" carregando={transferirM.isPending} onClick={() => transferir && transferirM.mutate({ vendedorId: transferir.vendedorId, observacao: transferir.observacao || undefined })}>Transferir</Button>
          </>
        }
      >
        {transferir && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">Vendedor atual: <strong>{venda.vendedor?.nome ?? vendedores?.find((v) => v.id === venda.vendedorId)?.nome ?? 'nenhum'}</strong></p>
            <Select label="Novo vendedor" value={transferir.vendedorId ?? ''} onChange={(e) => setTransferir({ ...transferir, vendedorId: e.target.value ? Number(e.target.value) : null })} opcoes={opcoesDe(vendedores)} placeholder="Sem vendedor" />
            <Textarea label="Motivo (opcional)" rows={2} value={transferir.observacao} onChange={(e) => setTransferir({ ...transferir, observacao: e.target.value })} />
          </div>
        )}
      </Modal>

      <ConfirmDialog
        aberto={cancelar}
        onFechar={() => setCancelar(false)}
        titulo={orcamento ? `Reprovar o orçamento nº ${venda.numero}?` : `Cancelar a venda nº ${venda.numero}?`}
        descricao={
          orcamento
            ? 'O orçamento vai para "Reprovado". Dá para reabrir depois mudando a situação.'
            : `A venda vai para "${sitCancelar?.nome ?? 'Cancelada'}": o estoque e as contas lançados são estornados, as reservas liberadas e a compra registrada ao finalizar (se houver) é desfeita, com o pagamento dela voltando para o banco.${notaAtiva ? ' A NF-e precisa ser cancelada à parte, na tela da nota.' : ''}`
        }
        textoConfirmar={orcamento ? 'Reprovar' : 'Cancelar venda'}
        onConfirmar={async () => {
          if (!sitCancelar) return;
          try {
            const r = await api.post<{ compra?: CompraDesfeita | null }>(`/vendas/${venda.id}/situacao`, { situacaoId: sitCancelar.id, observacao: orcamento ? 'Orçamento reprovado' : 'Venda cancelada' });
            toast.success(orcamento ? 'Orçamento reprovado.' : 'Venda cancelada.');
            avisarCompra(r.compra);
            invalidar();
          } catch (e) {
            erro(e);
          }
        }}
      />

      <ConfirmDialog
        aberto={converter}
        onFechar={() => setConverter(false)}
        titulo={`Converter o orçamento nº ${venda.numero} em venda?`}
        descricao="Cria um pedido de venda com os mesmos itens, valores e condições de pagamento. O orçamento fica como “Convertido em venda” e ligado ao pedido."
        textoConfirmar="Converter em venda"
        perigo={false}
        onConfirmar={() => converterM.mutateAsync().then(() => undefined).catch(() => undefined)}
      />

      <ConfirmDialog
        aberto={excluir}
        onFechar={() => setExcluir(false)}
        titulo={`Excluir ${rotulo} nº ${venda.numero}?`}
        descricao={orcamento ? 'O registro será removido permanentemente. Prefira reprovar se quiser manter o histórico.' : 'O registro será removido permanentemente, junto com a compra registrada ao finalizar a venda (se houver): o pagamento dela volta para o banco. Prefira cancelar se quiser manter o histórico.'}
        textoConfirmar="Excluir"
        onConfirmar={async () => {
          try {
            const r = await api.del<{ ok: boolean; compra?: CompraDesfeita | null }>(`/vendas/${venda.id}`);
            toast.success(`${orcamento ? 'Orçamento' : 'Venda'} excluído.`);
            avisarCompra(r?.compra);
            qc.invalidateQueries({ queryKey: ['vendas'] });
            qc.invalidateQueries({ queryKey: ['compras'] });
            if (contexto === 'detalhe') nav(base);
          } catch (e) {
            erro(e);
          }
        }}
      />
    </>
  );
}
