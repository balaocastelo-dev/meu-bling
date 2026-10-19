import { useState, type ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';
import { Modal } from './Modal';
import { Button } from './Button';

interface ConfirmProps {
  aberto: boolean;
  onFechar: () => void;
  onConfirmar: () => Promise<void> | void;
  titulo: ReactNode;
  descricao?: ReactNode;
  textoConfirmar?: string;
  perigo?: boolean;
}

/** Diálogo de confirmação (exclusões e ações irreversíveis) */
export function ConfirmDialog({ aberto, onFechar, onConfirmar, titulo, descricao, textoConfirmar = 'Confirmar', perigo = true }: ConfirmProps) {
  const [carregando, setCarregando] = useState(false);
  const confirmar = async () => {
    setCarregando(true);
    try {
      await onConfirmar();
      onFechar();
    } finally {
      setCarregando(false);
    }
  };
  return (
    <Modal aberto={aberto} onFechar={onFechar} tamanho="sm">
      <div className="flex gap-4">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${perigo ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600'}`}>
          <TriangleAlert className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-slate-900">{titulo}</h3>
          {descricao && <div className="mt-1 text-sm text-slate-500">{descricao}</div>}
          <div className="mt-5 flex justify-end gap-2">
            <Button variante="secundario" onClick={onFechar} disabled={carregando}>
              Cancelar
            </Button>
            <Button variante={perigo ? 'primario' : 'sucesso'} onClick={confirmar} carregando={carregando}>
              {textoConfirmar}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
