import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { api, mensagemErro } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { Button, Card, Definicoes, Input, PageHeader } from '@/components/ui';
import { rotulo } from '@/lib/format';

/** Minha conta: dados do usuário e troca de senha */
export default function Perfil() {
  const usuario = useAuth((s) => s.usuario);
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

  return (
    <div className="max-w-2xl">
      <PageHeader titulo="Minha conta" descricao="Seus dados de acesso." />
      <div className="space-y-4">
        <Card titulo="Dados">
          <Definicoes itens={[{ rotulo: 'Nome', valor: usuario?.nome }, { rotulo: 'E-mail', valor: usuario?.email }, { rotulo: 'Perfil', valor: rotulo(usuario?.perfil) }]} colunas={3} />
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
