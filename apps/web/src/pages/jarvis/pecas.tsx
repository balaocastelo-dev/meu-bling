/**
 * Peças do painel do JARVIS — a versão escura dos cartões e números.
 *
 * O sistema inteiro é claro; o JARVIS é um instrumento à parte. Em vez de forçar os
 * componentes claros a virarem escuros, aqui ficam as poucas peças de que o painel
 * precisa, no estilo dele.
 */
import type { ReactNode } from 'react';

export function Cartao({
  titulo,
  descricao,
  icone,
  acoes,
  destaque,
  className,
  children,
}: {
  titulo?: ReactNode;
  descricao?: ReactNode;
  icone?: ReactNode;
  acoes?: ReactNode;
  destaque?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`jv-card ${destaque ? 'jv-card-destaque' : ''} p-4 sm:p-5 ${className ?? ''}`}>
      {(titulo || acoes) && (
        <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {titulo && (
              <h2 className="flex items-center gap-2 text-base font-semibold leading-tight">
                {icone && <span style={{ color: 'var(--jv-cobre)' }}>{icone}</span>}
                {titulo}
              </h2>
            )}
            {descricao && (
              <p className="mt-1 text-sm" style={{ color: 'var(--jv-suave)' }}>
                {descricao}
              </p>
            )}
          </div>
          {acoes && <div className="flex flex-wrap items-center gap-2">{acoes}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

/** Um número do painel. O valor é o assunto: grande, tabular, com o rótulo discreto. */
export function Numero({
  rotulo,
  valor,
  sub,
  tom = 'neutro',
  grande,
  carregando,
  onClick,
}: {
  rotulo: string;
  valor: string;
  sub?: ReactNode;
  tom?: 'neutro' | 'bom' | 'ruim' | 'alvo';
  grande?: boolean;
  carregando?: boolean;
  onClick?: () => void;
}) {
  const cor =
    tom === 'bom' ? 'var(--jv-menta)' : tom === 'ruim' ? 'var(--jv-coral)' : tom === 'alvo' ? 'var(--jv-cobre)' : 'var(--jv-texto)';
  const Tag = onClick ? 'button' : 'div';

  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`jv-card p-4 text-left ${onClick ? 'transition hover:border-[var(--jv-linha-forte)]' : ''} ${
        grande ? 'sm:col-span-2' : ''
      }`}
    >
      <p className="text-sm" style={{ color: 'var(--jv-suave)' }}>
        {rotulo}
      </p>
      {carregando ? (
        <div className="mt-2 h-9 w-36 animate-pulse rounded" style={{ background: 'var(--jv-superficie)' }} />
      ) : (
        <p
          className={`jv-num mt-1.5 font-semibold ${grande ? 'text-3xl sm:text-[2.6rem]' : 'text-2xl sm:text-3xl'}`}
          style={{ color: cor }}
        >
          {valor}
        </p>
      )}
      {sub && (
        <p className="mt-1.5 text-sm" style={{ color: 'var(--jv-apagado)' }}>
          {sub}
        </p>
      )}
    </Tag>
  );
}

/** Nada para mostrar — e o que fazer a respeito. */
export function Vazio({ titulo, descricao }: { titulo: string; descricao: string }) {
  return (
    <div className="rounded-xl px-4 py-6 text-center" style={{ background: '#0c1620', border: '1px dashed var(--jv-linha)' }}>
      <p className="font-medium">{titulo}</p>
      <p className="mx-auto mt-1 max-w-md text-sm" style={{ color: 'var(--jv-suave)' }}>
        {descricao}
      </p>
    </div>
  );
}

/** Divisor que marca onde acaba o que importa agora. */
export function Divisor({ titulo, dica }: { titulo: string; dica?: string }) {
  return (
    <div className="flex items-center gap-3 pt-2">
      <span className="text-sm font-medium" style={{ color: 'var(--jv-suave)' }}>
        {titulo}
      </span>
      <span className="h-px flex-1" style={{ background: 'var(--jv-linha)' }} />
      {dica && (
        <span className="text-xs" style={{ color: 'var(--jv-apagado)' }}>
          {dica}
        </span>
      )}
    </div>
  );
}
