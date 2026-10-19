import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import clsx from 'clsx';

interface CampoProps {
  label?: ReactNode;
  erro?: string;
  ajuda?: string;
  obrigatorio?: boolean;
  className?: string;
}

/** Envoltório com label/erro usado por todos os campos */
export function Campo({ label, erro, ajuda, obrigatorio, className, children, htmlFor }: CampoProps & { children: ReactNode; htmlFor?: string }) {
  return (
    <div className={clsx('flex flex-col gap-1', className)}>
      {label && (
        <label htmlFor={htmlFor} className="text-xs font-medium text-slate-600">
          {label}
          {obrigatorio && <span className="text-brand-600"> *</span>}
        </label>
      )}
      {children}
      {erro ? <p className="text-xs text-red-600">{erro}</p> : ajuda ? <p className="text-xs text-slate-400">{ajuda}</p> : null}
    </div>
  );
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement>, CampoProps {
  prefixo?: ReactNode;
  sufixo?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, erro, ajuda, obrigatorio, className, prefixo, sufixo, id, ...rest },
  ref,
) {
  const gid = useId();
  const iid = id || gid;
  return (
    <Campo label={label} erro={erro} ajuda={ajuda} obrigatorio={obrigatorio} className={className} htmlFor={iid}>
      <div className="relative">
        {prefixo && <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-sm text-slate-400">{prefixo}</span>}
        <input
          ref={ref}
          id={iid}
          className={clsx('input-base', erro && 'input-erro', prefixo && 'pl-9', sufixo && 'pr-9')}
          {...rest}
        />
        {sufixo && <span className="absolute inset-y-0 right-0 flex items-center pr-3 text-sm text-slate-400">{sufixo}</span>}
      </div>
    </Campo>
  );
});

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement>, CampoProps {
  opcoes?: { valor: string | number; rotulo: string }[];
  placeholder?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, erro, ajuda, obrigatorio, className, opcoes, placeholder, id, children, ...rest },
  ref,
) {
  const gid = useId();
  const iid = id || gid;
  return (
    <Campo label={label} erro={erro} ajuda={ajuda} obrigatorio={obrigatorio} className={className} htmlFor={iid}>
      <select ref={ref} id={iid} className={clsx('input-base appearance-none bg-no-repeat pr-8', erro && 'input-erro')} style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%2364748b' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e\")",
        backgroundPosition: 'right 0.5rem center',
        backgroundSize: '1.25rem',
      }} {...rest}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {opcoes?.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.rotulo}
          </option>
        ))}
        {children}
      </select>
    </Campo>
  );
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement>, CampoProps {}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, erro, ajuda, obrigatorio, className, id, rows = 3, ...rest },
  ref,
) {
  const gid = useId();
  const iid = id || gid;
  return (
    <Campo label={label} erro={erro} ajuda={ajuda} obrigatorio={obrigatorio} className={className} htmlFor={iid}>
      <textarea ref={ref} id={iid} rows={rows} className={clsx('input-base resize-y', erro && 'input-erro')} {...rest} />
    </Campo>
  );
});

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: ReactNode;
  descricao?: string;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox({ label, descricao, className, id, ...rest }, ref) {
  const gid = useId();
  const iid = id || gid;
  return (
    <label htmlFor={iid} className={clsx('inline-flex items-start gap-2 text-sm text-slate-700 cursor-pointer select-none', className)}>
      <input
        ref={ref}
        id={iid}
        type="checkbox"
        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 accent-red-600 focus:ring-brand-500/30"
        {...rest}
      />
      {(label || descricao) && (
        <span className="flex flex-col">
          {label && <span>{label}</span>}
          {descricao && <span className="text-xs text-slate-400">{descricao}</span>}
        </span>
      )}
    </label>
  );
});

/** Chave liga/desliga */
export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <label className={clsx('inline-flex items-center gap-2 text-sm text-slate-700 select-none', disabled ? 'opacity-50' : 'cursor-pointer')}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={clsx(
          'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40',
          checked ? 'bg-brand-600' : 'bg-slate-300',
        )}
      >
        <span className={clsx('inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform', checked ? 'translate-x-4' : 'translate-x-0.5')} />
      </button>
      {label}
    </label>
  );
}
