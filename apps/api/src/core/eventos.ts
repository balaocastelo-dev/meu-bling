import { EventEmitter } from 'node:events';

/**
 * Barramento de eventos interno do sistema.
 * Usado para desacoplar módulos (ex.: mudança de situação → notificações).
 */
export interface EventosSistema {
  'situacao.alterada': {
    modulo: 'VENDA' | 'COMPRA' | 'OS';
    entidadeId: number;
    deSituacaoId: number | null;
    paraSituacaoId: number;
    notificarCliente: boolean;
    usuarioId: number | null;
  };
  'venda.criada': { vendaId: number; usuarioId: number | null };
  'compra.criada': { compraId: number; usuarioId: number | null };
  'os.criada': { osId: number; usuarioId: number | null };
  'os.orcamento': { osId: number; usuarioId: number | null };
  'nfe.autorizada': { notaId: number };
  'nfe.cancelada': { notaId: number };
  'conta.recebida': { contaReceberId: number };
  'conta.paga': { contaPagarId: number };
}

class Barramento extends EventEmitter {
  emitir<K extends keyof EventosSistema>(evento: K, dados: EventosSistema[K]) {
    setImmediate(() => {
      try {
        this.emit(evento, dados);
      } catch (e) {
        console.error(`[eventos] erro ao emitir ${evento}`, e);
      }
    });
  }
  ouvir<K extends keyof EventosSistema>(evento: K, fn: (dados: EventosSistema[K]) => void | Promise<void>) {
    this.on(evento, (d) => {
      Promise.resolve(fn(d)).catch((e) => console.error(`[eventos] erro no handler de ${evento}`, e));
    });
  }
}

export const eventos = new Barramento();
eventos.setMaxListeners(100);
