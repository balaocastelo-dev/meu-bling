import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import clsx from 'clsx';
import { RefreshCw, Save, ShieldCheck, Trash2, Upload, Wifi, WifiOff } from 'lucide-react';
import { api, mensagemErro } from '@/lib/api';
import { useEmpresa } from '@/hooks/useEmpresa';
import { Badge, Button, FormSkeleton, Input, MoneyInput, PageHeader, Secao, Select } from '@/components/ui';
import { data, diasAtraso } from '@/lib/format';
import type { Empresa, StatusSefaz } from '@/types';

type Form = Pick<Empresa, 'ambienteFiscal' | 'serieNfe' | 'proximoNumeroNfe' | 'serieNfce' | 'proximoNumeroNfce' | 'cscId' | 'naturezaOperacaoPadrao' | 'cfopPadraoDentroUf' | 'cfopPadraoForaUf' | 'csosnPadrao' | 'aliquotaSimplesPct' | 'provedorFiscal' | 'taxaCartao1xPct' | 'taxaCartao12xPct' | 'freteVendaPadrao' | 'custoProdutoMinPct' | 'custoProdutoMaxPct'> & { cscToken: string };

/** Configuração fiscal: ambiente, séries, CSC, certificado A1, provedor */
export default function Fiscal() {
  const qc = useQueryClient();
  const { data: emp, isLoading } = useEmpresa();
  const [form, setForm] = useState<Form | null>(null);
  const [senhaCert, setSenhaCert] = useState('');
  const [arquivoCert, setArquivoCert] = useState<File | null>(null);
  const certRef = useRef<HTMLInputElement>(null);
  const { data: sefaz, refetch: consultarSefaz, isFetching: consultando } = useQuery({ queryKey: ['sefaz-status'], queryFn: () => api.get<StatusSefaz>('/fiscal/status-sefaz').catch(() => null) });

  useEffect(() => {
    if (emp && !form) {
      setForm({ ambienteFiscal: emp.ambienteFiscal, serieNfe: emp.serieNfe, proximoNumeroNfe: emp.proximoNumeroNfe, serieNfce: emp.serieNfce, proximoNumeroNfce: emp.proximoNumeroNfce, cscId: emp.cscId ?? '', cscToken: '', naturezaOperacaoPadrao: emp.naturezaOperacaoPadrao, cfopPadraoDentroUf: emp.cfopPadraoDentroUf, cfopPadraoForaUf: emp.cfopPadraoForaUf, csosnPadrao: emp.csosnPadrao, aliquotaSimplesPct: emp.aliquotaSimplesPct, provedorFiscal: emp.provedorFiscal, taxaCartao1xPct: emp.taxaCartao1xPct ?? 5, taxaCartao12xPct: emp.taxaCartao12xPct ?? 12, freteVendaPadrao: emp.freteVendaPadrao ?? 10, custoProdutoMinPct: emp.custoProdutoMinPct ?? 40, custoProdutoMaxPct: emp.custoProdutoMaxPct ?? 70 });
    }
  }, [emp, form]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));

  const salvar = useMutation({
    mutationFn: (f: Form) => api.put('/empresa', { ...f, cscToken: f.cscToken || undefined }),
    onSuccess: () => {
      toast.success('Configuração fiscal salva.');
      qc.invalidateQueries({ queryKey: ['empresa'] });
      setForm((f) => (f ? { ...f, cscToken: '' } : f));
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });
  const enviarCert = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append('arquivo', arquivoCert!);
      fd.append('senha', senhaCert);
      return api.upload<{ nome: string; validade: string }>('/empresa/certificado', fd);
    },
    onSuccess: (r) => {
      toast.success(`Certificado ${r.nome} válido até ${data(r.validade)}.`);
      qc.invalidateQueries({ queryKey: ['empresa'] });
      setArquivoCert(null);
      setSenhaCert('');
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });
  const removerCert = useMutation({
    mutationFn: () => api.del('/empresa/certificado'),
    onSuccess: () => {
      toast.success('Certificado removido.');
      qc.invalidateQueries({ queryKey: ['empresa'] });
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  if (isLoading || !form) return <FormSkeleton />;
  const cert = emp?.certificado;
  const diasValidade = cert?.validade ? -diasAtraso(cert.validade) : null;

  return (
    <div className="pb-6">
      <PageHeader migalhas={[{ rotulo: 'Configurações', para: '/configuracoes' }, { rotulo: 'Fiscal' }]} titulo="Fiscal / Certificado" descricao="Emissão de NF-e e NFC-e direto na SEFAZ com certificado A1." acoes={<Button variante="primario" icone={<Save className="h-4 w-4" />} carregando={salvar.isPending} onClick={() => salvar.mutate(form)}>Salvar</Button>} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Secao titulo="Ambiente e provedor">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <Select label="Ambiente" value={form.ambienteFiscal} onChange={(e) => set('ambienteFiscal', Number(e.target.value))} opcoes={[{ valor: 2, rotulo: '2 — Homologação (testes)' }, { valor: 1, rotulo: '1 — Produção' }]} />
              <Select label="Provedor" value={form.provedorFiscal} onChange={(e) => set('provedorFiscal', e.target.value as 'mock' | 'sefaz')} opcoes={[{ valor: 'mock', rotulo: 'Simulado — sem SEFAZ' }, { valor: 'sefaz', rotulo: 'SEFAZ direto (certificado A1)' }]} ajuda="Use “Simulado” para treinar sem transmitir." />
              <MoneyInput label="Alíquota Simples (%) p/ DRE" prefixo="" value={form.aliquotaSimplesPct} onChange={(v) => set('aliquotaSimplesPct', v)} ajuda="Imposto sobre cada venda (DRE e lucro)." />
            </div>
          </Secao>
          <Secao titulo="Custo de cada venda (DRE e dashboards)" descricao="Toda venda tem custo = produto + imposto (alíquota acima) + taxa do cartão + frete. Venda sem custo de produto informado usa uma estimativa fixa dentro da faixa abaixo.">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <MoneyInput label="Cartão 1x / débito (%)" prefixo="" value={form.taxaCartao1xPct ?? 5} onChange={(v) => set('taxaCartao1xPct', v)} />
              <MoneyInput label="Cartão 12x (%)" prefixo="" value={form.taxaCartao12xPct ?? 12} onChange={(v) => set('taxaCartao12xPct', v)} ajuda="De 2x a 11x sobe em linha reta." />
              <MoneyInput label="Frete por venda (R$)" value={form.freteVendaPadrao ?? 10} onChange={(v) => set('freteVendaPadrao', v)} ajuda="Usado quando a venda não tem logística lançada." />
              <MoneyInput label="Custo produto mín. (%)" prefixo="" value={form.custoProdutoMinPct ?? 40} onChange={(v) => set('custoProdutoMinPct', v)} />
              <MoneyInput label="Custo produto máx. (%)" prefixo="" value={form.custoProdutoMaxPct ?? 70} onChange={(v) => set('custoProdutoMaxPct', v)} />
            </div>
          </Secao>
          <Secao titulo="Séries e numeração">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Input label="Série NF-e" type="number" value={form.serieNfe} onChange={(e) => set('serieNfe', Number(e.target.value))} />
              <Input label="Próximo nº NF-e" type="number" value={form.proximoNumeroNfe} onChange={(e) => set('proximoNumeroNfe', Number(e.target.value))} />
              <Input label="Série NFC-e" type="number" value={form.serieNfce} onChange={(e) => set('serieNfce', Number(e.target.value))} />
              <Input label="Próximo nº NFC-e" type="number" value={form.proximoNumeroNfce} onChange={(e) => set('proximoNumeroNfce', Number(e.target.value))} />
            </div>
            <p className="mt-2 text-xs text-slate-400">Ao migrar do Bling, informe o próximo número para continuar a sequência sem inutilizações.</p>
          </Secao>
          <Secao titulo="NFC-e — CSC (Código de Segurança do Contribuinte)">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <Input label="ID do CSC" value={form.cscId ?? ''} onChange={(e) => set('cscId', e.target.value)} placeholder="000001" />
              <Input className="xl:col-span-2" label="Token CSC" type="password" value={form.cscToken} onChange={(e) => set('cscToken', e.target.value)} placeholder={emp?.cscToken ? '•••••••• (já cadastrado — preencha para trocar)' : 'Token obtido no portal da SEFAZ'} autoComplete="new-password" />
            </div>
          </Secao>
          <Secao titulo="Padrões de emissão (Simples Nacional)">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Input className="sm:col-span-2" label="Natureza da operação padrão" value={form.naturezaOperacaoPadrao} onChange={(e) => set('naturezaOperacaoPadrao', e.target.value)} />
              <Input label="CFOP dentro da UF" value={form.cfopPadraoDentroUf} onChange={(e) => set('cfopPadraoDentroUf', e.target.value)} />
              <Input label="CFOP fora da UF" value={form.cfopPadraoForaUf} onChange={(e) => set('cfopPadraoForaUf', e.target.value)} />
              <Input label="CSOSN padrão" value={form.csosnPadrao} onChange={(e) => set('csosnPadrao', e.target.value)} />
            </div>
          </Secao>
        </div>

        <div className="space-y-4">
          <Secao titulo="Certificado digital A1">
            {cert?.temCertificado ? (
              <div className="space-y-3">
                <div className={clsx('flex items-start gap-3 rounded-md border p-3', diasValidade !== null && diasValidade < 30 ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50')}>
                  <ShieldCheck className={clsx('mt-0.5 h-5 w-5 shrink-0', diasValidade !== null && diasValidade < 30 ? 'text-amber-600' : 'text-emerald-600')} />
                  <div className="min-w-0 text-sm">
                    <p className="truncate font-medium text-slate-800">{cert.nome}</p>
                    <p className="text-xs text-slate-600">Válido até {data(cert.validade)}{diasValidade !== null && <span className={diasValidade < 0 ? 'font-semibold text-red-600' : diasValidade < 30 ? 'font-semibold text-amber-700' : ''}> · {diasValidade < 0 ? 'VENCIDO' : `${diasValidade} dias`}</span>}</p>
                  </div>
                </div>
                <Button tamanho="sm" variante="perigo" icone={<Trash2 className="h-3.5 w-3.5" />} carregando={removerCert.isPending} onClick={() => { if (confirm('Remover o certificado?')) removerCert.mutate(); }}>Remover certificado</Button>
                <p className="text-xs text-slate-400">Para trocar, envie um novo arquivo abaixo.</p>
              </div>
            ) : (
              <p className="mb-3 text-sm text-slate-500">Nenhum certificado instalado. Envie o arquivo .pfx (A1) e a senha.</p>
            )}
            <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
              <input ref={certRef} type="file" accept=".pfx,.p12" className="hidden" onChange={(e) => setArquivoCert(e.target.files?.[0] ?? null)} />
              <Button variante="secundario" tamanho="sm" icone={<Upload className="h-3.5 w-3.5" />} onClick={() => certRef.current?.click()} className="w-full">{arquivoCert ? arquivoCert.name : 'Escolher arquivo .pfx'}</Button>
              <Input label="Senha do certificado" type="password" value={senhaCert} onChange={(e) => setSenhaCert(e.target.value)} autoComplete="new-password" />
              <Button variante="primario" tamanho="sm" className="w-full" disabled={!arquivoCert || !senhaCert} carregando={enviarCert.isPending} onClick={() => enviarCert.mutate()}>Instalar certificado</Button>
            </div>
          </Secao>
          <Secao titulo="Status da SEFAZ" acoes={<Button tamanho="xs" variante="fantasma" icone={<RefreshCw className={clsx('h-3.5 w-3.5', consultando && 'animate-spin')} />} onClick={() => consultarSefaz()} />}>
            {sefaz ? (
              <div className="flex items-center gap-3">
                <span className={clsx('flex h-10 w-10 items-center justify-center rounded-full', sefaz.online ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600')}>{sefaz.online ? <Wifi className="h-5 w-5" /> : <WifiOff className="h-5 w-5" />}</span>
                <div className="text-sm">
                  <p className="font-medium">{sefaz.online ? 'Serviço em operação' : 'Indisponível'}</p>
                  <p className="text-xs text-slate-500">{sefaz.cStat ? `${sefaz.cStat} — ` : ''}{sefaz.motivo ?? ''}</p>
                  <Badge tom={sefaz.ambiente === 1 ? 'verde' : 'amarelo'} className="mt-1">{sefaz.ambiente === 1 ? 'Produção' : 'Homologação'}</Badge>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-400">Sem resposta (provedor simulado ou rota indisponível).</p>
            )}
          </Secao>
        </div>
      </div>
    </div>
  );
}
