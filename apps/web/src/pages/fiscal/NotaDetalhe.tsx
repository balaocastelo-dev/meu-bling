import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Ban, ExternalLink, FileCode2, FileDown, Mail, Pencil, RefreshCw, Send, Trash2 } from 'lucide-react';
import { abrirEmNovaAba, api, baixarArquivo, BASE_PATH, mensagemErro } from '@/lib/api';
import { Badge, Button, Card, ConfirmDialog, Definicoes, EmptyState, FormSkeleton, Input, Modal, PageHeader, Tabs, Textarea, tomPorStatus } from '@/components/ui';
import { chaveNfe, dataHora, moeda, numero, rotulo } from '@/lib/format';
import type { NotaFiscal } from '@/types';

/** Detalhe da nota fiscal com itens, eventos e ações SEFAZ */
export default function NotaDetalhe() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [aba, setAba] = useState('itens');
  const [cancelar, setCancelar] = useState(false);
  const [justificativa, setJustificativa] = useState('');
  const [cce, setCce] = useState(false);
  const [textoCce, setTextoCce] = useState('');
  const [email, setEmail] = useState<string | null>(null);
  const [excluir, setExcluir] = useState(false);

  const { data: n, isLoading, error } = useQuery({ queryKey: ['nota', id], queryFn: () => api.get<NotaFiscal>(`/notas-fiscais/${id}`) });
  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ['nota', id] });
    qc.invalidateQueries({ queryKey: ['notas-fiscais'] });
  };

  const transmitir = useMutation({
    mutationFn: () => api.post<{ situacao: string; chave?: string; protocolo?: string; cStat?: string; motivo?: string }>(`/notas-fiscais/${id}/transmitir`),
    onSuccess: (r) => {
      if (r.situacao === 'AUTORIZADA') toast.success(`Nota autorizada. Protocolo ${r.protocolo ?? ''}`);
      else toast.warning(`Retorno SEFAZ: ${r.cStat ?? ''} ${r.motivo ?? r.situacao}`);
      invalidar();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });
  const renumerar = useMutation({
    mutationFn: () => api.post<{ de: number; para: number; serie: number }>(`/notas-fiscais/${id}/renumerar`),
    onSuccess: (r) => {
      toast.success(`A nota passou do nº ${r.de} para o nº ${r.para}. Agora clique em Transmitir à SEFAZ.`);
      invalidar();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });
  const consultar = useMutation({
    mutationFn: () => api.post<{ situacao?: string; cStat?: string; motivo?: string }>(`/notas-fiscais/${id}/consultar`),
    onSuccess: (r) => {
      toast.info(`SEFAZ: ${r.cStat ?? ''} ${r.motivo ?? r.situacao ?? ''}`);
      invalidar();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });
  const cancelarM = useMutation({
    mutationFn: () => api.post(`/notas-fiscais/${id}/cancelar`, { justificativa }),
    onSuccess: () => {
      toast.success('Cancelamento enviado.');
      invalidar();
      setCancelar(false);
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });
  const cceM = useMutation({
    mutationFn: () => api.post(`/notas-fiscais/${id}/carta-correcao`, { texto: textoCce }),
    onSuccess: () => {
      toast.success('Carta de correção enviada.');
      invalidar();
      setCce(false);
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });
  const emailM = useMutation({
    mutationFn: () => api.post(`/notas-fiscais/${id}/enviar-email`, { para: email || undefined }),
    onSuccess: () => {
      toast.success('E-mail com XML e DANFE enfileirado.');
      setEmail(null);
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  if (isLoading) return <FormSkeleton />;
  if (error || !n) return <EmptyState titulo="Nota não encontrada" descricao={error ? mensagemErro(error) : undefined} acao={<Link to="/notas-fiscais"><Button>Voltar</Button></Link>} />;

  const orientacao = (n as NotaFiscal & { orientacao?: { titulo: string; detalhe?: string; acoes: { rotulo: string; rota: string }[]; renumerar?: boolean } | null }).orientacao;
  const podeTransmitir = n.situacao === 'PENDENTE' || n.situacao === 'REJEITADA' || n.situacao === 'ERRO';
  const autorizada = n.situacao === 'AUTORIZADA';
  const rotuloModelo = n.modelo === 65 ? 'NFC-e' : 'NF-e';

  return (
    <div className="space-y-4">
      <PageHeader
        migalhas={[{ rotulo: 'Notas fiscais', para: '/notas-fiscais' }, { rotulo: `${rotuloModelo} ${n.numero}` }]}
        titulo={`${rotuloModelo} nº ${n.numero} · série ${n.serie}`}
        extra={
          <>
            <Badge tom={tomPorStatus(n.situacao)} ponto>{rotulo(n.situacao)}</Badge>
            <Badge tom={n.ambiente === 1 ? 'verde' : 'amarelo'}>{n.ambiente === 1 ? 'Produção' : 'Homologação'}</Badge>
          </>
        }
        descricao={`${dataHora(n.dataEmissao)} · ${n.contato?.nome ?? 'Consumidor final'} · ${moeda(n.valorTotal)}`}
        acoes={
          <>
            {podeTransmitir && <Button variante="primario" icone={<Send className="h-4 w-4" />} carregando={transmitir.isPending} onClick={() => transmitir.mutate()}>Transmitir à SEFAZ</Button>}
            {podeTransmitir && <Link to={`/notas-fiscais/nova?editar=${n.id}`}><Button variante="secundario" icone={<Pencil className="h-4 w-4" />}>Editar</Button></Link>}
            {(autorizada || n.situacao === 'PROCESSANDO') && <Button variante="secundario" icone={<RefreshCw className="h-4 w-4" />} carregando={consultar.isPending} onClick={() => consultar.mutate()}>Consultar</Button>}
            {autorizada && (
              <>
                <Button variante="secundario" icone={<FileDown className="h-4 w-4" />} onClick={() => abrirEmNovaAba(`/notas-fiscais/${id}/danfe`).catch((e) => toast.error(mensagemErro(e)))}>DANFE</Button>
                <Button variante="secundario" icone={<FileCode2 className="h-4 w-4" />} onClick={() => baixarArquivo(`/notas-fiscais/${id}/xml`, `NFe-${n.chave ?? n.numero}.xml`).catch((e) => toast.error(mensagemErro(e)))}>XML</Button>
                <Button variante="secundario" icone={<Mail className="h-4 w-4" />} onClick={() => setEmail(n.contato?.email ?? '')}>Enviar e-mail</Button>
                {n.modelo === 55 && <Button variante="secundario" onClick={() => setCce(true)}>Carta de correção</Button>}
                <Button variante="perigo" icone={<Ban className="h-4 w-4" />} onClick={() => setCancelar(true)}>Cancelar nota</Button>
              </>
            )}
          </>
        }
      />

      {n.motivo && n.situacao !== 'AUTORIZADA' && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {orientacao && <p className="mb-1 text-base font-semibold text-red-900">{orientacao.titulo}</p>}
          <p className={orientacao ? 'text-xs text-red-700' : ''}>
            <strong>Resposta da SEFAZ (cStat {n.cStat ?? '—'}):</strong> {n.motivo}
          </p>
          {orientacao?.detalhe && <p className="mt-2 text-sm text-red-900">{orientacao.detalhe}</p>}
          {orientacao && (orientacao.acoes.length > 0 || orientacao.renumerar) && (
            <div className="mt-3 flex flex-wrap gap-2">
              {orientacao.renumerar && (
                <Button tamanho="sm" variante="primario" carregando={renumerar.isPending} onClick={() => renumerar.mutate()}>Usar o próximo número livre</Button>
              )}
              {orientacao.acoes.map((a) => (
                <Button key={a.rota} tamanho="sm" variante={orientacao.renumerar ? 'secundario' : 'primario'} iconeDireita={<ExternalLink className="h-3.5 w-3.5" />} onClick={() => window.open(`${BASE_PATH}${a.rota}`, '_blank', 'noopener')}>
                  {a.rotulo}
                </Button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <Definicoes
            colunas={4}
            itens={[
              { rotulo: 'Chave de acesso', valor: n.chave ? <span className="font-mono text-xs">{chaveNfe(n.chave)}</span> : '—', largo: true },
              { rotulo: 'Protocolo', valor: n.protocolo ?? '—' },
              { rotulo: 'Autorização', valor: n.dataAutorizacao ? dataHora(n.dataAutorizacao) : '—' },
              { rotulo: 'Natureza da operação', valor: n.naturezaOperacao },
              { rotulo: 'Finalidade', valor: ['', 'Normal', 'Complementar', 'Ajuste', 'Devolução'][n.finalidade] ?? n.finalidade },
              { rotulo: 'Destinatário', valor: n.contato ? <Link to={`/contatos/${n.contato.id}`} className="text-brand-600 hover:underline">{n.contato.nome}</Link> : 'Consumidor final' },
              { rotulo: 'Origem', valor: n.venda ? <Link to={`/vendas/${n.venda.id}`} className="text-brand-600 hover:underline">Venda nº {n.venda.numero}</Link> : n.os ? <Link to={`/ordens-servico/${n.os.id}`} className="text-brand-600 hover:underline">OS nº {n.os.numero}</Link> : 'Manual' },
              { rotulo: 'Forma de pagamento (tPag)', valor: n.formaPagamentoFiscal },
              ...(n.informacoesComplementares ? [{ rotulo: 'Informações complementares', valor: <span className="whitespace-pre-line">{n.informacoesComplementares}</span>, largo: true }] : []),
            ]}
          />
        </Card>
        <Card titulo="Valores">
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between"><span className="text-slate-500">Produtos</span><span className="num">{moeda(n.valorProdutos)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Desconto</span><span className="num text-red-600">- {moeda(n.valorDesconto)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Frete</span><span className="num">{moeda(n.valorFrete)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Outras</span><span className="num">{moeda(n.valorOutras)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">ICMS</span><span className="num">{moeda(n.valorIcms)}</span></div>
            <div className="flex justify-between border-t border-slate-200 pt-2 text-base"><span className="font-semibold">Total da nota</span><span className="num font-bold">{moeda(n.valorTotal)}</span></div>
          </div>
        </Card>
      </div>

      <Card semPadding>
        <Tabs className="px-3" ativa={aba} onMudar={setAba} abas={[{ id: 'itens', rotulo: 'Itens', contador: n.itens.length }, { id: 'eventos', rotulo: 'Eventos', contador: n.eventos.length }]} />
        <div className="p-4">
          {aba === 'itens' && (
            <div className="overflow-x-auto">
            <table className="tbl tbl-pilha">
              <thead><tr><th>#</th><th>Código</th><th>Descrição</th><th>NCM</th><th>CFOP</th><th>CSOSN/CST</th><th className="text-right">Qtd</th><th className="text-right">Unitário</th><th className="text-right">Total</th></tr></thead>
              <tbody>
                {n.itens.map((it, i) => (
                  <tr key={it.id ?? i}>
                    <td className="pilha-oculto text-slate-400">{it.numeroItem ?? i + 1}</td>
                    <td className="font-mono text-xs" data-rotulo="Código">{it.codigo}</td>
                    <td className="pilha-cheio">{it.descricao}</td>
                    <td className="font-mono text-xs" data-rotulo="NCM">{it.ncm}</td>
                    <td className="font-mono text-xs" data-rotulo="CFOP">{it.cfop}</td>
                    <td className="font-mono text-xs" data-rotulo="CSOSN/CST">{it.csosn ?? it.cst ?? '—'}</td>
                    <td className="num text-right" data-rotulo="Qtd">{numero(it.quantidade)} {it.unidade}</td>
                    <td className="num text-right" data-rotulo="Unitário">{moeda(it.valorUnitario)}</td>
                    <td className="num text-right font-medium" data-rotulo="Total">{moeda(it.valorTotal ?? it.quantidade * it.valorUnitario)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
          {aba === 'eventos' &&
            (n.eventos.length ? (
              <div className="overflow-x-auto">
              <table className="tbl tbl-pilha">
                <thead><tr><th>Data</th><th>Evento</th><th>Status</th><th>Protocolo</th><th>Justificativa / retorno</th></tr></thead>
                <tbody>
                  {n.eventos.map((e) => (
                    <tr key={e.id}>
                      <td className="text-xs text-slate-500" data-rotulo="Data">{dataHora(e.data)}</td>
                      <td data-rotulo="Evento">{rotulo(e.tipo)} {e.sequencia > 1 ? `#${e.sequencia}` : ''}</td>
                      <td data-rotulo="Status"><Badge tom={tomPorStatus(e.status)}>{rotulo(e.status)}</Badge></td>
                      <td className="font-mono text-xs" data-rotulo="Protocolo">{e.protocolo ?? '—'}</td>
                      <td className="text-xs text-slate-600" data-rotulo="Justificativa / retorno">{e.justificativa}{e.motivo ? <span className="block text-slate-400">{e.cStat} {e.motivo}</span> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            ) : (
              <EmptyState compacto titulo="Sem eventos" descricao="Cancelamentos e cartas de correção aparecem aqui." />
            ))}
        </div>
      </Card>

      {n.situacao === 'PENDENTE' && (
        <div className="flex justify-end">
          <Button tamanho="xs" variante="perigo" icone={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setExcluir(true)}>Excluir nota pendente</Button>
        </div>
      )}

      <Modal aberto={cancelar} onFechar={() => setCancelar(false)} titulo="Cancelar nota fiscal" descricao="O cancelamento é enviado à SEFAZ (evento 110111). Mínimo de 15 caracteres na justificativa." rodape={<><Button variante="secundario" onClick={() => setCancelar(false)}>Voltar</Button><Button variante="primario" carregando={cancelarM.isPending} disabled={justificativa.trim().length < 15} onClick={() => cancelarM.mutate()}>Confirmar cancelamento</Button></>}>
        <Textarea label="Justificativa" rows={3} value={justificativa} onChange={(e) => setJustificativa(e.target.value)} ajuda={`${justificativa.trim().length}/15 caracteres mínimos`} />
      </Modal>
      <Modal aberto={cce} onFechar={() => setCce(false)} titulo="Carta de correção eletrônica" descricao="Use para corrigir erros que não alterem valores, destinatário ou data." rodape={<><Button variante="secundario" onClick={() => setCce(false)}>Voltar</Button><Button variante="primario" carregando={cceM.isPending} disabled={textoCce.trim().length < 15} onClick={() => cceM.mutate()}>Enviar</Button></>}>
        <Textarea label="Texto da correção" rows={4} value={textoCce} onChange={(e) => setTextoCce(e.target.value)} />
      </Modal>
      <Modal aberto={email !== null} onFechar={() => setEmail(null)} titulo="Enviar XML + DANFE por e-mail" rodape={<><Button variante="secundario" onClick={() => setEmail(null)}>Cancelar</Button><Button variante="primario" carregando={emailM.isPending} onClick={() => emailM.mutate()}>Enviar</Button></>}>
        <Input label="Para" type="email" value={email ?? ''} onChange={(e) => setEmail(e.target.value)} placeholder={n.contato?.email ?? 'email@cliente.com'} ajuda="Em branco usa o e-mail do destinatário." />
      </Modal>
      <ConfirmDialog aberto={excluir} onFechar={() => setExcluir(false)} titulo="Excluir nota?" descricao="Apenas notas pendentes podem ser excluídas." textoConfirmar="Excluir" onConfirmar={async () => { try { await api.del(`/notas-fiscais/${id}`); toast.success('Nota excluída.'); invalidar(); nav('/notas-fiscais'); } catch (e) { toast.error(mensagemErro(e)); } }} />
    </div>
  );
}
