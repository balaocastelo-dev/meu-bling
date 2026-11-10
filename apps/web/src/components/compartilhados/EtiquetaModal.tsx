import { useState } from 'react';
import { toast } from 'sonner';
import { Printer, Tag } from 'lucide-react';
import { Button, Input, Modal } from '@/components/ui';
import { imprimirEtiquetas, type Etiqueta, type FormatoEtiqueta } from './etiquetas';
import { mensagemErro } from '@/lib/api';

/**
 * Escolha do formato antes de imprimir etiqueta (produto ou OS).
 * O Thiago quis os dois formatos disponíveis, com o funcionário escolhendo na hora.
 * A escolha fica guardada no navegador: quem usa a etiquetadora não precisa escolher
 * de novo toda vez.
 */
const CHAVE = 'meubling:formato-etiqueta';

export function EtiquetaModal({
  aberto,
  onFechar,
  etiquetas,
  titulo = 'Imprimir etiquetas',
  permiteCopias = true,
}: {
  aberto: boolean;
  onFechar: () => void;
  etiquetas: Etiqueta[];
  titulo?: string;
  /** produto: várias cópias da mesma etiqueta faz sentido; OS: não */
  permiteCopias?: boolean;
}) {
  const [formato, setFormato] = useState<FormatoEtiqueta>(() => {
    try {
      return (localStorage.getItem(CHAVE) as FormatoEtiqueta) || 'a4';
    } catch {
      return 'a4';
    }
  });
  const [copias, setCopias] = useState(1);

  const imprimir = () => {
    try {
      localStorage.setItem(CHAVE, formato);
    } catch {
      /* navegador sem armazenamento: só não lembra da escolha */
    }
    try {
      imprimirEtiquetas(etiquetas, formato, permiteCopias ? copias : 1);
      onFechar();
    } catch (e) {
      toast.error(mensagemErro(e));
    }
  };

  const total = etiquetas.length * (permiteCopias ? Math.max(1, copias) : 1);

  return (
    <Modal
      aberto={aberto}
      onFechar={onFechar}
      titulo={titulo}
      descricao={`${etiquetas.length} registro${etiquetas.length > 1 ? 's' : ''} marcado${etiquetas.length > 1 ? 's' : ''}.`}
      rodape={
        <>
          <Button variante="secundario" onClick={onFechar}>
            Cancelar
          </Button>
          <Button variante="primario" icone={<Printer className="h-4 w-4" />} onClick={imprimir}>
            Imprimir {total} etiqueta{total > 1 ? 's' : ''}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-2">
          {(
            [
              { v: 'a4' as const, nome: 'Folha A4 adesiva', desc: 'Cartela tipo Pimaco — 3 por linha, 24 por folha. Sai na impressora comum.' },
              { v: 'termica' as const, nome: 'Etiquetadora térmica', desc: 'Rolo, 50 × 30 mm, uma etiqueta por vez.' },
            ] as const
          ).map((op) => (
            <button
              key={op.v}
              type="button"
              onClick={() => setFormato(op.v)}
              className={
                'rounded-xl border p-3 text-left transition ' + (formato === op.v ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500' : 'border-slate-200 hover:bg-slate-50')
              }
            >
              <p className="flex items-center gap-1.5 text-sm font-medium text-slate-900">
                <Tag className="h-3.5 w-3.5 text-slate-400" /> {op.nome}
              </p>
              <p className="mt-1 text-xs text-slate-500">{op.desc}</p>
            </button>
          ))}
        </div>

        {permiteCopias && (
          <Input
            label="Cópias de cada etiqueta"
            type="number"
            min={1}
            max={50}
            value={copias}
            onChange={(e) => setCopias(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
            ajuda="Use quando tiver várias unidades do mesmo produto na prateleira."
            className="sm:w-56"
          />
        )}

        <p className="text-xs text-slate-500">
          A etiqueta sai com código de barras (Code 128), que o leitor da loja reconhece. Na primeira vez, confira a medida numa folha comum antes de gastar adesivo.
        </p>
      </div>
    </Modal>
  );
}
