import { forwardRef, useEffect, useState, type InputHTMLAttributes } from 'react';
import clsx from 'clsx';
import { Campo } from './Input';
import { arred, parseNumeroBr } from '@/lib/format';

interface MoneyInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  value: number;
  onChange: (v: number) => void;
  label?: string;
  erro?: string;
  obrigatorio?: boolean;
  /** Casas decimais (2 para moeda, 3 para quantidades) */
  casas?: number;
  /** Prefixo visual (R$ por padrão; "" para esconder) */
  prefixo?: string;
  alinharDireita?: boolean;
  className?: string;
  inputClassName?: string;
}

function formatar(v: number, casas: number): string {
  return new Intl.NumberFormat('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }).format(Number(v) || 0);
}

/**
 * Input numérico com máscara pt-BR (1.234,56).
 * Mantém texto livre enquanto digita e normaliza no blur.
 */
export const MoneyInput = forwardRef<HTMLInputElement, MoneyInputProps>(function MoneyInput(
  { value, onChange, label, erro, obrigatorio, casas = 2, prefixo = 'R$', alinharDireita = true, className, inputClassName, onBlur, onFocus, ...rest },
  ref,
) {
  const [texto, setTexto] = useState(formatar(value, casas));
  const [focado, setFocado] = useState(false);

  // Sincroniza quando o valor externo muda (e o campo não está em edição)
  useEffect(() => {
    if (!focado) setTexto(formatar(value, casas));
  }, [value, casas, focado]);

  return (
    <Campo label={label} erro={erro} obrigatorio={obrigatorio} className={className}>
      <div className="relative">
        {prefixo && <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-xs text-slate-400">{prefixo}</span>}
        <input
          ref={ref}
          type="text"
          inputMode="decimal"
          value={texto}
          onFocus={(e) => {
            setFocado(true);
            e.target.select();
            onFocus?.(e);
          }}
          onChange={(e) => {
            const t = e.target.value;
            setTexto(t);
            onChange(arred(parseNumeroBr(t), casas));
          }}
          onBlur={(e) => {
            setFocado(false);
            const n = arred(parseNumeroBr(texto), casas);
            setTexto(formatar(n, casas));
            onChange(n);
            onBlur?.(e);
          }}
          className={clsx('input-base num', erro && 'input-erro', prefixo && 'pl-9', alinharDireita && 'text-right', inputClassName)}
          {...rest}
        />
      </div>
    </Campo>
  );
});
