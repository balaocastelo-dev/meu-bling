import { useEffect, useRef, useState } from 'react';
import { TextoValores } from '@/components/compartilhados/TextoValores';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Ban, BadgeDollarSign, CalendarClock, Copy, FileSignature, Globe, ImagePlus, PackageOpen, Pencil, PenLine, Percent, Printer, Send, Star, Trash2 } from 'lucide-react';
import { abrirEmNovaAba, api, mensagemErro } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { useContasFinanceiras, opcoesDe } from '@/hooks/useListas';
import { Badge, Button, Card, Checkbox, DateInput, EmptyState, Input, MenuAcoes, Modal, MoneyInput, PageHeader, Select, Switch, Textarea, Skeleton } from '@/components/ui';
import { data, dataHora, documento, hoje, moeda, telefone } from '@/lib/format';
import { AssinaturaCanvas } from '@/components/compartilhados/AssinaturaCanvas';
import { CaixaAlerta, Info, nomeTipo, tomStatus, type Consignacao } from './comum';

type Acao = null | 'pagar' | 'quitar' | 'desconto' | 'assinar' | 'retirada' | 'editar';

/** Contrato de consignação: valores, pagamentos ao consignante, fotos do site e linha do tempo. */
export default function ConsignacaoDetalhe() {
  const { id } = useParams();
  const qc = useQueryClient();
  const temPerfil = useAuth((s) => s.temPerfil);
  const fin = temPerfil('ADMIN', 'GERENTE', 'FINANCEIRO');
  const gestao = temPerfil('ADMIN', 'GERENTE');
  const { data: c, isLoading, error } = useQuery({ queryKey: ['consignacao', id], queryFn: () => api.get<Consignacao>(`/consignacoes/${id}`) });
  const { data: contasFin } = useContasFinanceiras();
  const [acao, setAcao] = useState<Acao>(null);
  const atualizar = (n: Consignacao, msg: string) => {
    toast.success(msg);
    qc.setQueryData(['consignacao', id], n);
    qc.invalidateQueries({ queryKey: ['consignacoes'] });
    qc.invalidateQueries({ queryKey: ['consignacoes-painel'] });
    qc.invalidateQueries({ queryKey: ['avisos'] });
    setAcao(null);
  };
  const reenviar = useMutation({ mutationFn: () => api.post(`/consignacoes/${id}/reenviar-link`, {}), onSuccess: () => toast.success('Link reenviado pelo WhatsApp.'), onError: (e) => toast.error(mensagemErro(e)) });
  const iniciar = useMutation({ mutationFn: () => api.post<Consignacao>(`/consignacoes/${id}/iniciar-diarias`, {}), onSuccess: (n) => atualizar(n, 'Diárias lançadas no contas a pagar.'), onError: (e) => toast.error(mensagemErro(e)) });
  const cancelar = useMutation({ mutationFn: () => api.post<Consignacao>(`/consignacoes/${id}/cancelar`, {}), onSuccess: (n) => atualizar(n, 'Consignação cancelada.'), onError: (e) => toast.error(mensagemErro(e)) });
  const alternar = useMutation({ mutationFn: (b: Partial<Consignacao>) => api.put<Consignacao>(`/consignacoes/${id}`, b), onSuccess: (n) => atualizar(n, 'Atualizado.'), onError: (e) => toast.error(mensagemErro(e)) });

  if (isLoading) return <div className="space-y-3"><Skeleton className="h-10 w-1/2" /><Skeleton className="h-32" /><Skeleton className="h-64" /></div>;
  if (error || !c) return <EmptyState titulo="Consignação não encontrada" descricao={error ? mensagemErro(error) : undefined} acao={<Link to="/consignacoes" className="text-sm text-brand-600 hover:underline">Voltar para a lista</Link>} />;

  const ativa = ['NO_PRAZO', 'EM_DIARIAS', 'AGUARDANDO_RETIRADA'].includes(c.status);
  const podePagar = fin && c.saldo > 0.009 && (c.devidoHoje > 0.009 || c.status === 'VENDIDO' || c.status === 'EM_DIARIAS');
  const podeQuitar = fin && c.saldo > 0.009 && (c.status === 'VENDIDO' || c.status === 'EM_DIARIAS' || c.status === 'AGUARDANDO_RETIRADA') && c.pago > 0;
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(c.link);
      toast.success('Link copiado.');
    } catch {
      toast.message(c.link);
    }
  };

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        titulo={`Consignação nº ${c.numero}`}
        descricao={c.descricao}
        migalhas={[{ rotulo: 'Consignação', para: '/consignacoes' }, { rotulo: `Nº ${c.numero}` }]}
        acoes={
          <div className="flex flex-wrap gap-2">
            <Button icone={<Printer className="h-4 w-4" />} onClick={() => abrirEmNovaAba(`/consignacoes/${id}/contrato`).catch((e) => toast.error(mensagemErro(e)))}>Contrato</Button>
            <Button icone={<Send className="h-4 w-4" />} carregando={reenviar.isPending} onClick={() => reenviar.mutate()}>Reenviar link</Button>
            <MenuAcoes
              itens={[
                { rotulo: 'Copiar link do consignante', icone: <Copy className="h-4 w-4" />, onClick: copiar },
                { rotulo: 'Editar equipamento e preço', icone: <Pencil className="h-4 w-4" />, onClick: () => setAcao('editar'), oculto: !ativa },
                { rotulo: 'Iniciar diárias agora', icone: <CalendarClock className="h-4 w-4" />, onClick: () => confirm('Começar a pagar as diárias já? O prazo é encerrado hoje.') && iniciar.mutate(), oculto: !gestao || c.status !== 'NO_PRAZO' },
                { rotulo: 'Cancelar (lançado por engano)', icone: <Ban className="h-4 w-4" />, perigo: true, separar: true, onClick: () => confirm('Cancelar esta consignação? O equipamento sai do estoque e do site.') && cancelar.mutate(), oculto: !gestao || !ativa || c.pago > 0 },
              ]}
            />
          </div>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Badge tom={tomStatus(c.status)}>{c.rotuloStatus}</Badge>
        {c.assinadoEm ? <Badge tom="verde">Assinado {c.assinadoPor === 'CELULAR' ? 'pelo celular' : 'na loja'} em {data(c.assinadoEm)}</Badge> : <Badge tom="laranja">Falta assinar</Badge>}
        {c.mostrarNoSite && c.assinadoEm && ['NO_PRAZO', 'EM_DIARIAS'].includes(c.status) && <Badge tom="azul">No site</Badge>}
        {c.destaque && <Badge tom="roxo">Destaque</Badge>}
        {c.escolha && ativa && <Badge tom="cinza">Escolha do consignante: {c.escolha === 'RETIRAR' ? 'retirar' : 'receber aos poucos'}</Badge>}
      </div>
      <CaixaAlerta alerta={c.alerta} className="mb-3" />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Info rotulo="Preço de venda" valor={moeda(c.precoVenda)} sub={c.precoVenda !== c.precoVendaOriginal ? `era ${moeda(c.precoVendaOriginal)}` : `loja fica com ${moeda(c.lucroLoja)}`} />
        <Info rotulo="Consignante recebe" valor={moeda(c.valorConsignante)} sub={`${c.percentualConsignante}% · travado`} destaque />
        <Info rotulo="Já pago" valor={moeda(c.pago)} sub={c.diariasTotal ? `diárias ${c.diariasPagas}/${c.diariasTotal}` : undefined} />
        <Info rotulo="Falta pagar" valor={moeda(c.saldo)} destaque={c.saldo > 0} sub={c.proximaDiaria ? `próxima ${data(c.proximaDiaria.vencimento)}` : c.devidoHoje > 0 ? `${moeda(c.devidoHoje)} hoje` : undefined} />
        <Info rotulo="Prazo" valor={data(c.dataLimite)} sub={c.status === 'NO_PRAZO' ? (c.diasParaPrazo > 0 ? `faltam ${c.diasParaPrazo} dia(s)` : 'termina hoje') : `${c.diasConsignado} dia(s) na loja`} />
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {podePagar && <Button variante="sucesso" icone={<BadgeDollarSign className="h-4 w-4" />} onClick={() => setAcao('pagar')}>Pagar consignante</Button>}
        {podeQuitar && <Button variante="primario" icone={<BadgeDollarSign className="h-4 w-4" />} onClick={() => setAcao('quitar')}>Quitar saldo de uma vez</Button>}
        {!c.assinadoEm && ativa && <Button icone={<PenLine className="h-4 w-4" />} onClick={() => setAcao('assinar')}>Assinar aqui na loja</Button>}
        {c.status === 'NO_PRAZO' && !c.descontoPendente && <Button icone={<Percent className="h-4 w-4" />} onClick={() => setAcao('desconto')}>Pedir desconto ao consignante</Button>}
        {ativa && <Button icone={<PackageOpen className="h-4 w-4" />} onClick={() => setAcao('retirada')}>Registrar retirada</Button>}
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Fotos c={c} onAtualizado={(fotos) => qc.setQueryData(['consignacao', id], { ...c, fotosUrls: fotos })} />

          {c.descontoPendente && (
            <Card titulo="Desconto aguardando o consignante">
              <p className="text-sm text-slate-700">Pedimos {c.descontoPendente.pct}%: preço {moeda(c.descontoPendente.precoDe)} → <b>{moeda(c.descontoPendente.precoPara)}</b>; consignante {moeda(c.descontoPendente.valorDe)} → <b>{moeda(c.descontoPendente.valorPara)}</b>. Ele responde pelo link do WhatsApp.</p>
            </Card>
          )}

          <Card titulo="Pagamentos ao consignante" semPadding>
            {c.contasPagar?.length ? (
              <div className="overflow-x-auto">
                <table className="tbl">
                  <thead><tr><th>Parcela</th><th>Vence</th><th className="text-right">Valor</th><th className="text-right">Pago</th><th>Situação</th></tr></thead>
                  <tbody>
                    {c.contasPagar.map((x) => (
                      <tr key={x.id} className={x.situacao === 'CANCELADO' ? 'opacity-50' : ''}>
                        <td>{x.parcela === 'VENDA' ? 'Venda' : x.parcela === 'QUITACAO' ? 'Quitação' : `Diária ${x.parcela}`}</td>
                        <td>{data(x.vencimento)}</td>
                        <td className="num text-right">{moeda(x.valor)}</td>
                        <td className="num text-right">{moeda(x.valorPago)}</td>
                        <td><Badge tom={x.situacao === 'PAGO' ? 'verde' : x.situacao === 'CANCELADO' ? 'cinza' : x.situacao === 'PARCIAL' ? 'amarelo' : new Date(x.vencimento) < new Date(new Date().toDateString()) ? 'vermelho' : 'azul'}>{x.situacao === 'PAGO' ? `Pago ${data(x.dataPagamento)}` : x.situacao === 'PARCIAL' ? 'Parcial' : x.situacao === 'CANCELADO' ? 'Cancelado' : 'Em aberto'}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="px-4 py-4 text-sm text-slate-500">{c.status === 'NO_PRAZO' ? `Nada a pagar por enquanto. Vendeu: paga ${moeda(c.valorConsignante)} na hora. Não vendeu até ${data(c.dataLimite)}: começam as diárias.` : 'Sem pagamentos.'}</p>
            )}
            {!!c.contasReceber?.length && (
              <div className="border-t border-slate-100 px-4 py-3 text-sm">
                {c.contasReceber.map((x) => <p key={x.id} className="text-slate-600">{x.descricao}: <b className="num">{moeda(x.valor)}</b> · {x.situacao === 'RECEBIDO' ? 'recebido' : 'a receber'}</p>)}
              </div>
            )}
          </Card>

          <Card titulo="Linha do tempo" semPadding>
            <ol className="divide-y divide-slate-100">
              {(c.eventos ?? []).map((e) => (
                <li key={e.id} className="px-4 py-2.5 text-sm">
                  <p className="text-slate-700"><TextoValores texto={e.texto} /></p>
                  <p className="text-[11px] text-slate-400">{dataHora(e.data)}{e.publico ? '' : ' · só a loja vê'}</p>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <div className="space-y-4">
          <Card titulo="Consignante">
            <div className="space-y-1 text-sm">
              <Link to={`/contatos/${c.consignante.id}`} className="font-medium text-brand-600 hover:underline">{c.consignante.nome}</Link>
              {c.consignante.documento && <p className="text-slate-600">{documento(c.consignante.documento)}</p>}
              {(c.consignante.celular || c.consignante.telefone) && <p className="text-slate-600">{telefone(c.consignante.celular || c.consignante.telefone)}</p>}
              {c.consignante.email && <p className="truncate text-slate-600">{c.consignante.email}</p>}
              <button type="button" onClick={copiar} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline"><Copy className="h-3.5 w-3.5" /> Copiar link do contrato</button>
            </div>
          </Card>
          <Card titulo="Equipamento">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-slate-400">Tipo</dt><dd>{nomeTipo(c.tipoEquipamento)}</dd>
              {(c.marca || c.modelo) && <><dt className="text-slate-400">Marca</dt><dd>{[c.marca, c.modelo].filter(Boolean).join(' ')}</dd></>}
              {c.numeroSerie && <><dt className="text-slate-400">Série</dt><dd className="break-all">{c.numeroSerie}</dd></>}
              {c.imei && <><dt className="text-slate-400">IMEI</dt><dd className="break-all">{c.imei}</dd></>}
              {c.estado && <><dt className="text-slate-400">Estado</dt><dd>{c.estado}</dd></>}
              {c.acessorios && <><dt className="text-slate-400">Acessórios</dt><dd>{c.acessorios}</dd></>}
              <dt className="text-slate-400">Entrada</dt><dd>{data(c.dataEntrada)}{c.vendedor ? ` · ${c.vendedor.nome}` : ''}</dd>
              {c.produto && <><dt className="text-slate-400">Produto</dt><dd><Link to={`/produtos/${c.produto.id}`} className="text-brand-600 hover:underline">{c.produto.codigo}</Link> · estoque {c.estoque}</dd></>}
              {c.compra && <><dt className="text-slate-400">Compra</dt><dd><Link to={`/compras/${c.compra.id}`} className="text-brand-600 hover:underline">nº {c.compra.numero}</Link> · {c.compra.situacao.nome}</dd></>}
              {c.vendaId && <><dt className="text-slate-400">Venda</dt><dd><Link to={`/vendas/${c.vendaId}`} className="text-brand-600 hover:underline">nº {c.vendaNumero}</Link> · {data(c.vendidoEm)}</dd></>}
            </dl>
            {c.detalhes && <p className="mt-3 whitespace-pre-line text-xs text-slate-500">{c.detalhes}</p>}
            {c.observacoes && <p className="mt-2 whitespace-pre-line rounded-md bg-amber-50 p-2 text-xs text-amber-800">{c.observacoes}</p>}
          </Card>
          {ativa && (
            <Card titulo="Site">
              <div className="space-y-3">
                <Switch checked={c.mostrarNoSite} disabled={alternar.isPending} onChange={(v) => alternar.mutate({ mostrarNoSite: v })} label={<span className="inline-flex items-center gap-1"><Globe className="h-4 w-4" /> Vitrine Consignados</span>} />
                <Switch checked={c.destaque} disabled={alternar.isPending} onChange={(v) => alternar.mutate({ destaque: v })} label={<span className="inline-flex items-center gap-1"><Star className="h-4 w-4" /> Destaque (aparece primeiro)</span>} />
                {!c.assinadoEm && <p className="text-xs text-amber-700">Só aparece no site depois de assinado.</p>}
              </div>
            </Card>
          )}
        </div>
      </div>

      <AcoesModais c={c} acao={acao} onFechar={() => setAcao(null)} contas={opcoesDe(contasFin)} contaPadrao={contasFin?.find((x) => x.padrao)?.id ?? contasFin?.[0]?.id ?? ''} gestao={gestao} onFeito={atualizar} />
    </div>
  );
}

// ------------------------------------------------------------------ fotos
function Fotos({ c, onAtualizado }: { c: Consignacao; onAtualizado: (f: Consignacao['fotosUrls']) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const enviar = useMutation({
    mutationFn: async (arquivos: File[]) => {
      const fd = new FormData();
      for (const a of arquivos) fd.append('foto', a, a.name);
      return api.upload<{ fotos: Consignacao['fotosUrls'] }>(`/consignacoes/${c.id}/fotos`, fd);
    },
    onSuccess: (r) => { onAtualizado(r.fotos); qc.invalidateQueries({ queryKey: ['consignacoes'] }); toast.success('Fotos enviadas.'); },
    onError: (e) => toast.error(mensagemErro(e)),
  });
  const remover = useMutation({ mutationFn: (nome: string) => api.del<{ fotos: Consignacao['fotosUrls'] }>(`/consignacoes/${c.id}/fotos/${nome}`), onSuccess: (r) => onAtualizado(r.fotos), onError: (e) => toast.error(mensagemErro(e)) });
  const capa = useMutation({ mutationFn: (nome: string) => api.put<{ fotos: Consignacao['fotosUrls'] }>(`/consignacoes/${c.id}/fotos/ordem`, { ordem: [nome] }), onSuccess: (r) => { onAtualizado(r.fotos); toast.success('Capa trocada.'); }, onError: (e) => toast.error(mensagemErro(e)) });
  return (
    <Card titulo="Fotos" descricao="A primeira é a capa no site" acoes={<Button tamanho="sm" icone={<ImagePlus className="h-4 w-4" />} carregando={enviar.isPending} onClick={() => input.current?.click()}>Adicionar</Button>}>
      <input ref={input} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { const l = Array.from(e.target.files ?? []); if (l.length) enviar.mutate(l); e.target.value = ''; }} />
      {c.fotosUrls?.length ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
          {c.fotosUrls.map((f, i) => (
            <div key={f.nome} className="group relative aspect-square overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
              <img src={f.url} alt="" className="h-full w-full object-cover" loading="lazy" />
              {i === 0 && <span className="absolute left-1 top-1 rounded bg-brand-600 px-1.5 text-[10px] font-semibold text-white">Capa</span>}
              <div className="absolute inset-x-1 bottom-1 flex justify-between gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
                {i > 0 ? <button type="button" title="Usar como capa" onClick={() => capa.mutate(f.nome)} className="rounded bg-white/90 p-1 text-slate-600 shadow"><Star className="h-3.5 w-3.5" /></button> : <span />}
                <button type="button" title="Remover" onClick={() => confirm('Remover esta foto?') && remover.mutate(f.nome)} className="rounded bg-white/90 p-1 text-red-600 shadow"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-slate-500">Sem fotos. Com foto o equipamento vende muito mais rápido no site.</p>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------ modais das ações
function AcoesModais({ c, acao, onFechar, contas, contaPadrao, gestao, onFeito }: { c: Consignacao; acao: Acao; onFechar: () => void; contas: { valor: number; rotulo: string }[]; contaPadrao: number | ''; gestao: boolean; onFeito: (n: Consignacao, msg: string) => void }) {
  const [conta, setConta] = useState<number | ''>('');
  const [valor, setValor] = useState(0);
  const [dataAcao, setDataAcao] = useState(hoje());
  const [pct, setPct] = useState(5);
  const [pagarAgora, setPagarAgora] = useState(true);
  const [isentar, setIsentar] = useState(false);
  const [recebido, setRecebido] = useState(true);
  const [assinatura, setAssinatura] = useState<string | null>(null);
  const [nome, setNome] = useState('');
  const [ed, setEd] = useState({ descricao: '', precoVenda: 0, estado: '', acessorios: '', detalhes: '', observacoes: '' });

  useEffect(() => {
    if (!acao) return;
    setConta(contaPadrao);
    setDataAcao(hoje());
    setValor(acao === 'pagar' ? (c.devidoHoje > 0 ? c.devidoHoje : c.saldo) : 0);
    setNome(c.consignante.nome);
    setAssinatura(null);
    setIsentar(false);
    setEd({ descricao: c.descricao, precoVenda: c.precoVenda, estado: c.estado ?? '', acessorios: c.acessorios ?? '', detalhes: c.detalhes ?? '', observacoes: c.observacoes ?? '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acao]);

  const erro = (e: unknown) => toast.error(mensagemErro(e));
  const pagar = useMutation({ mutationFn: () => api.post<Consignacao>(`/consignacoes/${c.id}/pagar`, { contaFinanceiraId: conta, valor, data: dataAcao, tudo: valor > c.devidoHoje + 0.009 }), onSuccess: (n) => onFeito(n, n.saldo <= 0.009 ? 'Consignante quitado.' : `Pagamento lançado. Falta ${moeda(n.saldo)}.`), onError: erro });
  const quitar = useMutation({ mutationFn: () => api.post<Consignacao>(`/consignacoes/${c.id}/quitar`, { contaFinanceiraId: pagarAgora ? conta : null, data: dataAcao }), onSuccess: (n) => onFeito(n, pagarAgora ? 'Saldo quitado.' : 'Saldo lançado para pagar hoje.'), onError: erro });
  const desconto = useMutation({ mutationFn: () => api.post<Consignacao>(`/consignacoes/${c.id}/desconto`, { pct }), onSuccess: (n) => onFeito(n, 'Pedido de desconto enviado pelo WhatsApp.'), onError: erro });
  const assinar = useMutation({ mutationFn: () => api.post<{ consignacao: Consignacao }>(`/consignacoes/${c.id}/assinar-na-loja`, { nome, assinatura: assinatura ?? undefined }), onSuccess: (r) => onFeito(r.consignacao, 'Contrato assinado.'), onError: erro });
  const retirada = useMutation({ mutationFn: () => api.post<Consignacao>(`/consignacoes/${c.id}/retirada`, { isentarTaxa: isentar, recebido, contaFinanceiraId: recebido ? conta : null, data: dataAcao }), onSuccess: (n) => onFeito(n, 'Retirada registrada.'), onError: erro });
  const editar = useMutation({ mutationFn: () => api.put<Consignacao>(`/consignacoes/${c.id}`, { ...ed, estado: ed.estado || null, acessorios: ed.acessorios || null, detalhes: ed.detalhes || null, observacoes: ed.observacoes || null }), onSuccess: (n) => onFeito(n, 'Consignação atualizada.'), onError: erro });

  const antesDoPrazo = new Date(`${dataAcao}T12:00:00`) < new Date(new Date(c.dataLimite).toDateString());
  const taxa = antesDoPrazo && !isentar ? c.taxaRetirada : 0;
  const devolver = c.pago;
  const novoPreco = Math.round(c.precoVenda * (1 - pct / 100) * 100) / 100;
  const novoValor = Math.round(c.valorConsignante * (1 - pct / 100) * 100) / 100;

  const carregando = pagar.isPending || quitar.isPending || desconto.isPending || assinar.isPending || retirada.isPending || editar.isPending;
  const titulo = { pagar: 'Pagar consignante', quitar: 'Quitar saldo de uma vez', desconto: 'Pedir desconto ao consignante', assinar: 'Assinatura na loja', retirada: 'Registrar retirada', editar: 'Editar equipamento' } as const;
  const confirmar = () => (acao === 'pagar' ? pagar.mutate() : acao === 'quitar' ? quitar.mutate() : acao === 'desconto' ? desconto.mutate() : acao === 'assinar' ? assinar.mutate() : acao === 'retirada' ? retirada.mutate() : editar.mutate());
  const bloqueado = (acao === 'pagar' && (!conta || !(valor > 0))) || (acao === 'quitar' && pagarAgora && !conta) || (acao === 'assinar' && nome.trim().length < 2) || (acao === 'retirada' && recebido && (taxa > 0 || devolver > 0) && !conta) || (acao === 'editar' && (!ed.descricao.trim() || !(ed.precoVenda > 0)));

  return (
    <Modal aberto={acao !== null} onFechar={onFechar} titulo={acao ? titulo[acao] : ''} tamanho={acao === 'editar' ? 'lg' : 'md'} rodape={<><Button onClick={onFechar}>Voltar</Button><Button variante={acao === 'retirada' ? 'primario' : 'sucesso'} carregando={carregando} disabled={bloqueado} onClick={confirmar}>Confirmar</Button></>}>
      {acao === 'pagar' && (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">{c.devidoHoje > 0 ? <>Vence até hoje: <b className="num">{moeda(c.devidoHoje)}</b>. </> : null}Falta no total: <b className="num">{moeda(c.saldo)}</b>. Faça o PIX para o consignante e registre aqui.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <MoneyInput label="Valor pago" value={valor} onChange={setValor} />
            <DateInput label="Data" value={dataAcao} onChange={setDataAcao} />
            <Select className="sm:col-span-2" label="Saiu de qual conta" value={conta} onChange={(e) => setConta(e.target.value ? Number(e.target.value) : '')} opcoes={contas} placeholder="—" />
          </div>
          <p className="text-xs text-slate-400">O consignante recebe um WhatsApp com o pagamento e quanto falta.</p>
        </div>
      )}
      {acao === 'quitar' && (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">As diárias que faltam viram um pagamento só de <b className="num">{moeda(c.saldo)}</b>, vencendo hoje.</p>
          <Checkbox checked={pagarAgora} onChange={(e) => setPagarAgora(e.target.checked)} label="Já paguei agora" />
          {pagarAgora && (
            <div className="grid gap-3 sm:grid-cols-2">
              <DateInput label="Data" value={dataAcao} onChange={setDataAcao} />
              <Select label="Saiu de qual conta" value={conta} onChange={(e) => setConta(e.target.value ? Number(e.target.value) : '')} opcoes={contas} placeholder="—" />
            </div>
          )}
        </div>
      )}
      {acao === 'desconto' && (
        <div className="space-y-3">
          <MoneyInput label="Desconto (%)" prefixo="" value={pct} onChange={setPct} />
          <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">Preço {moeda(c.precoVenda)} → <b>{moeda(novoPreco)}</b> · consignante {moeda(c.valorConsignante)} → <b>{moeda(novoValor)}</b>. Ele recebe o pedido no WhatsApp e autoriza com um toque; só depois disso o preço muda.</p>
        </div>
      )}
      {acao === 'assinar' && (
        <div className="space-y-3">
          <Input label="Nome de quem assina" value={nome} onChange={(e) => setNome(e.target.value)} />
          <AssinaturaCanvas onMudar={setAssinatura} />
          <p className="text-xs text-slate-400">Pode deixar em branco se ele assinou o contrato impresso: fica registrado como assinado na loja.</p>
        </div>
      )}
      {acao === 'retirada' && (
        <div className="space-y-3">
          <DateInput label="Data da retirada" value={dataAcao} onChange={setDataAcao} />
          <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
            {antesDoPrazo ? (isentar ? <p>Antes do prazo, com a taxa dispensada.</p> : <p>Antes do prazo ({data(c.dataLimite)}): taxa de <b className="num">{moeda(c.taxaRetirada)}</b>.</p>) : <p>Depois do prazo: <b>sem taxa</b>.</p>}
            {devolver > 0 && <p className="mt-1">Ele já recebeu <b className="num">{moeda(devolver)}</b> em diárias: devolve na retirada.</p>}
            <p className="mt-1 text-xs text-slate-500">O equipamento sai do estoque e do site.</p>
          </div>
          {antesDoPrazo && gestao && <Checkbox checked={isentar} onChange={(e) => setIsentar(e.target.checked)} label="Dispensar a taxa de retirada" />}
          {(taxa > 0 || devolver > 0) && (
            <>
              <Checkbox checked={recebido} onChange={(e) => setRecebido(e.target.checked)} label={`Recebi ${moeda(taxa + devolver)} agora`} />
              {recebido && <Select label="Entrou em qual conta" value={conta} onChange={(e) => setConta(e.target.value ? Number(e.target.value) : '')} opcoes={contas} placeholder="—" />}
            </>
          )}
        </div>
      )}
      {acao === 'editar' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Input className="sm:col-span-2" label="Título" value={ed.descricao} onChange={(e) => setEd((x) => ({ ...x, descricao: e.target.value }))} />
          <MoneyInput label="Preço de venda" value={ed.precoVenda} onChange={(v) => setEd((x) => ({ ...x, precoVenda: v }))} ajuda={`Não pode ficar abaixo de ${moeda(c.valorConsignante)} (valor do consignante).`} />
          <Input label="Estado" value={ed.estado} onChange={(e) => setEd((x) => ({ ...x, estado: e.target.value }))} />
          <Input className="sm:col-span-2" label="Acessórios" value={ed.acessorios} onChange={(e) => setEd((x) => ({ ...x, acessorios: e.target.value }))} />
          <Textarea className="sm:col-span-2" label="Descrição para o site" rows={3} value={ed.detalhes} onChange={(e) => setEd((x) => ({ ...x, detalhes: e.target.value }))} />
          <Textarea className="sm:col-span-2" label="Observações internas" rows={2} value={ed.observacoes} onChange={(e) => setEd((x) => ({ ...x, observacoes: e.target.value }))} />
          <p className="flex items-center gap-1 text-xs text-slate-400 sm:col-span-2"><FileSignature className="h-3.5 w-3.5" /> Para baixar o valor do consignante, use “Pedir desconto” — ele autoriza pelo WhatsApp.</p>
        </div>
      )}
    </Modal>
  );
}
