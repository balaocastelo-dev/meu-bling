/**
 * Configurações → WhatsApp (só ADMIN): o QR Code principal da loja.
 *
 * O WhatsApp aceita uma sessão por número. Ligando o servidor Evolution, o CRM dos
 * vendedores, as mensagens automáticas, os orçamentos e a cobrança do JARVIS passam a
 * usar o mesmo número e o mesmo QR Code. Desligando, volta para a sessão própria do
 * sistema — sem mexer em código.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { LogOut, QrCode, Save, Server, Smartphone, Zap } from 'lucide-react';
import { api, mensagemErro } from '@/lib/api';
import { Badge, Button, FormSkeleton, Input, PageHeader, Secao, Switch, tomPorStatus } from '@/components/ui';
import { rotulo, telefone } from '@/lib/format';

interface ConfigEvolution {
  ligado: boolean;
  url: string;
  instancia: string;
  temChave: boolean;
  chaveMascarada: string | null;
  provedor: 'EVOLUTION' | 'BAILEYS';
}
interface EstadoWpp {
  status: string;
  numero?: string | null;
  nome?: string | null;
  qrDataUrl?: string | null;
  provedor?: string;
}

export default function ConfigWhatsapp() {
  const qc = useQueryClient();
  const { data: cfg, isLoading } = useQuery({
    queryKey: ['whatsapp-evolution'],
    queryFn: () => api.get<ConfigEvolution>('/whatsapp/evolution'),
    retry: 0,
  });
  const { data: estado } = useQuery({
    queryKey: ['whatsapp-status'],
    queryFn: () => api.get<EstadoWpp>('/whatsapp/status'),
    refetchInterval: 10_000,
    retry: 0,
  });
  const { data: instancias } = useQuery({
    queryKey: ['whatsapp-instancias'],
    queryFn: () => api.get<{ data: { nome: string; estado: string; numero: string | null }[] }>('/whatsapp/evolution/instancias'),
    enabled: !!cfg?.temChave,
    retry: 0,
  });

  const [form, setForm] = useState<(ConfigEvolution & { apiKey: string }) | null>(null);
  useEffect(() => {
    if (cfg && !form) setForm({ ...cfg, apiKey: '' });
  }, [cfg, form]);

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ['whatsapp-evolution'] });
    qc.invalidateQueries({ queryKey: ['whatsapp-status'] });
    qc.invalidateQueries({ queryKey: ['whatsapp-instancias'] });
  };

  const salvar = useMutation({
    mutationFn: () =>
      api.put('/whatsapp/evolution', {
        ligado: form?.ligado,
        url: form?.url,
        instancia: form?.instancia,
        apiKey: form?.apiKey || undefined,
      }),
    onSuccess: () => {
      toast.success('Configuração salva.');
      setForm((f) => (f ? { ...f, apiKey: '' } : f));
      invalidar();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const testar = useMutation({
    mutationFn: () =>
      api.post<{ ok: boolean; mensagem: string }>('/whatsapp/evolution/testar', {
        url: form?.url,
        apiKey: form?.apiKey || undefined,
        instancia: form?.instancia,
      }),
    onSuccess: (r) => (r.ok ? toast.success(r.mensagem) : toast.error(r.mensagem)),
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const conectar = useMutation({
    mutationFn: () => api.post<EstadoWpp>('/whatsapp/conectar'),
    onSuccess: () => {
      toast.info('Leia o QR Code com o celular da loja.');
      invalidar();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const desconectar = useMutation({
    mutationFn: () => api.post('/whatsapp/desconectar'),
    onSuccess: () => {
      toast.success('WhatsApp desconectado.');
      invalidar();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  if (isLoading || !form) return <FormSkeleton />;
  const set = (c: Partial<ConfigEvolution & { apiKey: string }>) => setForm((f) => (f ? { ...f, ...c } : f));
  const conectado = estado?.status === 'CONECTADO';
  const qr = (conectar.data as EstadoWpp | undefined)?.qrDataUrl;

  return (
    <>
      <PageHeader
        migalhas={[{ rotulo: 'Configurações', para: '/configuracoes' }, { rotulo: 'WhatsApp' }]}
        titulo="WhatsApp da loja"
        descricao="Um QR Code só para tudo: CRM dos vendedores, mensagens automáticas, orçamentos e as cobranças do JARVIS."
        extra={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tom={tomPorStatus(estado?.status ?? 'DESCONECTADO')} ponto>
              {rotulo(estado?.status ?? 'DESCONECTADO')}
            </Badge>
            <Badge tom={cfg?.provedor === 'EVOLUTION' ? 'azul' : 'cinza'}>
              {cfg?.provedor === 'EVOLUTION' ? 'Servidor Evolution' : 'Sessão do próprio sistema'}
            </Badge>
          </div>
        }
        acoes={
          <Button variante="primario" icone={<Save className="h-4 w-4" />} carregando={salvar.isPending} onClick={() => salvar.mutate()}>
            Salvar
          </Button>
        }
      />

      <Secao
        titulo="Servidor de WhatsApp (um QR Code para todos)"
        descricao="O WhatsApp aceita uma sessão por número. Com o servidor ligado, todos os sistemas da loja usam o mesmo número; desligado, o sistema abre a própria sessão e aí são dois QR Codes."
        acoes={<Switch checked={form.ligado} onChange={(v: boolean) => set({ ligado: v })} label="Usar o servidor" />}
      >
        <div className="grid gap-3 md:grid-cols-2">
          <Input
            label="Endereço do servidor"
            value={form.url}
            onChange={(e) => set({ url: e.target.value })}
            placeholder="http://evolution:8080"
            autoComplete="off"
          />
          <Input
            label="Instância (a conexão do número da loja)"
            value={form.instancia}
            onChange={(e) => set({ instancia: e.target.value })}
            placeholder="loja"
            autoComplete="off"
          />
          <Input
            label="Chave da API"
            type="password"
            value={form.apiKey}
            onChange={(e) => set({ apiKey: e.target.value })}
            placeholder={form.temChave ? `${form.chaveMascarada ?? '••••'} (cadastrada — preencha para trocar)` : 'apikey do servidor'}
            autoComplete="new-password"
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variante="secundario" icone={<Zap className="h-4 w-4" />} carregando={testar.isPending} onClick={() => testar.mutate()}>
            Testar conexão
          </Button>
          {(instancias?.data?.length ?? 0) > 0 && (
            <span className="text-xs text-slate-500">
              Instâncias no servidor:{' '}
              {instancias!.data.map((i) => `${i.nome} (${i.estado === 'open' ? 'conectada' : i.estado})`).join(' · ')}
            </span>
          )}
        </div>
      </Secao>

      <Secao
        titulo="Conexão do número"
        descricao={
          conectado
            ? 'O número da loja está conectado. Todas as mensagens do sistema saem por ele.'
            : 'Leia o QR Code com o celular da loja (WhatsApp → Aparelhos conectados).'
        }
        acoes={
          conectado ? (
            <Button
              variante="perigo"
              icone={<LogOut className="h-4 w-4" />}
              carregando={desconectar.isPending}
              onClick={() => {
                if (confirm('Desconectar o WhatsApp da loja? As mensagens param até reconectar.')) desconectar.mutate();
              }}
            >
              Desconectar
            </Button>
          ) : (
            <Button variante="primario" icone={<QrCode className="h-4 w-4" />} carregando={conectar.isPending} onClick={() => conectar.mutate()}>
              Gerar QR Code
            </Button>
          )
        }
      >
        {conectado ? (
          <div className="flex flex-wrap items-center gap-3 rounded-xl bg-emerald-50 p-4 ring-1 ring-emerald-200">
            <Smartphone className="h-8 w-8 text-emerald-600" />
            <div>
              <p className="font-medium text-emerald-900">
                {estado?.numero ? telefone(estado.numero) : 'Número conectado'}
              </p>
              <p className="text-sm text-emerald-700">
                {cfg?.provedor === 'EVOLUTION'
                  ? `Pelo servidor Evolution, instância "${form.instancia}" — o mesmo número do CRM e das automações.`
                  : 'Sessão do próprio sistema. Ligue o servidor acima para usar um QR Code só.'}
              </p>
            </div>
          </div>
        ) : qr ? (
          <div className="flex flex-col items-center gap-2 py-2">
            <img src={qr} alt="QR Code do WhatsApp" className="h-64 w-64 rounded-xl ring-1 ring-slate-200" />
            <p className="text-sm text-slate-500">WhatsApp do celular da loja → Aparelhos conectados → Conectar aparelho</p>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3 rounded-xl bg-slate-50 p-4 text-sm text-slate-600 ring-1 ring-slate-200">
            <Server className="h-6 w-6 text-slate-400" />
            Clique em "Gerar QR Code" para conectar o número da loja.
          </div>
        )}
      </Secao>
    </>
  );
}
