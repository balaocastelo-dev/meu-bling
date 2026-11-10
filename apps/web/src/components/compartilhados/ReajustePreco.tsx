import { useState } from 'react';
import { toast } from 'sonner';
import { ArrowRight, Percent } from 'lucide-react';
import { api, mensagemErro } from '@/lib/api';
import { Button, Input, Modal, Select } from '@/components/ui';
import { moeda } from '@/lib/format';
import type { Produto } from '@/types';

/**
 * REAJUSTE DE PREÇO EM LOTE (pedido do Thiago, 10/11/2026).
 *
 * Mexer em preço de vários produtos de uma vez é das coisas mais fáceis de errar
 * no sistema inteiro, então aqui a pessoa SEMPRE vê o de-para antes de confirmar:
 * a prévia mostra produto por produto o preço de hoje e o que vai ficar.
 *
 * O arredondamento final (".90", ".00") é opcional e aparece já na prévia.
 */
type Modo = 'pct' | 'valor' | 'fixo';

const ARREDONDAR: Record<string, (v: number) => number> = {
  nao: (v) => Math.round(v * 100) / 100,
  '90': (v) => Math.max(0, Math.floor(v) + 0.9),
  '00': (v) => Math.max(0, Math.round(v)),
};

export function ReajustePrecoModal({
  aberto,
  onFechar,
  produtos,
  aoTerminar,
}: {
  aberto: boolean;
  onFechar: () => void;
  produtos: Produto[];
  aoTerminar: (falhas: number[]) => void;
}) {
  const [modo, setModo] = useState<Modo>('pct');
  const [valor, setValor] = useState('');
  const [arred, setArred] = useState('nao');
  const [salvando, setSalvando] = useState(false);

  const n = Number(String(valor).replace(',', '.'));
  const valido = Number.isFinite(n) && (modo === 'fixo' ? n >= 0 : n !== 0);

  const novoPreco = (p: Produto): number => {
    const base = modo === 'pct' ? p.preco * (1 + n / 100) : modo === 'valor' ? p.preco + n : n;
    return ARREDONDAR[arred](Math.max(0, base));
  };

  const previa = produtos.slice(0, 8);

  const salvar = async () => {
    if (!valido) return;
    setSalvando(true);
    const falhas: { id: number; motivo: string }[] = [];
    let ok = 0;
    for (const p of produtos) {
      try {
        await api.put(`/produtos/${p.id}`, { preco: novoPreco(p) });
        ok += 1;
      } catch (e) {
        falhas.push({ id: p.id, motivo: mensagemErro(e) });
      }
    }
    setSalvando(false);
    if (ok) toast.success(`Preço reajustado em ${ok} produto${ok > 1 ? 's' : ''}.`);
    if (falhas.length) {
      toast.warning(`${falhas.length} não foi reajustado.`, { description: [...new Set(falhas.map((f) => f.motivo))].slice(0, 3).join(' · '), duration: 15_000 });
    }
    aoTerminar(falhas.map((f) => f.id));
    if (!falhas.length) {
      setValor('');
      onFechar();
    }
  };

  return (
    <Modal
      aberto={aberto}
      onFechar={onFechar}
      titulo={`Reajustar o preço de ${produtos.length} produto${produtos.length > 1 ? 's' : ''}`}
      descricao="Confira a prévia antes de confirmar — isto muda o preço de venda."
      rodape={
        <>
          <Button variante="secundario" onClick={onFechar}>
            Cancelar
          </Button>
          <Button variante="primario" icone={<Percent className="h-4 w-4" />} carregando={salvando} disabled={!valido} onClick={salvar}>
            Aplicar nos {produtos.length}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <Select
            label="Como reajustar"
            value={modo}
            onChange={(e) => setModo(e.target.value as Modo)}
            opcoes={[
              { valor: 'pct', rotulo: 'Percentual (%)' },
              { valor: 'valor', rotulo: 'Somar/subtrair R$' },
              { valor: 'fixo', rotulo: 'Preço fixo' },
            ]}
          />
          <Input
            label={modo === 'pct' ? 'Percentual' : modo === 'valor' ? 'Valor em R$' : 'Novo preço'}
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            inputMode="decimal"
            placeholder={modo === 'pct' ? '10 (ou -10 para baixar)' : modo === 'valor' ? '50 (ou -50)' : '199,90'}
          />
          <Select
            label="Terminar o preço em"
            value={arred}
            onChange={(e) => setArred(e.target.value)}
            opcoes={[
              { valor: 'nao', rotulo: 'Deixar como calculou' },
              { valor: '90', rotulo: ',90 (ex.: R$ 199,90)' },
              { valor: '00', rotulo: 'Inteiro (ex.: R$ 200)' },
            ]}
          />
        </div>

        {valido && (
          <div className="rounded-xl border border-slate-200">
            <p className="border-b border-slate-100 px-3 py-2 text-xs font-medium text-slate-600">
              Prévia {produtos.length > previa.length ? `(primeiros ${previa.length} de ${produtos.length})` : ''}
            </p>
            <ul className="divide-y divide-slate-100">
              {previa.map((p) => {
                const novo = novoPreco(p);
                const subiu = novo > p.preco;
                return (
                  <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate text-slate-700">{p.nome}</span>
                    <span className="flex shrink-0 items-center gap-1.5 num">
                      <span className="text-slate-400 line-through">{moeda(p.preco)}</span>
                      <ArrowRight className="h-3 w-3 text-slate-300" />
                      <span className={subiu ? 'font-medium text-emerald-700' : 'font-medium text-rose-700'}>{moeda(novo)}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <p className="text-xs text-slate-500">Só mexe no preço de venda. O preço de custo e o do site continuam como estão.</p>
      </div>
    </Modal>
  );
}
