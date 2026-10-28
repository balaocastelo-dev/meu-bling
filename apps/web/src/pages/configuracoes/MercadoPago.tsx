import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, ExternalLink, Save } from 'lucide-react';
import { api, mensagemErro } from '@/lib/api';
import { useEmpresa } from '@/hooks/useEmpresa';
import { Button, FormSkeleton, Input, PageHeader, Secao } from '@/components/ui';

/** Mercado Pago: Access Token usado para o vendedor gerar o link de pagamento dentro do pedido. */
export default function MercadoPago() {
  const qc = useQueryClient();
  const { data: emp, isLoading } = useEmpresa();
  const [token, setToken] = useState('');
  const salvar = useMutation({
    mutationFn: () => api.put('/empresa', { mercadoPagoAccessToken: token.trim() }),
    onSuccess: () => {
      toast.success('Access Token salvo.');
      setToken('');
      qc.invalidateQueries({ queryKey: ['empresa'] });
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });
  const testar = useMutation({
    mutationFn: () => api.post<{ conta: string; email: string | null }>('/empresa/mercado-pago/testar', {}),
    onSuccess: (r) => toast.success(`Conectado na conta ${r.conta}.`),
    onError: (e) => toast.error(mensagemErro(e)),
  });
  if (isLoading) return <FormSkeleton />;
  const tem = !!emp?.mercadoPago?.temToken;
  return (
    <div className="max-w-3xl pb-6">
      <PageHeader
        migalhas={[{ rotulo: 'Configurações', para: '/configuracoes' }, { rotulo: 'Mercado Pago' }]}
        titulo="Mercado Pago"
        descricao="Link de pagamento: o vendedor gera dentro do pedido e manda para o cliente pagar no cartão (até 12x) ou PIX."
        acoes={<Button variante="primario" icone={<Save className="h-4 w-4" />} disabled={!token.trim()} carregando={salvar.isPending} onClick={() => salvar.mutate()}>Salvar</Button>}
      />
      <Secao titulo="Access Token de produção">
        <Input
          label="Access Token"
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={tem ? '•••••••• (cadastrado — cole outro para trocar)' : 'APP_USR-...'}
          autoComplete="new-password"
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variante="secundario" icone={<CheckCircle2 className="h-4 w-4" />} disabled={!tem} carregando={testar.isPending} onClick={() => testar.mutate()}>Testar conexão</Button>
          <a className="inline-flex items-center gap-1 text-sm text-brand-700 hover:underline" href="https://www.mercadopago.com.br/developers/panel/app" target="_blank" rel="noreferrer">
            Onde pego o token? <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
        <p className="mt-2 text-xs text-slate-500">No painel do Mercado Pago: Suas integrações → sua aplicação → Credenciais de produção → Access Token. Fica guardado criptografado.</p>
      </Secao>
    </div>
  );
}
