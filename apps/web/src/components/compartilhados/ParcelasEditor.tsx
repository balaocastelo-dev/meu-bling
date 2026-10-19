import { useState } from 'react';
import { addDays, format } from 'date-fns';
import { Plus, Trash2, Wand2 } from 'lucide-react';
import clsx from 'clsx';
import { Button, Input, MoneyInput, Select } from '@/components/ui';
import { useFormasPagamento, opcoesDe } from '@/hooks/useListas';
import { arred, hoje, moeda } from '@/lib/format';
import type { Parcela } from '@/types';

interface Props {
  parcelas: Parcela[];
  onChange: (p: Parcela[]) => void;
  total: number;
  disabled?: boolean;
}

/**
 * Editor de parcelas com gerador (nº, forma, 1º vencimento, intervalo).
 * Valida que a soma das parcelas = total.
 */
export function ParcelasEditor({ parcelas, onChange, total, disabled }: Props) {
  const { data: formas } = useFormasPagamento();
  const [qtd, setQtd] = useState(1);
  const [formaId, setFormaId] = useState<number | ''>('');
  const [primeiro, setPrimeiro] = useState(hoje());
  const [intervalo, setIntervalo] = useState(30);

  const soma = arred(parcelas.reduce((s, p) => s + (Number(p.valor) || 0), 0));
  const diferenca = arred(total - soma);

  const gerar = () => {
    const n = Math.max(1, Math.min(48, qtd));
    const base = arred(total / n);
    const lista: Parcela[] = [];
    let acumulado = 0;
    for (let i = 0; i < n; i++) {
      const valor = i === n - 1 ? arred(total - acumulado) : base;
      acumulado = arred(acumulado + valor);
      lista.push({
        numero: i + 1,
        dataVencimento: format(addDays(new Date(primeiro + 'T00:00:00'), i * intervalo), 'yyyy-MM-dd'),
        valor,
        formaPagamentoId: formaId === '' ? null : Number(formaId),
        observacoes: '',
      });
    }
    onChange(lista);
  };

  const atualizar = (i: number, patch: Partial<Parcela>) => {
    onChange(parcelas.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  };

  const remover = (i: number) => onChange(parcelas.filter((_, j) => j !== i).map((p, j) => ({ ...p, numero: j + 1 })));

  const adicionar = () => {
    const ultima = parcelas[parcelas.length - 1];
    onChange([
      ...parcelas,
      {
        numero: parcelas.length + 1,
        dataVencimento: ultima ? format(addDays(new Date(ultima.dataVencimento + 'T00:00:00'), intervalo), 'yyyy-MM-dd') : hoje(),
        valor: Math.max(0, diferenca),
        formaPagamentoId: ultima?.formaPagamentoId ?? (formaId === '' ? null : Number(formaId)),
        observacoes: '',
      },
    ]);
  };

  return (
    <div className="space-y-3">
      {!disabled && (
        <div className="flex flex-wrap items-end gap-2 rounded-md border border-dashed border-slate-200 bg-slate-50 p-3">
          <Input label="Nº parcelas" type="number" min={1} max={48} value={qtd} onChange={(e) => setQtd(Number(e.target.value))} className="w-24" />
          <Select label="Forma" value={formaId} onChange={(e) => setFormaId(e.target.value ? Number(e.target.value) : '')} opcoes={opcoesDe(formas)} placeholder="—" className="w-44" />
          <Input label="1º vencimento" type="date" value={primeiro} onChange={(e) => setPrimeiro(e.target.value)} className="w-40" />
          <Input label="Intervalo (dias)" type="number" min={0} value={intervalo} onChange={(e) => setIntervalo(Number(e.target.value))} className="w-32" />
          <Button variante="secundario" icone={<Wand2 className="h-4 w-4" />} onClick={gerar} disabled={total <= 0}>
            Gerar parcelas
          </Button>
        </div>
      )}

      <div className="overflow-auto rounded-md border border-slate-200">
        <table className="tbl">
          <thead>
            <tr>
              <th className="w-12">#</th>
              <th className="w-40">Vencimento</th>
              <th className="w-36 text-right">Valor</th>
              <th>Forma de pagamento</th>
              <th>Observações</th>
              {!disabled && <th className="w-10" />}
            </tr>
          </thead>
          <tbody>
            {parcelas.length === 0 && (
              <tr>
                <td colSpan={6} className="py-4 text-center text-xs text-slate-400">
                  Nenhuma parcela. Sem parcelas a API cria uma à vista automaticamente.
                </td>
              </tr>
            )}
            {parcelas.map((p, i) => (
              <tr key={i}>
                <td className="text-slate-500">{i + 1}</td>
                <td>
                  <input type="date" disabled={disabled} value={p.dataVencimento?.slice(0, 10) ?? ''} onChange={(e) => atualizar(i, { dataVencimento: e.target.value })} className="input-base h-8 py-0" />
                </td>
                <td>
                  <MoneyInput value={p.valor} onChange={(v) => atualizar(i, { valor: v })} prefixo="" disabled={disabled} inputClassName="h-8 py-0" />
                </td>
                <td>
                  <select disabled={disabled} value={p.formaPagamentoId ?? ''} onChange={(e) => atualizar(i, { formaPagamentoId: e.target.value ? Number(e.target.value) : null })} className="input-base h-8 py-0">
                    <option value="">—</option>
                    {formas?.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.nome}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input disabled={disabled} value={p.observacoes ?? ''} onChange={(e) => atualizar(i, { observacoes: e.target.value })} className="input-base h-8 py-0" placeholder="opcional" />
                </td>
                {!disabled && (
                  <td>
                    <button type="button" onClick={() => remover(i)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="Remover parcela">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        {!disabled && (
          <Button tamanho="sm" variante="fantasma" icone={<Plus className="h-4 w-4" />} onClick={adicionar}>
            Adicionar parcela
          </Button>
        )}
        <div className={clsx('ml-auto flex items-center gap-4 num', Math.abs(diferenca) > 0.009 ? 'text-red-600' : 'text-slate-600')}>
          <span>
            Soma: <strong>{moeda(soma)}</strong>
          </span>
          <span>
            Total: <strong>{moeda(total)}</strong>
          </span>
          {Math.abs(diferenca) > 0.009 && parcelas.length > 0 && <span className="rounded bg-red-50 px-2 py-0.5 text-xs font-medium">Diferença {moeda(diferenca)}</span>}
        </div>
      </div>
    </div>
  );
}

/** Verifica se as parcelas batem com o total (tolerância de 1 centavo) */
export function parcelasValidas(parcelas: Parcela[], total: number): boolean {
  if (parcelas.length === 0) return true;
  const soma = parcelas.reduce((s, p) => s + (Number(p.valor) || 0), 0);
  return Math.abs(arred(total - soma)) <= 0.01;
}
