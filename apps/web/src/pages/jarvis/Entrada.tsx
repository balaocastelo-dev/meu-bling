/**
 * A porta do JARVIS.
 *
 * Quem chega sem estar logado entra por aqui (o mesmo login do sistema, com a cara do
 * JARVIS). Quem já está logado vê o próprio nome e o estado do agente, e abre o painel.
 * Quem não é ADMIN é avisado: o painel é do gestor.
 *
 * A tela é um instrumento: o trilho do milhão atravessa o alto e é a única coisa que se
 * move ao abrir.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowRight, Bot, Lock, Mail } from 'lucide-react';
import { api, mensagemErro } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import type { LoginResposta } from '@/types';

export default function Entrada({ aoEntrar }: { aoEntrar: () => void }) {
  const { token, usuario, login } = useAuth();
  const ehAdmin = usuario?.perfil === 'ADMIN';

  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [entrando, setEntrando] = useState(false);
  const [preenchido, setPreenchido] = useState(0);

  // o trilho enche uma vez, ao abrir — é a única animação da porta
  useEffect(() => {
    const t = setTimeout(() => setPreenchido(ehAdmin ? 34 : 18), 220);
    return () => clearTimeout(t);
  }, [ehAdmin]);

  const autenticar = async (e: FormEvent) => {
    e.preventDefault();
    setEntrando(true);
    try {
      const r = await api.post<LoginResposta>('/auth/login', { email, senha });
      login(r.token, r.usuario);
      if (r.usuario.perfil !== 'ADMIN') toast.info('Você entrou, mas o painel do JARVIS é do gestor.');
      else aoEntrar();
    } catch (err) {
      toast.error(mensagemErro(err, 'E-mail ou senha não conferem.'));
    } finally {
      setEntrando(false);
    }
  };

  return (
    <div className="jv jv-tela jv-grade">
      <div className="relative mx-auto flex min-h-full w-full max-w-5xl flex-col justify-center px-5 py-12 sm:px-8">
        <div className="jv-acende max-w-xl">
          <div className="mb-10 flex items-center gap-3">
            <span
              className="flex h-11 w-11 items-center justify-center rounded-xl"
              style={{ background: 'rgba(227,155,60,.12)', border: '1px solid rgba(227,155,60,.35)' }}
            >
              <Bot className="h-6 w-6" style={{ color: 'var(--jv-cobre)' }} />
            </span>
            <div>
              <h1 className="text-2xl font-semibold leading-none tracking-tight sm:text-3xl">JARVIS</h1>
              <p className="mt-1.5 text-sm" style={{ color: 'var(--jv-suave)' }}>
                agente do caixa · Balão da Informática
              </p>
            </div>
          </div>

          {/* o instrumento: onde a loja está no caminho do milhão */}
          <div className="mb-10">
            <div className="jv-trilho">
              <i style={{ width: `${preenchido}%` }} />
            </div>
            <p className="mt-3 text-sm" style={{ color: 'var(--jv-suave)' }}>
              O alvo é <span className="jv-num font-semibold" style={{ color: 'var(--jv-texto)' }}>R$ 1.000.000</span>{' '}
              livres no caixa. Entre para ver onde a loja está hoje.
            </p>
          </div>

          {token ? (
            ehAdmin ? (
              <div>
                <p className="text-lg">
                  Tudo pronto, <strong>{usuario?.nome?.split(' ')[0]}</strong>.
                </p>
                <p className="mt-1 text-sm" style={{ color: 'var(--jv-suave)' }}>
                  O agente olha a loja a cada 30 minutos e já tem o que te contar.
                </p>
                <button type="button" className="jv-btn jv-btn-primario mt-6" onClick={aoEntrar}>
                  Abrir o painel <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div>
                <p className="text-lg">O painel do JARVIS é do gestor.</p>
                <p className="mt-1 text-sm" style={{ color: 'var(--jv-suave)' }}>
                  Você entrou como {usuario?.nome}. As sugestões que são suas aparecem no Meu Dashboard.
                </p>
                <Link to="/meu-dashboard" className="jv-btn jv-btn-quieto mt-6">
                  Ir para o Meu Dashboard
                </Link>
              </div>
            )
          ) : (
            <form onSubmit={autenticar} className="max-w-sm">
              <label className="mb-1.5 block text-sm" style={{ color: 'var(--jv-suave)' }} htmlFor="jv-email">
                E-mail
              </label>
              <div className="relative mb-4">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: 'var(--jv-apagado)' }} />
                <input
                  id="jv-email"
                  type="email"
                  autoComplete="username"
                  className="jv-campo pl-9"
                  placeholder="voce@balao.info"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>

              <label className="mb-1.5 block text-sm" style={{ color: 'var(--jv-suave)' }} htmlFor="jv-senha">
                Senha
              </label>
              <div className="relative mb-6">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: 'var(--jv-apagado)' }} />
                <input
                  id="jv-senha"
                  type="password"
                  autoComplete="current-password"
                  className="jv-campo pl-9"
                  placeholder="sua senha"
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  required
                />
              </div>

              <button type="submit" className="jv-btn jv-btn-primario w-full" disabled={entrando}>
                {entrando ? 'Entrando…' : 'Entrar'} <ArrowRight className="h-4 w-4" />
              </button>
              <p className="mt-4 text-xs" style={{ color: 'var(--jv-apagado)' }}>
                É o mesmo acesso do MEU BLING.
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
