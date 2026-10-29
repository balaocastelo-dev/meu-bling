import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import clsx from 'clsx';
import { Loader2, LogOut, MessageCircle, QrCode, RefreshCw, Send, Smartphone } from 'lucide-react';
import { api, mensagemErro } from '@/lib/api';
import { useWhatsappStatus } from '@/hooks/useEmpresa';
import { Badge, Button, Card, Input, PageHeader, Textarea, tomPorStatus } from '@/components/ui';
import { dataHora, rotulo, telefone } from '@/lib/format';

/** Conexão do WhatsApp via QR Code (Baileys) */
export default function Whatsapp() {
  const qc = useQueryClient();
  const { data: st, isLoading } = useWhatsappStatus(true);
  const [numero, setNumero] = useState('');
  const [mensagem, setMensagem] = useState('Olá! Teste de envio do MEU BLING — Balão da Informática.');

  const invalidar = () => qc.invalidateQueries({ queryKey: ['whatsapp-status'] });
  const conectar = useMutation({ mutationFn: () => api.post('/whatsapp/conectar'), onSuccess: () => { toast.info('Sessão iniciada. Escaneie o QR Code.'); invalidar(); }, onError: (e) => toast.error(mensagemErro(e)) });
  const desconectar = useMutation({ mutationFn: () => api.post('/whatsapp/desconectar'), onSuccess: () => { toast.success('WhatsApp desconectado.'); invalidar(); }, onError: (e) => toast.error(mensagemErro(e)) });
  const reconectar = useMutation({ mutationFn: () => api.post('/whatsapp/reconectar'), onSuccess: () => { toast.info('Sessão recriada. Escaneie o novo QR Code.'); invalidar(); }, onError: (e) => toast.error(mensagemErro(e)) });
  const teste = useMutation({ mutationFn: () => api.post('/whatsapp/enviar-teste', { numero: numero.replace(/\D/g, ''), mensagem }), onSuccess: () => toast.success('Mensagem de teste enviada.'), onError: (e) => toast.error(mensagemErro(e)) });

  const status = st?.status ?? 'DESCONECTADO';
  const conectado = status === 'CONECTADO';

  return (
    <div>
      <PageHeader
        titulo="WhatsApp"
        descricao="Conecte o número da loja escaneando o QR Code, como no WhatsApp Web. As notificações usam esta sessão."
        extra={<Badge tom={tomPorStatus(status)} ponto>{rotulo(status)}</Badge>}
        acoes={
          conectado ? (
            <>
              <Button variante="secundario" icone={<RefreshCw className="h-4 w-4" />} carregando={reconectar.isPending} onClick={() => { if (confirm('Apagar a sessão atual e gerar um QR Code novo? Use isto se as mensagens chegam como "Aguardando mensagem" no celular do cliente.')) reconectar.mutate(); }}>Reconectar do zero</Button>
              <Button variante="perigo" icone={<LogOut className="h-4 w-4" />} carregando={desconectar.isPending} onClick={() => { if (confirm('Desconectar e apagar a sessão do WhatsApp?')) desconectar.mutate(); }}>Desconectar</Button>
            </>
          ) : (
            <Button variante="primario" icone={<QrCode className="h-4 w-4" />} carregando={conectar.isPending || status === 'CONECTANDO'} onClick={() => conectar.mutate()}>{status === 'AGUARDANDO_QR' ? 'Gerar novo QR Code' : 'Conectar'}</Button>
          )
        }
      />

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card titulo="Sessão">
          <div className="flex flex-col items-center justify-center py-4 text-center">
            {isLoading ? (
              <Loader2 className="h-8 w-8 animate-spin text-slate-300" />
            ) : conectado ? (
              <>
                <span className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-50 text-emerald-600"><Smartphone className="h-10 w-10" /></span>
                <p className="mt-4 text-lg font-semibold text-slate-900">{st?.nome ?? 'Conectado'}</p>
                <p className="text-sm text-slate-500">{telefone(st?.numero) || st?.numero}</p>
                {st?.desde && <p className="mt-1 text-xs text-slate-400">desde {dataHora(st.desde)}</p>}
              </>
            ) : status === 'AGUARDANDO_QR' && st?.qrDataUrl ? (
              <>
                <div className="rounded-xl border-4 border-emerald-500 bg-white p-2 shadow-pop">
                  <img src={st.qrDataUrl} alt="QR Code do WhatsApp" className="h-72 w-72" />
                </div>
                <p className="mt-4 max-w-xs text-sm text-slate-600">
                  No celular: <strong>WhatsApp → Dispositivos conectados → Conectar dispositivo</strong> e aponte a câmera para o código.
                </p>
                <p className="mt-1 inline-flex items-center gap-1 text-xs text-slate-400"><Loader2 className="h-3 w-3 animate-spin" /> Atualizando a cada 3 segundos</p>
              </>
            ) : status === 'CONECTANDO' ? (
              <>
                <Loader2 className="h-10 w-10 animate-spin text-emerald-500" />
                <p className="mt-3 text-sm text-slate-500">Conectando…</p>
              </>
            ) : (
              <>
                <span className="flex h-20 w-20 items-center justify-center rounded-full bg-slate-100 text-slate-300"><MessageCircle className="h-10 w-10" /></span>
                <p className="mt-4 font-medium text-slate-700">WhatsApp desconectado</p>
                <p className="mt-1 max-w-xs text-sm text-slate-500">Clique em “Conectar” para gerar o QR Code. Use preferencialmente um chip dedicado da loja.</p>
              </>
            )}
          </div>
        </Card>

        <div className="space-y-4">
          <Card titulo="Enviar mensagem de teste" descricao="Confirme que a sessão está funcionando antes de ativar os templates.">
            <div className="space-y-3">
              <Input label="Número (com DDD)" placeholder="(19) 99999-9999" value={numero} onChange={(e) => setNumero(e.target.value)} inputMode="tel" />
              <Textarea label="Mensagem" rows={3} value={mensagem} onChange={(e) => setMensagem(e.target.value)} />
              <Button variante="sucesso" icone={<Send className="h-4 w-4" />} disabled={!conectado || numero.replace(/\D/g, '').length < 10} carregando={teste.isPending} onClick={() => teste.mutate()}>Enviar teste</Button>
            </div>
          </Card>
          <Card titulo="Como funciona">
            <ul className="space-y-2 text-sm text-slate-600">
              {[
                'A sessão fica salva no servidor (pasta storage/whatsapp) — não precisa escanear de novo a cada reinício.',
                'Templates com evento “mudança de situação” disparam automaticamente para o celular do cliente.',
                'Mensagens entram na fila de Notificações e são enviadas com intervalo para evitar bloqueios.',
                'Se o número for desconectado no celular, o status volta para “Desconectado” — reconecte por aqui.',
                'Se o cliente vê “Aguardando mensagem” ou as respostas dele não chegam, clique em “Reconectar do zero” e leia o novo QR Code.',
              ].map((t, i) => (
                <li key={i} className={clsx('flex gap-2')}><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />{t}</li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
