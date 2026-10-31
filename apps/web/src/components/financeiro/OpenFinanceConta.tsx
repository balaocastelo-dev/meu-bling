import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import clsx from 'clsx';
import { PlugZap, RefreshCw, Unlink } from 'lucide-react';
import { api, mensagemErro } from '@/lib/api';
import { abrirPluggyConnect } from '@/lib/pluggy';
import { useEmpresa } from '@/hooks/useEmpresa';
import { useAuth } from '@/stores/auth';
import { Badge, Button, Modal } from '@/components/ui';
import { dataHora, moeda } from '@/lib/format';
import type { ContaFinanceira, OpenFinanceStatus } from '@/types';

interface ContaBanco {
  id: string;
  nome: string;
  tipo: string;
  subtipo: string;
  numero: string | null;
  saldo: number;
  banco?: string | null;
  agencia?: string | null;
}

function digitos(s?: string | null) {
  return (s || '').replace(/\D/g, '');
}

/** Qual conta do banco corresponde a esta conta financeira, quando a conexão devolve mais de uma. */
function sugerirConta(conta: ContaFinanceira, lista: ContaBanco[]): string {
  if (conta.openFinanceAccountId && lista.some((c) => c.id === conta.openFinanceAccountId)) return conta.openFinanceAccountId;
  const numero = digitos(conta.conta);
  if (numero.length >= 4) {
    const iguais = lista.filter((c) => digitos(c.numero) === numero);
    if (iguais.length === 1) return iguais[0].id;
  }
  const nome = conta.nome.trim().toLowerCase();
  const porNome = lista.filter((c) => {
    const n = c.nome.trim().toLowerCase();
    return nome.length > 2 && (n.includes(nome) || nome.includes(n));
  });
  if (porNome.length === 1) return porNome[0].id;
  return lista[0].id;
}

function situacao(c: ContaFinanceira): { tom: 'verde' | 'vermelho' | 'cinza'; rotulo: string; detalhe?: string } {
  if (!c.openFinanceItemId) return { tom: 'cinza', rotulo: 'Não conectada' };
  const st = (c.openFinanceStatus || '').trim();
  if (/^ERRO\b/i.test(st) || /LOGIN_ERROR|OUTDATED/i.test(st)) {
    const msg = st.replace(/^ERRO:\s*/i, '').trim();
    return { tom: 'vermelho', rotulo: 'Erro', detalhe: msg || 'Falha na conexão com o banco' };
  }
  return {
    tom: 'verde',
    rotulo: 'Conectado',
    detalhe: c.ultimaSincronizacao ? `última sincronização ${dataHora(c.ultimaSincronizacao)}` : 'ainda sem sincronização',
  };
}

/** Botão e status de Open Finance de uma conta financeira. O client secret não passa por aqui. */
export function OpenFinanceConta({ conta, compacto = false }: { conta: ContaFinanceira; compacto?: boolean }) {
  const qc = useQueryClient();
  const { data: emp } = useEmpresa();
  const podeDesconectar = useAuth((s) => s.temPerfil('ADMIN', 'GERENTE'));
  const { data: of } = useQuery({
    queryKey: ['open-finance-status'],
    queryFn: () => api.get<OpenFinanceStatus>('/open-finance/status').catch(() => null),
    staleTime: 60_000,
  });
  const [escolha, setEscolha] = useState<{ itemId: string; contas: ContaBanco[]; accountId: string } | null>(null);
  const st = situacao(conta);
  const ativo = !!of?.ativo;

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ['contas-financeiras'] });
    qc.invalidateQueries({ queryKey: ['/contas-financeiras'] });
    qc.invalidateQueries({ queryKey: ['open-finance-status'] });
    qc.invalidateQueries({ queryKey: ['transacoes'] });
    qc.invalidateQueries({ queryKey: ['financeiro-resumo'] });
    qc.invalidateQueries({ queryKey: ['extrato-conta'] });
    qc.invalidateQueries({ queryKey: ['movimentos-fin'] });
  };

  const gravarESincronizar = async (itemId: string, accountId: string) => {
    await api.post('/open-finance/vincular', { itemId, contaFinanceiraId: conta.id, accountId });
    try {
      const r = await api.post<{ saldo: number; novasTransacoes: number }>(`/open-finance/sincronizar/${conta.id}`);
      toast.success(`${conta.nome} conectada ao Open Finance.`, { description: `${r.novasTransacoes ?? 0} transações novas` });
    } catch (e) {
      toast.error(`Conta vinculada, mas a sincronização falhou: ${mensagemErro(e)}`);
    }
    invalidar();
  };

  const conectar = useMutation({
    mutationFn: async (reconectar: boolean) => {
      const corpo = reconectar && conta.openFinanceItemId ? { itemId: conta.openFinanceItemId } : {};
      const { accessToken } = await api.post<{ accessToken: string }>('/open-finance/connect-token', corpo);
      const item = await abrirPluggyConnect(accessToken, { cnpj: emp?.cnpj });
      if (!item) return null;
      const contas = await api.get<ContaBanco[]>(`/open-finance/itens/${encodeURIComponent(item.id)}/contas`);
      if (!contas.length) throw new Error('Nenhuma conta encontrada nesta conexão.');
      if (contas.length === 1) {
        await gravarESincronizar(item.id, contas[0].id);
        return 'ok' as const;
      }
      setEscolha({ itemId: item.id, contas, accountId: sugerirConta(conta, contas) });
      return 'escolher' as const;
    },
    onSuccess: (r) => {
      if (r === null) toast.message('Conexão cancelada. Nada foi vinculado.');
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const confirmarEscolha = useMutation({
    mutationFn: () => gravarESincronizar(escolha!.itemId, escolha!.accountId),
    onSuccess: () => setEscolha(null),
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const sincronizar = useMutation({
    mutationFn: () => api.post<{ novasTransacoes: number }>(`/open-finance/sincronizar/${conta.id}`),
    onSuccess: (r) => {
      toast.success(`${conta.nome} sincronizada.`, { description: `${r.novasTransacoes ?? 0} transações novas` });
      invalidar();
    },
    onError: (e) => {
      toast.error(mensagemErro(e));
      invalidar();
    },
  });

  const desconectar = useMutation({
    mutationFn: () => api.del(`/open-finance/desvincular/${conta.id}`),
    onSuccess: () => {
      toast.success(`${conta.nome} desconectada do Open Finance.`);
      invalidar();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const ocupado = conectar.isPending || confirmarEscolha.isPending || sincronizar.isPending || desconectar.isPending;
  const tituloOff = of && !of.ativo ? 'Ative o Open Finance em Configurações → Open Finance' : undefined;

  return (
    <div className={clsx('flex flex-col gap-1.5', compacto ? 'max-w-[18rem]' : '')} onClick={(e) => e.stopPropagation()}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <Badge tom={st.tom} ponto>{st.rotulo}</Badge>
        {st.detalhe && (
          <span className="text-[11px] text-slate-500" title={st.detalhe}>
            {st.detalhe.length > (compacto ? 42 : 80) ? `${st.detalhe.slice(0, compacto ? 42 : 80)}…` : st.detalhe}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {!conta.openFinanceItemId ? (
          <Button tamanho="xs" variante="primario" icone={<PlugZap className="h-3.5 w-3.5" />} carregando={conectar.isPending} disabled={!ativo || ocupado} title={tituloOff} onClick={() => conectar.mutate(false)}>
            Conectar Open Finance
          </Button>
        ) : (
          <>
            <Button tamanho="xs" variante="secundario" icone={<RefreshCw className={clsx('h-3.5 w-3.5', sincronizar.isPending && 'animate-spin')} />} disabled={!ativo || ocupado} title={tituloOff} onClick={() => sincronizar.mutate()}>
              Sincronizar
            </Button>
            <Button tamanho="xs" variante={st.tom === 'vermelho' ? 'primario' : 'secundario'} icone={<PlugZap className="h-3.5 w-3.5" />} carregando={conectar.isPending} disabled={!ativo || ocupado} title={tituloOff || 'Abre de novo o banco nesta mesma conexão'} onClick={() => conectar.mutate(true)}>
              Reconectar
            </Button>
            {podeDesconectar && (
              <Button
                tamanho="xs"
                variante="fantasma"
                icone={<Unlink className="h-3.5 w-3.5" />}
                disabled={ocupado}
                onClick={() => {
                  if (confirm(`Desconectar ${conta.nome} do Open Finance? O saldo e o extrato já importados continuam no sistema.`)) desconectar.mutate();
                }}
              >
                Desconectar
              </Button>
            )}
          </>
        )}
      </div>

      <Modal
        aberto={!!escolha}
        onFechar={() => { if (!confirmarEscolha.isPending) setEscolha(null); }}
        titulo={`Qual conta do banco é ${conta.nome}?`}
        descricao="A conexão trouxe mais de uma conta. Escolha a que corresponde a esta conta financeira. O vínculo e a sincronização acontecem em seguida."
        rodape={
          <>
            <Button variante="secundario" onClick={() => setEscolha(null)} disabled={confirmarEscolha.isPending}>Cancelar</Button>
            <Button variante="primario" carregando={confirmarEscolha.isPending} disabled={!escolha?.accountId} onClick={() => confirmarEscolha.mutate()}>Vincular e sincronizar</Button>
          </>
        }
      >
        <div className="space-y-2">
          {escolha?.contas.map((c) => (
            <label key={c.id} className={clsx('flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2', escolha.accountId === c.id ? 'border-brand-500 bg-brand-50' : 'border-slate-200 hover:bg-slate-50')}>
              <input type="radio" className="mt-1" name={`of-${conta.id}`} checked={escolha.accountId === c.id} onChange={() => setEscolha({ ...escolha, accountId: c.id })} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-slate-800">{c.nome}</span>
                <span className="block text-xs text-slate-500">{[c.tipo, c.subtipo, c.numero && `cc ${c.numero}`, c.agencia && `ag ${c.agencia}`].filter(Boolean).join(' · ')}</span>
              </span>
              <span className="num text-sm font-medium text-slate-700">{moeda(c.saldo)}</span>
            </label>
          ))}
        </div>
      </Modal>
    </div>
  );
}
