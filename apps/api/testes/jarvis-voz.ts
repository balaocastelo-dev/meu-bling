/**
 * VOZ DO JARVIS — tempo até ele começar a falar (29/10/2026)
 *
 * O que estava lento: o JARVIS só abria a boca depois de a resposta INTEIRA ser
 * gerada pela IA e o áudio INTEIRO ser sintetizado. Agora a resposta por voz vem
 * curta e a fala é dividida em frases, tocando a primeira enquanto as outras
 * ainda estão sendo geradas.
 *
 * Aqui mede-se o que dá para medir sem o PC-servidor da loja: a quebra em frases
 * (que define o tamanho do primeiro pedaço) e o comportamento da rota de voz.
 *   npx tsx testes/jarvis-voz.ts http://localhost:3333
 */
import { encerrar, entrar, igual, secao, verifica } from './lib.js';
import { emFrases } from '../../web/src/lib/frases.js';

const RESPOSTA_LONGA =
  'O caixa livre hoje está em quarenta mil reais. Isso é oito por cento da meta do milhão. ' +
  'Você tem três contas vencendo esta semana, somando doze mil. ' +
  'A caixinha do décimo terceiro está atrasada em dois dias. ' +
  'Minha sugestão é segurar a compra do fornecedor até sexta e priorizar a caixinha.';

async function main() {
  const base = process.argv[2] || 'http://localhost:3333';

  secao('Quebra em frases: define quanto o chefe espera antes de ouvir a 1ª palavra');
  const partes = emFrases(RESPOSTA_LONGA);
  verifica(partes.length > 1, 'texto longo vira vários pedaços', partes.length);
  // o ganho real: o 1º pedaço é bem menor que o texto todo
  verifica(partes[0].length < RESPOSTA_LONGA.length / 2, 'o primeiro pedaço é bem menor que o texto todo', { primeiro: partes[0].length, total: RESPOSTA_LONGA.length });
  verifica(partes.join(' ').replace(/\s+/g, ' ') === RESPOSTA_LONGA.replace(/\s+/g, ' '), 'nada se perde na quebra');

  secao('Pedaços curtos demais são grudados (cada ida ao servidor tem custo fixo)');
  const curtas = emFrases('Claro. Sim. Pode ser. Vou verificar isso agora e te aviso em seguida.');
  verifica(curtas.every((p) => p.length >= 20 || curtas.length === 1), 'não sobra pedaço de duas palavras', curtas);
  verifica(emFrases('').length === 0, 'texto vazio não vira pedaço nenhum');
  verifica(igual(emFrases('Uma frase só.').length, 1), 'frase única continua única');

  secao('Perguntas e respostas');
  const adm = await entrar('admin@balao.info', 'admin123');
  adm.nome = 'ADMIN';

  // a rota aceita o modo voz: é ele que faz a IA responder curto
  const porVoz: any = await adm.post('/jarvis/perguntar', { pergunta: 'Como está o caixa?', porVoz: true }, [200, 503]);
  verifica(!!porVoz, 'a rota aceita porVoz sem reclamar', typeof porVoz);
  const semVoz: any = await adm.post('/jarvis/perguntar', { pergunta: 'Como está o caixa?' }, [200, 503]);
  verifica(!!semVoz, 'e continua funcionando sem o campo (compatível com o que já existia)');
  await adm.post('/jarvis/perguntar', { pergunta: 'oi', porVoz: 'talvez' }, 400);

  secao('Rota de voz: sem o PC-servidor, avisa em vez de travar');
  const t0 = Date.now();
  const r = await fetch(`${base}/api/v1/jarvis/voz`, {
    method: 'POST',
    headers: { "content-type": "application/json", authorization: `Bearer ${adm.token}` },
    body: JSON.stringify({ texto: 'Teste de voz do JARVIS.' }),
  });
  const ms = Date.now() - t0;
  verifica([200, 503].includes(r.status), 'responde 200 com áudio ou 503 quando o PC está fora', r.status);
  if (r.status === 503) {
    verifica(ms < 9_000, 'quando o PC não responde, desiste em segundos (não em 20s)', `${ms}ms`);

    // e a SEGUNDA frase não pode pagar o mesmo preço: numa ligação são várias
    // seguidas, e esperar de novo é o que fazia o JARVIS parecer travado
    const t1 = Date.now();
    const r2 = await fetch(`${base}/api/v1/jarvis/voz`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${adm.token}` },
      body: JSON.stringify({ texto: 'Segunda frase, logo depois da primeira ter falhado.' }),
    });
    const ms2 = Date.now() - t1;
    verifica(r2.status === 503 && ms2 < 1_000, 'a frase seguinte desiste na hora (memória de falha)', `${ms2}ms`);
  }

  secao('Estado da voz');
  const estado: any = await adm.get('/jarvis/voz/estado');
  verifica(typeof estado.disponivel === 'boolean', 'diz se a voz clonada está no ar', estado);

  encerrar('Voz do JARVIS');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
