import { forwardRef, type InputHTMLAttributes } from 'react';
import { Input } from './Input';

interface DateInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  value: string | null | undefined;
  onChange: (v: string) => void;
  label?: string;
  erro?: string;
  obrigatorio?: boolean;
  className?: string;
}

/** Input de data (YYYY-MM-DD) — o navegador exibe em dd/mm/aaaa no locale pt-BR */
export const DateInput = forwardRef<HTMLInputElement, DateInputProps>(function DateInput({ value, onChange, ...rest }, ref) {
  return <Input ref={ref} type="date" value={value || ''} onChange={(e) => onChange(e.target.value)} {...rest} />;
});
