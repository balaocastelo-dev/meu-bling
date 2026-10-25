/** Aba "Registro de chamadas": tudo o que as chaves fizeram (30 dias). */
import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { dataHora } from '@/lib/format';
import { Badge, Button, Checkbox, Pagination, Select, Table } from '@/components/ui';
import { CorMetodo, type ChaveApi } from './comum';

interface Linha {
  id: number;
  metodo: string;
  rota: string;
  status: number;
  ms: number;
  ip: string | null;
  origem: 'API' | 'MCP';
  erro: string | null;
  data: string;
  chave: { id: number; nome: string } | null;
}

export function AbaRegistro({ chaveInicial }: { chaveInicial: number | null }) {
  const [chaveId, setChaveId] = useState<number | null>(chaveInicial);
  const [erros, setErros] = useState(false);
  const [origem, setOrigem] = useState('');
  const [pagina, setPagina] = useState(1);
  const [limite, setLimite] = useState(50);
  const { data: chaves } = useQuery({ queryKey: ['api-externa', 'chaves'], queryFn: () => api.get<ChaveApi[]>('/api-externa/chaves') });
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['api-externa', 'logs', chaveId, erros, origem, pagina, limite],
    queryFn: () => api.get<{ data: Linha[]; meta: { total: number; totalPaginas: number } }>('/api-externa/logs', { chaveId, erros: erros || undefined, origem, pagina, limite }),
    placeholderData: keepPreviousData,
    refetchInterval: 15_000,
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <Select label="Chave" className="w-full sm:w-64" value={chaveId ?? ''} onChange={(e) => { setChaveId(e.target.value ? Number(e.target.value) : null); setPagina(1); }} placeholder="Todas" opcoes={(chaves ?? []).map((c) => ({ valor: c.id, rotulo: c.nome }))} />
        <Select label="Origem" className="w-full sm:w-48" value={origem} onChange={(e) => { setOrigem(e.target.value); setPagina(1); }} placeholder="API e agentes" opcoes={[{ valor: 'API', rotulo: 'API (sistemas)' }, { valor: 'MCP', rotulo: 'Agentes de IA (MCP)' }]} />
        <div className="pb-2"><Checkbox label="Só erros e negados" checked={erros} onChange={(e) => { setErros(e.target.checked); setPagina(1); }} /></div>
        <Button variante="secundario" tamanho="sm" className="mb-0.5" icone={<RefreshCw className="h-4 w-4" />} carregando={isFetching} onClick={() => refetch()}>Atualizar</Button>
      </div>
      <Table<Linha>
        compacta
        carregando={isLoading}
        dados={data?.data}
        chave={(l) => l.id}
        vazio={<p className="p-6 text-center text-sm text-slate-400">Nenhuma chamada registrada {erros ? 'com erro ' : ''}ainda.</p>}
        colunas={[
          { chave: 'quando', titulo: 'Quando', render: (l) => <span className="whitespace-nowrap text-xs text-slate-500">{dataHora(l.data)}</span> },
          { chave: 'chave', titulo: 'Chave', render: (l) => <span className="whitespace-nowrap text-xs">{l.chave?.nome ?? '—'}{l.origem === 'MCP' && <Badge tom="roxo" className="ml-1 text-[10px]">IA</Badge>}</span> },
          {
            chave: 'rota',
            titulo: 'Chamada',
            render: (l) => (
              <div className="flex min-w-0 items-start gap-2">
                <CorMetodo metodo={l.metodo} />
                <div className="min-w-0">
                  <code className="break-all text-xs text-slate-700">{l.rota}</code>
                  {l.erro && <p className="text-xs text-red-600">{l.erro}</p>}
                </div>
              </div>
            ),
          },
          { chave: 'status', titulo: 'Resultado', render: (l) => <Badge tom={l.status < 300 ? 'verde' : l.status === 429 ? 'amarelo' : 'vermelho'}>{l.status}</Badge> },
          { chave: 'ms', titulo: 'Tempo', direita: true, ocultarMobile: true, render: (l) => <span className="text-xs text-slate-500">{l.ms} ms</span> },
          { chave: 'ip', titulo: 'IP', ocultarMobile: true, render: (l) => <span className="font-mono text-xs text-slate-400">{l.ip ?? '—'}</span> },
        ]}
      />
      {data && <Pagination pagina={pagina} totalPaginas={data.meta.totalPaginas} total={data.meta.total} limite={limite} onPagina={setPagina} onLimite={(n) => { setLimite(n); setPagina(1); }} />}
    </div>
  );
}
