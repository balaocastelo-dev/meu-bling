/**
 * "Emitir nota fiscal" de uma venda ou OS, com o checklist da NF:
 * mostra TUDO o que falta (empresa, certificado, cliente, produtos…), cada item com o botão
 * que abre a tela certa para preencher. "Verificar de novo" (ou voltar para esta aba) refaz a checagem.
 * Só libera "Gerar nota" quando não há pendência que a SEFAZ rejeitaria.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, ExternalLink, RefreshCw, XCircle } from 'lucide-react';
import { api, ApiError, BASE_PATH, mensagemErro } from '@/lib/api';
import { Button, Modal, Select, Textarea } from '@/components/ui';

export interface AcaoPendencia {
  rotulo: string;
  rota: string;
}
export interface PendenciaNfe {
  nivel: 'erro' | 'aviso';
  codigo: string;
  grupo: string;
  titulo: string;
  detalhe?: string;
  acoes?: AcaoPendencia[];
  /** NCM sugerido pelo robô de NF: botão "Confirmar NCM" */
  confirmarNcm?: { produtoId: number; ncm: string; produto: string };
}
export interface ChecagemNfe {
  podeEmitir: boolean;
  modelo: 55 | 65;
  erros: number;
  avisos: number;
  pendencias: PendenciaNfe[];
  ok: string[];
  resumo: { cliente: string; itensNota: number; proximoNumero: number; serie: number; ambiente: string; provedor: string };
}

const GRUPOS: Record<string, string> = {
  DOCUMENTO: 'Nota',
  EMPRESA: 'Empresa',
  CONFIGURACAO: 'Configuração fiscal',
  ITENS: 'Produtos',
  CLIENTE: 'Cliente',
};

interface Props {
  aberto: boolean;
  onFechar: () => void;
  /** 'vendas' ou 'ordens-servico' */
  origem: 'vendas' | 'ordens-servico';
  id: number;
  numero?: number;
  onGerada: (notaId: number) => void;
}

/** Abre a tela de correção em outra aba, para o checklist continuar aberto aqui. */
function abrir(rota: string) {
  window.open(`${BASE_PATH}${rota}`, '_blank', 'noopener');
}

const fmtNcm = (n: string) => (n.length === 8 ? `${n.slice(0, 4)}.${n.slice(4, 6)}.${n.slice(6)}` : n);

export function ListaPendenciasNfe({
  checagem,
  onConfirmarNcm,
  confirmando,
}: {
  checagem: Pick<ChecagemNfe, 'pendencias' | 'ok'>;
  /** quando informado, mostra o botão "Confirmar NCM" nas sugestões do robô */
  onConfirmarNcm?: (c: NonNullable<PendenciaNfe['confirmarNcm']>) => void;
  confirmando?: number | null;
}) {
  return (
    <div className="space-y-3">
      {checagem.pendencias.map((p, i) => (
        <div
          key={`${p.codigo}-${i}`}
          className={
            p.nivel === 'erro'
              ? 'rounded-lg border border-red-200 bg-red-50 p-3'
              : 'rounded-lg border border-amber-200 bg-amber-50 p-3'
          }
        >
          <div className="flex items-start gap-2">
            {p.nivel === 'erro' ? <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />}
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{GRUPOS[p.grupo] || p.grupo}</p>
              <p className={p.nivel === 'erro' ? 'text-sm font-medium text-red-900' : 'text-sm font-medium text-amber-900'}>{p.titulo}</p>
              {p.detalhe && <p className="mt-0.5 text-xs text-gray-700">{p.detalhe}</p>}
              {(!!p.acoes?.length || (p.confirmarNcm && onConfirmarNcm)) && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {p.confirmarNcm && onConfirmarNcm && (
                    <Button tamanho="sm" variante="sucesso" icone={<CheckCircle2 className="h-3.5 w-3.5" />} carregando={confirmando === p.confirmarNcm.produtoId} onClick={() => onConfirmarNcm(p.confirmarNcm!)}>
                      Confirmar NCM {fmtNcm(p.confirmarNcm.ncm)}
                    </Button>
                  )}
                  {(p.acoes || []).map((a) => (
                    <Button key={a.rota} tamanho="sm" variante={p.nivel === 'erro' ? 'primario' : 'secundario'} iconeDireita={<ExternalLink className="h-3.5 w-3.5" />} onClick={() => abrir(a.rota)}>
                      {a.rotulo}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ))}
      {checagem.ok?.length > 0 && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
          {checagem.ok.map((o) => (
            <p key={o} className="flex items-center gap-2 text-sm text-emerald-900">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" /> {o}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

export function EmitirNfModal({ aberto, onFechar, origem, id, numero, onGerada }: Props) {
  const [modelo, setModelo] = useState<55 | 65>(55);
  const [info, setInfo] = useState('');
  useEffect(() => {
    if (aberto) {
      setModelo(55);
      setInfo('');
    }
  }, [aberto]);

  const checagem = useQuery({
    queryKey: ['nfe-verificar', origem, id, modelo],
    queryFn: () => api.get<ChecagemNfe>(`/${origem}/${id}/nfe/verificar`, { modelo }),
    enabled: aberto,
    // voltou da aba onde corrigiu o cadastro → confere de novo sozinho
    refetchOnWindowFocus: true,
    staleTime: 0,
  });

  const gerar = useMutation({
    mutationFn: () => api.post<{ notaId: number; numero: number }>(`/${origem}/${id}/gerar-nfe`, { modelo, informacoesComplementares: info || undefined }),
    onSuccess: (r) => {
      toast.success(`Nota nº ${r.numero} gerada.`, { description: 'Agora é só conferir e clicar em Transmitir.' });
      onGerada(r.notaId);
    },
    onError: (e) => {
      // pendência descoberta só na hora (cadastro mudou): mostra o checklist atualizado em vez de só o erro
      if (e instanceof ApiError && e.code === 'NFE_PENDENCIAS') checagem.refetch();
      toast.error(mensagemErro(e));
    },
  });

  const c = checagem.data;
  const titulo = `Emitir nota fiscal${numero ? ` — ${origem === 'vendas' ? 'venda' : 'OS'} nº ${numero}` : ''}`;

  return (
    <Modal
      aberto={aberto}
      onFechar={onFechar}
      tamanho="lg"
      titulo={titulo}
      descricao={c ? `Próxima nota: nº ${c.resumo.proximoNumero} · série ${c.resumo.serie} · ${c.resumo.ambiente}${c.resumo.provedor === 'mock' ? ' · SIMULADO' : ''}` : 'Conferindo o que a nota precisa…'}
      rodape={
        <>
          <Button variante="secundario" onClick={onFechar}>Fechar</Button>
          <Button variante="secundario" icone={<RefreshCw className="h-4 w-4" />} carregando={checagem.isFetching} onClick={() => checagem.refetch()}>Verificar de novo</Button>
          <Button variante="primario" disabled={!c?.podeEmitir} carregando={gerar.isPending} onClick={() => gerar.mutate()}>
            {c && !c.podeEmitir ? `Falta${c.erros > 1 ? 'm' : ''} ${c.erros} ite${c.erros > 1 ? 'ns' : 'm'}` : 'Gerar nota'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="Tipo de nota"
            value={modelo}
            onChange={(e) => setModelo(Number(e.target.value) as 55 | 65)}
            opcoes={[{ valor: 55, rotulo: 'NF-e (modelo 55)' }, { valor: 65, rotulo: 'NFC-e (modelo 65 — consumidor)' }]}
          />
          <Textarea label="Informações complementares (opcional)" value={info} onChange={(e) => setInfo(e.target.value)} rows={2} />
        </div>

        {checagem.isLoading && <p className="text-sm text-gray-500">Conferindo empresa, certificado, cliente e produtos…</p>}
        {checagem.isError && <p className="text-sm text-red-700">{mensagemErro(checagem.error)}</p>}

        {c && (
          <>
            {c.podeEmitir ? (
              <div className="flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white">
                <CheckCircle2 className="h-4 w-4" /> Tudo certo para emitir{c.avisos ? ` (${c.avisos} aviso${c.avisos > 1 ? 's' : ''} para conferir)` : ''}.
              </div>
            ) : (
              <div className="rounded-lg bg-red-600 px-3 py-2 text-sm text-white">
                <p className="font-medium">Faltam {c.erros} coisa{c.erros > 1 ? 's' : ''} para a nota sair.</p>
                <p className="text-xs text-red-50">Clique no botão de cada item: a tela abre em outra aba já no lugar certo. Salve lá e volte para esta aba — a lista se atualiza sozinha.</p>
              </div>
            )}
            <ListaPendenciasNfe checagem={c} />
          </>
        )}
      </div>
    </Modal>
  );
}
