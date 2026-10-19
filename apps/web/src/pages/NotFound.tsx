import { Link } from 'react-router-dom';
import { Button, EmptyState } from '@/components/ui';

export default function NotFound() {
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
