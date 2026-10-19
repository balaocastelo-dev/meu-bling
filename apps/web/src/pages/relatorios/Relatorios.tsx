import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { format, startOfMonth } from 'date-fns';
import { Download } from 'lucide-react';
import { api, baixarArquivo, mensagemErro } from '@/lib/api';
import { useDepositos, useVendedores, opcoesDe } from '@/hooks/useListas';
import { Button, Card, EmptyState, PageHeader, PeriodoFiltro, SelectFiltro, Skeleton, Tabs } from '@/components/ui';
import { hoje, moeda, numero } from '@/lib/format';

type Linha = Record<string, string | number | null | undefined>;

interface Relatorio {
  id: string;
  rotulo: string;
  rota: string;
  descricao: string;
  colunas: { chave: string; titulo: string; formato?: 'moeda' | 'numero' | 'texto' }[];
  usaPeriodo: boolean;
  usaVendedor?: boolean;
  usaDeposito?: boolean;
}

const RELATORIOS: Relatorio[] = [
  {
    id: 'vendas',
    rotulo: 'Vendas por período',
    rota: '/relatorios/vendas-por-periodo',
    descricao: 'Faturamento, quantidade e ticket médio por dia.',
    usaPeriodo: true,
    usaVendedor: true,
    colunas: [
      { chave: 'periodo', titulo: 'Período' },
      { chave: 'qtdVendas', titulo: 'Vendas', formato: 'numero' },
      { chave: 'itens', titulo: 'Itens', formato: 'numero' },
      { chave: 'faturamento', titulo: 'Faturamento', formato: 'moeda' },
      { chave: 'descontos', titulo: 'Descontos', formato: 'moeda' },
      { chave: 'custo', titulo: 'Custo', formato: 'moeda' },
      { chave: 'lucro', titulo: 'Lucro', formato: 'moeda' },
      { chave: 'ticketMedio', titulo: 'Ticket médio', formato: 'moeda' },
    ],
  },
  {
    id: 'produtos',
    rotulo: 'Produtos mais vendidos',
    rota: '/relatorios/produtos-mais-vendidos',
    descricao: 'Ranking de produtos por quantidade e valor.',
    usaPeriodo: true,
    colunas: [
      { chave: 'posicao', titulo: '#', formato: 'texto' },
      { chave: 'nome', titulo: 'Produto' },
      { chave: 'codigo', titulo: 'Código' },
      { chave: 'categoria', titulo: 'Categoria' },
      { chave: 'qtd', titulo: 'Qtd', formato: 'numero' },
      { chave: 'valor', titulo: 'Valor', formato: 'moeda' },
      { chave: 'custo', titulo: 'Custo', formato: 'moeda' },
      { chave: 'lucro', titulo: 'Lucro', formato: 'moeda' },
      { chave: 'margemPct', titulo: 'Margem %', formato: 'numero' },
    ],
  },
  {
    id: 'estoque',
    rotulo: 'Posição de estoque',
    rota: '/relatorios/estoque',
    descricao: 'Valor em estoque por depósito (custo × saldo).',
    usaPeriodo: false,
    usaDeposito: true,
    colunas: [
      { chave: 'deposito', titulo: 'Depósito' },
      { chave: 'produto', titulo: 'Produto' },
      { chave: 'codigo', titulo: 'Código' },
      { chave: 'categoria', titulo: 'Categoria' },
      { chave: 'saldo', titulo: 'Saldo', formato: 'numero' },
      { chave: 'reservado', titulo: 'Reservado', formato: 'numero' },
      { chave: 'custoUnitario', titulo: 'Custo', formato: 'moeda' },
      { chave: 'valorCusto', titulo: 'Valor (custo)', formato: 'moeda' },
      { chave: 'valorVenda', titulo: 'Valor (venda)', formato: 'moeda' },
    ],
  },
  {
    id: 'comissoes',
    rotulo: 'Comissões',
    rota: '/relatorios/comissoes',
    descricao: 'Comissões por vendedor/técnico no período.',
    usaPeriodo: true,
    usaVendedor: true,
    colunas: [
      { chave: 'pessoa', titulo: 'Pessoa' },
      { chave: 'tipo', titulo: 'Tipo' },
      { chave: 'descricao', titulo: 'Origem' },
      { chave: 'cliente', titulo: 'Cliente' },
      { chave: 'competencia', titulo: 'Competência' },
      { chave: 'base', titulo: 'Base', formato: 'moeda' },
      { chave: 'pct', titulo: '%', formato: 'numero' },
      { chave: 'valor', titulo: 'Comissão', formato: 'moeda' },
      { chave: 'status', titulo: 'Status' },
    ],
  },
];

function fmt(v: unknown, f?: 'moeda' | 'numero' | 'texto'): string {
  if (v === null || v === undefined) return '—';
  if (f === 'moeda') return moeda(Number(v));
  if (f === 'numero') return numero(Number(v));
  return String(v);
}

/** Relatórios tabulares com exportação CSV */
export default function Relatorios() {
  const [ativo, setAtivo] = useState('vendas');
  const [periodo, setPeriodo] = useState({ i: format(startOfMonth(new Date()), 'yyyy-MM-dd'), f: hoje() });
  const [vendedorId, setVendedorId] = useState('');
  const [depositoId, setDepositoId] = useState('');
  const { data: vendedores } = useVendedores();
  const { data: depositos } = useDepositos();
  const rel = RELATORIOS.find((r) => r.id === ativo)!;

  const params = { dataInicial: rel.usaPeriodo ? periodo.i : undefined, dataFinal: rel.usaPeriodo ? periodo.f : undefined, vendedorId: rel.usaVendedor ? vendedorId : undefined, depositoId: rel.usaDeposito ? depositoId : undefined };
  const { data, isLoading, error } = useQuery({
    queryKey: ['relatorio', rel.id, params],
    queryFn: async () => {
      const r = await api.get<Linha[] | { data?: Linha[]; linhas?: Linha[]; itens?: Linha[]; totais?: Linha }>(rel.rota, params);
      if (Array.isArray(r)) return { linhas: r, totais: undefined as Linha | undefined };
      return { linhas: r.data ?? r.linhas ?? r.itens ?? [], totais: r.totais };
    },
    retry: 0,
  });

  // Colunas: apenas as definidas que existirem nos dados (ignora chaves extras da API)
  const linhas = data?.linhas ?? [];
  const chavesDados = linhas.length ? Object.keys(linhas[0]).filter((k) => typeof linhas[0][k] !== 'object') : [];
  const colunas = rel.colunas.filter((c) => !linhas.length || chavesDados.includes(c.chave));

  const exportar = () => baixarArquivo(rel.rota, `${rel.id}.csv`, { ...params, formato: 'csv' }).catch((e) => toast.error(mensagemErro(e)));

  // Totais calculados no cliente para colunas de valor/quantidade (não soma percentuais, posições e ticket médio)
  const SEM_TOTAL = new Set(['posicao', 'pct', 'margemPct', 'ticketMedio', 'custoUnitario', 'periodo', 'competencia']);
  const totais = colunas.map((c) => ((c.formato === 'moeda' || c.formato === 'numero') && !SEM_TOTAL.has(c.chave) ? linhas.reduce((s, l) => s + (Number(l[c.chave]) || 0), 0) : null));

  return (
    <div>
      <PageHeader titulo="Relatórios" descricao={rel.descricao} acoes={<Button variante="secundario" icone={<Download className="h-4 w-4" />} onClick={exportar}>Exportar CSV</Button>} />
      <Card semPadding>
        <Tabs className="px-3" ativa={ativo} onMudar={setAtivo} abas={RELATORIOS.map((r) => ({ id: r.id, rotulo: r.rotulo }))} />
        <div className="flex flex-wrap items-end gap-2 border-b border-slate-100 px-3 py-2.5">
          {rel.usaPeriodo && <PeriodoFiltro inicial={periodo.i} final={periodo.f} onChange={(i, f) => setPeriodo({ i, f })} label="" />}
          {rel.usaVendedor && <SelectFiltro valor={vendedorId} onChange={setVendedorId} opcoes={opcoesDe(vendedores)} placeholder="Todos vendedores" />}
          {rel.usaDeposito && <SelectFiltro valor={depositoId} onChange={setDepositoId} opcoes={opcoesDe(depositos)} placeholder="Todos depósitos" />}
        </div>
        {isLoading ? (
          <div className="p-4"><Skeleton className="h-64" /></div>
        ) : error ? (
          <EmptyState titulo="Relatório indisponível" descricao={mensagemErro(error)} />
        ) : !linhas.length ? (
          <EmptyState titulo="Sem dados para os filtros" />
        ) : (
          <div className="overflow-auto">
            <table className="tbl">
              <thead>
                <tr>{colunas.map((c) => <th key={c.chave} className={c.formato === 'moeda' || c.formato === 'numero' ? 'text-right' : ''}>{c.titulo}</th>)}</tr>
              </thead>
              <tbody>
                {linhas.map((l, i) => (
                  <tr key={i}>{colunas.map((c) => <td key={c.chave} className={c.formato === 'moeda' || c.formato === 'numero' ? 'num text-right' : ''}>{fmt(l[c.chave], c.formato)}</td>)}</tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50 font-semibold">
                  {colunas.map((c, i) => <td key={c.chave} className={`px-3 py-2 ${totais[i] !== null ? 'num text-right' : ''}`}>{i === 0 && totais[0] === null ? 'Total' : totais[i] !== null ? fmt(totais[i], c.formato) : ''}</td>)}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
