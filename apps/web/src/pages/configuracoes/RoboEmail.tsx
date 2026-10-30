import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Mail, Play, Plus, Trash2, Plug, ShieldAlert } from 'lucide-react';
import { api, mensagemErro } from '@/lib/api';
import { Badge, Button, Coluna, ConfirmDialog, EmptyState, Input, Modal, PageHeader, Secao, Switch, Table } from '@/components/ui';

interface Caixa {
  id: number; nome: string; endereco: string; tipo: string; host: string | null; porta: number;
  usuario: string | null; pasta: string; ativo: boolean; segredo: string | null; temSegredo: boolean;
  ultimaLeituraEm: string | null; ultimoErro: string | null;
}
interface Regra {
  id: number; nome: string; remetente: string; parser: string; contaFinanceiraId: number | null;
  ativo: boolean; ordem: number; contaFinanceira?: { id: number; nome: string } | null;
}
interface Mensagem {
  id: number; remetente: string; assunto: string; recebidoEm: string; situacao: string;
  motivo: string | null; valor: number | null;
}
interface Painel {
  ligado: boolean; baixaAutomatica: boolean; ultimaRodadaEm: string | null; ultimoErro: string | null;
  caixas: Caixa[]; ultimos7Dias: Record<string, number>; pendentesDeConciliacao: number; ultimas: Mensagem[];
}
interface Conta { id: number; nome: string }

const PARSERS: { valor: string; rotulo: string; pronto: boolean }[] = [
  { valor: 'SUMUP_PIX', rotulo: 'SumUp — Pix recebido e enviado', pronto: true },
  { valor: 'ASAAS', rotulo: 'Asaas — cobrança confirmada', pronto: true },
  { valor: 'SUMUP_PAYOUT', rotulo: 'SumUp — extrato de depósito (PDF)', pronto: false },
  { valor: 'CORA', rotulo: 'Cora', pronto: false },
  { valor: 'MERCADOPAGO', rotulo: 'Mercado Pago', pronto: false },
  { valor: 'BOLETO_FORNECEDOR', rotulo: 'Boleto de fornecedor', pronto: false },
];

const TOM_SITUACAO: Record<string, 'verde' | 'amarelo' | 'vermelho' | 'cinza'> = {
  IMPORTADO: 'verde', SEM_REGRA: 'cinza', SEM_DADOS: 'amarelo', REMETENTE_SUSPEITO: 'vermelho', ERRO: 'vermelho',
};
const ROTULO_SITUACAO: Record<string, string> = {
  IMPORTADO: 'Lançado', SEM_REGRA: 'Remetente sem regra', SEM_DADOS: 'Sem dados no corpo',
  REMETENTE_SUSPEITO: 'Origem não confere', ERRO: 'Erro',
};

const dataHora = (v: string | null) => (v ? new Date(v).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const dinheiro = (v: number | null) => (v === null || v === undefined ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));

/** Robô que lê o e-mail dos bancos e lança no financeiro. */
export default function RoboEmail() {
  const qc = useQueryClient();
  const [caixaEdit, setCaixaEdit] = useState<Partial<Caixa> & { segredoNovo?: string } | null>(null);
  const [regraEdit, setRegraEdit] = useState<Partial<Regra> | null>(null);
  const [apagar, setApagar] = useState<{ tipo: 'caixa' | 'regra'; id: number; nome: string } | null>(null);

  const painel = useQuery({ queryKey: ['email-banco-painel'], queryFn: () => api.get<Painel>('/email-banco/painel'), refetchInterval: 60_000 });
  const regras = useQuery({ queryKey: ['email-banco-regras'], queryFn: () => api.get<Regra[]>('/email-banco/regras') });
  const contas = useQuery({ queryKey: ['contas-financeiras-ativas'], queryFn: () => api.get<Conta[] | { data: Conta[] }>('/contas-financeiras?ativo=true') });
  const listaContas: Conta[] = Array.isArray(contas.data) ? contas.data : contas.data?.data ?? [];

  const recarregar = () => {
    qc.invalidateQueries({ queryKey: ['email-banco-painel'] });
    qc.invalidateQueries({ queryKey: ['email-banco-regras'] });
  };

  const config = useMutation({
    mutationFn: (d: Record<string, unknown>) => api.put('/email-banco/config', d),
    onSuccess: () => recarregar(),
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const rodar = useMutation({
    mutationFn: () => api.post<{ caixasLidas: number; importadas: number; baixasAutomaticas: number; erros: { caixa: string; erro: string }[] }>('/email-banco/rodar', {}),
    onSuccess: (r) => {
      if (r.erros?.length) r.erros.forEach((e) => toast.error(`${e.caixa}: ${e.erro}`));
      toast.success(`${r.caixasLidas} caixa(s) lida(s), ${r.importadas} lançamento(s), ${r.baixasAutomaticas} baixa(s).`);
      recarregar();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const salvarCaixa = useMutation({
    mutationFn: (c: Partial<Caixa> & { segredoNovo?: string }) => {
      const corpo: Record<string, unknown> = {
        nome: c.nome, endereco: c.endereco, tipo: c.tipo ?? 'IMAP', host: c.host || null,
        porta: Number(c.porta) || 993, usuario: c.usuario || null, pasta: c.pasta || 'INBOX', ativo: c.ativo ?? true,
      };
      // senha em branco = não mexe na que já está gravada
      if (c.segredoNovo) corpo.segredo = c.segredoNovo;
      return c.id ? api.put(`/email-banco/caixas/${c.id}`, corpo) : api.post('/email-banco/caixas', corpo);
    },
    onSuccess: () => { toast.success('Caixa salva.'); setCaixaEdit(null); recarregar(); },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const testar = useMutation({
    mutationFn: (id: number) => api.post<{ ok: boolean; mensagens: number }>(`/email-banco/caixas/${id}/testar`, {}),
    onSuccess: (r) => toast.success(`Entrei na caixa. ${r.mensagens} mensagem(ns) nos últimos 2 dias.`),
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const salvarRegra = useMutation({
    mutationFn: (r: Partial<Regra>) => {
      const corpo = { nome: r.nome, remetente: r.remetente, parser: r.parser, contaFinanceiraId: r.contaFinanceiraId ?? null, ativo: r.ativo ?? true, ordem: r.ordem ?? 0 };
      return r.id ? api.put(`/email-banco/regras/${r.id}`, corpo) : api.post('/email-banco/regras', corpo);
    },
    onSuccess: () => { toast.success('Regra salva.'); setRegraEdit(null); recarregar(); },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const excluir = useMutation({
    mutationFn: (a: { tipo: 'caixa' | 'regra'; id: number }) => api.del(a.tipo === 'caixa' ? `/email-banco/caixas/${a.id}` : `/email-banco/regras/${a.id}`),
    onSuccess: () => { toast.success('Removido.'); setApagar(null); recarregar(); },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const p = painel.data;

  const colCaixas: Coluna<Caixa>[] = [
    { chave: 'nome', titulo: 'Caixa', noCartao: 'titulo', render: (c) => (<div><div className="font-medium text-slate-800">{c.nome}</div><div className="text-xs text-slate-500">{c.endereco}</div></div>) },
    { chave: 'tipo', titulo: 'Como lê', render: (c) => <Badge tom="cinza">{c.tipo === 'GMAIL' ? 'Gmail' : `IMAP · ${c.host ?? '—'}`}</Badge> },
    { chave: 'ultima', titulo: 'Última leitura', ocultarMobile: true, render: (c) => <span className="text-sm text-slate-600">{dataHora(c.ultimaLeituraEm)}</span> },
    { chave: 'situacao', titulo: 'Situação', render: (c) => (c.ultimoErro ? <Badge tom="vermelho" ponto>Com erro</Badge> : c.ativo ? <Badge tom="verde" ponto>Lendo</Badge> : <Badge tom="cinza">Parada</Badge>) },
    { chave: 'acoes', titulo: '', direita: true, render: (c) => (
      <div className="flex justify-end gap-2">
        <Button variante="secundario" tamanho="sm" carregando={testar.isPending} onClick={() => testar.mutate(c.id)}>Testar</Button>
        <Button variante="secundario" tamanho="sm" onClick={() => setCaixaEdit({ ...c })}>Editar</Button>
        <Button variante="perigo" tamanho="sm" icone={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setApagar({ tipo: 'caixa', id: c.id, nome: c.nome })} />
      </div>
    ) },
  ];

  const colRegras: Coluna<Regra>[] = [
    { chave: 'remetente', titulo: 'Remetente', noCartao: 'titulo', render: (r) => (<div><div className="font-medium text-slate-800">{r.remetente}</div><div className="text-xs text-slate-500">{r.nome}</div></div>) },
    { chave: 'parser', titulo: 'Entende como', render: (r) => { const def = PARSERS.find((x) => x.valor === r.parser); return <Badge tom={def?.pronto ? 'verde' : 'amarelo'}>{def?.rotulo ?? r.parser}</Badge>; } },
    { chave: 'conta', titulo: 'Cai no banco', render: (r) => (r.contaFinanceira?.nome ? <span className="text-sm text-slate-700">{r.contaFinanceira.nome}</span> : <Badge tom="vermelho">sem banco definido</Badge>) },
    { chave: 'acoes', titulo: '', direita: true, render: (r) => (
      <div className="flex justify-end gap-2">
        <Button variante="secundario" tamanho="sm" onClick={() => setRegraEdit({ ...r })}>Editar</Button>
        <Button variante="perigo" tamanho="sm" icone={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setApagar({ tipo: 'regra', id: r.id, nome: r.remetente })} />
      </div>
    ) },
  ];

  const colMensagens: Coluna<Mensagem>[] = [
    { chave: 'recebidoEm', titulo: 'Recebido', render: (m) => <span className="text-sm text-slate-600">{dataHora(m.recebidoEm)}</span> },
    { chave: 'assunto', titulo: 'Assunto', noCartao: 'titulo', render: (m) => (<div><div className="text-sm text-slate-800">{m.assunto}</div><div className="text-xs text-slate-500">{m.remetente}</div></div>) },
    { chave: 'valor', titulo: 'Valor', direita: true, render: (m) => <span className={m.valor && m.valor < 0 ? 'text-rose-600' : 'text-slate-700'}>{dinheiro(m.valor)}</span> },
    { chave: 'situacao', titulo: 'O que foi feito', render: (m) => (<div><Badge tom={TOM_SITUACAO[m.situacao] ?? 'cinza'}>{ROTULO_SITUACAO[m.situacao] ?? m.situacao}</Badge>{m.motivo ? <div className="mt-0.5 text-xs text-slate-500">{m.motivo}</div> : null}</div>) },
  ];

  return (
    <div className="pb-6">
      <PageHeader
        migalhas={[{ rotulo: 'Configurações', para: '/configuracoes' }, { rotulo: 'Robô de e-mail' }]}
        titulo="Robô de e-mail dos bancos"
        descricao="Lê os avisos que os bancos mandam por e-mail e lança no financeiro. O que não casa com certeza fica para você conferir em Bancos → Conciliação."
        extra={p ? <Badge tom={p.ligado ? 'verde' : 'cinza'} ponto>{p.ligado ? 'Ligado' : 'Desligado'}</Badge> : null}
        acoes={<Button variante="primario" icone={<Play className="h-4 w-4" />} carregando={rodar.isPending} onClick={() => rodar.mutate()}>Ler agora</Button>}
      />

      <div className="space-y-4">
        {p?.ultimoErro ? (
          <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <div><span className="font-medium">Última leitura deu problema:</span> {p.ultimoErro}</div>
          </div>
        ) : null}

        <Secao
          titulo="Como o robô trabalha"
          descricao={`Lê de 30 em 30 minutos. Última leitura: ${dataHora(p?.ultimaRodadaEm ?? null)}.`}
          acoes={<Switch checked={!!p?.ligado} onChange={(v) => config.mutate({ ligado: v })} label={p?.ligado ? 'Ligado' : 'Desligado'} />}
        >
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border border-slate-200 p-3">
              <Switch checked={!!p?.baixaAutomatica} onChange={(v) => config.mutate({ baixaAutomatica: v })} label="Dar baixa sozinho quando o casamento for exato" />
              <p className="mt-2 text-xs text-slate-500">
                Só dá baixa quando existe <strong>uma única</strong> conta em aberto com aquele valor, ou quando o aviso traz o número do pedido.
                Havendo duas contas com o mesmo valor, o robô para e deixa para você.
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 p-3">
              <div className="text-sm font-medium text-slate-800">Esperando conferência</div>
              <div className="mt-1 text-2xl font-semibold text-slate-900">{p?.pendentesDeConciliacao ?? 0}</div>
              <p className="mt-1 text-xs text-slate-500">Lançamentos vindos de e-mail que ainda não foram conciliados. Resolva em Financeiro → Bancos → Conciliação.</p>
            </div>
          </div>
        </Secao>

        <Secao
          titulo="Caixas de e-mail"
          descricao="As caixas são abertas só para leitura: nada é marcado como lido, movido ou apagado."
          acoes={<Button variante="secundario" icone={<Plus className="h-4 w-4" />} onClick={() => setCaixaEdit({ tipo: 'IMAP', porta: 993, pasta: 'INBOX', ativo: true })}>Nova caixa</Button>}
        >
          <Table colunas={colCaixas} dados={p?.caixas} carregando={painel.isLoading} chave={(c) => c.id}
            vazio={<EmptyState icone={<Mail className="h-8 w-8" />} titulo="Nenhuma caixa cadastrada" descricao="Cadastre a caixa onde chegam os avisos dos bancos." />} />
        </Secao>

        <Secao
          titulo="De quem o robô aceita aviso"
          descricao="Remetente que não estiver aqui nunca vira lançamento. É isso que impede um e-mail falso de mexer no seu caixa."
          acoes={<Button variante="secundario" icone={<Plus className="h-4 w-4" />} onClick={() => setRegraEdit({ parser: 'SUMUP_PIX', ativo: true, ordem: 0 })}>Nova regra</Button>}
        >
          <Table colunas={colRegras} dados={regras.data} carregando={regras.isLoading} chave={(r) => r.id}
            vazio={<EmptyState icone={<Plug className="h-8 w-8" />} titulo="Nenhum remetente liberado" descricao="Sem regra, o robô lê mas não lança nada." />} />
        </Secao>

        <Secao titulo="Últimos e-mails que o robô olhou" descricao="Inclusive os que ele decidiu não lançar, e por quê.">
          <Table colunas={colMensagens} dados={p?.ultimas} carregando={painel.isLoading} chave={(m) => m.id}
            vazio={<EmptyState icone={<Mail className="h-8 w-8" />} titulo="Nada lido ainda" descricao="Cadastre uma caixa e clique em Ler agora." />} />
        </Secao>
      </div>

      {/* --- caixa --- */}
      <Modal aberto={!!caixaEdit} onFechar={() => setCaixaEdit(null)} titulo={caixaEdit?.id ? 'Editar caixa' : 'Nova caixa de e-mail'}
        descricao="Para o domínio da loja use IMAP. Para contas Google use Gmail (o servidor precisa estar com o app do Google configurado)."
        rodape={<><Button variante="secundario" onClick={() => setCaixaEdit(null)}>Cancelar</Button><Button variante="primario" carregando={salvarCaixa.isPending} onClick={() => caixaEdit && salvarCaixa.mutate(caixaEdit)}>Salvar</Button></>}>
        {caixaEdit ? (
          <div className="grid gap-3 md:grid-cols-2">
            <Input label="Nome" value={caixaEdit.nome ?? ''} onChange={(e) => setCaixaEdit({ ...caixaEdit, nome: e.target.value })} placeholder="Caixa da loja" />
            <Input label="E-mail" value={caixaEdit.endereco ?? ''} onChange={(e) => setCaixaEdit({ ...caixaEdit, endereco: e.target.value })} placeholder="balaocastelo@balaodainformatica.com.br" autoComplete="off" />
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Como ler</label>
              <select className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={caixaEdit.tipo ?? 'IMAP'} onChange={(e) => setCaixaEdit({ ...caixaEdit, tipo: e.target.value })}>
                <option value="IMAP">IMAP (domínio próprio)</option>
                <option value="GMAIL">Gmail (API do Google)</option>
              </select>
            </div>
            <Input label="Pasta" value={caixaEdit.pasta ?? 'INBOX'} onChange={(e) => setCaixaEdit({ ...caixaEdit, pasta: e.target.value })} />
            {caixaEdit.tipo !== 'GMAIL' ? (
              <>
                <Input label="Servidor (host)" value={caixaEdit.host ?? ''} onChange={(e) => setCaixaEdit({ ...caixaEdit, host: e.target.value })} placeholder="imap.dreamhost.com" />
                <Input label="Porta" type="number" value={String(caixaEdit.porta ?? 993)} onChange={(e) => setCaixaEdit({ ...caixaEdit, porta: Number(e.target.value) })} />
                <Input label="Usuário (se for diferente do e-mail)" value={caixaEdit.usuario ?? ''} onChange={(e) => setCaixaEdit({ ...caixaEdit, usuario: e.target.value })} autoComplete="off" />
              </>
            ) : null}
            <Input
              label={caixaEdit.tipo === 'GMAIL' ? 'Refresh token' : 'Senha'}
              type="password"
              value={caixaEdit.segredoNovo ?? ''}
              onChange={(e) => setCaixaEdit({ ...caixaEdit, segredoNovo: e.target.value })}
              placeholder={caixaEdit.temSegredo ? '•••••••• (guardada — preencha só para trocar)' : ''}
              autoComplete="new-password"
            />
            <div className="md:col-span-2">
              <Switch checked={caixaEdit.ativo ?? true} onChange={(v) => setCaixaEdit({ ...caixaEdit, ativo: v })} label="Ler esta caixa" />
              <p className="mt-2 text-xs text-slate-500">A senha é guardada criptografada e nunca volta para a tela.</p>
            </div>
          </div>
        ) : null}
      </Modal>

      {/* --- regra --- */}
      <Modal aberto={!!regraEdit} onFechar={() => setRegraEdit(null)} titulo={regraEdit?.id ? 'Editar regra' : 'Nova regra de remetente'}
        descricao="Pode ser o e-mail exato (no-reply@sumup.com) ou o domínio inteiro (@cora.com.br)."
        rodape={<><Button variante="secundario" onClick={() => setRegraEdit(null)}>Cancelar</Button><Button variante="primario" carregando={salvarRegra.isPending} onClick={() => regraEdit && salvarRegra.mutate(regraEdit)}>Salvar</Button></>}>
        {regraEdit ? (
          <div className="grid gap-3">
            <Input label="Nome" value={regraEdit.nome ?? ''} onChange={(e) => setRegraEdit({ ...regraEdit, nome: e.target.value })} placeholder="Pix da SumUp Loja" />
            <Input label="Remetente" value={regraEdit.remetente ?? ''} onChange={(e) => setRegraEdit({ ...regraEdit, remetente: e.target.value })} placeholder="no-reply@sumup.com" autoComplete="off" />
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Entende como</label>
              <select className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={regraEdit.parser ?? 'SUMUP_PIX'} onChange={(e) => setRegraEdit({ ...regraEdit, parser: e.target.value })}>
                {PARSERS.map((x) => <option key={x.valor} value={x.valor}>{x.rotulo}{x.pronto ? '' : ' (ainda não lê o valor)'}</option>)}
              </select>
              {!PARSERS.find((x) => x.valor === (regraEdit.parser ?? 'SUMUP_PIX'))?.pronto ? (
                <p className="mt-1 text-xs text-amber-700">Esse formato ainda não é lido. O e-mail fica registrado para conferência, sem virar lançamento.</p>
              ) : null}
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Cai em qual banco</label>
              <select className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={regraEdit.contaFinanceiraId ?? ''} onChange={(e) => setRegraEdit({ ...regraEdit, contaFinanceiraId: e.target.value ? Number(e.target.value) : null })}>
                <option value="">— escolha a conta —</option>
                {listaContas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
              <p className="mt-1 text-xs text-slate-500">Sem conta escolhida, o robô lê mas não lança.</p>
            </div>
            <Switch checked={regraEdit.ativo ?? true} onChange={(v) => setRegraEdit({ ...regraEdit, ativo: v })} label="Regra ativa" />
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        aberto={!!apagar}
        onFechar={() => setApagar(null)}
        titulo={apagar?.tipo === 'caixa' ? 'Remover caixa' : 'Remover regra'}
        descricao={apagar ? `Remover "${apagar.nome}"? Os lançamentos já feitos continuam no financeiro.` : ''}
        onConfirmar={async () => { if (apagar) await excluir.mutateAsync(apagar); }}
      />
    </div>
  );
}
