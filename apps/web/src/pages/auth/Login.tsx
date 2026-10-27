import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Lock, Mail } from 'lucide-react';
import { api, mensagemErro } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { Button, Input } from '@/components/ui';
import { Logo } from '@/components/layout/Sidebar';
import type { LoginResposta } from '@/types';

/** Tela de login */
export default function Login() {
  const nav = useNavigate();
  const loc = useLocation();
  const { token, login } = useAuth();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [carregando, setCarregando] = useState(false);

  if (token) return <Navigate to="/" replace />;

  const entrar = async (e: FormEvent) => {
    e.preventDefault();
    setCarregando(true);
    try {
      const r = await api.post<LoginResposta>('/auth/login', { email, senha });
      login(r.token, r.usuario);
      if (r.senhaFraca) toast.warning('Você está usando a senha padrão. Troque em "Minha conta / senha".', { duration: 8000 });
      const destino = (loc.state as { de?: string } | null)?.de || '/';
      nav(destino, { replace: true });
    } catch (err) {
      toast.error(mensagemErro(err, 'Não foi possível entrar.'));
    } finally {
      setCarregando(false);
    }
  };

  return (
    <div className="flex min-h-dvh">
      {/* lado esquerdo: marca */}
      <div className="hidden w-1/2 flex-col justify-between bg-slate-950 p-10 text-slate-300 lg:flex">
        <div className="flex items-center gap-3">
          <Logo className="h-9 w-9" />
          <span className="text-lg font-bold tracking-wide text-white">MEU BLING</span>
        </div>
        <div>
          <h2 className="text-3xl font-semibold leading-tight text-white">
            O ERP da <span className="text-brand-500">Balão da Informática</span>.
          </h2>
          <p className="mt-3 max-w-md text-sm text-slate-400">Vendas, assistência técnica, estoque, financeiro com Open Finance, NF-e e WhatsApp em um só lugar — sem mensalidade do Bling.</p>
        </div>
        <p className="text-xs text-slate-500">Campinas/SP · Cambuí · www.balao.info</p>
      </div>

      {/* lado direito: formulário */}
      <div className="flex flex-1 items-center justify-center bg-slate-50 p-6">
        <form onSubmit={entrar} className="w-full max-w-sm space-y-5 rounded-xl border border-slate-200 bg-white p-8 shadow-card">
          <div className="flex items-center gap-2 lg:hidden">
            <Logo className="h-8 w-8" />
            <span className="font-bold tracking-wide">MEU BLING</span>
          </div>
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Entrar</h1>
            <p className="text-sm text-slate-500">Use seu e-mail e senha de acesso.</p>
          </div>
          <Input label="E-mail" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} prefixo={<Mail className="h-4 w-4" />} placeholder="voce@balao.info" autoFocus />
          <Input label="Senha" type="password" autoComplete="current-password" required value={senha} onChange={(e) => setSenha(e.target.value)} prefixo={<Lock className="h-4 w-4" />} placeholder="••••••••" />
          <Button type="submit" variante="primario" tamanho="lg" className="w-full" carregando={carregando}>
            Entrar
          </Button>
        </form>
      </div>
    </div>
  );
}
