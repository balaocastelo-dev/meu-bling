/**
 * Nomes de arquivo dos PDFs e títulos de impressão.
 *   npx tsx testes/nome-arquivo.ts
 */
import fs from 'node:fs';
import { nomeArquivoDanfe, nomeArquivoDocumento, tituloDocumento, trechoNome } from '../src/modules/comum/nome-arquivo.js';

let falhas = 0;

function verifica(cond: unknown, msg: string, veio?: unknown) {
  if (cond) {
    console.log('  ✔ ' + msg);
    return;
  }
  falhas++;
  const extra = veio === undefined ? '' : ` — veio: ${typeof veio === 'string' ? veio : JSON.stringify(veio)}`;
  console.log('  ✖ ' + msg + extra);
}

const seguro = (nome: string) => /^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(nome) && !nome.includes('--') && !nome.includes('-.') && nome.length <= 80;

verifica(trechoNome('José da Silva') === 'Jose-da-Silva', 'acento some e vira hífen');
verifica(trechoNome('Conceição') === 'Conceicao', 'ç vira c');
verifica(trechoNome('  Kairo   Costa  ') === 'Kairo-Costa', 'espaços viram um hífen só');
verifica(trechoNome('Kairo "Costa"') === 'Kairo-Costa', 'aspas não entram no arquivo');
verifica(trechoNome('') === '' && trechoNome(null) === '' && trechoNome('   ') === '', 'nome vazio não gera trecho');
verifica(trechoNome('😀🎉') === '' && trechoNome('😀 Ana Souza') === 'Ana-Souza', 'emoji sozinho some; o resto do nome fica');
verifica(trechoNome('Ana-Maria', 4) === 'Ana', 'corte não deixa hífen no fim', trechoNome('Ana-Maria', 4));
verifica(trechoNome('A'.repeat(80)).length === 40, 'trecho do nome para em 40 caracteres', trechoNome('A'.repeat(80)).length);

verifica(nomeArquivoDocumento({ tipo: 'Pedido', numero: 25070, nomePessoa: 'Kairo Costa' }) === 'Pedido-25070-Kairo-Costa.pdf', 'pedido com cliente');
verifica(nomeArquivoDocumento({ tipo: 'Orcamento', numero: 12, nomePessoa: 'José da Silva' }) === 'Orcamento-12-Jose-da-Silva.pdf', 'orçamento sem acento');
verifica(nomeArquivoDocumento({ tipo: 'OS', numero: 1234, nomePessoa: 'Maria Souza' }) === 'OS-1234-Maria-Souza.pdf', 'OS via do cliente');
verifica(nomeArquivoDocumento({ tipo: 'OS', numero: 1234, nomePessoa: 'Maria Souza', sufixo: 'tecnico' }) === 'OS-1234-Maria-Souza-tecnico.pdf', 'OS via do técnico');
verifica(nomeArquivoDocumento({ tipo: 'OS', numero: 1234, nomePessoa: 'Maria Souza', sufixo: 'etiqueta' }) === 'OS-1234-Maria-Souza-etiqueta.pdf', 'etiqueta da OS');
verifica(nomeArquivoDocumento({ tipo: 'Pedido', numero: 25070, nomePessoa: '!!!' }) === 'Pedido-25070.pdf', 'sem cliente utilizável não termina em hífen');
verifica(nomeArquivoDocumento({ tipo: 'Pedido', numero: 25070 }) === 'Pedido-25070.pdf', 'cliente ausente');
verifica(nomeArquivoDocumento({ tipo: 'Recibo-80mm', numero: 25070, nomePessoa: 'Kairo Costa' }) === 'Recibo-80mm-25070-Kairo-Costa.pdf', 'recibo 80mm');
verifica(
  nomeArquivoDocumento({ tipo: 'Carne', numero: 9, extras: ['Pedido', 25070], nomePessoa: 'Kairo Costa', sufixo: '2via' }) === 'Carne-9-Pedido-25070-Kairo-Costa-2via.pdf',
  'carnê da venda, 2ª via',
);

verifica(
  nomeArquivoDanfe({ numero: 441, modelo: 55, venda: { numero: 25070 }, contato: { nome: 'Kairo Costa' } }) === 'NF-441-Pedido-25070-Kairo-Costa.pdf',
  'DANFE da venda',
);
verifica(nomeArquivoDanfe({ numero: 441, modelo: 55, os: { numero: 1234 }, contato: { nome: 'Maria Souza' } }) === 'NF-441-OS-1234-Maria-Souza.pdf', 'DANFE da OS');
verifica(nomeArquivoDanfe({ numero: 441, modelo: 65, venda: { numero: 25070 }, contato: { nome: 'Kairo Costa' } }) === 'NFCe-441-Pedido-25070-Kairo-Costa.pdf', 'DANFE NFC-e');
verifica(nomeArquivoDanfe({ numero: 441, modelo: 55, contato: { nome: 'Kairo Costa' } }) === 'NF-441-Kairo-Costa.pdf', 'DANFE sem venda e sem OS');
verifica(!nomeArquivoDanfe({ numero: 10, modelo: 55, contato: { nome: 'Ana' } }).startsWith('DANFE-'), 'DANFE não usa mais o prefixo antigo');

const longo = nomeArquivoDocumento({
  tipo: 'Pedido',
  numero: 25070,
  extras: ['Pedido', '123456789012345678901234567890'],
  nomePessoa: 'José da Conceição ' + 'Silva '.repeat(30),
});
verifica(seguro(longo) && longo.startsWith('Pedido-25070-') && longo.endsWith('.pdf'), 'nome longo continua ASCII, com tipo e número', longo);
verifica(longo.length <= 80, 'arquivo inteiro tem no máximo 80 caracteres', longo.length);

const titulo = tituloDocumento({ tipo: 'Pedido', numero: 25070, nomePessoa: 'Kairo Costa' });
verifica(titulo === 'Pedido-25070-Kairo-Costa', 'título da impressão é o basename sem .pdf', titulo);
verifica(tituloDocumento({ tipo: 'Orcamento', numero: 12, nomePessoa: 'José da Silva' }) === 'Orcamento-12-Jose-da-Silva', 'título do orçamento');

const api = fs.readFileSync(new URL('../src/modules/comum/nome-arquivo.ts', import.meta.url), 'utf8');
const web = fs.readFileSync(new URL('../../web/src/lib/nome-arquivo.ts', import.meta.url), 'utf8');
const corpo = (s: string) => s.replace(/^\/\*[\s\S]*?\*\/\s*/, '').trim();
verifica(corpo(api) === corpo(web), 'helper do front e do back são a mesma implementação');

if (falhas) {
  console.log(`\n${falhas} falha(s)`);
  process.exit(1);
}
console.log('\nNomes de arquivo ok');
