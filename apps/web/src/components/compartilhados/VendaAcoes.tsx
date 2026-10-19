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
import { useAuth } from '@/stores/auth';
import { useSituacoes, useVendedores, opcoesDe } from '@/hooks/useListas';
import { Button, ConfirmDialog, MenuAcoes, Modal, Select, Textarea, type ItemMenu } from '@/components/ui';
import { NotificarModal } from './NotificarModal';
import type { CanalNotificacao, Venda, VendaResumo } from '@/types';

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

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ['vendas'] });
    qc.invalidateQueries({ queryKey: ['venda', String(venda.id)] });
    qc.invalidateQueries({ queryKey: ['dashboard-geral'] });
  };
  const erro = (e: unknown) => toast.error(mensagemErro(e));

  const clonar = useMutation({
    mutationFn: () => api.post<Venda>(`/vendas/${venda.id}/duplicar`),
    onSuccess: (v) => {
      toast.success(`${orcamento ? 'Orçamento' : 'Venda'} clonado: nº ${v.numero}`, { description: 'Revise e salve as alterações.' });
      invalidar();
      nav(`${base}/${v.id}/editar`);
    },
    onError: erro,
  });

  const gerarNfe = useMutation({
    mutationFn: (p: { modelo: 55 | 65; informacoesComplementares?: string }) => api.post<{ notaId: number }>(`/vendas/${venda.id}/gerar-nfe`, p),
    onSuccess: (r) => {
      toast.success('Nota fiscal gerada (pendente de transmissão).', { description: 'Confira e transmita na tela da nota.' });
      invalidar();
      setNfe(null);
      nav(`/notas-fiscais/${r.notaId}`);
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

      <Modal
        aberto={!!nfe}
        onFechar={() => setNfe(null)}
        titulo={`Emitir nota da venda nº ${venda.numero}`}
        descricao="A nota é criada como pendente; confira e transmita na tela da nota."
        rodape={
          <>
            <Button variante="secundario" onClick={() => setNfe(null)}>Cancelar</Button>
            <Button variante="primario" carregando={gerarNfe.isPending} onClick={() => nfe && gerarNfe.mutate({ modelo: nfe.modelo, informacoesComplementares: nfe.info || undefined })}>Gerar nota</Button>
          </>
        }
      >
        {nfe && (
          <div className="space-y-3">
            <Select label="Modelo" value={nfe.modelo} onChange={(e) => setNfe({ ...nfe, modelo: Number(e.target.value) as 55 | 65 })} opcoes={[{ valor: 55, rotulo: 'NF-e (modelo 55)' }, { valor: 65, rotulo: 'NFC-e (modelo 65 — consumidor)' }]} />
            <Textarea label="Informações complementares" value={nfe.info} onChange={(e) => setNfe({ ...nfe, info: e.target.value })} rows={3} />
          </div>
        )}
      </Modal>

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
            : `A venda vai para "${sitCancelar?.nome ?? 'Cancelada'}": o estoque e as contas lançados são estornados e as reservas liberadas.${notaAtiva ? ' A NF-e precisa ser cancelada à parte, na tela da nota.' : ''}`
        }
        textoConfirmar={orcamento ? 'Reprovar' : 'Cancelar venda'}
        onConfirmar={async () => {
          if (!sitCancelar) return;
          try {
            await api.post(`/vendas/${venda.id}/situacao`, { situacaoId: sitCancelar.id, observacao: orcamento ? 'Orçamento reprovado' : 'Venda cancelada' });
            toast.success(orcamento ? 'Orçamento reprovado.' : 'Venda cancelada.');
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
        descricao="O registro será removido permanentemente. Prefira cancelar se quiser manter o histórico."
        textoConfirmar="Excluir"
        onConfirmar={async () => {
          try {
            await api.del(`/vendas/${venda.id}`);
            toast.success(`${orcamento ? 'Orçamento' : 'Venda'} excluído.`);
            qc.invalidateQueries({ queryKey: ['vendas'] });
            if (contexto === 'detalhe') nav(base);
          } catch (e) {
            erro(e);
          }
        }}
      />
    </>
  );
}
