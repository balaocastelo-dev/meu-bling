import { useState } from 'react';
import { toast } from 'sonner';
import { Pencil } from 'lucide-react';
import { Button, Modal, Select } from '@/components/ui';
import { mensagemErro } from '@/lib/api';

/**
 * EDITAR VÁRIOS DE UMA VEZ (pedido do Thiago, 10/11/2026).
 *
 * Um campo por vez, de propósito: a pessoa escolhe O QUE mudar e PARA QUÊ, vê
 * quantos registros vão ser afetados e confirma. Mudar vários campos ao mesmo
 * tempo numa tela só é onde esse tipo de função costuma causar estrago.
 *
 * Cada registro é alterado separadamente: um que recusar (regra de situação,
 * permissão) não derruba os outros, e os que falharam continuam marcados.
 */
export interface CampoLote {
  chave: string;
  rotulo: string;
  opcoes: { valor: string | number; rotulo: string }[];
  /** como gravar num registro */
  aplicar: (id: number, valor: string) => Promise<unknown>;
  /** aviso extra mostrado quando este campo é escolhido */
  aviso?: string;
}

export function EditarEmLote({
  aberto,
  onFechar,
  ids,
  campos,
  nome,
  nomePlural,
  aoTerminar,
}: {
  aberto: boolean;
  onFechar: () => void;
  ids: number[];
  campos: CampoLote[];
  nome: string;
  nomePlural: string;
  /** recebe os ids que NÃO deram certo */
  aoTerminar: (falhas: number[]) => void;
}) {
  const [campo, setCampo] = useState('');
  const [valor, setValor] = useState('');
  const [salvando, setSalvando] = useState(false);

  const escolhido = campos.find((c) => c.chave === campo);
  const n = ids.length;

  const fechar = () => {
    setCampo('');
    setValor('');
    onFechar();
  };

  const salvar = async () => {
    if (!escolhido || !valor) return;
    setSalvando(true);
    const falhas: { id: number; motivo: string }[] = [];
    let ok = 0;
    for (const id of ids) {
      try {
        await escolhido.aplicar(id, valor);
        ok += 1;
      } catch (e) {
        falhas.push({ id, motivo: mensagemErro(e) });
      }
    }
    setSalvando(false);
    if (ok) toast.success(`${escolhido.rotulo} alterad${/a$/.test(escolhido.rotulo) ? 'a' : 'o'} em ${ok} ${ok > 1 ? nomePlural : nome}.`);
    if (falhas.length) {
      toast.warning(`${falhas.length} não foi alterad${falhas.length > 1 ? 'os' : 'o'}.`, {
        description: [...new Set(falhas.map((f) => f.motivo))].slice(0, 3).join(' · '),
        duration: 15_000,
      });
    }
    aoTerminar(falhas.map((f) => f.id));
    if (!falhas.length) fechar();
  };

  return (
    <Modal
      aberto={aberto}
      onFechar={fechar}
      titulo={`Editar ${n} ${n > 1 ? nomePlural : nome}`}
      descricao="Escolha o que mudar. A alteração vale para todos os marcados."
      rodape={
        <>
          <Button variante="secundario" onClick={fechar}>
            Cancelar
          </Button>
          <Button variante="primario" icone={<Pencil className="h-4 w-4" />} carregando={salvando} disabled={!escolhido || !valor} onClick={salvar}>
            Aplicar nos {n}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Select
          label="O que mudar"
          value={campo}
          onChange={(e) => {
            setCampo(e.target.value);
            setValor('');
          }}
          opcoes={campos.map((c) => ({ valor: c.chave, rotulo: c.rotulo }))}
          placeholder="Escolha o campo…"
        />
        {escolhido && (
          <Select label={`Novo valor de ${escolhido.rotulo.toLowerCase()}`} value={valor} onChange={(e) => setValor(e.target.value)} opcoes={escolhido.opcoes} placeholder="Escolha…" />
        )}
        {escolhido?.aviso && <p className="rounded bg-amber-50 px-3 py-2 text-xs text-amber-800">{escolhido.aviso}</p>}
        {escolhido && valor && (
          <p className="text-xs text-slate-500">
            Vai mudar <b>{escolhido.rotulo.toLowerCase()}</b> em <b>{n}</b> {n > 1 ? nomePlural : nome}. Os que recusarem (por regra ou permissão) continuam marcados, com o motivo.
          </p>
        )}
      </div>
    </Modal>
  );
}
