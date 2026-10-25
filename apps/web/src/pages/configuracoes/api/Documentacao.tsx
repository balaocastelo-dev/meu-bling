/** Aba "Endpoints": o que a API oferece, por área, com filtros, exemplo de corpo e um "experimentar" (GET). */
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Download, Play, Search } from 'lucide-react';
import { api, mensagemErro } from '@/lib/api';
import { Button, Input, Modal } from '@/components/ui';
import { Codigo, CorMetodo, useCatalogo, type Endpoint } from './comum';

export function AbaDocumentacao({ urlBase }: { urlBase: string }) {
  const { data: catalogo } = useCatalogo();
  const [busca, setBusca] = useState('');
  const [resultado, setResultado] = useState<{ caminho: string; texto: string } | null>(null);
  const [rodando, setRodando] = useState<string | null>(null);

  const grupos = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return (catalogo?.recursos ?? [])
      .map((r) => ({ r, eps: (catalogo?.endpoints ?? []).filter((e) => e.recurso === r.chave && (!t || `${e.metodo} ${e.caminho} ${e.resumo}`.toLowerCase().includes(t))) }))
      .filter((g) => g.eps.length);
  }, [catalogo, busca]);

  const experimentar = async (e: Endpoint) => {
    const caminho = e.caminho.includes('?') ? e.caminho : `${e.caminho}${e.filtros?.some((f) => f.startsWith('limite')) ? '?limite=3' : ''}`;
    setRodando(e.caminho);
    try {
      const r = await api.get<unknown>(caminho);
      setResultado({ caminho, texto: JSON.stringify(r, null, 2).slice(0, 20000) });
    } catch (err) {
      toast.error(mensagemErro(err));
    } finally {
      setRodando(null);
    }
  };

  const baixarOpenApi = async () => {
    try {
      const { blob } = await api.blob('/externo/openapi.json');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'meu-bling-openapi.json';
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      toast.error(mensagemErro(err));
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-600">
        <p>
          Endereço base: <code className="break-all rounded bg-slate-100 px-1 text-xs">{urlBase}</code>. Mande a chave no cabeçalho <code className="rounded bg-slate-100 px-1 text-xs">X-API-Key</code>. Datas em AAAA-MM-DD, valores em reais, listas com{' '}
          <code className="rounded bg-slate-100 px-1 text-xs">?pagina=&amp;limite=</code> devolvem <code className="rounded bg-slate-100 px-1 text-xs">{'{ data, meta }'}</code>; erro devolve <code className="rounded bg-slate-100 px-1 text-xs">{'{ erro, code }'}</code> em português.
        </p>
        <p className="text-xs text-slate-400">Aqui estão as rotas mais usadas. Qualquer outra rota da mesma área também funciona com a chave (é a mesma API das telas). Cada chave vê no próprio OpenAPI só o que pode usar.</p>
        <div className="flex flex-wrap gap-2">
          <Button tamanho="sm" variante="secundario" icone={<Download className="h-4 w-4" />} onClick={baixarOpenApi}>Baixar OpenAPI (Postman, n8n, GPTs)</Button>
        </div>
      </div>

      <Input prefixo={<Search className="h-4 w-4" />} placeholder="Procurar rota (ex.: venda, estoque, situação)" value={busca} onChange={(e) => setBusca(e.target.value)} className="max-w-md" />

      {grupos.map(({ r, eps }) => (
        <section key={r.chave} className="min-w-0 rounded-lg border border-slate-200 bg-white">
          <header className="border-b border-slate-100 px-3 py-2">
            <h3 className="text-sm font-semibold text-slate-800">{r.nome}</h3>
            <p className="text-xs text-slate-400">{r.descricao}</p>
          </header>
          <div className="divide-y divide-slate-100">
            {eps.map((e) => (
              <details key={e.metodo + e.caminho} className="group px-3 py-2">
                <summary className="flex cursor-pointer items-start gap-2">
                  <CorMetodo metodo={e.metodo} />
                  <div className="min-w-0 flex-1">
                    <code className="break-all text-xs font-semibold text-slate-800">{e.caminho}</code>
                    <p className="text-xs text-slate-500">{e.resumo}</p>
                  </div>
                </summary>
                <div className="mt-2 space-y-2 pl-0 sm:pl-16">
                  {!!e.filtros?.length && (
                    <p className="text-xs text-slate-500">
                      <span className="font-medium text-slate-600">Filtros: </span>
                      {e.filtros.join(' · ')}
                    </p>
                  )}
                  {e.corpo !== undefined && <Codigo titulo="Exemplo de corpo (JSON)">{JSON.stringify(e.corpo, null, 2)}</Codigo>}
                  <Codigo titulo="curl">{`curl ${e.metodo !== 'GET' ? `-X ${e.metodo} ` : ''}-H "X-API-Key: SUA_CHAVE"${e.corpo !== undefined ? ` -H "Content-Type: application/json" -d '${JSON.stringify(e.corpo)}'` : ''} "${urlBase}${e.caminho.replace('{id}', '1').replace('{cep}', '13025000')}"`}</Codigo>
                  {e.metodo === 'GET' && !e.caminho.includes('{') && (
                    <Button tamanho="xs" variante="secundario" icone={<Play className="h-3.5 w-3.5" />} carregando={rodando === e.caminho} onClick={() => experimentar(e)}>
                      Experimentar com o meu acesso
                    </Button>
                  )}
                </div>
              </details>
            ))}
          </div>
        </section>
      ))}

      {resultado && (
        <Modal aberto tamanho="xl" onFechar={() => setResultado(null)} titulo={`GET ${resultado.caminho}`} descricao="Resposta real com o seu acesso de ADMIN (uma chave vê só o que foi liberado).">
          <Codigo titulo="Resposta">{resultado.texto}</Codigo>
        </Modal>
      )}
    </div>
  );
}
