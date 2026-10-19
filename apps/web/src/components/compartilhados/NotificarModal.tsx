import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Mail, MessageCircle } from 'lucide-react';
import { api, mensagemErro } from '@/lib/api';
import { Button, Modal, Segmentado, Select, Textarea } from '@/components/ui';
import type { CanalNotificacao, TemplateNotificacao } from '@/types';

interface Props {
  aberto: boolean;
  onFechar: () => void;
  /** /vendas/12 ou /ordens-servico/3 */
  caminho: string;
  /** VENDA_SITUACAO | OS_SITUACAO ... para filtrar templates */
  eventoTemplate?: string;
  destinatarios?: { email?: string | null; celular?: string | null };
}

/** Modal para enviar WhatsApp/E-mail escolhendo template ou mensagem livre */
export function NotificarModal({ aberto, onFechar, caminho, eventoTemplate, destinatarios }: Props) {
  const qc = useQueryClient();
  const [canal, setCanal] = useState<CanalNotificacao>('WHATSAPP');
  const [templateId, setTemplateId] = useState<number | ''>('');
  const [mensagem, setMensagem] = useState('');

  const { data: templates } = useQuery({
    queryKey: ['templates', canal],
    queryFn: () => api.get<TemplateNotificacao[]>('/templates-notificacao', { canal }).catch(() => [] as TemplateNotificacao[]),
    enabled: aberto,
  });

  useEffect(() => {
    if (aberto) {
      setTemplateId('');
      setMensagem('');
    }
  }, [aberto]);

  const enviar = useMutation({
    mutationFn: () => api.post(`${caminho}/notificar`, { canal, templateId: templateId === '' ? undefined : Number(templateId), mensagem: templateId === '' ? mensagem : undefined }),
    onSuccess: () => {
      toast.success('Notificação enfileirada para envio.');
      qc.invalidateQueries({ queryKey: ['notificacoes'] });
      onFechar();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const semDestino = canal === 'WHATSAPP' ? !destinatarios?.celular : !destinatarios?.email;
  const lista = (templates ?? []).filter((t) => t.ativo && (!eventoTemplate || t.evento === eventoTemplate || t.evento.endsWith('_SITUACAO') === false));

  return (
    <Modal
      aberto={aberto}
      onFechar={onFechar}
      titulo="Enviar mensagem ao cliente"
      rodape={
        <>
          <Button variante="secundario" onClick={onFechar}>
            Cancelar
          </Button>
          <Button variante="primario" carregando={enviar.isPending} disabled={templateId === '' && !mensagem.trim()} onClick={() => enviar.mutate()}>
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
        {semDestino && destinatarios && <p className="rounded bg-amber-50 px-3 py-2 text-xs text-amber-700">O contato não tem {canal === 'WHATSAPP' ? 'celular' : 'e-mail'} cadastrado — a notificação será criada como cancelada.</p>}
        <Select label="Template" value={templateId} onChange={(e) => setTemplateId(e.target.value ? Number(e.target.value) : '')} placeholder="Mensagem livre (digite abaixo)" opcoes={lista.map((t) => ({ valor: t.id, rotulo: t.nome }))} />
        {templateId === '' && <Textarea label="Mensagem" rows={5} value={mensagem} onChange={(e) => setMensagem(e.target.value)} placeholder="Olá {{cliente.primeiroNome}}, ..." ajuda="Você pode usar variáveis como {{cliente.nome}}, {{numero}}, {{total}}, {{link}}." />}
      </div>
    </Modal>
  );
}
