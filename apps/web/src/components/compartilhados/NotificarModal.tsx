import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Mail, MessageCircle, Paperclip } from 'lucide-react';
import { api, mensagemErro } from '@/lib/api';
import { Button, Checkbox, Modal, Segmentado, Select, Textarea } from '@/components/ui';
import type { CanalNotificacao, TemplateNotificacao } from '@/types';

interface Props {
  aberto: boolean;
  onFechar: () => void;
  /** /vendas/12 ou /ordens-servico/3 */
  caminho: string;
  /** evento principal dos templates (ex.: VENDA_SITUACAO, ORCAMENTO_VENDA) — vem pré-selecionado */
  eventoTemplate?: string;
  /** outros eventos cujos templates também aparecem na lista */
  eventosExtras?: string[];
  destinatarios?: { email?: string | null; celular?: string | null };
  /** canal que abre selecionado (menu "Enviar por e-mail" / "Enviar por WhatsApp") */
  canalInicial?: CanalNotificacao;
  /** mostra a opção de anexar o PDF do documento (pedido/orçamento) */
  permiteAnexo?: boolean;
  titulo?: string;
  /** chamado após enfileirar (ex.: invalidar a venda, que pode mudar de situação) */
  onEnviado?: () => void;
}

/** Modal para enviar WhatsApp/E-mail escolhendo template ou mensagem livre, com PDF opcional */
export function NotificarModal({ aberto, onFechar, caminho, eventoTemplate, eventosExtras, destinatarios, canalInicial, permiteAnexo, titulo, onEnviado }: Props) {
  const qc = useQueryClient();
  const [canal, setCanal] = useState<CanalNotificacao>(canalInicial ?? 'WHATSAPP');
  const [templateId, setTemplateId] = useState<number | ''>('');
  const [mensagem, setMensagem] = useState('');
  const [anexarPdf, setAnexarPdf] = useState(true);

  const { data: templates } = useQuery({
    queryKey: ['templates', canal],
    queryFn: () => api.get<TemplateNotificacao[]>('/templates-notificacao', { canal }).catch(() => [] as TemplateNotificacao[]),
    enabled: aberto,
  });

  const eventos = [eventoTemplate, ...(eventosExtras ?? [])].filter(Boolean) as string[];
  const lista = (templates ?? []).filter((t) => t.ativo && (!eventos.length || eventos.includes(t.evento)));

  useEffect(() => {
    if (aberto) {
      setCanal(canalInicial ?? 'WHATSAPP');
      setTemplateId('');
      setMensagem('');
      setAnexarPdf(true);
    }
  }, [aberto, canalInicial]);

  // pré-seleciona o template do evento principal (ex.: "Orçamento de venda") ao trocar de canal
  useEffect(() => {
    if (!aberto || !templates) return;
    const preferido = templates.find((t) => t.ativo && t.evento === eventoTemplate && !t.situacaoId);
    setTemplateId(preferido ? preferido.id : '');
  }, [aberto, templates, eventoTemplate]);

  const enviar = useMutation({
    mutationFn: () =>
      api.post(`${caminho}/notificar`, {
        canal,
        templateId: templateId === '' ? undefined : Number(templateId),
        mensagem: templateId === '' ? mensagem : undefined,
        anexarPdf: permiteAnexo ? anexarPdf : undefined,
      }),
    onSuccess: () => {
      toast.success(canal === 'EMAIL' ? 'E-mail na fila de envio.' : 'WhatsApp na fila de envio.', { description: 'Acompanhe em Comunicação → Notificações.' });
      qc.invalidateQueries({ queryKey: ['notificacoes'] });
      onEnviado?.();
      onFechar();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const semDestino = canal === 'WHATSAPP' ? !destinatarios?.celular : !destinatarios?.email;

  return (
    <Modal
      aberto={aberto}
      onFechar={onFechar}
      titulo={titulo ?? 'Enviar mensagem ao cliente'}
      rodape={
        <>
          <Button variante="secundario" onClick={onFechar}>
            Cancelar
          </Button>
          <Button variante="primario" carregando={enviar.isPending} disabled={(templateId === '' && !mensagem.trim()) || (semDestino && !!destinatarios)} onClick={() => enviar.mutate()}>
            Enviar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Segmentado
          valor={canal}
          onMudar={setCanal}
          opcoes={[
            { valor: 'WHATSAPP', rotulo: 'WhatsApp', icone: <MessageCircle className="h-3.5 w-3.5" /> },
            { valor: 'EMAIL', rotulo: 'E-mail', icone: <Mail className="h-3.5 w-3.5" /> },
          ]}
        />
        {destinatarios && (
          <p className="text-xs text-slate-500">
            Destinatário: <strong>{canal === 'WHATSAPP' ? destinatarios.celular || 'sem celular cadastrado' : destinatarios.email || 'sem e-mail cadastrado'}</strong>
          </p>
        )}
        {semDestino && destinatarios && <p className="rounded bg-amber-50 px-3 py-2 text-xs text-amber-700">O cliente não tem {canal === 'WHATSAPP' ? 'celular' : 'e-mail'} cadastrado. Edite o cadastro do cliente para poder enviar.</p>}
        <Select label="Template" value={templateId} onChange={(e) => setTemplateId(e.target.value ? Number(e.target.value) : '')} placeholder="Mensagem livre (digite abaixo)" opcoes={lista.map((t) => ({ valor: t.id, rotulo: t.nome }))} />
        {templateId === '' && <Textarea label="Mensagem" rows={5} value={mensagem} onChange={(e) => setMensagem(e.target.value)} placeholder="Olá {{cliente.primeiroNome}}, ..." ajuda="Você pode usar variáveis como {{cliente.nome}}, {{numero}}, {{total}}, {{validade}}, {{link}}." />}
        {permiteAnexo && (
          <div className="flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <Paperclip className="mt-0.5 h-4 w-4 text-slate-400" />
            <Checkbox
              label="Anexar o PDF"
              descricao={canal === 'EMAIL' ? 'Vai como anexo do e-mail.' : 'Vai como documento logo depois da mensagem.'}
              checked={anexarPdf}
              onChange={(e) => setAnexarPdf(e.target.checked)}
            />
          </div>
        )}
      </div>
    </Modal>
  );
}
