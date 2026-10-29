import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { BadgeCheck, CalendarClock, CircleCheck, FileText, Globe, Loader2, PackageOpen, Percent, Wallet } from 'lucide-react';
import { API_BASE, api, mensagemErro } from '@/lib/api';
import { Badge, Button, Card, Checkbox, Input } from '@/components/ui';
import { data, dataHora, moeda, somenteDigitos } from '@/lib/format';
import { AssinaturaCanvas } from '@/components/compartilhados/AssinaturaCanvas';
import { LayoutPublico } from './LayoutPublico';
import { tomStatus, type StatusConsignacao } from '../consignacoes/comum';

interface Visao {
  empresa: { nome: string; telefone: string | null; site: string | null; logoPath: string | null };
  consignacao: {
    numero: number;
    status: StatusConsignacao;
    rotuloStatus: string;
    consignante: string;
    descricao: string;
    marca: string | null;
    modelo: string | null;
    estado: string | null;
    acessorios: string | null;
    fotos: { nome: string; url: string }[];
    precoVenda: number;
    percentualConsignante: number;
    valorConsignante: number;
    dataEntrada: string;
    dataLimite: string;
    diasConsignado: number;
    diasParaPrazo: number;
    prazoDias: number;
    diaria: number;
    diariaPct: number;
    taxaRetirada: number;
    assinado: boolean;
    assinadoEm: string | null;
    vendidoEm: string | null;
    retiradoEm: string | null;
    quitadoEm: string | null;
    escolha: string | null;
    podeEscolher: boolean;
    pago: number;
    saldo: number;
    proximoPagamento: { vencimento: string; valor: number } | null;
    pagamentos: { descricao: string; vencimento: string; valor: number; pago: number; situacao: string; dataPagamento: string | null }[];
    descontoPendente: { id: number; pct: number; precoDe: number; precoPara: number; valorDe: number; valorPara: number } | null;
    linhaDoTempo: { data: string; tipo: string; texto: string }[];
    noSite: boolean;
  };
}

/** Link do consignante (sem login): assinar o contrato, autorizar desconto, escolher retirar ou receber e acompanhar os pagamentos. */
export default function ConsignacaoPublica() {
  const { token } = useParams();
  const qc = useQueryClient();
  const chave = ['publico-consignacao', token];
  const { data: r, isLoading, error } = useQuery({ queryKey: chave, queryFn: () => api.get<Visao>(`/publico/consignacao/${token}`), retry: 0 });
  const [nome, setNome] = useState('');
  const [cpf, setCpf] = useState('');
  const [aceite, setAceite] = useState(false);
  const [assinatura, setAssinatura] = useState<string | null>(null);
  const recarregar = (v: Visao, msg: string) => {
    qc.setQueryData(chave, v);
    toast.success(msg);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const assinar = useMutation({ mutationFn: () => api.post<Visao>(`/publico/consignacao/${token}/assinar`, { nome: nome.trim(), documento: somenteDigitos(cpf), aceite, assinatura }), onSuccess: (v) => recarregar(v, 'Contrato assinado. Obrigado!'), onError: (e) => toast.error(mensagemErro(e)) });
  const responder = useMutation({ mutationFn: (autorizar: boolean) => api.post<Visao & { status: string }>(`/publico/consignacao/${token}/desconto/${r?.consignacao.descontoPendente?.id}`, { autorizar }), onSuccess: (v) => recarregar(v, v.status === 'AUTORIZADO' ? 'Desconto autorizado. Vamos vender rapidinho!' : 'Tudo bem, o preço continua o mesmo.'), onError: (e) => toast.error(mensagemErro(e)) });
  const escolher = useMutation({ mutationFn: (escolha: 'RECEBER' | 'RETIRAR') => api.post<Visao>(`/publico/consignacao/${token}/escolha`, { escolha }), onSuccess: (v) => recarregar(v, 'Escolha registrada. A loja já foi avisada.'), onError: (e) => toast.error(mensagemErro(e)) });

  if (isLoading) return <LayoutPublico><div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-slate-300" /></div></LayoutPublico>;
  if (error || !r) return <LayoutPublico><Card><p className="py-8 text-center text-sm text-slate-500">{error ? mensagemErro(error) : 'Contrato não encontrado.'}</p></Card></LayoutPublico>;

  const c = r.consignacao;
  const ativo = ['NO_PRAZO', 'EM_DIARIAS', 'AGUARDANDO_RETIRADA'].includes(c.status);
  const progresso = c.valorConsignante > 0 ? Math.min(100, (c.pago / c.valorConsignante) * 100) : 0;
  const contrato = `${API_BASE}/publico/consignacao/${token}/contrato`;

  return (
    <LayoutPublico empresa={{ nome: r.empresa.nome, telefone: r.empresa.telefone, logoPath: r.empresa.logoPath }}>
      <div className="space-y-4">
        <Card>
          <div className="flex items-start gap-3">
            {c.fotos[0] && <img src={c.fotos[0].url} alt="" className="h-20 w-20 shrink-0 rounded-lg border border-slate-200 object-cover" />}
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Consignação nº {c.numero}</p>
              <h1 className="text-lg font-bold leading-tight text-slate-900">{c.descricao}</h1>
              <p className="text-sm text-slate-600">Olá, {c.consignante}!</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <Badge tom={tomStatus(c.status)}>{c.rotuloStatus}</Badge>
                {c.noSite && <Badge tom="azul"><Globe className="h-3 w-3" /> À venda no site</Badge>}
              </div>
            </div>
          </div>
        </Card>

        {c.status === 'VENDIDO' && (
          <Card>
            <div className="flex items-center gap-3 text-emerald-700">
              <CircleCheck className="h-7 w-7 shrink-0" />
              <div>
                <p className="font-semibold">Seu equipamento foi vendido{c.vendidoEm ? ` em ${data(c.vendidoEm)}` : ''}!</p>
                <p className="text-sm text-emerald-600">{c.saldo > 0 ? `Falta te pagar ${moeda(c.saldo)}.` : 'Você já recebeu tudo. Obrigado pela confiança!'}</p>
              </div>
            </div>
          </Card>
        )}

        {c.descontoPendente && (
          <Card className="border-violet-200">
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-violet-700"><Percent className="h-5 w-5" /><p className="font-semibold">Autoriza baixar {c.descontoPendente.pct}% para vender mais rápido?</p></div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-lg bg-slate-50 p-2.5"><p className="text-[11px] uppercase text-slate-400">Preço na loja</p><p><s className="text-slate-400">{moeda(c.descontoPendente.precoDe)}</s> <b className="num text-slate-900">{moeda(c.descontoPendente.precoPara)}</b></p></div>
                <div className="rounded-lg bg-slate-50 p-2.5"><p className="text-[11px] uppercase text-slate-400">Você recebe</p><p><s className="text-slate-400">{moeda(c.descontoPendente.valorDe)}</s> <b className="num text-slate-900">{moeda(c.descontoPendente.valorPara)}</b></p></div>
              </div>
              <div className="flex gap-2">
                <Button variante="sucesso" tamanho="lg" className="flex-1" carregando={responder.isPending && responder.variables === true} onClick={() => responder.mutate(true)}>Autorizo</Button>
                <Button tamanho="lg" className="flex-1" carregando={responder.isPending && responder.variables === false} onClick={() => responder.mutate(false)}>Manter o preço</Button>
              </div>
            </div>
          </Card>
        )}

        {c.podeEscolher && ativo && (
          <Card className="border-amber-200">
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-amber-700"><CalendarClock className="h-5 w-5" /><p className="font-semibold">O prazo de {c.prazoDias} dias terminou. O que você prefere?</p></div>
              <p className="text-sm text-slate-600">Seu equipamento continua à venda. Escolha como quer seguir — dá para mudar depois falando com a loja.</p>
              <button type="button" disabled={escolher.isPending} onClick={() => escolher.mutate('RECEBER')} className={`w-full rounded-xl border-2 p-3 text-left ${c.escolha !== 'RETIRAR' ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 bg-white'}`}>
                <p className="font-semibold text-slate-900"><Wallet className="mr-1 inline h-4 w-4" /> Receber aos poucos</p>
                <p className="text-sm text-slate-600">{moeda(c.diaria)} por dia útil até completar {moeda(c.valorConsignante)}. Se vender antes, pagamos o que faltar.</p>
              </button>
              <button type="button" disabled={escolher.isPending} onClick={() => escolher.mutate('RETIRAR')} className={`w-full rounded-xl border-2 p-3 text-left ${c.escolha === 'RETIRAR' ? 'border-sky-500 bg-sky-50' : 'border-slate-200 bg-white'}`}>
                <p className="font-semibold text-slate-900"><PackageOpen className="mr-1 inline h-4 w-4" /> Retirar o equipamento</p>
                <p className="text-sm text-slate-600">Sem taxa. {c.pago > 0 ? `Na retirada você devolve os ${moeda(c.pago)} já recebidos.` : 'Combine o dia com a loja.'}</p>
              </button>
            </div>
          </Card>
        )}

        <Card titulo="Valores do contrato">
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-lg bg-slate-50 p-2.5"><p className="text-[11px] uppercase text-slate-400">Preço na loja</p><p className="num font-semibold">{moeda(c.precoVenda)}</p></div>
            <div className="rounded-lg bg-emerald-50 p-2.5"><p className="text-[11px] uppercase text-emerald-700">Você recebe</p><p className="num font-semibold text-emerald-800">{moeda(c.valorConsignante)}</p></div>
            <div className="rounded-lg bg-slate-50 p-2.5"><p className="text-[11px] uppercase text-slate-400">Prazo</p><p className="font-semibold">até {data(c.dataLimite)}</p>{c.status === 'NO_PRAZO' && <p className="text-[11px] text-slate-500">{c.diasParaPrazo > 0 ? `faltam ${c.diasParaPrazo} dia(s)` : 'termina hoje'}</p>}</div>
            <div className="rounded-lg bg-slate-50 p-2.5"><p className="text-[11px] uppercase text-slate-400">Depois do prazo</p><p className="num font-semibold">{moeda(c.diaria)}/dia útil</p></div>
          </div>
          <ul className="mt-3 space-y-1 text-xs text-slate-500">
            <li>• Vendeu: pagamos {moeda(c.valorConsignante)} na hora (PIX).</li>
            <li>• Não vendeu até {data(c.dataLimite)}: pagamos {c.diariaPct}% por dia útil até completar.</li>
            <li>• Retirar antes do prazo tem taxa de {moeda(c.taxaRetirada)}; depois do prazo, sem taxa.</li>
          </ul>
          <a href={contrato} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:underline"><FileText className="h-4 w-4" /> Ver o contrato completo</a>
        </Card>

        {!c.assinado && ativo && (
          <Card titulo="Assinar o contrato" descricao="Leva menos de um minuto">
            <div className="space-y-3">
              <Input label="Seu nome completo" value={nome} onChange={(e) => setNome(e.target.value)} autoComplete="name" />
              <Input label="Seu CPF" inputMode="numeric" value={cpf} onChange={(e) => setCpf(e.target.value)} placeholder="000.000.000-00" />
              <div>
                <p className="mb-1.5 text-sm font-medium text-slate-700">Sua assinatura</p>
                <AssinaturaCanvas onMudar={setAssinatura} />
              </div>
              <Checkbox checked={aceite} onChange={(e) => setAceite(e.target.checked)} label="Li e concordo com o contrato de consignação e declaro que o equipamento é meu, de origem lícita e sem bloqueio." />
              <Button variante="primario" tamanho="lg" className="w-full" icone={<BadgeCheck className="h-5 w-5" />} disabled={!aceite || !assinatura || nome.trim().length < 3 || somenteDigitos(cpf).length < 11} carregando={assinar.isPending} onClick={() => assinar.mutate()}>Assinar contrato</Button>
              <p className="text-center text-[11px] text-slate-400">Registramos nome, CPF, data, hora e o endereço do aparelho como prova da assinatura.</p>
            </div>
          </Card>
        )}
        {c.assinado && c.assinadoEm && <p className="text-center text-xs text-emerald-700"><BadgeCheck className="mr-1 inline h-4 w-4" />Contrato assinado em {dataHora(c.assinadoEm)}</p>}

        {(c.pagamentos.length > 0 || c.status === 'EM_DIARIAS') && (
          <Card titulo="Seus pagamentos">
            <div className="mb-3">
              <div className="flex justify-between text-sm"><span className="text-slate-600">Recebido</span><span className="num font-semibold">{moeda(c.pago)} de {moeda(c.valorConsignante)}</span></div>
              <div className="mt-1 h-3 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${progresso}%` }} /></div>
              {c.proximoPagamento && c.saldo > 0 && <p className="mt-1 text-xs text-slate-500">Próximo: {moeda(c.proximoPagamento.valor)} em {data(c.proximoPagamento.vencimento)}</p>}
            </div>
            <ul className="divide-y divide-slate-100 text-sm">
              {c.pagamentos.map((p, i) => (
                <li key={i} className="flex items-center justify-between gap-2 py-2">
                  <div><p className="text-slate-700">{p.descricao}</p><p className="text-[11px] text-slate-400">{p.situacao === 'PAGO' && p.dataPagamento ? `pago em ${data(p.dataPagamento)}` : `previsto ${data(p.vencimento)}`}</p></div>
                  <span className={`num ${p.situacao === 'PAGO' ? 'font-semibold text-emerald-700' : 'text-slate-600'}`}>{moeda(p.valor)}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {c.linhaDoTempo.length > 0 && (
          <Card titulo="O que aconteceu">
            <ol className="space-y-2.5">
              {c.linhaDoTempo.map((e, i) => (
                <li key={i} className="text-sm">
                  <p className="text-slate-700">{e.texto}</p>
                  <p className="text-[11px] text-slate-400">{dataHora(e.data)}</p>
                </li>
              ))}
            </ol>
          </Card>
        )}
      </div>
    </LayoutPublico>
  );
}
