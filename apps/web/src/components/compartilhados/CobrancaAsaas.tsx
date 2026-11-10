import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Barcode, Copy, MessageCircle, RefreshCw, Trash2 } from 'lucide-react';
import { api, mensagemErro } from '@/lib/api';
import { Button, Select } from '@/components/ui';
import { dataHora, moeda } from '@/lib/format';

interface Cobranca {
  id: string;
  url: string;
  valor: number;
  status: string;
  vencimento: string;
  linhaDigitavel?: string | null;
}

interface VendaCobranca {
  id: number;
  numero: number;
  total: number;
  asaasCobrancaId?: string | null;
  asaasLinkUrl?: string | null;
  asaasStatus?: string | null;
  asaasEm?: string | null;
  contato?: { celular?: string | null; nome?: string | null } | null;
}

/** Como o Asaas nomeia os status, em português de balcão. */
const STATUS: Record<string, string> = {
  PENDING: 'aguardando pagamento',
  RECEIVED: 'pago',
  CONFIRMED: 'pago (em compensação)',
  RECEIVED_IN_CASH: 'pago em dinheiro',
  OVERDUE: 'vencido',
  REFUNDED: 'estornado',
  DELETED: 'cancelada',
};

const FORMAS = [
  { valor: 'UNDEFINED', rotulo: 'O cliente escolhe (boleto, PIX ou cartão)' },
  { valor: 'PIX', rotulo: 'PIX' },
  { valor: 'BOLETO', rotulo: 'Boleto' },
  { valor: 'CREDIT_CARD', rotulo: 'Cartão de crédito' },
];

/**
 * Cobrança no Asaas gerada a partir do pedido: boleto, PIX ou cartão, com link
 * pronto para mandar ao cliente no WhatsApp sem sair da tela da venda.
 */
export function CobrancaAsaas({ venda }: { venda: VendaCobranca }) {
  const qc = useQueryClient();
  const [forma, setForma] = useState('UNDEFINED');
  const [parcelas, setParcelas] = useState(1);
  const [semChave, setSemChave] = useState(false);

  const invalidar = () => qc.invalidateQueries({ queryKey: ['venda', String(venda.id)] });

  const gerar = useMutation({
    mutationFn: () => api.post<Cobranca>(`/vendas/${venda.id}/cobranca-asaas`, { forma, parcelas }),
    onSuccess: async (c) => {
      setSemChave(false);
      try {
        await navigator.clipboard.writeText(c.url);
        toast.success(`Cobrança de ${moeda(c.valor)} gerada e link copiado.`);
      } catch {
        toast.success(`Cobrança de ${moeda(c.valor)} gerada.`);
      }
      invalidar();
    },
    onError: (e: any) => {
      if (e?.code === 'ASAAS_SEM_CHAVE' || e?.code === 'ASAAS_CHAVE') setSemChave(true);
      toast.error(mensagemErro(e));
    },
  });

  const atualizar = useMutation({
    mutationFn: () => api.get<Cobranca>(`/vendas/${venda.id}/cobranca-asaas`),
    onSuccess: (c) => {
      toast.info(`Situação no Asaas: ${STATUS[c.status] || c.status.toLowerCase()}.`);
      invalidar();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const cancelar = useMutation({
    mutationFn: () => api.del(`/vendas/${venda.id}/cobranca-asaas`),
    onSuccess: () => {
      toast.success('Cobrança cancelada no Asaas.');
      invalidar();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const url = venda.asaasLinkUrl;
  const fone = (venda.contato?.celular || '').replace(/\D/g, '');
  const msg = encodeURIComponent(
    `Olá${venda.contato?.nome ? ` ${venda.contato.nome.split(' ')[0]}` : ''}! Segue o link para pagamento do pedido nº ${venda.numero} da Balão da Informática (${moeda(venda.total)}): ${url}`,
  );
  const pago = venda.asaasStatus === 'RECEIVED' || venda.asaasStatus === 'CONFIRMED' || venda.asaasStatus === 'RECEIVED_IN_CASH';

  return (
    <div className="space-y-2 rounded-md border border-indigo-200 bg-indigo-50/60 p-3">
      <p className="flex items-center gap-2 text-sm font-medium text-indigo-900">
        <Barcode className="h-4 w-4" /> Cobrança no Asaas (boleto, PIX ou cartão)
      </p>

      {url ? (
        <>
          <div className="flex items-center gap-2">
            <input readOnly value={url} className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700" onFocus={(e) => e.target.select()} />
            <Button tamanho="sm" variante="secundario" icone={<Copy className="h-3.5 w-3.5" />} onClick={() => navigator.clipboard.writeText(url).then(() => toast.success('Link copiado.'))}>
              Copiar
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
            <span className={pago ? 'font-medium text-emerald-700' : undefined}>{STATUS[venda.asaasStatus || ''] || venda.asaasStatus || 'aguardando'}</span>
            {venda.asaasEm && <span>· gerada em {dataHora(venda.asaasEm)}</span>}
            {fone && (
              <a className="inline-flex items-center gap-1 font-medium text-emerald-700 hover:underline" href={`https://wa.me/${fone.length <= 11 ? `55${fone}` : fone}?text=${msg}`} target="_blank" rel="noreferrer">
                <MessageCircle className="h-3.5 w-3.5" /> Mandar no WhatsApp
              </a>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button tamanho="sm" variante="secundario" icone={<RefreshCw className="h-3.5 w-3.5" />} carregando={atualizar.isPending} onClick={() => atualizar.mutate()}>
              Conferir pagamento
            </Button>
            {!pago && (
              <Button tamanho="sm" variante="secundario" icone={<Trash2 className="h-3.5 w-3.5" />} carregando={cancelar.isPending} onClick={() => cancelar.mutate()}>
                Cancelar cobrança
              </Button>
            )}
          </div>
        </>
      ) : (
        <>
          <p className="text-xs text-slate-600">Gera boleto, PIX ou cartão no Asaas e devolve o link pronto para mandar ao cliente.</p>
          <div className="flex flex-wrap items-end gap-2">
            <Select label="Forma" value={forma} onChange={(e) => setForma(e.target.value)} opcoes={FORMAS} className="w-64" />
            {forma !== 'PIX' && (
              <div className="w-28">
                <label className="mb-1 block text-xs font-medium text-slate-600">Parcelas</label>
                <input type="number" min={1} max={21} value={parcelas} onChange={(e) => setParcelas(Math.max(1, Number(e.target.value) || 1))} className="input-base h-9" />
              </div>
            )}
            <Button tamanho="sm" variante="primario" icone={<Barcode className="h-3.5 w-3.5" />} carregando={gerar.isPending} onClick={() => gerar.mutate()}>
              Gerar cobrança
            </Button>
          </div>
        </>
      )}

      {semChave && (
        <p className="text-xs text-amber-800">
          Falta a chave de API do Asaas.{' '}
          <Link to="/configuracoes/asaas" className="font-medium underline">
            Abrir configuração
          </Link>{' '}
          (só o administrador).
        </p>
      )}
    </div>
  );
}
