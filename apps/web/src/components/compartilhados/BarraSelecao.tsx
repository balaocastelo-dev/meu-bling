import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { X } from 'lucide-react';
import { mensagemErro } from '@/lib/api';
import { Button, ConfirmDialog } from '@/components/ui';
import type { Selecao } from '@/hooks/useSelecao';

/**
 * BARRA DE AÇÕES DA SELEÇÃO (pedido do Thiago, 10/11/2026).
 *
 * Aparece grudada no topo da lista assim que alguém marca a primeira linha, com o
 * que dá para fazer com as marcadas: apagar, imprimir, clonar, etiqueta, relatório…
 * É a mesma barra em vendas, orçamentos, OS, notas e produtos — muda só a lista de ações.
 */
export interface AcaoLote {
  /** texto do botão */
  rotulo: string;
  icone?: ReactNode;
  /** 'perigo' deixa o botão vermelho e sempre pede confirmação */
  tom?: 'normal' | 'perigo';
  /** confirmação antes de executar (sempre pedida quando tom = 'perigo') */
  confirmacao?: { titulo: (n: number) => string; descricao: string; textoConfirmar?: string };
  /** some quando houver mais marcados do que isto (ex.: imprimir 200 de uma vez) */
  maximo?: number;
  /** o que fazer com os ids marcados. Devolver os ids que NÃO deram certo deixa só eles marcados. */
  executar: (ids: number[]) => Promise<void | number[]>;
}

export function BarraSelecao({
  selecao,
  acoes,
  nome,
  nomePlural,
}: {
  selecao: Selecao;
  acoes: AcaoLote[];
  /** já com a concordância pronta: "venda marcada", "ordem de serviço marcada" */
  nome: string;
  /** "vendas marcadas", "ordens de serviço marcadas" */
  nomePlural: string;
}) {
  const [confirmando, setConfirmando] = useState<AcaoLote | null>(null);
  const [rodando, setRodando] = useState<string | null>(null);

  if (!selecao.qtd) return null;
  const n = selecao.qtd;
  const quantos = `${n} ${n > 1 ? nomePlural : nome}`;

  const rodar = async (a: AcaoLote) => {
    setRodando(a.rotulo);
    try {
      const falhas = await a.executar(selecao.ids);
      // devolveu ids = esses não deram certo e continuam marcados para a pessoa ver
      if (Array.isArray(falhas)) selecao.definir(falhas);
      else selecao.limpar();
    } catch (e) {
      toast.error(mensagemErro(e));
    } finally {
      setRodando(null);
      setConfirmando(null);
    }
  };

  const clicar = (a: AcaoLote) => (a.tom === 'perigo' || a.confirmacao ? setConfirmando(a) : rodar(a));

  return (
    <>
      <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 border-b border-brand-100 bg-brand-50 px-3 py-2">
        <span className="text-sm font-medium text-brand-900">{quantos}</span>
        <div className="flex flex-wrap items-center gap-2">
          {acoes
            .filter((a) => !a.maximo || n <= a.maximo)
            .map((a) => (
              <Button key={a.rotulo} tamanho="sm" variante={a.tom === 'perigo' ? 'perigo' : 'secundario'} icone={a.icone} carregando={rodando === a.rotulo} disabled={!!rodando} onClick={() => clicar(a)}>
                {a.rotulo}
              </Button>
            ))}
          <Button tamanho="sm" variante="secundario" icone={<X className="h-3.5 w-3.5" />} disabled={!!rodando} onClick={selecao.limpar}>
            Desmarcar
          </Button>
        </div>
      </div>

      <ConfirmDialog
        aberto={!!confirmando}
        onFechar={() => setConfirmando(null)}
        titulo={confirmando?.confirmacao?.titulo(n) ?? `${confirmando?.rotulo} ${quantos}?`}
        descricao={confirmando?.confirmacao?.descricao ?? ''}
        textoConfirmar={confirmando?.confirmacao?.textoConfirmar ?? confirmando?.rotulo ?? 'Confirmar'}
        perigo={confirmando?.tom === 'perigo'}
        onConfirmar={() => (confirmando ? rodar(confirmando) : Promise.resolve())}
      />
    </>
  );
}

/**
 * Roda uma ação registro a registro e conta o resultado, para um erro num não
 * derrubar o lote inteiro. Devolve os ids que falharam — a barra deixa só eles marcados.
 */
export async function emLote(
  ids: number[],
  fazer: (id: number) => Promise<unknown>,
  textos: { feito: (n: number) => string; falhou: (n: number) => string },
): Promise<number[]> {
  const falhas: { id: number; motivo: string }[] = [];
  let ok = 0;
  for (const id of ids) {
    try {
      await fazer(id);
      ok += 1;
    } catch (e) {
      falhas.push({ id, motivo: mensagemErro(e) });
    }
  }
  if (ok) toast.success(textos.feito(ok));
  if (falhas.length) {
    toast.warning(textos.falhou(falhas.length), {
      description: [...new Set(falhas.map((f) => f.motivo))].slice(0, 3).join(' · '),
      duration: 15_000,
    });
  }
  return falhas.map((f) => f.id);
}
