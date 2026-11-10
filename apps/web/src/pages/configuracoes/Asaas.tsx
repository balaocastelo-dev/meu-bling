import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, ExternalLink, Save } from 'lucide-react';
import { api, mensagemErro } from '@/lib/api';
import { useEmpresa } from '@/hooks/useEmpresa';
import { Button, Checkbox, FormSkeleton, Input, PageHeader, Secao, Select } from '@/components/ui';

/**
 * Asaas: chave de API para gerar boleto, PIX e cartão a partir do pedido de venda,
 * com a opção de criar a cobrança sozinho toda vez que uma venda é finalizada.
 */
export default function Asaas() {
  const qc = useQueryClient();
  const { data: emp, isLoading } = useEmpresa();
  const [chave, setChave] = useState('');
  const [ambiente, setAmbiente] = useState('producao');
  const [cobrancaAuto, setCobrancaAuto] = useState(false);

  useEffect(() => {
    if (emp?.asaas) {
      setAmbiente(emp.asaas.ambiente || 'producao');
      setCobrancaAuto(!!emp.asaas.cobrancaAuto);
    }
  }, [emp]);

  const salvar = useMutation({
    mutationFn: () => api.put('/empresa', { ...(chave.trim() ? { asaasApiKey: chave.trim() } : {}), asaasAmbiente: ambiente, asaasCobrancaAuto: cobrancaAuto }),
    onSuccess: () => {
      toast.success('Configuração do Asaas salva.');
      setChave('');
      qc.invalidateQueries({ queryKey: ['empresa'] });
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const testar = useMutation({
    mutationFn: () => api.post<{ conta: string; email: string | null }>('/empresa/asaas/testar', {}),
    onSuccess: (r) => toast.success(`Conectado na conta ${r.conta}.`),
    onError: (e) => toast.error(mensagemErro(e)),
  });

  if (isLoading) return <FormSkeleton />;
  const tem = !!emp?.asaas?.temChave;

  return (
    <div className="pb-6">
      <PageHeader
        migalhas={[{ rotulo: 'Configurações', para: '/configuracoes' }, { rotulo: 'Asaas' }]}
        titulo="Asaas"
        descricao="Cobrança por boleto, PIX ou cartão gerada direto do pedido de venda, com link para mandar ao cliente."
        acoes={
          <Button variante="primario" icone={<Save className="h-4 w-4" />} carregando={salvar.isPending} onClick={() => salvar.mutate()}>
            Salvar
          </Button>
        }
      />

      <div className="space-y-4">
        <Secao titulo="Chave de API">
          <div className="grid gap-3 sm:grid-cols-3">
            <Input
              className="sm:col-span-2"
              label="Chave de API (access token)"
              type="password"
              value={chave}
              onChange={(e) => setChave(e.target.value)}
              placeholder={tem ? '•••••••• (cadastrada — cole outra para trocar)' : '$aact_...'}
              autoComplete="new-password"
            />
            <Select
              label="Ambiente"
              value={ambiente}
              onChange={(e) => setAmbiente(e.target.value)}
              opcoes={[
                { valor: 'producao', rotulo: 'Produção (cobra de verdade)' },
                { valor: 'sandbox', rotulo: 'Sandbox (teste)' },
              ]}
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variante="secundario" icone={<CheckCircle2 className="h-4 w-4" />} disabled={!tem} carregando={testar.isPending} onClick={() => testar.mutate()}>
              Testar conexão
            </Button>
            <a className="inline-flex items-center gap-1 text-sm text-brand-700 hover:underline" href="https://www.asaas.com/customerApiAccessToken/index" target="_blank" rel="noreferrer">
              Onde pego a chave? <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
          <p className="mt-2 text-xs text-slate-500">No painel do Asaas: Minha conta → Integrações → Chave de API. Fica guardada criptografada, como o certificado e o token do Mercado Pago.</p>
        </Secao>

        <Secao titulo="Cobrança automática" descricao="Para não depender de alguém lembrar de gerar a cobrança depois da venda.">
          <Checkbox
            label="Gerar a cobrança no Asaas ao finalizar a venda"
            descricao="Cria a cobrança com o total do pedido e o cliente escolhe entre boleto, PIX ou cartão. Se o Asaas estiver fora do ar, a venda é finalizada do mesmo jeito e a cobrança pode ser gerada à mão no pedido."
            checked={cobrancaAuto}
            onChange={(e) => setCobrancaAuto(e.target.checked)}
          />
          {cobrancaAuto && !tem && <p className="mt-2 text-xs text-amber-700">Salve a chave de API antes: sem ela nada é gerado.</p>}
        </Secao>
      </div>
    </div>
  );
}
