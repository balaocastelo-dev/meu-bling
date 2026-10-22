import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, EmptyState } from '@/components/ui';
import { haVersaoNova, recarregarUmaVez } from '@/lib/versao';

export default function NotFound() {
  // a página pode ser nova e esta aba ainda estar com a versão anterior do sistema: confere e recarrega
  const [conferindo, setConferindo] = useState(true);
  useEffect(() => {
    haVersaoNova().then((nova) => {
      if (!(nova && recarregarUmaVez())) setConferindo(false);
    });
  }, []);
  if (conferindo) return <EmptyState titulo="Abrindo…" descricao="Conferindo se há uma versão nova do sistema." />;
  return (
    <EmptyState
      titulo="Página não encontrada"
      descricao="O endereço que você acessou não existe ou foi movido."
      acao={
        <Link to="/">
          <Button variante="primario">Voltar ao início</Button>
        </Link>
      }
    />
  );
}
