/** Aba "Conectar agente de IA": endereços e receitas prontas (Claude, ChatGPT, n8n, Python). */
import { useState } from 'react';
import { Bot } from 'lucide-react';
import { Segmentado } from '@/components/ui';
import { Codigo, LinhaCopiavel, useCatalogo, type ResumoApi } from './comum';

type Receita = 'claude-code' | 'claude-desktop' | 'claude-ai' | 'chatgpt' | 'n8n' | 'python';

export function AbaConectar({ resumo }: { resumo: ResumoApi }) {
  const { data: catalogo } = useCatalogo();
  const [receita, setReceita] = useState<Receita>('claude-code');
  const { urlBase, urlMcp, urlOpenApi } = resumo;

  const receitas: Record<Receita, { rotulo: string; texto: React.ReactNode; codigo?: { titulo: string; corpo: string } }> = {
    'claude-code': {
      rotulo: 'Claude Code',
      texto: 'No terminal do PC (ou da VPS) onde o Claude Code roda:',
      codigo: { titulo: 'Terminal', corpo: `claude mcp add --transport http meu-bling ${urlMcp} --header "X-API-Key: SUA_CHAVE"` },
    },
    'claude-desktop': {
      rotulo: 'Claude Desktop / Cursor',
      texto: 'No arquivo de configuração de servidores MCP do aplicativo (ex.: claude_desktop_config.json ou .cursor/mcp.json):',
      codigo: { titulo: 'JSON', corpo: JSON.stringify({ mcpServers: { 'meu-bling': { type: 'http', url: urlMcp, headers: { 'X-API-Key': 'SUA_CHAVE' } } } }, null, 2) },
    },
    'claude-ai': {
      rotulo: 'claude.ai (conector)',
      texto: (
        <>
          Em claude.ai → Configurações → Conectores → <em>Adicionar conector personalizado</em>, cole o endereço abaixo. Como esse conector não manda cabeçalho, a chave vai no endereço: ligue <strong>“Permitir a chave dentro do endereço do MCP”</strong> na chave (Segurança avançada) e trate o endereço como senha.
        </>
      ),
      codigo: { titulo: 'Endereço do conector', corpo: `${urlMcp}/SUA_CHAVE` },
    },
    chatgpt: {
      rotulo: 'ChatGPT (GPT)',
      texto: 'Num GPT personalizado → Configurar → Ações → Importar de URL: use o endereço do OpenAPI. Autenticação: “Chave de API”, tipo “Personalizado”, cabeçalho X-API-Key.',
      codigo: { titulo: 'Importar de URL', corpo: urlOpenApi },
    },
    n8n: {
      rotulo: 'n8n / Make / Zapier',
      texto: 'Nó “HTTP Request” com o cabeçalho X-API-Key. Para receber os acontecimentos (venda criada, OS aberta, pagamento…), crie um nó Webhook no n8n e cadastre o endereço dele na aba Webhooks.',
      codigo: { titulo: 'HTTP Request', corpo: `Método: GET\nURL: ${urlBase}/vendas?dataInicial=2026-10-01&limite=50\nCabeçalho: X-API-Key = SUA_CHAVE` },
    },
    python: {
      rotulo: 'Python / agente próprio',
      texto: 'Qualquer linguagem: é HTTP com JSON.',
      codigo: {
        titulo: 'Python',
        corpo: `import requests

API = "${urlBase}"
H = {"X-API-Key": "SUA_CHAVE"}

clientes = requests.get(f"{API}/contatos", params={"pesquisa": "maria"}, headers=H).json()["data"]
nova = requests.post(f"{API}/vendas", headers=H, json={
    "contatoId": clientes[0]["id"],
    "itens": [{"produtoId": 1, "quantidade": 1}],
}).json()
print(nova["numero"], nova["total"])`,
      },
    },
  };
  const atual = receitas[receita];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-3 md:grid-cols-3">
        <LinhaCopiavel rotulo="Endereço da API (REST)" valor={urlBase} />
        <LinhaCopiavel rotulo="Servidor MCP (agentes de IA)" valor={urlMcp} ajuda="POST JSON-RPC, cabeçalho X-API-Key" />
        <LinhaCopiavel rotulo="Documentação OpenAPI" valor={urlOpenApi} ajuda="Só com o que a chave pode usar" />
      </div>

      <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-3">
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-brand-600" />
          <p className="text-sm font-semibold text-slate-800">Passo a passo</p>
        </div>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-600">
          <li>Na aba <strong>Chaves de acesso</strong>, crie uma chave só para o agente, liberando o que ele precisa (ex.: ler clientes e produtos, gravar vendas).</li>
          <li>Escolha onde o agente roda e copie a receita, trocando <code className="rounded bg-slate-100 px-1 text-xs">SUA_CHAVE</code> pela chave.</li>
          <li>Pergunte ao agente, por exemplo: “quanto vendemos hoje?”, “abra uma OS para a Maria, notebook Dell que não liga”, “quais contas estão atrasadas?”.</li>
        </ol>
        <div className="overflow-x-auto pb-1">
          <Segmentado<Receita> tamanho="xs" valor={receita} onMudar={setReceita} opcoes={(Object.keys(receitas) as Receita[]).map((k) => ({ valor: k, rotulo: receitas[k].rotulo }))} />
        </div>
        <p className="text-sm text-slate-600">{atual.texto}</p>
        {atual.codigo && <Codigo titulo={atual.codigo.titulo}>{atual.codigo.corpo}</Codigo>}
      </div>

      {!!catalogo?.ferramentasMcp?.length && (
        <div className="rounded-lg border border-slate-200 bg-white">
          <p className="border-b border-slate-100 px-3 py-2 text-sm font-semibold text-slate-800">Ferramentas que o agente recebe</p>
          <ul className="divide-y divide-slate-100">
            {catalogo.ferramentasMcp.map((f) => (
              <li key={f.nome} className="px-3 py-2">
                <p className="text-sm">
                  <code className="text-xs font-semibold text-slate-800">{f.nome}</code> <span className="text-slate-500">— {f.titulo}</span>
                </p>
                <p className="text-xs text-slate-400">{f.descricao}</p>
              </li>
            ))}
          </ul>
          <p className="border-t border-slate-100 px-3 py-2 text-xs text-slate-400">Cada agente só recebe as ferramentas que a chave dele permite. Tudo o que ele faz aparece no Registro de chamadas (marcado “IA”) e na auditoria do sistema.</p>
        </div>
      )}
    </div>
  );
}
