/** Escolha, na hora do link do Mercado Pago, de quantas parcelas saem sem juros. */
import { useId } from 'react';

export const OPCOES_SEM_JUROS = [
  { valor: 0 as const, rotulo: 'Nenhum (juros do cliente)' },
  { valor: 2 as const, rotulo: 'Até 2x sem juros' },
  { valor: 3 as const, rotulo: 'Até 3x sem juros' },
];

export type ParcelasSemJurosValor = (typeof OPCOES_SEM_JUROS)[number]['valor'];

export function rotuloSemJuros(n: number | null | undefined) {
  return OPCOES_SEM_JUROS.find((o) => o.valor === n)?.rotulo ?? 'Nenhum (juros do cliente)';
}

export function normalizarSemJuros(n: number | null | undefined): ParcelasSemJurosValor {
  return n === 2 || n === 3 ? n : 0;
}

/**
 * As três opções ficam visíveis (não é um menu fechado).
 * O padrão é nenhuma: juros por conta do cliente, como a loja já trabalha.
 */
export function EscolhaParcelasSemJuros({ valor, onChange, disabled, embutido }: { valor: number; onChange: (v: ParcelasSemJurosValor) => void; disabled?: boolean; embutido?: boolean }) {
  const nome = useId();
  const atual = normalizarSemJuros(valor);
  return (
    <fieldset disabled={disabled} className={embutido ? 'space-y-2' : 'space-y-2 rounded-md border border-sky-200 bg-sky-50/60 p-3'} id="parcelas-sem-juros">
      <legend className="px-1 text-sm font-medium text-sky-900">Parcelas sem juros no link do Mercado Pago</legend>
      <div className="flex flex-col gap-1.5">
        {OPCOES_SEM_JUROS.map((o) => (
          <label key={o.valor} className="flex cursor-pointer items-center gap-2 text-sm text-slate-800">
            <input type="radio" name={nome} className="h-4 w-4 accent-sky-700" checked={atual === o.valor} onChange={() => onChange(o.valor)} />
            <span>
              {o.rotulo}
              {o.valor === 0 && <span className="ml-1 text-xs text-slate-500">(padrão)</span>}
            </span>
          </label>
        ))}
      </div>
      <p className="text-xs leading-relaxed text-slate-600">
        O link continua até 12x. Se escolher 2x ou 3x sem juros, 4x, 5x e as outras seguem liberadas, com juros do cliente.
        O Mercado Pago não aceita essa marca em cada link: quem paga os juros é a configuração da conta (Seu negócio → Taxas e parcelas).
        A opção escolhida fica anotada na venda e no resumo do link.
      </p>
      {atual !== 0 && (
        <p className="text-xs leading-relaxed text-amber-800">
          Anotado: {rotuloSemJuros(atual).toLowerCase()}, e o restante com juros do cliente. No checkout, o Mercado Pago segue a conta.
          Se a conta estiver no padrão da loja, o cliente vê juros em todas as parcelas. O parcelamento não é limitado.
        </p>
      )}
    </fieldset>
  );
}
