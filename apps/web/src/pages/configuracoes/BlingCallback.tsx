import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { CircleCheck, CircleX, Loader2 } from 'lucide-react';
import { api, mensagemErro } from '@/lib/api';
import { Button, Card } from '@/components/ui';

/** Callback do OAuth do Bling: lê ?code e troca por token */
export default function BlingCallback() {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [estado, setEstado] = useState<'processando' | 'ok' | 'erro'>('processando');
  const [erro, setErro] = useState('');
  const executou = useRef(false);

  useEffect(() => {
    if (executou.current) return;
    executou.current = true;
    const code = sp.get('code');
    if (!code) {
      setEstado('erro');
      setErro(sp.get('error_description') || sp.get('error') || 'Código de autorização não recebido.');
      return;
    }
    api
      .post('/bling/callback', { code, state: sp.get('state') ?? undefined })
      .then(() => {
        setEstado('ok');
        qc.invalidateQueries({ queryKey: ['bling-status'] });
        setTimeout(() => nav('/configuracoes/bling', { replace: true }), 1500);
      })
      .catch((e) => {
        setEstado('erro');
        setErro(mensagemErro(e));
      });
  }, [sp, nav, qc]);

  return (
    <div className="mx-auto max-w-md pt-10">
      <Card>
        <div className="flex flex-col items-center py-6 text-center">
          {estado === 'processando' && (
            <>
              <Loader2 className="h-10 w-10 animate-spin text-brand-600" />
              <p className="mt-4 font-medium text-slate-800">Concluindo a conexão com o Bling…</p>
            </>
          )}
          {estado === 'ok' && (
            <>
              <CircleCheck className="h-10 w-10 text-emerald-600" />
              <p className="mt-4 font-medium text-slate-800">Bling conectado com sucesso!</p>
              <p className="text-sm text-slate-500">Redirecionando para a importação…</p>
            </>
          )}
          {estado === 'erro' && (
            <>
              <CircleX className="h-10 w-10 text-red-600" />
              <p className="mt-4 font-medium text-slate-800">Não foi possível conectar</p>
              <p className="mt-1 text-sm text-slate-500">{erro}</p>
              <Link to="/configuracoes/bling" className="mt-4"><Button variante="primario">Tentar novamente</Button></Link>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
