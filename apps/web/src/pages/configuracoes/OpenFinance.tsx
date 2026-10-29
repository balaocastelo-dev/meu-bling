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
    <div className="pb-6">
      <PageHeader
        migalhas={[{ rotulo: 'Configurações', para: '/configuracoes' }, { rotulo: 'Open Finance' }]}
        titulo="Open Finance (Pluggy)"
        descricao="Conecte as contas bancárias da loja para saldo ao vivo e conciliação automática."
        extra={status ? <Badge tom={status.configurado ? (status.ativo ? 'verde' : 'amarelo') : 'cinza'} ponto>{status.configurado ? (status.ativo ? 'Ativo' : 'Configurado, inativo') : 'Não configurado'}</Badge> : null}
        acoes={<Button variante="primario" icone={<Save className="h-4 w-4" />} carregando={salvar.isPending} onClick={() => salvar.mutate()}>Salvar</Button>}
      />
      <div className="space-y-4">
        <Secao titulo="Credenciais" descricao="Em dashboard.pluggy.ai → Applications, crie uma aplicação e copie o Client ID / Client Secret (ficam criptografados aqui)." acoes={<Switch checked={form.openFinanceAtivo} onChange={(v) => setForm({ ...form, openFinanceAtivo: v })} label={form.openFinanceAtivo ? 'Ativo' : 'Inativo'} />}>
          <div className="grid gap-3 md:grid-cols-2">
            <Input label="Client ID" value={form.openFinanceClientId} onChange={(e) => setForm({ ...form, openFinanceClientId: e.target.value })} autoComplete="off" />
            <Input label="Client Secret" type="password" value={form.openFinanceClientSecret} onChange={(e) => setForm({ ...form, openFinanceClientSecret: e.target.value })} placeholder={emp?.openFinance?.temSecret ? '•••••••• (cadastrado — preencha para trocar)' : ''} autoComplete="new-password" />
          </div>
        </Secao>
        <Secao titulo="Dois jeitos de conectar o banco">
          <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-600">
            <li>
              <span className="font-medium text-slate-800">Gratuito — Meu Pluggy</span> (indicado: só as contas da própria loja). Conecte o banco em <a href="https://meu.pluggy.ai" target="_blank" rel="noreferrer" className="font-medium text-brand-600 hover:underline">meu.pluggy.ai</a>; no dashboard, adicione o conector <em>MeuPluggy</em> à lista de conectores da aplicação e crie uma <em>Development Application</em> (Client ID/Secret acima). Depois, em <Link to="/financeiro/bancos" className="font-medium text-brand-600 hover:underline">Financeiro → Bancos</Link>, use “Conectar banco” (o widget mostra o MeuPluggy) ou cole o <em>Item ID</em> copiado do app Demo da Pluggy. A conexão é mantida pelo Meu Pluggy e atualizada 1x por dia. Faça tudo isso durante os 15 dias de teste do dashboard — depois a lista de conectores vira somente leitura.
            </li>
            <li>
              <span className="font-medium text-slate-800">Plano pago da Pluggy</span> (atualização mais frequente, várias instituições, sem passar pelo Meu Pluggy). Peça o plano em pluggy.ai; a aplicação de produção usa os mesmos campos acima e o botão “Conectar banco” abre direto o login do banco.
            </li>
          </ol>
          <Link to="/financeiro/bancos" className="mt-3 inline-block"><Button variante="secundario" icone={<PlugZap className="h-4 w-4" />}>Ir para Bancos</Button></Link>
          <p className="mt-3 text-xs text-slate-400">Webhook (opcional): cadastre na Pluggy a URL <code className="inline-block max-w-full overflow-x-auto whitespace-nowrap rounded bg-slate-100 px-1 align-middle">{location.origin}{API_BASE}/webhooks/pluggy</code> para sincronizar assim que o banco atualizar. Sem webhook, o sistema sincroniza sozinho a cada 30 minutos.</p>
        </Secao>
      </div>
    </div>
  );
}
