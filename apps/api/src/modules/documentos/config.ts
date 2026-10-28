/**
 * TEXTOS E VALORES DOS DOCUMENTOS DE VENDA (recibos, certificados, garantia, licenças).
 * Tudo que o Thiago pode querer mudar fica aqui, num lugar só.
 */

/** Garantia dos aparelhos com certificado (PC, PC Gamer, Notebook, iPhone, Games) — decisão do Thiago 28/10/2026 */
export const GARANTIA_NOVO_MESES = 12;
export const GARANTIA_SEMINOVO_MESES = 3;

/** Oferta de licenciamento que sai junto com PC, PC Gamer e Notebook */
export const OFERTA_LICENCA = {
  titulo: 'Windows 11 Pro + Office 2021 Professional',
  preco: 999,
  windows: 'Windows 11 Pro',
  office: 'Office 2021 Professional',
  /** apps do Office Professional 2021 */
  officeApps: ['Word', 'Excel', 'PowerPoint', 'Outlook', 'Publisher', 'Access'],
};

/** Quem somos (bloco institucional dos documentos) */
export const INSTITUCIONAL = {
  slogan: 'Comércio e assistência técnica em informática',
  servicos: [
    { titulo: 'Assistência técnica própria', texto: 'Laboratório na loja para notebooks, PCs, celulares, iPhone e videogames.' },
    { titulo: 'PC Gamer sob medida', texto: 'Montagem, upgrade, organização de cabos e testes de estabilidade.' },
    { titulo: 'Apple e celulares', texto: 'iPhone, iPad, MacBook e acessórios, novos e seminovos revisados.' },
    { titulo: 'Games', texto: 'Consoles, controles, jogos e acessórios.' },
    { titulo: 'Recuperação de dados', texto: 'HDs, SSDs, pendrives e cartões de memória.' },
    { titulo: 'Entrega rápida', texto: 'Entrega no mesmo dia em Campinas e região.' },
  ],
};

/** Cores por tipo de certificado */
export const TEMAS = {
  PC: { titulo: 'Computador', cor: '#1e3a8a', cor2: '#b8860b', fundo: '#f6f8fc' },
  PC_GAMER: { titulo: 'PC Gamer', cor: '#5b21b6', cor2: '#0891b2', fundo: '#f8f6fd' },
  NOTEBOOK: { titulo: 'Notebook', cor: '#0f4c81', cor2: '#64748b', fundo: '#f5f8fb' },
  IPHONE: { titulo: 'iPhone', cor: '#1f2937', cor2: '#9ca3af', fundo: '#f8f8f9' },
  GAMES: { titulo: 'Games', cor: '#047857', cor2: '#7c3aed', fundo: '#f4faf7' },
} as const;

export const COR_MARCA = '#e52421';
