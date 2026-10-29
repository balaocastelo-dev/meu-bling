/**
 * Configurações → JARVIS (só ADMIN).
 * Meta de caixa, data-alvo, chave da IA (criptografada aqui) e as regras de preço de usado.
 * A chave nunca volta do servidor: o campo abre vazio e vazio significa "não mexe".
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Bot, Save, Zap } from 'lucide-react';
import { api, mensagemErro } from '@/lib/api';
import { Badge, Button, FormSkeleton, Input, PageHeader, Secao, Switch } from '@/components/ui';

interface ConfigJarvis {
  ligado: boolean;
  metaCaixa: number;
  dataAlvo: string | null;
  modeloIa: string;
  temChave: boolean;
  chaveMascarada: string | null;
  percVendaUsado: number;
  percCompraRegular: number;
  percCompraBom: number;
  percCompraLacrado: number;
  percLojaConsignado: number;
  diasEstoqueParado: number;
  ultimaRodadaEm?: string | null;
  ultimoErro?: string | null;
}

export default function ConfigJarvis() {
  const qc = useQueryClient();
  const { data: cfg, isLoading } = useQuery({ queryKey: ['jarvis-config'], queryFn: () => api.get<ConfigJarvis>('/jarvis/config'), retry: 0 });
  const [form, setForm] = useState<(ConfigJarvis & { chaveAnthropic: string }) | null>(null);

  useEffect(() => {
    if (cfg && !form) setForm({ ...cfg, chaveAnthropic: '', dataAlvo: cfg.dataAlvo ? cfg.dataAlvo.slice(0, 10) : null });
  }, [cfg, form]);

  const salvar = useMutation({
    mutationFn: () =>
      api.put('/jarvis/config', {
        ligado: form?.ligado,
        metaCaixa: form?.metaCaixa,
        dataAlvo: form?.dataAlvo || null,
        modeloIa: form?.modeloIa,
        chaveAnthropic: form?.chaveAnthropic || undefined,
        percVendaUsado: form?.percVendaUsado,
        percCompraRegular: form?.percCompraRegular,
        percCompraBom: form?.percCompraBom,
        percCompraLacrado: form?.percCompraLacrado,
        percLojaConsignado: form?.percLojaConsignado,
        diasEstoqueParado: form?.diasEstoqueParado,
      }),
    onSuccess: () => {
      toast.success('JARVIS atualizado.');
      qc.invalidateQueries({ queryKey: ['jarvis-config'] });
      qc.invalidateQueries({ queryKey: ['jarvis-painel'] });
      setForm((f) => (f ? { ...f, chaveAnthropic: '' } : f));
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const testar = useMutation({
    mutationFn: () => api.post<{ ok: boolean; mensagem: string }>('/jarvis/config/testar-ia', { chave: form?.chaveAnthropic || undefined, modelo: form?.modeloIa }),
    onSuccess: (r) => (r.ok ? toast.success(r.mensagem) : toast.error(r.mensagem)),
    onError: (e) => toast.error(mensagemErro(e)),
  });

  if (isLoading || !form) return <FormSkeleton />;
  const set = (campos: Partial<ConfigJarvis & { chaveAnthropic: string }>) => setForm((f) => (f ? { ...f, ...campos } : f));

  return (
    <>
      <PageHeader
        migalhas={[{ rotulo: 'Configurações', para: '/configuracoes' }, { rotulo: 'JARVIS' }]}
        titulo="JARVIS — agente do gestor"
        descricao="O robô que olha a loja a cada 30 minutos e diz o que fazer para o caixa crescer."
        extra={<Badge tom={form.temChave ? 'verde' : 'amarelo'} ponto>{form.temChave ? 'IA ligada' : 'Sem chave de IA'}</Badge>}
        acoes={
          <Button variante="primario" icone={<Save className="h-4 w-4" />} carregando={salvar.isPending} onClick={() => salvar.mutate()}>
            Salvar
          </Button>
        }
      />

      <Secao
        titulo="Objetivo"
        descricao="Para onde o JARVIS está puxando a loja."
        acoes={<Switch checked={form.ligado} onChange={(v: boolean) => set({ ligado: v })} label="JARVIS ligado" />}
      >
        <div className="grid gap-3 md:grid-cols-2">
          <Input
            label="Meta de caixa livre (R$)"
            type="number"
            min={0}
            step={1000}
            value={form.metaCaixa}
            onChange={(e) => set({ metaCaixa: Number(e.target.value) })}
          />
          <Input
            label="Data-alvo (opcional)"
            type="date"
            value={form.dataAlvo ?? ''}
            onChange={(e) => set({ dataAlvo: e.target.value || null })}
          />
        </div>
      </Secao>

      <Secao titulo="Inteligência artificial" descricao="A chave fica criptografada aqui dentro e nunca aparece de volta na tela.">
        <div className="grid gap-3 md:grid-cols-2">
          <Input
            label="Modelo"
            value={form.modeloIa}
            onChange={(e) => set({ modeloIa: e.target.value })}
            autoComplete="off"
          />
          <Input
            label="Chave da API da Anthropic"
            type="password"
            value={form.chaveAnthropic}
            onChange={(e) => set({ chaveAnthropic: e.target.value })}
            placeholder={form.temChave ? `${form.chaveMascarada ?? '••••'} (cadastrada — preencha para trocar)` : 'sk-ant-...'}
            autoComplete="new-password"
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variante="secundario" icone={<Zap className="h-4 w-4" />} carregando={testar.isPending} onClick={() => testar.mutate()}>
            Testar
          </Button>
          <span className="text-xs text-slate-500">
            Sem chave, o JARVIS continua funcionando com os textos padrão — só não responde perguntas.
          </span>
        </div>
        {cfg?.ultimoErro && <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-800 ring-1 ring-amber-200">{cfg.ultimoErro}</p>}
      </Secao>

      <Secao titulo="Preço de usado" descricao="As regras da loja para avaliar o que entra de balcão (% sobre o valor do produto novo).">
        <div className="grid gap-3 md:grid-cols-3">
          <Input
            label="Compra — condição regular (%)"
            type="number"
            min={5}
            max={100}
            value={form.percCompraRegular}
            onChange={(e) => set({ percCompraRegular: Number(e.target.value) })}
          />
          <Input
            label="Compra — boas condições (%)"
            type="number"
            min={5}
            max={100}
            value={form.percCompraBom}
            onChange={(e) => set({ percCompraBom: Number(e.target.value) })}
          />
          <Input
            label="Compra — lacrado com NF (%)"
            type="number"
            min={5}
            max={100}
            value={form.percCompraLacrado}
            onChange={(e) => set({ percCompraLacrado: Number(e.target.value) })}
          />
          <Input
            label="Venda do usado (% do novo)"
            type="number"
            min={10}
            max={100}
            value={form.percVendaUsado}
            onChange={(e) => set({ percVendaUsado: Number(e.target.value) })}
          />
          <Input
            label="Loja no consignado (%)"
            type="number"
            min={0}
            max={100}
            value={form.percLojaConsignado}
            onChange={(e) => set({ percLojaConsignado: Number(e.target.value) })}
          />
          <Input
            label="Dias sem vender = parado"
            type="number"
            min={7}
            max={365}
            value={form.diasEstoqueParado}
            onChange={(e) => set({ diasEstoqueParado: Number(e.target.value) })}
          />
        </div>
      </Secao>
    </>
  );
}
