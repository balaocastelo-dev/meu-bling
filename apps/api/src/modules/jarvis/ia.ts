/**
 * JARVIS — a IA que escreve as instruções em português.
 *
 * Usa a API da Anthropic (chave digitada pelo ADMIN em Configurações → JARVIS, guardada
 * criptografada no banco). Sem chave configurada o JARVIS continua funcionando: cada regra
 * já traz o seu próprio texto padrão — só fica menos "JARVIS".
 *
 * Sem dependência nova: chamada direta por `fetch` (regra 12 do docs/DEV.md).
 */
import { prisma } from '../../lib/prisma.js';
import { decrypt } from '../../lib/crypto.js';

const URL_API = 'https://api.anthropic.com/v1/messages';
const VERSAO = '2023-06-01';

export type RespostaIa = { texto: string; tokens: number } | null;

async function configIa() {
  const cfg = await prisma.jarvisConfig.findUnique({ where: { id: 1 } });
  const chave = decrypt(cfg?.chaveAnthropic);
  return { chave, modelo: cfg?.modeloIa || 'claude-fable-5-1' };
}

/** true quando há chave configurada (a tela mostra "IA ligada"). */
export async function iaDisponivel(): Promise<boolean> {
  const { chave } = await configIa();
  return !!chave;
}

/**
 * Pergunta à IA. Devolve null (sem quebrar nada) se não há chave ou se a API falhou —
 * quem chama sempre tem um texto padrão de reserva.
 */
export async function perguntarIa(
  sistema: string,
  pergunta: string,
  opcoes: { maxTokens?: number; timeoutMs?: number } = {},
): Promise<RespostaIa> {
  const { chave, modelo } = await configIa();
  if (!chave) return null;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opcoes.timeoutMs ?? 60_000);
  try {
    const r = await fetch(URL_API, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': chave, 'anthropic-version': VERSAO },
      body: JSON.stringify({
        model: modelo,
        max_tokens: opcoes.maxTokens ?? 2000,
        system: sistema,
        messages: [{ role: 'user', content: pergunta }],
      }),
    });
    if (!r.ok) {
      const erro = await r.text().catch(() => '');
      await marcarErro(`IA ${r.status}: ${erro.slice(0, 300)}`);
      return null;
    }
    const j: any = await r.json();
    const texto = (j?.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n').trim();
    const tokens = (j?.usage?.input_tokens || 0) + (j?.usage?.output_tokens || 0);
    if (texto) await marcarErro(null);
    return texto ? { texto, tokens } : null;
  } catch (e: any) {
    await marcarErro(`IA indisponível: ${String(e?.message || e).slice(0, 200)}`);
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function marcarErro(erro: string | null) {
  await prisma.jarvisConfig.update({ where: { id: 1 }, data: { ultimoErro: erro } }).catch(() => {});
}

/** Testa a chave na tela de configuração: devolve { ok, mensagem }. */
export async function testarChave(chave: string, modelo: string) {
  try {
    const r = await fetch(URL_API, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': chave, 'anthropic-version': VERSAO },
      body: JSON.stringify({ model: modelo, max_tokens: 16, messages: [{ role: 'user', content: 'Responda apenas: ok' }] }),
    });
    if (r.ok) return { ok: true, mensagem: `Chave válida e modelo ${modelo} respondendo.` };
    const txt = await r.text().catch(() => '');
    if (r.status === 401) return { ok: false, mensagem: 'Chave recusada pela Anthropic (401). Confira se copiou a chave inteira.' };
    if (r.status === 404) return { ok: false, mensagem: `O modelo "${modelo}" não existe nessa conta. Escolha outro na lista.` };
    if (r.status === 429) return { ok: false, mensagem: 'Limite de uso atingido na Anthropic (429). Tente de novo mais tarde.' };
    return { ok: false, mensagem: `A Anthropic respondeu ${r.status}. ${txt.slice(0, 200)}` };
  } catch (e: any) {
    return { ok: false, mensagem: `Não consegui falar com a Anthropic: ${String(e?.message || e).slice(0, 200)}` };
  }
}

export const SISTEMA_SUGESTOES = `Você é o JARVIS, o agente do dono do Balão da Informática (loja de informática em Campinas-SP).
O objetivo dele é ter R$ 1.000.000,00 livres no caixa da loja.
Você recebe números reais do sistema e reescreve cada sugestão como uma INSTRUÇÃO curta, direta e em português do Brasil.
Regras: no máximo 2 frases por sugestão; sempre citar o número (R$, dias, quantidade); dizer o que fazer, não o que aconteceu;
nada de saudação, nada de "eu sugiro", nada de emoji. Fale como um sócio prático falaria com o dono.
Responda SOMENTE com um JSON no formato [{"chave":"...","titulo":"...","texto":"..."}] — sem comentários e sem texto fora do JSON.`;

export const SISTEMA_PERGUNTA = `Você é o JARVIS, agente do dono do Balão da Informática (loja de informática em Campinas-SP).
Meta: R$ 1.000.000,00 livres no caixa. Você recebe os números reais da loja (caixa livre, contas, estoque, sugestões abertas).
Responda em português do Brasil, em no máximo 6 linhas, sempre citando os números que recebeu, e termine com no máximo 3 ações práticas.
Você sugere e calcula; quem decide onde colocar o dinheiro é o dono. Nunca invente números que não estão no contexto:
se faltar um dado, diga qual falta.`;
