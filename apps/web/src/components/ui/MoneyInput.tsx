import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type InputHTMLAttributes } from 'react';
import clsx from 'clsx';
import { Campo } from './Input';
import { arred, parseNumeroBr } from '@/lib/format';
import { BotaoOlho, MASCARA } from './Oculto';

interface MoneyInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  value: number;
  onChange: (v: number) => void;
  label?: string;
  erro?: string;
  /** texto de ajuda abaixo do campo */
  ajuda?: string;
  obrigatorio?: boolean;
  /** Casas decimais (2 para moeda, 3 para quantidades) */
  casas?: number;
  /** Prefixo visual (R$ por padrão; "" para esconder) */
  prefixo?: string;
  alinharDireita?: boolean;
  className?: string;
  inputClassName?: string;
  /** custo: mostra "****" com olhinho; o valor só aparece ao clicar no olho e volta a se esconder ao sair do campo */
  oculto?: boolean;
}

function formatar(v: number, casas: number): string {
  return new Intl.NumberFormat('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }).format(Number(v) || 0);
}

/**
 * Input numérico com máscara pt-BR (1.234,56).
 * Mantém texto livre enquanto digita e normaliza no blur.
 */
export const MoneyInput = forwardRef<HTMLInputElement, MoneyInputProps>(function MoneyInput(
  { value, onChange, label, erro, ajuda, obrigatorio, casas = 2, prefixo = 'R$', alinharDireita = true, className, inputClassName, onBlur, onFocus, onKeyDown, readOnly, title, oculto, ...rest },
  ref,
) {
  const [texto, setTexto] = useState(formatar(value, casas));
  const [focado, setFocado] = useState(false);
  const [revelado, setRevelado] = useState(false);
  const interno = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => interno.current as HTMLInputElement);
  const escondido = !!oculto && !revelado;

  // Sincroniza quando o valor externo muda (e o campo não está em edição)
  useEffect(() => {
    if (!focado) setTexto(formatar(value, casas));
  }, [value, casas, focado]);

  function revelar() {
    setRevelado(true);
    setTexto(formatar(value, casas));
    // foca já com o valor à mostra para digitar
    setTimeout(() => {
      interno.current?.focus();
      interno.current?.select();
    }, 0);
  }

  return (
    <Campo label={label} erro={erro} ajuda={ajuda} obrigatorio={obrigatorio} className={className}>
      <div className="relative">
        {prefixo && <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-xs text-slate-400">{prefixo}</span>}
        <input
          ref={interno}
          type="text"
          inputMode="decimal"
          value={escondido ? MASCARA : texto}
          readOnly={escondido || readOnly}
          onFocus={(e) => {
            if (escondido) return;
            setFocado(true);
            e.target.select();
            onFocus?.(e);
          }}
          onChange={(e) => {
            if (escondido) return;
            const t = e.target.value;
            setTexto(t);
            onChange(arred(parseNumeroBr(t), casas));
          }}
          onKeyDown={(e) => {
            // no campo escondido, Enter/espaço mostra (para quem navega pelo teclado)
            if (escondido && (e.key === 'Enter' || e.key === ' ')) {
              e.preventDefault();
              revelar();
            }
            onKeyDown?.(e);
          }}
          onBlur={(e) => {
            if (oculto) setRevelado(false);
            if (escondido) return;
            setFocado(false);
            const n = arred(parseNumeroBr(texto), casas);
            setTexto(formatar(n, casas));
            onChange(n);
            onBlur?.(e);
          }}
          className={clsx('input-base num', erro && 'input-erro', prefixo && 'pl-9', alinharDireita && 'text-right', oculto && 'pr-7', escondido && 'select-none tracking-widest text-slate-400', inputClassName)}
          {...rest}
          title={escondido ? 'Custo escondido: clique no olho para ver' : title}
        />
        {oculto && <BotaoOlho revelado={revelado} onClick={() => (revelado ? setRevelado(false) : revelar())} className="absolute inset-y-0 right-1 my-auto h-6" />}
      </div>
    </Campo>
  );
});
