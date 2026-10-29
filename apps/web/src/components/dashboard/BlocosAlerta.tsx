/**
 * Alertas do dashboard em BLOCOS (estilo Power BI) — Thiago, 29/10/2026.
 * Cada ponto de atenção vira um bloco com o tom da gravidade, o texto com os valores em
 * destaque e o atalho para resolver. Os mais graves sobem; os leves ficam no fim.
 */
import { motion, type Variants } from 'framer-motion';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { AlertOctagon, AlertTriangle, ArrowRight, Info } from 'lucide-react';
import { TextoValores } from '@/components/compartilhados/TextoValores';
import { listaVariants } from '@/components/dashboard/v18';

export type AlertaBloco = { tipo: string; mensagem: string; link?: string };

const TOM = {
  erro: { bloco: 'border-red-200 bg-red-50/70 hover:border-red-300', chip: 'bg-red-100 text-red-700', titulo: 'text-red-900', acao: 'text-red-700', icone: AlertOctagon, peso: 0 },
  aviso: { bloco: 'border-amber-200 bg-amber-50/70 hover:border-amber-300', chip: 'bg-amber-100 text-amber-700', titulo: 'text-amber-900', acao: 'text-amber-700', icone: AlertTriangle, peso: 1 },
  info: { bloco: 'border-sky-200 bg-sky-50/70 hover:border-sky-300', chip: 'bg-sky-100 text-sky-700', titulo: 'text-sky-900', acao: 'text-sky-700', icone: Info, peso: 2 },
} as const;

const tomDe = (t: string) => TOM[t as keyof typeof TOM] ?? TOM.info;

/** cada bloco entra subindo, em cascata (igual às linhas do V18) */
const entrada: Variants = {
  oculto: { opacity: 0, y: 14 },
  visivel: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 260, damping: 26 } },
};

/** Um bloco de alerta. Clicar no bloco inteiro abre a tela de resolver. */
function Bloco({ a }: { a: AlertaBloco }) {
  const t = tomDe(a.tipo);
  const I = t.icone;
  const conteudo = (
    <>
      <span className={clsx('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', t.chip)}>
        <I className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className={clsx('block break-words text-sm font-semibold leading-snug', t.titulo)}>
          <TextoValores texto={a.mensagem} />
        </span>
        {a.link && (
          <span className={clsx('mt-1.5 inline-flex items-center gap-1 text-xs font-semibold', t.acao)}>
            Resolver <ArrowRight className="h-3 w-3" />
          </span>
        )}
      </span>
    </>
  );
  const classe = clsx('flex min-w-0 items-start gap-3 rounded-2xl border p-3.5 shadow-card transition-colors sm:p-4', t.bloco);
  return (
    <motion.li variants={entrada} whileHover={a.link ? { y: -3 } : undefined} transition={{ type: 'spring', stiffness: 300, damping: 22 }} className="min-w-0">
      {a.link ? (
        <Link to={a.link} className={clsx(classe, 'cursor-pointer')}>
          {conteudo}
        </Link>
      ) : (
        <div className={classe}>{conteudo}</div>
      )}
    </motion.li>
  );
}

/** Grade de blocos: 1 coluna no celular, 2 no tablet, 3 no computador. */
export function BlocosAlerta({ alertas, limite, className }: { alertas: AlertaBloco[]; limite?: number; className?: string }) {
  const ordenados = [...alertas].sort((a, b) => tomDe(a.tipo).peso - tomDe(b.tipo).peso);
  const lista = limite ? ordenados.slice(0, limite) : ordenados;
  return (
    <motion.ul
      className={clsx('grid gap-3 sm:grid-cols-2 xl:grid-cols-3', className)}
      variants={listaVariants}
      initial="oculto"
      animate="visivel"
    >
      {lista.map((a, i) => (
        <Bloco key={`${a.tipo}-${i}`} a={a} />
      ))}
    </motion.ul>
  );
}
