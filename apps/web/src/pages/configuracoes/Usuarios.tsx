import { useTecnicos, useVendedores, opcoesDe } from '@/hooks/useListas';
import { CrudSimples } from '@/components/compartilhados/CrudSimples';
import { Badge, Checkbox, Input, Select } from '@/components/ui';
import { dataHora, rotulo } from '@/lib/format';
import type { Perfil, Usuario } from '@/types';

type UsuarioForm = Usuario & { senha?: string };
const PERFIS: Perfil[] = ['ADMIN', 'GERENTE', 'VENDEDOR', 'TECNICO', 'FINANCEIRO'];

/** Usuários e perfis de acesso */
export default function Usuarios() {
  const { data: vendedores } = useVendedores(false);
  const { data: tecnicos } = useTecnicos(false);
  return (
    <CrudSimples<UsuarioForm>
      titulo="Usuários"
      descricao="Acessos ao sistema. Vincule o usuário a um vendedor/técnico para filtrar suas vendas e OS."
      rota="/usuarios"
      rotuloNovo="Novo usuário"
      vazio={{ nome: '', email: '', perfil: 'VENDEDOR', ativo: true, vendedorId: null, tecnicoId: null, senha: '' }}
      validar={(f) => (!f.nome?.trim() ? 'Informe o nome.' : !f.email?.trim() ? 'Informe o e-mail.' : !f.id && (f.senha ?? '').length < 6 ? 'Senha inicial com ao menos 6 caracteres.' : null)}
      antesDeSalvar={(f) => { const { ultimoLogin: _u, criadoEm: _c, ...resto } = f; if (!resto.senha) delete resto.senha; return resto; }}
      colunas={[
        { titulo: 'Nome', render: (u) => <span className="font-medium">{u.nome}</span> },
        { titulo: 'E-mail', render: (u) => <span className="text-slate-500">{u.email}</span> },
        { titulo: 'Perfil', render: (u) => <Badge tom={u.perfil === 'ADMIN' ? 'vermelho' : u.perfil === 'GERENTE' ? 'roxo' : 'neutro'}>{rotulo(u.perfil)}</Badge> },
        { titulo: 'Vínculo', render: (u) => <span className="text-xs text-slate-500">{u.vendedorId ? `Vendedor #${u.vendedorId}` : u.tecnicoId ? `Técnico #${u.tecnicoId}` : '—'}</span> },
        { titulo: 'Último login', render: (u) => <span className="text-xs text-slate-500">{u.ultimoLogin ? dataHora(u.ultimoLogin) : 'nunca'}</span> },
        { titulo: 'Situação', render: (u) => <Badge tom={u.ativo ? 'verde' : 'cinza'}>{u.ativo ? 'Ativo' : 'Inativo'}</Badge> },
      ]}
      formulario={(f, set) => (
        <>
          <Input label="Nome" obrigatorio value={f.nome ?? ''} onChange={(e) => set({ nome: e.target.value })} autoFocus />
          <Input label="E-mail" type="email" obrigatorio value={f.email ?? ''} onChange={(e) => set({ email: e.target.value })} />
          <Input label={f.id ? 'Nova senha (deixe em branco para manter)' : 'Senha inicial'} type="password" value={f.senha ?? ''} onChange={(e) => set({ senha: e.target.value })} autoComplete="new-password" />
          <Select label="Perfil" value={f.perfil ?? 'VENDEDOR'} onChange={(e) => set({ perfil: e.target.value as Perfil })} opcoes={PERFIS.map((p) => ({ valor: p, rotulo: rotulo(p) }))} />
          <div className="grid grid-cols-2 gap-3">
            <Select label="Vendedor vinculado" value={f.vendedorId ?? ''} onChange={(e) => set({ vendedorId: e.target.value ? Number(e.target.value) : null })} opcoes={opcoesDe(vendedores)} placeholder="—" />
            <Select label="Técnico vinculado" value={f.tecnicoId ?? ''} onChange={(e) => set({ tecnicoId: e.target.value ? Number(e.target.value) : null })} opcoes={opcoesDe(tecnicos)} placeholder="—" />
          </div>
          <Checkbox label="Ativo" checked={f.ativo ?? true} onChange={(e) => set({ ativo: e.target.checked })} />
        </>
      )}
    />
  );
}
