import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { api, mensagemErro } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { Button, Card, Definicoes, Input, PageHeader } from '@/components/ui';
import { rotulo } from '@/lib/format';
import type { LoginResposta } from '@/types';

/** Minha conta: dados do usuário e troca de senha */
export default function Perfil() {
  const usuario = useAuth((s) => s.usuario);
  const login = useAuth((s) => s.login);
  const podeTrocar = usuario?.perfil === 'VENDEDOR' || usuario?.perfil === 'TECNICO';
  const [trocando, setTrocando] = useState(false);
  const [senhaAtual, setSenhaAtual] = useState('');
  const [novaSenha, setNovaSenha] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [carregando, setCarregando] = useState(false);

  const salvar = async (e: FormEvent) => {
    e.preventDefault();
    if (novaSenha !== confirmar) return toast.error('A confirmação não confere com a nova senha.');
    if (novaSenha.length < 6) return toast.error('A nova senha deve ter ao menos 6 caracteres.');
    setCarregando(true);
    try {
      await api.put('/auth/senha', { senhaAtual, novaSenha });
      toast.success('Senha alterada com sucesso.');
      setSenhaAtual('');
      setNovaSenha('');
      setConfirmar('');
    } catch (err) {
      toast.error(mensagemErro(err));
    } finally {
      setCarregando(false);
    }
  };

  const outro = usuario?.perfil === 'TECNICO' ? 'VENDEDOR' : 'TECNICO';
  const trocarPerfil = async () => {
    setTrocando(true);
    try {
      const r = await api.post<LoginResposta & { alterado?: boolean }>('/auth/trocar-perfil', { perfil: outro });
      login(r.token, r.usuario);
      toast.success(outro === 'TECNICO' ? 'Agora você acompanha as OS como técnico e continua vendendo.' : 'Perfil voltou para vendedor.');
    } catch (err) {
      toast.error(mensagemErro(err));
    } finally {
      setTrocando(false);
    }
  };

  return (
    <div className="max-w-2xl">
      <PageHeader titulo="Minha conta" descricao="Seus dados de acesso." />
      <div className="space-y-4">
        <Card titulo="Dados">
          <Definicoes itens={[{ rotulo: 'Nome', valor: usuario?.nome }, { rotulo: 'E-mail', valor: usuario?.email }, { rotulo: 'Perfil', valor: rotulo(usuario?.perfil) }]} colunas={3} />
          {podeTrocar && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
              <p className="max-w-xl text-sm text-slate-600">
                {usuario?.perfil === 'VENDEDOR'
                  ? 'Para acompanhar as ordens de serviço e os serviços da assistência, mude para técnico. As suas vendas continuam no seu nome.'
                  : 'Você está como técnico e também vende. Se quiser voltar a ver só o painel de vendedor, dá para trocar de novo.'}
              </p>
              <Button variante="primario" carregando={trocando} onClick={trocarPerfil}>
                {usuario?.perfil === 'VENDEDOR' ? 'Acompanhar as OS como técnico' : 'Voltar para vendedor'}
              </Button>
            </div>
          )}
          {usuario?.perfil === 'ADMIN' && (
            <p className="mt-4 text-sm text-slate-500">Para mudar o perfil de outra pessoa: Configurações → Usuários, abra o usuário, escolha Técnico e deixe “Também vende” marcado. A pessoa sai e entra de novo.</p>
          )}
        </Card>
        <Card titulo="Alterar senha">
          <form onSubmit={salvar} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Input label="Senha atual" type="password" required value={senhaAtual} onChange={(e) => setSenhaAtual(e.target.value)} autoComplete="current-password" />
            <Input label="Nova senha" type="password" required value={novaSenha} onChange={(e) => setNovaSenha(e.target.value)} autoComplete="new-password" />
            <Input label="Confirmar nova senha" type="password" required value={confirmar} onChange={(e) => setConfirmar(e.target.value)} autoComplete="new-password" />
            <div className="sm:col-span-2 lg:col-span-3">
              <Button type="submit" variante="primario" carregando={carregando}>
                Salvar nova senha
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}
