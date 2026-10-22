import { useEffect } from 'react';
import { useRouteError, Link } from 'react-router-dom';
import { ehErroDeVersaoAntiga, recarregarUmaVez } from '@/lib/versao';

/** Tela amigável para erros inesperados de uma rota (substitui a tela padrão do React Router). */
export default function ErroPagina() {
  const err = useRouteError() as { message?: string } | undefined;
  // sistema atualizado com a aba aberta: os arquivos antigos sumiram — recarrega sozinho
  useEffect(() => {
    if (ehErroDeVersaoAntiga(err?.message)) recarregarUmaVez();
  }, [err]);
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="max-w-md rounded-xl border border-red-200 bg-white p-6 text-center shadow-sm">
        <p className="text-lg font-semibold text-slate-800">Ops, algo deu errado nesta tela</p>
        <p className="mt-2 text-sm text-slate-500">{err?.message || 'Erro inesperado.'}</p>
        <div className="mt-4 flex justify-center gap-2">
          <button onClick={() => window.location.reload()} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50">Recarregar</button>
          <Link to="/" className="rounded-md bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700">Ir para o início</Link>
        </div>
      </div>
    </div>
  );
}
