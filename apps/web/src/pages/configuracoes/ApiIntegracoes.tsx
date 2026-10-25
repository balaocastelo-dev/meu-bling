/**
 * Configurações → API e integrações (só ADMIN).
 * Chaves de acesso para outros sistemas e agentes de IA (leitura/gravação por área), webhooks de saída,
 * endpoints documentados, registro de chamadas e receitas para conectar agentes (MCP).
 */
import { useState } from 'react';
import { Activity, AlertTriangle, KeyRound, Webhook } from 'lucide-react';
import { inteiro } from '@/lib/format';
import { FormSkeleton, PageHeader, StatCard, Tabs } from '@/components/ui';
import { useResumoApi } from './api/comum';
import { AbaChaves } from './api/Chaves';
import { AbaWebhooks } from './api/Webhooks';
import { AbaDocumentacao } from './api/Documentacao';
import { AbaRegistro } from './api/Registro';
import { AbaConectar } from './api/ConectarAgente';

type Aba = 'chaves' | 'agente' | 'webhooks' | 'endpoints' | 'registro';

export default function ApiIntegracoes() {
  const { data: resumo, isLoading } = useResumoApi();
  const [aba, setAba] = useState<Aba>('chaves');
  const [chaveDoRegistro, setChaveDoRegistro] = useState<number | null>(null);

  if (isLoading || !resumo) return <FormSkeleton />;

  return (
    <div className="pb-6">
      <PageHeader
        migalhas={[{ rotulo: 'Configurações', para: '/configuracoes' }, { rotulo: 'API e integrações' }]}
        titulo="API e integrações"
        descricao="Conecte outros sistemas e agentes de IA ao MEU BLING: você decide, por chave, o que cada um pode ler e gravar."
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard rotulo="Chaves ativas" valor={`${inteiro(resumo.ativas)} de ${inteiro(resumo.chaves)}`} icone={<KeyRound className="h-4 w-4" />} tom="azul" onClick={() => setAba('chaves')} />
        <StatCard rotulo="Chamadas em 24 h" valor={inteiro(resumo.chamadas24h)} icone={<Activity className="h-4 w-4" />} tom="verde" onClick={() => setAba('registro')} />
        <StatCard rotulo="Erros e negados (24 h)" valor={inteiro(resumo.erros24h)} icone={<AlertTriangle className="h-4 w-4" />} tom={resumo.erros24h ? 'amarelo' : 'neutro'} onClick={() => setAba('registro')} />
        <StatCard rotulo="Webhooks ligados" valor={inteiro(resumo.webhooks)} sub={resumo.entregasPendentes ? `${inteiro(resumo.entregasPendentes)} aviso(s) aguardando` : undefined} icone={<Webhook className="h-4 w-4" />} tom="neutro" onClick={() => setAba('webhooks')} />
      </div>
      <Tabs
        className="mb-4"
        ativa={aba}
        onMudar={(a) => setAba(a as Aba)}
        abas={[
          { id: 'chaves', rotulo: 'Chaves de acesso', contador: resumo.chaves || undefined },
          { id: 'agente', rotulo: 'Conectar agente de IA' },
          { id: 'webhooks', rotulo: 'Webhooks', contador: resumo.webhooks || undefined },
          { id: 'endpoints', rotulo: 'Endpoints' },
          { id: 'registro', rotulo: 'Registro de chamadas' },
        ]}
      />
      {aba === 'chaves' && <AbaChaves urlBase={resumo.urlBase} aoVerRegistro={(id) => { setChaveDoRegistro(id); setAba('registro'); }} />}
      {aba === 'agente' && <AbaConectar resumo={resumo} />}
      {aba === 'webhooks' && <AbaWebhooks />}
      {aba === 'endpoints' && <AbaDocumentacao urlBase={resumo.urlBase} />}
      {aba === 'registro' && <AbaRegistro key={chaveDoRegistro ?? 'todas'} chaveInicial={chaveDoRegistro} />}
    </div>
  );
}
