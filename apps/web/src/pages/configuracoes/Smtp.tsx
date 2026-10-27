import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Mail, Save, Send } from 'lucide-react';
import { api, mensagemErro } from '@/lib/api';
import { useEmpresa } from '@/hooks/useEmpresa';
import { Button, Checkbox, FormSkeleton, Input, PageHeader, Secao, Switch } from '@/components/ui';

interface Form {
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPass: string;
  smtpFrom: string;
  smtpAtivo: boolean;
}

/** Configuração do servidor de e-mail (SMTP) */
export default function Smtp() {
  const qc = useQueryClient();
  const { data: emp, isLoading } = useEmpresa();
  const [form, setForm] = useState<Form | null>(null);
  const [para, setPara] = useState('');

  useEffect(() => {
    if (emp && !form) setForm({ smtpHost: emp.smtpHost ?? '', smtpPort: emp.smtpPort ?? 587, smtpSecure: emp.smtpSecure, smtpUser: emp.smtpUser ?? '', smtpPass: '', smtpFrom: emp.smtpFrom ?? '', smtpAtivo: emp.smtpAtivo });
  }, [emp, form]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const salvar = useMutation({
    mutationFn: (f: Form) => api.put('/empresa', { ...f, smtpPass: f.smtpPass || undefined }),
    onSuccess: () => {
      toast.success('SMTP salvo.');
      qc.invalidateQueries({ queryKey: ['empresa'] });
      set('smtpPass', '');
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });
  const testar = useMutation({
    mutationFn: () => api.post('/empresa/smtp/testar', { para }),
    onSuccess: () => toast.success(`E-mail de teste enviado para ${para}.`),
    onError: (e) => toast.error(mensagemErro(e)),
  });

  if (isLoading || !form) return <FormSkeleton />;

  return (
    <div className="max-w-3xl pb-6">
      <PageHeader migalhas={[{ rotulo: 'Configurações', para: '/configuracoes' }, { rotulo: 'E-mail (SMTP)' }]} titulo="E-mail (SMTP)" descricao="Servidor usado para enviar pedidos, NF-e (XML+DANFE) e notificações por e-mail." acoes={<Button variante="primario" icone={<Save className="h-4 w-4" />} carregando={salvar.isPending} onClick={() => salvar.mutate(form)}>Salvar</Button>} />
      <div className="space-y-4">
        <Secao titulo="Servidor" acoes={<Switch checked={form.smtpAtivo} onChange={(v) => set('smtpAtivo', v)} label={form.smtpAtivo ? 'Ativo' : 'Inativo'} />}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <Input className="sm:col-span-2 lg:col-span-4" label="Host" value={form.smtpHost} onChange={(e) => set('smtpHost', e.target.value)} placeholder="smtp.gmail.com" />
            <Input className="lg:col-span-1" label="Porta" type="number" value={form.smtpPort} onChange={(e) => set('smtpPort', Number(e.target.value))} />
            <div className="flex items-end pb-2 lg:col-span-1"><Checkbox label="SSL/TLS" checked={form.smtpSecure} onChange={(e) => set('smtpSecure', e.target.checked)} /></div>
            <Input className="lg:col-span-3" label="Usuário" value={form.smtpUser} onChange={(e) => set('smtpUser', e.target.value)} autoComplete="off" />
            <Input className="lg:col-span-3" label="Senha" type="password" value={form.smtpPass} onChange={(e) => set('smtpPass', e.target.value)} placeholder={emp?.smtp?.temSenha ? '•••••••• (cadastrada — preencha para trocar)' : ''} autoComplete="new-password" />
            <Input className="sm:col-span-2 lg:col-span-6" label="Remetente (From)" value={form.smtpFrom} onChange={(e) => set('smtpFrom', e.target.value)} placeholder='"Balão da Informática" <contato@balao.info>' />
          </div>
          <p className="mt-2 text-xs text-slate-400">Gmail: use uma “senha de app” com porta 587 (STARTTLS) ou 465 (SSL).</p>
        </Secao>
        <Secao titulo="Testar envio">
          <div className="flex flex-wrap items-end gap-2">
            <Input label="Enviar teste para" type="email" value={para} onChange={(e) => setPara(e.target.value)} className="w-80" prefixo={<Mail className="h-4 w-4" />} />
            <Button variante="secundario" icone={<Send className="h-4 w-4" />} disabled={!para} carregando={testar.isPending} onClick={() => testar.mutate()}>Enviar e-mail de teste</Button>
          </div>
          <p className="mt-2 text-xs text-slate-400">Salve antes de testar — o teste usa a configuração gravada.</p>
        </Secao>
      </div>
    </div>
  );
}
