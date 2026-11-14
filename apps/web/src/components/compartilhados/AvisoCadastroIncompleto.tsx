import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { cadastroIncompleto, faltasCadastro, type DadosCadastro } from '@/lib/cadastro';

/**
 * Selo discreto: a venda fecha mesmo assim. CPF, endereço e contato só são
 * cobrados na hora de emitir a nota, com atalho para o cadastro.
 */
export function AvisoCadastroIncompleto({
  contato,
  modo = 'selo',
  className,
}: {
  contato?: DadosCadastro | null;
  /** selo = só o texto; linha = selo + o que falta + link */
  modo?: 'selo' | 'linha';
  className?: string;
}) {
  const faltas = faltasCadastro(contato);
  if (!faltas.length) return null;
  const titulo = `Cadastro incompleto. A venda fecha normalmente. A nota fiscal pede: ${faltas.join(', ')}.`;
  const selo = (
    <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 ring-1 ring-inset ring-amber-600/15" title={titulo}>
      cadastro incompleto
    </span>
  );
  if (modo === 'selo') return <span className={className}>{selo}</span>;
  return (
    <p className={clsx('flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-amber-800', className)}>
      {selo}
      <span>A venda fecha assim. A nota pede {faltas.join(', ')}.</span>
      {contato?.id ? (
        <Link to={`/contatos/${contato.id}/editar`} className="font-medium text-brand-700 hover:underline">
          Completar cadastro
        </Link>
      ) : null}
    </p>
  );
}

export { cadastroIncompleto };
