/**
 * ROBÔ DE NF no pedido de venda.
 *
 * O robô (que roda 24h na API) confere a venda, preenche sozinho o que consegue (endereço do
 * cliente pelo CEP/CNPJ, código IBGE, NCM dos produtos) e acende o botão:
 *   🟢 "Pronto pra NF"     → abre a confirmação e um clique emite a NF-e A4 e envia à SEFAZ
 *   🟡 "Falta N pra NF"    → abre a lista do que o robô não resolveu, com o link de onde corrigir
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Bot, CheckCircle2, Loader2, RefreshCw, Send, Sparkles } from 'lucide-react';
import { api, ApiError, mensagemErro } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { Button, Modal, Textarea } from '@/components/ui';
import { ListaPendenciasNfe, type PendenciaNfe } from './EmitirNfModal';
import { dataHora } from '@/lib/format';

export interface EstadoRoboNf {
  vendaId: number;
  status: 'PRONTA' | 'PENDENTE' | 'EMITIDA' | 'IGNORADA';
  erros: number;
  avisos: number;
  pendencias: PendenciaNfe[];
  preenchido: string[];
  verificadoEm: string;
  resumo: string;
}

interface ResultadoEmissao {
  notaId: number;
  numero: number;
  situacao: string;
  chave?: string | null;
  cStat?: string | null;
  motivo?: string | null;
}

export function BotaoRoboNf({ vendaId, numero, onEmitida }: { vendaId: number; numero: number; onEmitida?: () => void }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [aberto, setAberto] = useState(false);
  const [info, setInfo] = useState('');
  const [confirmando, setConfirmando] = useState<number | null>(null);
  const podeEmitir = useAuth((s) => s.temPerfil('GERENTE', 'FINANCEIRO', 'VENDEDOR'));
  const podeConfirmarNcm = useAuth((s) => s.temPerfil('GERENTE'));

  const estado = useQuery({
    queryKey: ['robo-nf', vendaId],
    queryFn: () => api.get<EstadoRoboNf>(`/vendas/${vendaId}/robo-nf`),
    // voltou da aba onde corrigiu o cadastro → o robô confere de novo
    refetchOnWindowFocus: true,
    refetchInterval: (q) => (q.state.data?.status === 'PENDENTE' ? 30_000 : false),
    staleTime: 0,
  });

  const conferir = useMutation({
    mutationFn: () => api.post<EstadoRoboNf>(`/vendas/${vendaId}/robo-nf/conferir`),
    onSuccess: (e) => qc.setQueryData(['robo-nf', vendaId], e),
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const confirmarNcm = useMutation({
    mutationFn: (c: { produtoId: number; ncm: string }) => api.post(`/produtos/${c.produtoId}/confirmar-ncm`, { ncm: c.ncm }),
    onMutate: (c) => setConfirmando(c.produtoId),
    onSuccess: () => {
      toast.success('NCM confirmado — vale para todas as vendas deste produto.');
      conferir.mutate();
    },
    onError: (e) => toast.error(e instanceof ApiError && e.status === 403 ? 'Só a gerência confirma NCM. Peça para a gerente ou o Thiago.' : mensagemErro(e)),
    onSettled: () => setConfirmando(null),
  });

  const emitir = useMutation({
    mutationFn: () => api.post<ResultadoEmissao>(`/vendas/${vendaId}/emitir-nf`, { informacoesComplementares: info || undefined }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['venda', String(vendaId)] });
      qc.invalidateQueries({ queryKey: ['vendas'] });
      qc.invalidateQueries({ queryKey: ['robo-nf', vendaId] });
      if (r.situacao === 'AUTORIZADA') {
        toast.success(`NF-e nº ${r.numero} autorizada pela SEFAZ.`, { description: 'O DANFE (A4) já está na nota.' });
      } else {
        toast.error(`NF-e nº ${r.numero}: ${r.situacao.toLowerCase()}`, { description: r.motivo || 'Abra a nota para ver o que a SEFAZ pediu.' });
      }
      setAberto(false);
      onEmitida?.();
      nav(`/notas-fiscais/${r.notaId}`);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'NFE_PENDENCIAS' && e.detalhes) qc.setQueryData(['robo-nf', vendaId], e.detalhes as EstadoRoboNf);
      toast.error(mensagemErro(e));
    },
  });

  const e = estado.data;
  if (!e || e.status === 'EMITIDA' || e.status === 'IGNORADA') {
    if (estado.isLoading)
      return (
        <Button variante="secundario" disabled icone={<Loader2 className="h-4 w-4 animate-spin" />}>
          Robô conferindo…
        </Button>
      );
    return null;
  }
  const pronta = e.status === 'PRONTA';

  return (
    <>
      {pronta ? (
        <Button variante="sucesso" icone={<CheckCircle2 className="h-4 w-4" />} onClick={() => setAberto(true)} title="O robô conferiu tudo: é só emitir">
          Pronto pra NF
        </Button>
      ) : (
        <Button
          variante="secundario"
          className="!border-amber-300 !bg-amber-50 !text-amber-800 hover:!bg-amber-100"
          icone={<Bot className="h-4 w-4" />}
          onClick={() => setAberto(true)}
          title="O robô preencheu o que conseguiu; veja o que falta"
        >
          {e.resumo}
        </Button>
      )}

      <Modal
        aberto={aberto}
        onFechar={() => setAberto(false)}
        tamanho="lg"
        titulo={pronta ? `Emitir NF-e da venda nº ${numero}` : `O que falta para a NF da venda nº ${numero}`}
        descricao={`Robô de NF · conferido em ${dataHora(e.verificadoEm)}`}
        rodape={
          <>
            <Button variante="secundario" onClick={() => setAberto(false)}>
              Fechar
            </Button>
            <Button variante="secundario" icone={<RefreshCw className="h-4 w-4" />} carregando={conferir.isPending} onClick={() => conferir.mutate()}>
              Conferir de novo
            </Button>
            {pronta && podeEmitir && (
              <Button variante="sucesso" icone={<Send className="h-4 w-4" />} carregando={emitir.isPending} onClick={() => emitir.mutate()}>
                Emitir e enviar à SEFAZ
              </Button>
            )}
          </>
        }
      >
        <div className="space-y-4">
          {pronta ? (
            <div className="rounded-lg bg-emerald-600 px-3 py-2 text-sm text-white">
              <p className="flex items-center gap-2 font-medium">
                <CheckCircle2 className="h-4 w-4" /> Tudo conferido. A NF-e (A4) vai para a SEFAZ quando você clicar em “Emitir”.
              </p>
              {!!e.avisos && <p className="text-xs text-emerald-50">{e.avisos} aviso{e.avisos > 1 ? 's' : ''} para dar uma olhada antes (não impedem a emissão).</p>}
              {!podeEmitir && <p className="text-xs text-emerald-50">Seu perfil não emite nota: peça para o vendedor ou a gerência.</p>}
            </div>
          ) : (
            <div className="rounded-lg bg-amber-500 px-3 py-2 text-sm text-white">
              <p className="font-medium">O robô preencheu o que conseguiu. Falta{e.erros > 1 ? 'm' : ''} {e.erros} ite{e.erros > 1 ? 'ns' : 'm'} que precisa{e.erros > 1 ? 'm' : ''} de alguém.</p>
              <p className="text-xs text-amber-50">Clique no botão de cada item: a tela abre em outra aba no lugar certo. Ao voltar para esta aba o robô confere de novo sozinho.</p>
            </div>
          )}

          {e.pendencias.length > 0 && <ListaPendenciasNfe checagem={{ pendencias: e.pendencias, ok: [] }} onConfirmarNcm={podeConfirmarNcm ? (c) => confirmarNcm.mutate(c) : undefined} confirmando={confirmando} />}

          {pronta && (
            <Textarea label="Informações complementares da nota (opcional)" value={info} onChange={(ev) => setInfo(ev.target.value)} rows={2} placeholder="Ex.: garantia de 12 meses, nº de série…" />
          )}

          {e.preenchido.length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <Sparkles className="h-3.5 w-3.5" /> O robô preencheu sozinho
              </p>
              <ul className="space-y-0.5 text-xs text-slate-700">
                {e.preenchido.slice(0, 15).map((p, i) => (
                  <li key={i}>• {p}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
