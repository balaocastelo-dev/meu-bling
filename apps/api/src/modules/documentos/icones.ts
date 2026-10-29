/** Ilustrações (SVG próprio, traço simples) dos certificados e das folhas. Cor via currentColor. */
import type { TipoCertificado } from './classificar.js';

const svg = (corpo: string, vb = '0 0 64 64') =>
  `<svg viewBox="${vb}" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${corpo}</svg>`;

export const ICONES: Record<TipoCertificado, string> = {
  PC: svg('<rect x="4" y="10" width="36" height="26" rx="2"/><path d="M16 44h12M22 36v8"/><rect x="46" y="8" width="14" height="40" rx="2"/><circle cx="53" cy="16" r="2"/><path d="M50 24h6M50 29h6"/>'),
  PC_GAMER: svg('<rect x="18" y="4" width="30" height="52" rx="3"/><circle cx="33" cy="20" r="6"/><circle cx="33" cy="38" r="6"/><path d="M27 20h12M33 14v12M27 38h12M33 32v12"/><path d="M8 50l6-6M6 40l8-4M56 50l-6-6M58 40l-8-4"/><path d="M22 56v4M44 56v4"/>'),
  NOTEBOOK: svg('<rect x="12" y="12" width="40" height="28" rx="2"/><path d="M4 48h56l-4-8H8z"/><path d="M28 44h8"/>'),
  IPHONE: svg('<rect x="18" y="4" width="28" height="56" rx="6"/><path d="M28 9h8"/><circle cx="32" cy="53" r="2"/><rect x="22" y="14" width="20" height="34" rx="1"/>'),
  GAMES: svg('<path d="M18 22h28c7 0 12 6 13 14l1 8c1 6-6 9-10 4l-5-6H19l-5 6c-4 5-11 2-10-4l1-8c1-8 6-14 13-14z"/><path d="M20 30v8M16 34h8"/><circle cx="43" cy="31" r="2"/><circle cx="48" cy="36" r="2"/>'),
};

export const ICONE_ESCUDO = svg('<path d="M32 4l22 8v16c0 14-9 26-22 32C19 54 10 42 10 28V12z"/><path d="M22 32l7 7 13-14"/>');
export const ICONE_X = svg('<circle cx="32" cy="32" r="26"/><path d="M22 22l20 20M42 22L22 42"/>');
export const ICONE_OK = svg('<circle cx="32" cy="32" r="26"/><path d="M20 33l8 8 16-17"/>');
export const ICONE_JANELA = svg('<rect x="6" y="10" width="52" height="44" rx="3"/><path d="M6 20h52M32 20v34M6 37h52"/>');
export const ICONE_ALERTA = svg('<path d="M32 6L60 56H4z"/><path d="M32 24v14M32 46v1"/>');

/** Selo redondo (roseta) com o prazo de garantia no meio */
export function selo(cor: string, cor2: string, linha1: string, linha2: string): string {
  const pontas = Array.from({ length: 24 }, (_, i) => {
    const a = (i / 24) * Math.PI * 2;
    const r = i % 2 ? 46 : 50;
    return `${(60 + r * Math.cos(a)).toFixed(1)},${(60 + r * Math.sin(a)).toFixed(1)}`;
  }).join(' ');
  return `<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
    <polygon points="${pontas}" fill="${cor}"/>
    <circle cx="60" cy="60" r="40" fill="#fff"/>
    <circle cx="60" cy="60" r="36" fill="none" stroke="${cor2}" stroke-width="1.5" stroke-dasharray="2 3"/>
    <text x="60" y="44" text-anchor="middle" font-family="Arial, sans-serif" font-size="7.5" font-weight="700" letter-spacing="1.6" fill="${cor2}">GARANTIA</text>
    <text x="60" y="72" text-anchor="middle" font-family="Georgia, serif" font-size="30" font-weight="700" fill="${cor}">${linha1}</text>
    <text x="60" y="85" text-anchor="middle" font-family="Arial, sans-serif" font-size="9" font-weight="700" letter-spacing="1" fill="${cor}">${linha2}</text>
  </svg>`;
}

/** Cantoneira ornamental da moldura */
export function cantoneira(cor: string): string {
  return `<svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="${cor}" stroke-width="1.6">
    <path d="M4 76V4h72"/><path d="M12 76V12h64"/>
    <path d="M4 4c14 0 22 8 22 22M4 4c0 14 8 22 22 22"/>
    <circle cx="26" cy="26" r="3" fill="${cor}"/>
    <path d="M20 40c6-2 10-6 12-12M40 20c-2 6-6 10-12 12"/>
  </svg>`;
}

/** ícones dos serviços do bloco institucional (mesma ordem de INSTITUCIONAL.servicos) */
export const ICONES_SERVICOS = [
  svg('<path d="M40 8a14 14 0 0 0-13 19L8 46l10 10 19-19a14 14 0 0 0 19-13l-8 8-8-2-2-8z"/>'),
  ICONES.PC_GAMER,
  ICONES.IPHONE,
  ICONES.GAMES,
  svg('<ellipse cx="32" cy="14" rx="20" ry="7"/><path d="M12 14v36c0 4 9 7 20 7s20-3 20-7V14"/><path d="M12 32c0 4 9 7 20 7s20-3 20-7"/>'),
  svg('<path d="M4 16h34v28H4zM38 26h12l8 10v8H38z"/><circle cx="16" cy="48" r="5"/><circle cx="48" cy="48" r="5"/>'),
];
