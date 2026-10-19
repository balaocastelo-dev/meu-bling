import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { PlugZap, Save } from 'lucide-react';
import { api, mensagemErro, API_BASE } from '@/lib/api';
import { useEmpresa } from '@/hooks/useEmpresa';
import { Badge, Button, FormSkeleton, Input, PageHeader, Secao, Switch } from '@/components/ui';
import type { OpenFinanceStatus } from '@/types';

/** Credenciais do Open Finance (Pluggy) */
export default function OpenFinance() {
  const qc = useQueryClient();
  const { data: emp, isLoading } = useEmpresa();
  const [form, setForm] = useState<{ openFinanceClientId: string; openFinanceClientSecret: string; openFinanceAtivo: boolean } | null>(null);
  const { data: status } = useQuery({ queryKey: ['open-finance-status'], queryFn: () => api.get<OpenFinanceStatus>('/open-finance/status').catch(() => null) });

  useEffect(() => {
    if (emp && !form) setForm({ openFinanceClientId: emp.openFinance?.clientId ?? '', openFinanceClientSecret: '', openFinanceAtivo: emp.openFinance?.ativo ?? false });
  }, [emp, form]);

  const salvar = useMutation({
    mutationFn: () => api.put('/empresa', { ...form, openFinanceClientSecret: form?.openFinanceClientSecret || undefined }),
    onSuccess: () => {
      toast.success('Open Finance salvo.');
      qc.invalidateQueries({ queryKey: ['empresa'] });
      qc.invalidateQueries({ queryKey: ['open-finance-status'] });
      setForm((f) => (f ? { ...f, openFinanceClientSecret: '' } : f));
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  if (isLoading || !form) return <FormSkeleton />;

  return (
    <div className="max-w-3xl pb-6">
      <PageHeader
        migalhas={[{ rotulo: 'Configurações', para: '/configuracoes' }, { rotulo: 'Open Finance' }]}
        titulo="Open Finance (Pluggy)"
        descricao="Conecte as contas bancárias da loja para saldo ao vivo e conciliação automática."
        extra={status ? <Badge tom={status.configurado ? (status.ativo ? 'verde' : 'amarelo') : 'cinza'} ponto>{status.configurado ? (status.ativo ? 'Ativo' : 'Configurado, inativo') : 'Não configurado'}</Badge> : null}
        acoes={<Button variante="primario" icone={<Save className="h-4 w-4" />} carregando={salvar.isPending} onClick={() => salvar.mutate()}>Salvar</Button>}
      />
      <div className="space-y-4">
        <Secao titulo="Credenciais" descricao="Crie uma aplicação em dashboard.pluggy.ai e copie o Client ID / Client Secret." acoes={<Switch checked={form.openFinanceAtivo} onChange={(v) => setForm({ ...form, openFinanceAtivo: v })} label={form.openFinanceAtivo ? 'Ativo' : 'Inativo'} />}>
          <div className="grid gap-3 md:grid-cols-2">
            <Input label="Client ID" value={form.openFinanceClientId} onChange={(e) => setForm({ ...form, openFinanceClientId: e.target.value })} autoComplete="off" />
            <Input label="Client Secret" type="password" value={form.openFinanceClientSecret} onChange={(e) => setForm({ ...form, openFinanceClientSecret: e.target.value })} placeholder={emp?.openFinance?.temSecret ? '•••••••• (cadastrado — preencha para trocar)' : ''} autoComplete="new-password" />
          </div>
        </Secao>
        <Secao titulo="Próximo passo">
          <p className="text-sm text-slate-600">Com as credenciais salvas e ativas, vá em <Link to="/financeiro/bancos" className="font-medium text-brand-600 hover:underline">Financeiro → Bancos & conciliação</Link> e clique em “Conectar banco”. O widget da Pluggy abre para autenticar no banco e as contas são vinculadas automaticamente.</p>
          <Link to="/financeiro/bancos" className="mt-3 inline-block"><Button variante="secundario" icone={<PlugZap className="h-4 w-4" />}>Ir para Bancos</Button></Link>
          <p className="mt-3 text-xs text-slate-400">Webhook (opcional): configure na Pluggy a URL <code className="rounded bg-slate-100 px-1">{location.origin}{API_BASE}/webhooks/pluggy</code> para sincronização automática.</p>
        </Secao>
      </div>
    </div>
  );
}
