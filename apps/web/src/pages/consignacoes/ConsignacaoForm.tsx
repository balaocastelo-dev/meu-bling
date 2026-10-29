import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Camera, Handshake, ImagePlus, X } from 'lucide-react';
import { api, mensagemErro } from '@/lib/api';
import { buscarContatos } from '@/lib/buscas';
import { useAuth } from '@/stores/auth';
import { useDebounce } from '@/hooks/useDebounce';
import { Button, Card, Checkbox, DateInput, Input, MoneyInput, PageHeader, SearchSelect, Segmentado, Select, Switch, Textarea } from '@/components/ui';
import { data, hoje, moeda, somenteDigitos } from '@/lib/format';
import { TIPOS_EQUIPAMENTO, type Consignacao } from './comum';

interface Simulacao { valorConsignante: number; lucroLoja: number; prazoDias: number; diaria: number; quantidadeDiarias: number; taxaRetirada: number; percentualConsignante: number }

const vazioConsignante = { nome: '', documento: '', celular: '', email: '', rg: '', cep: '', logradouro: '', numero: '', complemento: '', bairro: '', municipio: '', uf: '' };

/** Novo contrato de consignação: consignante, equipamento, preço (com a conta na hora) e fotos para o site. */
export default function ConsignacaoForm() {
  const navigate = useNavigate();
  const gestao = useAuth((s) => s.temPerfil('ADMIN', 'GERENTE'));
  const [modo, setModo] = useState<'NOVO' | 'CADASTRADO'>('NOVO');
  const [consignanteId, setConsignanteId] = useState<number | null>(null);
  const [consignanteNome, setConsignanteNome] = useState<string | null>(null);
  const [p, setP] = useState(vazioConsignante);
  const [f, setF] = useState({ tipoEquipamento: 'NOTEBOOK', descricao: '', marca: '', modelo: '', numeroSerie: '', imei: '', estado: '', acessorios: '', detalhes: '', precoVenda: 0, percentualConsignante: 0, dataEntrada: hoje(), prazoDias: 0, declaracaoOrigem: false, assinadoNaLoja: false, mostrarNoSite: true, destaque: false, observacoes: '' });
  const [fotos, setFotos] = useState<File[]>([]);
  const inputFotos = useRef<HTMLInputElement>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const setPes = <K extends keyof typeof p>(k: K, v: string) => setP((x) => ({ ...x, [k]: v }));

  const preco = useDebounce(f.precoVenda, 300);
  const pct = useDebounce(f.percentualConsignante, 300);
  const { data: sim } = useQuery({
    queryKey: ['consignacao-simular', preco, pct],
    enabled: preco > 0,
    queryFn: () => api.get<Simulacao>('/consignacoes/simular', { precoVenda: preco, percentual: pct > 0 ? pct : undefined }),
    placeholderData: (x) => x,
  });
  // percentual e prazo padrão vêm das regras
  const { data: regras } = useQuery({ queryKey: ['consignacoes-regras'], queryFn: () => api.get<{ regras: { percentualConsignante: number; prazoDias: number } }>('/consignacoes/regras') });
  useEffect(() => {
    if (regras?.regras) setF((x) => ({ ...x, percentualConsignante: x.percentualConsignante || regras.regras.percentualConsignante, prazoDias: x.prazoDias || regras.regras.prazoDias }));
  }, [regras]);

  // CEP → endereço
  useEffect(() => {
    const c = somenteDigitos(p.cep);
    if (c.length !== 8) return;
    api
      .get<{ logradouro?: string; bairro?: string; municipio?: string; uf?: string }>(`/contatos/cep/${c}`)
      .then((r) => setP((x) => ({ ...x, logradouro: x.logradouro || r.logradouro || '', bairro: x.bairro || r.bairro || '', municipio: x.municipio || r.municipio || '', uf: x.uf || r.uf || '' })))
      .catch(() => undefined);
  }, [p.cep]);

  const limite = (() => {
    const d = new Date(`${f.dataEntrada || hoje()}T12:00:00`);
    d.setDate(d.getDate() + (f.prazoDias || regras?.regras.prazoDias || 10));
    return d.toISOString().slice(0, 10);
  })();

  const criar = useMutation({
    mutationFn: async () => {
      const padraoPct = regras?.regras.percentualConsignante;
      const padraoPrazo = regras?.regras.prazoDias;
      const corpo: Record<string, unknown> = {
        tipoEquipamento: f.tipoEquipamento,
        descricao: f.descricao,
        marca: f.marca || null,
        modelo: f.modelo || null,
        numeroSerie: f.numeroSerie || null,
        imei: f.imei || null,
        estado: f.estado || null,
        acessorios: f.acessorios || null,
        detalhes: f.detalhes || null,
        precoVenda: f.precoVenda,
        declaracaoOrigem: f.declaracaoOrigem,
        assinadoNaLoja: f.assinadoNaLoja,
        mostrarNoSite: f.mostrarNoSite,
        destaque: f.destaque,
        observacoes: f.observacoes || null,
      };
      if (gestao) {
        if (f.percentualConsignante && f.percentualConsignante !== padraoPct) corpo.percentualConsignante = f.percentualConsignante;
        if (f.prazoDias && f.prazoDias !== padraoPrazo) corpo.prazoDias = f.prazoDias;
        if (f.dataEntrada && f.dataEntrada !== hoje()) corpo.dataEntrada = f.dataEntrada;
      } else if (f.percentualConsignante && f.percentualConsignante !== padraoPct) corpo.percentualConsignante = f.percentualConsignante;
      if (modo === 'CADASTRADO') corpo.consignanteId = consignanteId;
      else corpo.consignante = { ...p, documento: somenteDigitos(p.documento) || null, celular: somenteDigitos(p.celular) || null, cep: somenteDigitos(p.cep) || null, email: p.email.trim() || null };
      const c = await api.post<Consignacao>('/consignacoes', corpo);
      if (fotos.length) {
        const fd = new FormData();
        for (const x of fotos) fd.append('foto', x, x.name);
        await api.upload(`/consignacoes/${c.id}/fotos`, fd).catch((e) => toast.error(`Contrato criado, mas as fotos não subiram: ${mensagemErro(e)}`));
      }
      return c;
    },
    onSuccess: (c) => {
      toast.success(`Contrato nº ${c.numero} criado. O link para assinar foi para o WhatsApp do consignante.`);
      navigate(`/consignacoes/${c.id}`);
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const podeSalvar = f.descricao.trim().length >= 3 && f.precoVenda > 0 && (modo === 'CADASTRADO' ? !!consignanteId : p.nome.trim().length >= 2 && somenteDigitos(p.documento).length >= 11 && somenteDigitos(p.celular).length >= 10);
  const celular = ['CELULAR', 'TABLET'].includes(f.tipoEquipamento);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader titulo="Novo contrato de consignação" descricao="O consignante recebe o link no WhatsApp para assinar pelo celular e acompanhar tudo." migalhas={[{ rotulo: 'Consignação', para: '/consignacoes' }, { rotulo: 'Novo contrato' }]} />
      <div className="space-y-4">
        <Card titulo="Consignante (dono do equipamento)">
          <Segmentado opcoes={[{ valor: 'NOVO', rotulo: 'Cadastrar agora' }, { valor: 'CADASTRADO', rotulo: 'Já é cliente' }]} valor={modo} onMudar={setModo} className="mb-3" />
          {modo === 'CADASTRADO' ? (
            <SearchSelect label="Buscar por nome, CPF ou celular" obrigatorio valor={consignanteId} rotuloAtual={consignanteNome} buscar={(t) => buscarContatos(t)} onChange={(id, op) => { setConsignanteId(id); setConsignanteNome(op?.rotulo ?? null); }} />
          ) : (
            <div className="grid gap-3 sm:grid-cols-6">
              <Input className="sm:col-span-3" label="Nome completo" obrigatorio value={p.nome} onChange={(e) => setPes('nome', e.target.value)} />
              <Input className="sm:col-span-3" label="CPF / CNPJ" obrigatorio inputMode="numeric" value={p.documento} onChange={(e) => setPes('documento', e.target.value)} />
              <Input className="sm:col-span-2" label="Celular (WhatsApp)" obrigatorio inputMode="tel" placeholder="(19) 99999-9999" value={p.celular} onChange={(e) => setPes('celular', e.target.value)} />
              <Input className="sm:col-span-2" label="E-mail" type="email" value={p.email} onChange={(e) => setPes('email', e.target.value)} />
              <Input className="sm:col-span-2" label="RG" value={p.rg} onChange={(e) => setPes('rg', e.target.value)} />
              <Input className="sm:col-span-2" label="CEP" inputMode="numeric" value={p.cep} onChange={(e) => setPes('cep', e.target.value)} />
              <Input className="sm:col-span-3" label="Endereço" value={p.logradouro} onChange={(e) => setPes('logradouro', e.target.value)} />
              <Input className="sm:col-span-1" label="Número" value={p.numero} onChange={(e) => setPes('numero', e.target.value)} />
              <Input className="sm:col-span-2" label="Bairro" value={p.bairro} onChange={(e) => setPes('bairro', e.target.value)} />
              <Input className="sm:col-span-3" label="Cidade" value={p.municipio} onChange={(e) => setPes('municipio', e.target.value)} />
              <Input className="sm:col-span-1" label="UF" maxLength={2} value={p.uf} onChange={(e) => setPes('uf', e.target.value.toUpperCase())} />
            </div>
          )}
        </Card>

        <Card titulo="Equipamento">
          <div className="grid gap-3 sm:grid-cols-6">
            <Select className="sm:col-span-2" label="Tipo" value={f.tipoEquipamento} onChange={(e) => set('tipoEquipamento', e.target.value)} opcoes={TIPOS_EQUIPAMENTO.map((t) => ({ valor: t.valor, rotulo: t.rotulo }))} />
            <Input className="sm:col-span-4" label="Título (aparece no site e no estoque)" obrigatorio placeholder='ex.: MacBook Air M1 8GB 256GB Cinza' value={f.descricao} onChange={(e) => set('descricao', e.target.value)} />
            <Input className="sm:col-span-2" label="Marca" value={f.marca} onChange={(e) => set('marca', e.target.value)} />
            <Input className="sm:col-span-2" label="Modelo" value={f.modelo} onChange={(e) => set('modelo', e.target.value)} />
            <Input className="sm:col-span-2" label="Nº de série" value={f.numeroSerie} onChange={(e) => set('numeroSerie', e.target.value)} />
            {celular && <Input className="sm:col-span-2" label="IMEI" inputMode="numeric" value={f.imei} onChange={(e) => set('imei', e.target.value)} ajuda="Confira se não tem bloqueio antes de aceitar" />}
            <Input className={celular ? 'sm:col-span-4' : 'sm:col-span-3'} label="Estado de conservação" placeholder="ex.: Seminovo, sem marcas, bateria 89%" value={f.estado} onChange={(e) => set('estado', e.target.value)} />
            <Input className={celular ? 'sm:col-span-6' : 'sm:col-span-3'} label="Acessórios" placeholder="ex.: carregador original e caixa" value={f.acessorios} onChange={(e) => set('acessorios', e.target.value)} />
            <Textarea className="sm:col-span-6" label="Descrição para o site" rows={3} placeholder="Configuração, o que foi revisado, diferenciais…" value={f.detalhes} onChange={(e) => set('detalhes', e.target.value)} />
          </div>
          <div className="mt-3">
            <input ref={inputFotos} type="file" accept="image/*" multiple capture="environment" className="hidden" onChange={(e) => { setFotos((x) => [...x, ...Array.from(e.target.files ?? [])].slice(0, 12)); e.target.value = ''; }} />
            <div className="flex flex-wrap items-center gap-2">
              {fotos.map((x, i) => (
                <div key={i} className="relative h-16 w-16 overflow-hidden rounded-md border border-slate-200">
                  <img src={URL.createObjectURL(x)} alt="" className="h-full w-full object-cover" />
                  <button type="button" aria-label="Remover foto" onClick={() => setFotos((l) => l.filter((_, k) => k !== i))} className="absolute right-0.5 top-0.5 rounded-full bg-white/90 p-0.5 text-slate-600"><X className="h-3 w-3" /></button>
                </div>
              ))}
              <Button icone={fotos.length ? <ImagePlus className="h-4 w-4" /> : <Camera className="h-4 w-4" />} onClick={() => inputFotos.current?.click()}>{fotos.length ? 'Mais fotos' : 'Tirar / escolher fotos'}</Button>
              <span className="text-xs text-slate-400">A primeira foto é a capa no site. Até 12.</span>
            </div>
          </div>
        </Card>

        <Card titulo="Valores e prazo">
          <div className="grid gap-3 sm:grid-cols-4">
            <MoneyInput className="sm:col-span-2" label="Preço de venda na loja" obrigatorio value={f.precoVenda} onChange={(v) => set('precoVenda', v)} />
            <MoneyInput label="Consignante fica com (%)" prefixo="" value={f.percentualConsignante} onChange={(v) => set('percentualConsignante', v)} />
            {gestao ? <Input label="Prazo (dias corridos)" type="number" min={1} value={f.prazoDias} onChange={(e) => set('prazoDias', Number(e.target.value) || 0)} /> : <Input label="Prazo (dias corridos)" value={f.prazoDias} disabled />}
            {gestao && <DateInput className="sm:col-span-2" label="Data de entrada" value={f.dataEntrada} onChange={(v) => set('dataEntrada', v)} ajuda="Para registrar um equipamento que já está na loja" />}
          </div>
          {sim && f.precoVenda > 0 && (
            <div className="mt-3 grid gap-2 rounded-lg border border-brand-100 bg-brand-50/60 p-3 text-sm text-slate-700 sm:grid-cols-2">
              <p>Consignante recebe <b className="num">{moeda(sim.valorConsignante)}</b> ({sim.percentualConsignante}%) — <b>na hora da venda</b>.</p>
              <p>Loja fica com <b className="num">{moeda(sim.lucroLoja)}</b>.</p>
              <p>Prazo até <b>{data(limite)}</b>. Retirar antes disso: taxa de {moeda(sim.taxaRetirada)}.</p>
              <p>Sem venda no prazo: <b className="num">{sim.quantidadeDiarias}× {moeda(sim.diaria)}</b> por dia útil até quitar.</p>
            </div>
          )}
        </Card>

        <Card titulo="Contrato e site">
          <div className="space-y-3">
            <Checkbox checked={f.declaracaoOrigem} onChange={(e) => set('declaracaoOrigem', e.target.checked)} label="O consignante declarou que o equipamento é dele, de origem lícita e sem bloqueio (iCloud, Google, operadora)" />
            <Checkbox checked={f.assinadoNaLoja} onChange={(e) => set('assinadoNaLoja', e.target.checked)} label="Ele já assinou o contrato impresso aqui na loja" descricao="Sem marcar, ele assina pelo celular no link do WhatsApp." />
            <div className="flex flex-wrap gap-6">
              <Switch checked={f.mostrarNoSite} onChange={(v) => set('mostrarNoSite', v)} label="Mostrar na vitrine Consignados do site" />
              <Switch checked={f.destaque} onChange={(v) => set('destaque', v)} label="Destaque" />
            </div>
            <Textarea label="Observações internas" rows={2} value={f.observacoes} onChange={(e) => set('observacoes', e.target.value)} />
          </div>
        </Card>

        <div className="flex flex-wrap justify-end gap-2 pb-6">
          <Button onClick={() => navigate('/consignacoes')}>Cancelar</Button>
          <Button variante="primario" tamanho="lg" icone={<Handshake className="h-4 w-4" />} carregando={criar.isPending} disabled={!podeSalvar} onClick={() => criar.mutate()}>Criar contrato</Button>
        </div>
      </div>
    </div>
  );
}
