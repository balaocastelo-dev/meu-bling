import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { BadgeCheck, CircleCheck, Loader2, Wrench } from 'lucide-react';
import { api, mensagemErro } from '@/lib/api';
import { Badge, BadgeCor, Button, Card, Input, tomPorStatus } from '@/components/ui';
import { data, dataHora, moeda, numero, rotulo } from '@/lib/format';
import { LayoutPublico } from './LayoutPublico';
import type { OsPublicaResposta } from '@/types';

/** Página pública de acompanhamento da OS (sem login) */
export default function OsPublica() {
  const { token } = useParams();
  const qc = useQueryClient();
  const [nome, setNome] = useState('');
  const { data: resp, isLoading, error } = useQuery({ queryKey: ['publico-os', token], queryFn: () => api.get<OsPublicaResposta>(`/publico/os/${token}`), retry: 0, refetchInterval: 60_000 });

  const aprovar = useMutation({
    mutationFn: () => api.post(`/publico/os/${token}/aprovar`, { aprovadoPor: nome.trim() || 'Cliente (link)' }),
    onSuccess: () => {
      toast.success('Orçamento aprovado. Obrigado!');
      qc.invalidateQueries({ queryKey: ['publico-os', token] });
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  if (isLoading)
    return (
      <LayoutPublico>
        <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-slate-300" /></div>
      </LayoutPublico>
    );
  if (error || !resp?.os)
    return (
      <LayoutPublico>
        <Card><p className="py-8 text-center text-sm text-slate-500">{error ? mensagemErro(error) : 'Ordem de serviço não encontrada.'}</p></Card>
      </LayoutPublico>
    );

  const os = resp.os;
  const itens = os.itens ?? [];
  const pecas = itens.filter((i) => i.tipo === 'PECA');
  const servicos = itens.filter((i) => i.tipo !== 'PECA');
  const podeAprovar = os.podeAprovar ?? (os.orcar && !os.orcamentoAprovado);

  return (
    <LayoutPublico empresa={resp.empresa}>
      <div className="space-y-4">
        <Card>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Ordem de serviço</p>
              <h1 className="text-2xl font-bold text-slate-900">nº {os.numero}</h1>
              {os.cliente && <p className="text-sm text-slate-600">Olá, {os.cliente}!</p>}
            </div>
            <div className="flex flex-col items-end gap-1">
              <BadgeCor cor={os.situacao?.cor} tamanho="md">{os.situacao?.nome}</BadgeCor>
              {os.atrasada && <Badge tom="vermelho">Previsão vencida</Badge>}
            </div>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-xs text-slate-400">Equipamento</dt><dd className="font-medium text-slate-800">{os.equipamento || '—'}</dd></div>
            <div><dt className="text-xs text-slate-400">Entrada</dt><dd className="font-medium text-slate-800">{data(os.dataEntrada)}</dd></div>
            {os.dataPrevista && <div><dt className="text-xs text-slate-400">Previsão</dt><dd className="font-medium text-slate-800">{data(os.dataPrevista)}</dd></div>}
            {os.tecnico && <div><dt className="text-xs text-slate-400">Técnico</dt><dd className="font-medium text-slate-800">{os.tecnico}</dd></div>}
            {os.numeroSerie && <div><dt className="text-xs text-slate-400">Nº de série</dt><dd className="font-mono text-xs text-slate-800">{os.numeroSerie}</dd></div>}
            {os.garantiaDias ? <div><dt className="text-xs text-slate-400">Garantia</dt><dd className="font-medium text-slate-800">{os.garantiaDias} dias</dd></div> : null}
          </dl>
          {os.defeitoRelatado && <div className="mt-4 rounded-md bg-slate-50 p-3 text-sm"><p className="text-xs text-slate-400">Defeito relatado</p><p className="text-slate-700">{os.defeitoRelatado}</p></div>}
          {os.diagnostico && <div className="mt-2 rounded-md bg-slate-50 p-3 text-sm"><p className="text-xs text-slate-400">Diagnóstico técnico</p><p className="text-slate-700">{os.diagnostico}</p></div>}
          {os.servicoExecutado && <div className="mt-2 rounded-md bg-slate-50 p-3 text-sm"><p className="text-xs text-slate-400">Serviço executado</p><p className="text-slate-700">{os.servicoExecutado}</p></div>}
          {os.observacoes && <p className="mt-3 text-xs text-slate-500">{os.observacoes}</p>}
        </Card>

        {itens.length > 0 && (
          <Card titulo={os.orcar ? 'Orçamento' : 'Itens'} semPadding>
            <table className="tbl">
              <thead><tr><th>Descrição</th><th className="text-right">Qtd</th><th className="text-right">Valor</th></tr></thead>
              <tbody>
                {servicos.map((i, k) => <tr key={`s${k}`}><td><Badge tom="roxo">Serviço</Badge> {i.descricao}</td><td className="num text-right">{numero(i.quantidade)}</td><td className="num text-right">{moeda(i.total)}</td></tr>)}
                {pecas.map((i, k) => <tr key={`p${k}`}><td><Badge>Peça</Badge> {i.descricao}</td><td className="num text-right">{numero(i.quantidade)}</td><td className="num text-right">{moeda(i.total)}</td></tr>)}
                {(os.descontoValor ?? 0) > 0 && <tr><td colSpan={2} className="text-right text-slate-500">Desconto</td><td className="num text-right text-red-600">- {moeda(os.descontoValor)}</td></tr>}
                <tr className="bg-slate-50 font-semibold"><td colSpan={2} className="px-3 py-2 text-right">Total</td><td className="num px-3 py-2 text-right text-base">{moeda(os.total)}</td></tr>
              </tbody>
            </table>
          </Card>
        )}

        {os.orcar && (
          <Card>
            {os.orcamentoAprovado ? (
              <div className="flex items-center gap-3 text-emerald-700"><CircleCheck className="h-6 w-6" /><div><p className="font-semibold">Orçamento aprovado</p><p className="text-sm text-emerald-600">{os.orcamentoAprovadoEm ? `em ${dataHora(os.orcamentoAprovadoEm)} — ` : ''}já estamos cuidando do seu equipamento.</p></div></div>
            ) : podeAprovar ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-amber-700"><BadgeCheck className="h-5 w-5" /><p className="font-semibold">Aguardando sua aprovação</p></div>
                <p className="text-sm text-slate-600">Confira os itens acima. Ao aprovar, iniciamos o serviço no valor de <strong className="num">{moeda(os.total)}</strong>.</p>
                <Input label="Seu nome (para registro)" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome de quem aprova" />
                <Button variante="sucesso" tamanho="lg" className="w-full" carregando={aprovar.isPending} onClick={() => aprovar.mutate()}>Aprovar orçamento</Button>
              </div>
            ) : (
              <p className="text-sm text-slate-600">Estamos preparando o orçamento. Você será avisado assim que estiver pronto para aprovação.</p>
            )}
          </Card>
        )}

        {os.parcelas && os.parcelas.length > 0 && (
          <Card titulo="Pagamento" semPadding>
            <table className="tbl">
              <thead><tr><th>Parcela</th><th>Vencimento</th><th>Forma</th><th className="text-right">Valor</th><th /></tr></thead>
              <tbody>
                {os.parcelas.map((p) => (
                  <tr key={p.numero}><td>{p.numero}</td><td>{data(p.dataVencimento)}</td><td>{p.formaPagamento ?? '—'}</td><td className="num text-right">{moeda(p.valor)}</td><td>{p.situacao && <Badge tom={tomPorStatus(p.situacao)}>{rotulo(p.situacao)}</Badge>}</td></tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}

        {os.historico && os.historico.length > 0 && (
          <Card titulo="Andamento">
            <ol className="relative ml-2 border-l border-slate-200">
              {os.historico.map((h, i) => (
                <li key={i} className="mb-3 ml-5"><span className="absolute -left-[7px] mt-1 h-3 w-3 rounded-full border-2 border-white bg-slate-300" /><p className="text-sm font-medium text-slate-800">{h.paraSituacao}</p><p className="text-xs text-slate-400">{dataHora(h.data)}</p></li>
              ))}
            </ol>
          </Card>
        )}

        <p className="flex items-center justify-center gap-1 text-xs text-slate-400"><Wrench className="h-3 w-3" /> Situação atual: {os.situacao?.nome}. Esta página atualiza automaticamente.</p>
      </div>
    </LayoutPublico>
  );
}
