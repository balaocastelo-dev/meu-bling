/** Tipos, rótulos e peças comuns das telas de consignação. */
import clsx from 'clsx';
import type { ReactNode } from 'react';

export type StatusConsignacao = 'NO_PRAZO' | 'EM_DIARIAS' | 'AGUARDANDO_RETIRADA' | 'VENDIDO' | 'QUITADO' | 'RETIRADO' | 'CANCELADO';

export interface ContaConsignacao { id: number; descricao: string; valor: number; valorPago: number; juros: number; desconto: number; situacao: string; vencimento: string; dataPagamento: string | null; parcela: string | null }
export interface DescontoConsignacao { id: number; pct: number; precoDe: number; precoPara: number; valorDe: number; valorPara: number; status: string; origem: string; pedidoEm: string; respondidoEm: string | null }
export interface EventoConsignacao { id: number; data: string; tipo: string; texto: string; publico: boolean }
export interface Alerta { tom: 'vermelho' | 'amarelo' | 'verde' | 'azul'; texto: string }

export interface Consignacao {
  id: number;
  numero: number;
  status: StatusConsignacao;
  rotuloStatus: string;
  tipoEquipamento: string;
  descricao: string;
  marca: string | null;
  modelo: string | null;
  numeroSerie: string | null;
  imei: string | null;
  estado: string | null;
  acessorios: string | null;
  detalhes: string | null;
  declaracaoOrigem: boolean;
  precoVenda: number;
  percentualConsignante: number;
  valorConsignante: number;
  precoVendaOriginal: number;
  valorConsignanteOriginal: number;
  prazoDias: number;
  diariaPct: number;
  diariaMinima: number;
  diariaMaxima: number;
  diariaValor: number | null;
  taxaRetirada: number;
  dataEntrada: string;
  dataLimite: string;
  assinadoEm: string | null;
  assinadoPor: string | null;
  assinaturaNome: string | null;
  escolha: string | null;
  vendaId: number | null;
  vendaNumero: number | null;
  vendidoEm: string | null;
  vendidoEmDiarias: boolean;
  retiradoEm: string | null;
  quitadoEm: string | null;
  mostrarNoSite: boolean;
  destaque: boolean;
  observacoes: string | null;
  consignante: { id: number; nome: string; documento: string | null; celular: string | null; telefone: string | null; email: string | null };
  vendedor: { id: number; nome: string } | null;
  produto: { id: number; codigo: string; nome: string; preco: number; ativo: boolean } | null;
  compra: { id: number; numero: number; situacao: { nome: string; cor: string } } | null;
  contasPagar?: ContaConsignacao[];
  contasReceber?: { id: number; descricao: string; valor: number; valorRecebido: number; situacao: string; vencimento: string }[];
  descontos?: DescontoConsignacao[];
  eventos?: EventoConsignacao[];
  // calculados
  pago: number;
  saldo: number;
  devidoHoje: number;
  atrasado: number;
  diariasTotal: number;
  diariasPagas: number;
  proximaDiaria: { vencimento: string; valor: number } | null;
  diasConsignado: number;
  diasParaPrazo: number;
  estoque: number;
  descontoPendente: DescontoConsignacao | null;
  alerta: Alerta | null;
  link: string;
  fotosUrls: { nome: string; url: string }[];
  lucroLoja: number;
}

export const TIPOS_EQUIPAMENTO: { valor: string; rotulo: string }[] = [
  { valor: 'NOTEBOOK', rotulo: 'Notebook' },
  { valor: 'PC', rotulo: 'Computador' },
  { valor: 'PC_GAMER', rotulo: 'PC Gamer' },
  { valor: 'CELULAR', rotulo: 'Celular / iPhone' },
  { valor: 'TABLET', rotulo: 'Tablet / iPad' },
  { valor: 'GAMES', rotulo: 'Videogame' },
  { valor: 'MONITOR', rotulo: 'Monitor' },
  { valor: 'OUTRO', rotulo: 'Outro' },
];
export const nomeTipo = (t: string) => TIPOS_EQUIPAMENTO.find((x) => x.valor === t)?.rotulo ?? t;

export const STATUS: { valor: StatusConsignacao; rotulo: string }[] = [
  { valor: 'NO_PRAZO', rotulo: 'No prazo' },
  { valor: 'EM_DIARIAS', rotulo: 'Em diárias' },
  { valor: 'AGUARDANDO_RETIRADA', rotulo: 'Aguardando retirada' },
  { valor: 'VENDIDO', rotulo: 'Vendido' },
  { valor: 'QUITADO', rotulo: 'Quitado' },
  { valor: 'RETIRADO', rotulo: 'Retirado' },
  { valor: 'CANCELADO', rotulo: 'Cancelado' },
];

export const tomStatus = (s: StatusConsignacao) =>
  (({ NO_PRAZO: 'azul', EM_DIARIAS: 'amarelo', AGUARDANDO_RETIRADA: 'roxo', VENDIDO: 'verde', QUITADO: 'verde', RETIRADO: 'cinza', CANCELADO: 'cinza' }) as const)[s] ?? 'neutro';

export function CaixaAlerta({ alerta, className }: { alerta: Alerta | null | undefined; className?: string }) {
  if (!alerta) return null;
  return (
    <div className={clsx('rounded-lg p-3 text-sm', alerta.tom === 'vermelho' ? 'bg-red-50 text-red-700' : alerta.tom === 'amarelo' ? 'bg-amber-50 text-amber-800' : alerta.tom === 'verde' ? 'bg-emerald-50 text-emerald-800' : 'bg-sky-50 text-sky-800', className)}>
      {alerta.texto}
    </div>
  );
}

export function corTexto(tom: Alerta['tom']) {
  return tom === 'vermelho' ? 'text-red-600' : tom === 'amarelo' ? 'text-amber-700' : tom === 'verde' ? 'text-emerald-700' : 'text-sky-700';
}

export function Info({ rotulo, valor, sub, destaque }: { rotulo: string; valor: ReactNode; sub?: ReactNode; destaque?: boolean }) {
  return (
    <div className="min-w-0 rounded-lg border border-slate-200 p-2.5">
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{rotulo}</p>
      <p className={clsx('num truncate text-base font-semibold', destaque ? 'text-slate-900' : 'text-slate-700')}>{valor}</p>
      {sub && <p className="text-[11px] text-slate-400">{sub}</p>}
    </div>
  );
}
