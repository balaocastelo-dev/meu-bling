import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { api, mensagemErro } from '@/lib/api';
import { Button, Card, ConfirmDialog, EmptyState, Modal, PageHeader, Skeleton, Table } from '@/components/ui';

interface Props<T extends { id: number }> {
  titulo: string;
  descricao?: string;
  /** rota da API, ex.: /vendedores */
  rota: string;
  /** chaves de query a invalidar (além da própria rota) */
  invalidar?: string[];
  colunas: { titulo: ReactNode; render: (item: T) => ReactNode; className?: string }[];
  /** formulário: recebe o estado e o setter */
  formulario: (form: Partial<T>, set: (patch: Partial<T>) => void) => ReactNode;
  vazio: Partial<T>;
  /** validação simples antes de salvar; devolve mensagem de erro ou null */
  validar?: (form: Partial<T>) => string | null;
  rotuloNovo?: string;
  migalhas?: { rotulo: string; para?: string }[];
  /** itens que não podem ser excluídos (ex.: sistema) */
  podeExcluir?: (item: T) => boolean;
  /** transforma antes de enviar */
  antesDeSalvar?: (form: Partial<T>) => Partial<T>;
}

/** Tela de cadastro simples (lista + modal de edição) para configurações */
export function CrudSimples<T extends { id: number }>({ titulo, descricao, rota, invalidar, colunas, formulario, vazio, validar, rotuloNovo = 'Novo', migalhas, podeExcluir, antesDeSalvar }: Props<T>) {
  const qc = useQueryClient();
  const [editando, setEditando] = useState<Partial<T> | null>(null);
  const [excluir, setExcluir] = useState<T | null>(null);

  const { data, isLoading, error } = useQuery({ queryKey: [rota], queryFn: async () => { const r = await api.get<T[] | { data: T[] }>(rota); return Array.isArray(r) ? r : r.data; } });

  const inv = () => {
    qc.invalidateQueries({ queryKey: [rota] });
    invalidar?.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  };
  const salvar = useMutation({
    mutationFn: (f: Partial<T>) => {
      const body = antesDeSalvar ? antesDeSalvar(f) : f;
      return f.id ? api.put<T>(`${rota}/${f.id}`, body) : api.post<T>(rota, body);
    },
    onSuccess: () => {
      toast.success('Salvo.');
      inv();
      setEditando(null);
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });
  const remover = useMutation({
    mutationFn: (id: number) => api.del(`${rota}/${id}`),
    onSuccess: () => {
      toast.success('Excluído.');
      inv();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const submeter = () => {
    if (!editando) return;
    const erro = validar?.(editando);
    if (erro) return toast.error(erro);
    salvar.mutate(editando);
  };

  return (
    <div>
      <PageHeader titulo={titulo} descricao={descricao} migalhas={migalhas ?? [{ rotulo: 'Configurações', para: '/configuracoes' }, { rotulo: titulo }]} acoes={<Button variante="primario" icone={<Plus className="h-4 w-4" />} onClick={() => setEditando({ ...vazio })}>{rotuloNovo}</Button>} />
      <Card semPadding>
        {isLoading ? (
          <div className="p-4"><Skeleton className="h-48" /></div>
        ) : error ? (
          <EmptyState titulo="Não foi possível carregar" descricao={mensagemErro(error)} />
        ) : !data?.length ? (
          <EmptyState titulo="Nenhum registro" acao={<Button variante="primario" onClick={() => setEditando({ ...vazio })}>{rotuloNovo}</Button>} />
        ) : (
          <Table
            dados={data}
            chave={(item) => item.id}
            onClickLinha={(item) => setEditando({ ...item })}
            colunas={[
              ...colunas.map((c, i) => ({ chave: `c${i}`, titulo: c.titulo, className: c.className, render: (item: T) => c.render(item) })),
              {
                chave: 'acoes',
                titulo: '',
                largura: '96px',
                render: (item: T) => (
                  <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                    <Button tamanho="xs" variante="fantasma" aria-label="Editar" icone={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEditando({ ...item })} />
                    {(podeExcluir?.(item) ?? true) && <Button tamanho="xs" variante="fantasma" aria-label="Excluir" icone={<Trash2 className="h-3.5 w-3.5 text-red-500" />} onClick={() => setExcluir(item)} />}
                  </div>
                ),
              },
            ]}
          />
        )}
      </Card>

      <Modal aberto={!!editando} onFechar={() => setEditando(null)} titulo={editando?.id ? 'Editar' : rotuloNovo} rodape={<><Button variante="secundario" onClick={() => setEditando(null)}>Cancelar</Button><Button variante="primario" carregando={salvar.isPending} onClick={submeter}>Salvar</Button></>}>
        {editando && (
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); submeter(); }}>
            {formulario(editando, (patch) => setEditando((f) => ({ ...f, ...patch }) as Partial<T>))}
            <button type="submit" className="hidden" />
          </form>
        )}
      </Modal>
      <ConfirmDialog aberto={!!excluir} onFechar={() => setExcluir(null)} titulo="Excluir registro?" descricao="Registros em uso por outros cadastros não podem ser excluídos." textoConfirmar="Excluir" onConfirmar={async () => { if (excluir) await remover.mutateAsync(excluir.id); }} />
    </div>
  );
}
