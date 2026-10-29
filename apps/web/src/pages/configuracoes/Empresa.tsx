import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Building2, Save, Upload } from 'lucide-react';
import { api, mensagemErro, urlUpload } from '@/lib/api';
import { useEmpresa } from '@/hooks/useEmpresa';
import { Button, FormSkeleton, Input, PageHeader, Secao, Select } from '@/components/ui';
import type { Empresa as TEmpresa } from '@/types';

type Form = Pick<TEmpresa, 'razaoSocial' | 'nomeFantasia' | 'cnpj' | 'ie' | 'im' | 'crt' | 'logradouro' | 'numero' | 'complemento' | 'bairro' | 'codigoMunicipio' | 'municipio' | 'uf' | 'cep' | 'telefone' | 'email' | 'site'>;

/** Dados da empresa emitente */
export default function Empresa() {
  const qc = useQueryClient();
  const { data: emp, isLoading } = useEmpresa();
  const [form, setForm] = useState<Form | null>(null);
  const logoRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (emp && !form) {
      const { razaoSocial, nomeFantasia, cnpj, ie, im, crt, logradouro, numero, complemento, bairro, codigoMunicipio, municipio, uf, cep, telefone, email, site } = emp;
      setForm({ razaoSocial, nomeFantasia, cnpj, ie, im, crt, logradouro, numero, complemento, bairro, codigoMunicipio, municipio, uf, cep, telefone, email, site });
    }
  }, [emp, form]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));

  const salvar = useMutation({
    mutationFn: (f: Form) => api.put<TEmpresa>('/empresa', f),
    onSuccess: () => {
      toast.success('Dados da empresa salvos.');
      qc.invalidateQueries({ queryKey: ['empresa'] });
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });
  const logo = useMutation({
    mutationFn: (f: File) => {
      const fd = new FormData();
      fd.append('arquivo', f);
      return api.upload<{ logoPath: string }>('/empresa/logo', fd);
    },
    onSuccess: () => {
      toast.success('Logo atualizado.');
      qc.invalidateQueries({ queryKey: ['empresa'] });
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  if (isLoading || !form) return <FormSkeleton />;
  const logoUrl = emp?.logoPath ? urlUpload(emp.logoPath) : null;

  return (
    <div className="pb-6">
      <PageHeader migalhas={[{ rotulo: 'Configurações', para: '/configuracoes' }, { rotulo: 'Empresa' }]} titulo="Empresa" descricao="Dados do emitente usados em pedidos, OS, NF-e e mensagens." acoes={<Button variante="primario" icone={<Save className="h-4 w-4" />} carregando={salvar.isPending} onClick={() => salvar.mutate(form)}>Salvar</Button>} />
      <div className="space-y-4">
        <Secao titulo="Identificação">
          <div className="flex flex-col gap-4 md:flex-row">
            <div className="flex w-40 shrink-0 flex-col items-center gap-2">
              <div className="flex h-28 w-40 items-center justify-center overflow-hidden rounded-md border border-dashed border-slate-300 bg-slate-50">
                {logoUrl ? <img src={logoUrl} alt="Logo" className="max-h-full max-w-full object-contain" /> : <Building2 className="h-8 w-8 text-slate-300" />}
              </div>
              <input ref={logoRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) logo.mutate(f); e.target.value = ''; }} />
              <Button tamanho="xs" variante="secundario" icone={<Upload className="h-3.5 w-3.5" />} carregando={logo.isPending} onClick={() => logoRef.current?.click()}>Enviar logo</Button>
            </div>
            <div className="grid flex-1 gap-3 sm:grid-cols-2 xl:grid-cols-12">
              <Input className="sm:col-span-2 xl:col-span-8" label="Razão social" obrigatorio value={form.razaoSocial} onChange={(e) => set('razaoSocial', e.target.value)} />
              <Input className="xl:col-span-4" label="CNPJ" obrigatorio value={form.cnpj} onChange={(e) => set('cnpj', e.target.value)} />
              <Input className="xl:col-span-6" label="Nome fantasia" value={form.nomeFantasia ?? ''} onChange={(e) => set('nomeFantasia', e.target.value)} />
              <Input className="xl:col-span-3" label="Inscrição estadual" value={form.ie ?? ''} onChange={(e) => set('ie', e.target.value)} />
              <Input className="xl:col-span-3" label="Inscrição municipal" value={form.im ?? ''} onChange={(e) => set('im', e.target.value)} />
              <Select className="xl:col-span-6" label="Regime tributário (CRT)" value={form.crt} onChange={(e) => set('crt', Number(e.target.value))} opcoes={[{ valor: 1, rotulo: '1 — Simples Nacional' }, { valor: 2, rotulo: '2 — Simples Nacional (excesso de sublimite)' }, { valor: 3, rotulo: '3 — Regime normal' }]} />
            </div>
          </div>
        </Secao>
        <Secao titulo="Endereço">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-12">
            <Input className="xl:col-span-2" label="CEP" value={form.cep ?? ''} onChange={(e) => set('cep', e.target.value)} />
            <Input className="xl:col-span-6" label="Logradouro" value={form.logradouro ?? ''} onChange={(e) => set('logradouro', e.target.value)} />
            <Input className="xl:col-span-1" label="Nº" value={form.numero ?? ''} onChange={(e) => set('numero', e.target.value)} />
            <Input className="xl:col-span-3" label="Complemento" value={form.complemento ?? ''} onChange={(e) => set('complemento', e.target.value)} />
            <Input className="xl:col-span-4" label="Bairro" value={form.bairro ?? ''} onChange={(e) => set('bairro', e.target.value)} />
            <Input className="xl:col-span-4" label="Município" value={form.municipio ?? ''} onChange={(e) => set('municipio', e.target.value)} />
            <Input className="xl:col-span-1" label="UF" value={form.uf ?? ''} onChange={(e) => set('uf', e.target.value.toUpperCase())} maxLength={2} />
            <Input className="xl:col-span-3" label="Cód. IBGE do município" value={form.codigoMunicipio ?? ''} onChange={(e) => set('codigoMunicipio', e.target.value)} placeholder="3509502 (Campinas)" />
          </div>
        </Secao>
        <Secao titulo="Contato">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Input label="Telefone" value={form.telefone ?? ''} onChange={(e) => set('telefone', e.target.value)} />
            <Input label="E-mail" type="email" value={form.email ?? ''} onChange={(e) => set('email', e.target.value)} />
            <Input label="Site" value={form.site ?? ''} onChange={(e) => set('site', e.target.value)} placeholder="www.balao.info" />
          </div>
        </Secao>
      </div>
    </div>
  );
}
