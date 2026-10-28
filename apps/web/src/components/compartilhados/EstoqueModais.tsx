import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, mensagemErro } from '@/lib/api';
import { useDepositos, opcoesDe } from '@/hooks/useListas';
import { buscarProdutos } from '@/lib/buscas';
import { Button, Modal, MoneyInput, SearchSelect, Select, Textarea } from '@/components/ui';

interface AjusteProps {
  aberto: boolean;
  onFechar: () => void;
  produtoId?: number | null;
  produtoNome?: string | null;
  depositoId?: number | null;
}

/** Modal de ajuste de estoque (entrada/saída/balanço) */
export function AjusteEstoqueModal({ aberto, onFechar, produtoId, produtoNome, depositoId }: AjusteProps) {
  const qc = useQueryClient();
  const { data: depositos } = useDepositos();
  const [prod, setProd] = useState<number | null>(produtoId ?? null);
  const [prodNome, setProdNome] = useState<string | null>(produtoNome ?? null);
  const [dep, setDep] = useState<number | ''>(depositoId ?? '');
  const [tipo, setTipo] = useState<'ENTRADA' | 'SAIDA' | 'BALANCO'>('ENTRADA');
  const [qtd, setQtd] = useState(0);
  const [custo, setCusto] = useState(0);
  const [obs, setObs] = useState('');

  useEffect(() => {
    if (aberto) {
      setProd(produtoId ?? null);
      setProdNome(produtoNome ?? null);
      setDep(depositoId ?? depositos?.find((d) => d.padrao)?.id ?? '');
      setQtd(0);
      setObs('');
    }
  }, [aberto, produtoId, produtoNome, depositoId, depositos]);

  const m = useMutation({
    mutationFn: () => api.post('/estoque/ajuste', { produtoId: prod, depositoId: Number(dep), quantidade: qtd, tipo, custoUnitario: custo || undefined, observacao: obs || undefined }),
    onSuccess: () => {
      toast.success('Estoque ajustado.');
      qc.invalidateQueries({ queryKey: ['estoque'] });
      qc.invalidateQueries({ queryKey: ['produto'] });
      qc.invalidateQueries({ queryKey: ['produtos'] });
      qc.invalidateQueries({ queryKey: ['movimentos'] });
      onFechar();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  return (
    <Modal
      aberto={aberto}
      onFechar={onFechar}
      titulo="Ajuste de estoque"
      rodape={
        <>
          <Button variante="secundario" onClick={onFechar}>Cancelar</Button>
          <Button variante="primario" carregando={m.isPending} disabled={!prod || !dep || (tipo !== 'BALANCO' && qtd <= 0)} onClick={() => m.mutate()}>Confirmar</Button>
        </>
      }
    >
      <div className="space-y-3">
        <SearchSelect label="Produto" obrigatorio valor={prod} rotuloAtual={prodNome} onChange={(v, op) => { setProd(v); setProdNome(op?.rotulo ?? null); }} buscar={(t) => buscarProdutos(t, 'P')} />
        <div className="grid grid-cols-2 gap-3">
          <Select label="Depósito" obrigatorio value={dep} onChange={(e) => setDep(e.target.value ? Number(e.target.value) : '')} opcoes={opcoesDe(depositos)} placeholder="—" />
          <Select label="Tipo" value={tipo} onChange={(e) => setTipo(e.target.value as typeof tipo)} opcoes={[{ valor: 'ENTRADA', rotulo: 'Entrada (soma)' }, { valor: 'SAIDA', rotulo: 'Saída (subtrai)' }, { valor: 'BALANCO', rotulo: 'Balanço (define saldo)' }]} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <MoneyInput label={tipo === 'BALANCO' ? 'Novo saldo' : 'Quantidade'} prefixo="" value={qtd} onChange={setQtd} />
          <MoneyInput label="Custo unitário (opcional)" oculto value={custo} onChange={setCusto} />
        </div>
        <Textarea label="Observação" rows={2} value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Motivo do ajuste" />
      </div>
    </Modal>
  );
}

/** Modal de transferência entre depósitos */
export function TransferenciaEstoqueModal({ aberto, onFechar, produtoId, produtoNome }: Omit<AjusteProps, 'depositoId'>) {
  const qc = useQueryClient();
  const { data: depositos } = useDepositos();
  const [prod, setProd] = useState<number | null>(produtoId ?? null);
  const [prodNome, setProdNome] = useState<string | null>(produtoNome ?? null);
  const [origem, setOrigem] = useState<number | ''>('');
  const [destino, setDestino] = useState<number | ''>('');
  const [qtd, setQtd] = useState(0);
  const [obs, setObs] = useState('');

  useEffect(() => {
    if (aberto) {
      setProd(produtoId ?? null);
      setProdNome(produtoNome ?? null);
      setQtd(0);
      setObs('');
    }
  }, [aberto, produtoId, produtoNome]);

  const m = useMutation({
    mutationFn: () => api.post('/estoque/transferencia', { produtoId: prod, origemId: Number(origem), destinoId: Number(destino), quantidade: qtd, observacao: obs || undefined }),
    onSuccess: () => {
      toast.success('Transferência realizada.');
      qc.invalidateQueries({ queryKey: ['estoque'] });
      qc.invalidateQueries({ queryKey: ['produto'] });
      qc.invalidateQueries({ queryKey: ['movimentos'] });
      onFechar();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  return (
    <Modal
      aberto={aberto}
      onFechar={onFechar}
      titulo="Transferência entre depósitos"
      rodape={
        <>
          <Button variante="secundario" onClick={onFechar}>Cancelar</Button>
          <Button variante="primario" carregando={m.isPending} disabled={!prod || !origem || !destino || origem === destino || qtd <= 0} onClick={() => m.mutate()}>Transferir</Button>
        </>
      }
    >
      <div className="space-y-3">
        <SearchSelect label="Produto" obrigatorio valor={prod} rotuloAtual={prodNome} onChange={(v, op) => { setProd(v); setProdNome(op?.rotulo ?? null); }} buscar={(t) => buscarProdutos(t, 'P')} />
        <div className="grid grid-cols-2 gap-3">
          <Select label="De" obrigatorio value={origem} onChange={(e) => setOrigem(e.target.value ? Number(e.target.value) : '')} opcoes={opcoesDe(depositos)} placeholder="—" />
          <Select label="Para" obrigatorio value={destino} onChange={(e) => setDestino(e.target.value ? Number(e.target.value) : '')} opcoes={opcoesDe(depositos)} placeholder="—" />
        </div>
        <MoneyInput label="Quantidade" prefixo="" value={qtd} onChange={setQtd} />
        <Textarea label="Observação" rows={2} value={obs} onChange={(e) => setObs(e.target.value)} />
      </div>
    </Modal>
  );
}
