import { construirApp } from './app.js';
import { env } from './lib/env.js';
import { iniciarServicos } from './core/servicos.js';
import { prepararBanco } from './lib/prisma.js';

async function main() {
  await prepararBanco();
  const app = await construirApp();
  await app.listen({ port: env.PORT, host: env.HOST });
  await iniciarServicos(app);
  app.log.info(`✅ MEU BLING API em http://localhost:${env.PORT}  (ambiente: ${env.NODE_ENV})`);

  const encerrar = async (sinal: string) => {
    app.log.info(`Recebido ${sinal}, encerrando...`);
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => encerrar('SIGINT'));
  process.on('SIGTERM', () => encerrar('SIGTERM'));
}

main().catch((e) => {
  console.error('Falha ao iniciar a API:', e);
  process.exit(1);
});
