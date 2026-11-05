import type { FastifyInstance } from 'fastify';
import { comContexto } from '../modules/auditoria/contexto.js';

/**
 * Serviços de segundo plano (workers) iniciados após o servidor subir.
 * Cada integração registra seu inicializador com `registrarServico`.
 * Ex.: fila de notificações (e-mail/WhatsApp), sincronização Open Finance,
 * consulta de retorno de NF-e, lembretes de contas a vencer.
 */
type Inicializador = (app: FastifyInstance) => Promise<void> | void;
const servicos: { nome: string; iniciar: Inicializador }[] = [];

export function registrarServico(nome: string, iniciar: Inicializador) {
  servicos.push({ nome, iniciar });
}

export async function iniciarServicos(app: FastifyInstance) {
  for (const s of servicos) {
    try {
      // tudo o que o serviço (e os timers que ele cria) gravar fica na trilha de auditoria com o nome dele
      await comContexto({ origem: 'SERVICO', servico: s.nome }, () => Promise.resolve(s.iniciar(app)));
      app.log.info(`[serviço] ${s.nome} iniciado`);
    } catch (e) {
      app.log.error({ e }, `[serviço] falha ao iniciar ${s.nome}`);
    }
  }
}
