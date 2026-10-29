# MEU BLING — ERP do Balão da Informática

Sistema completo que substitui o Bling: **vendas, compras e ordens de serviço com situações configuráveis**, **NF-e / NFC-e com certificado A1 direto na SEFAZ**, **financeiro com contas a receber/pagar, bancos ao vivo (Open Finance) e conciliação**, **vendedores, técnicos e comissões**, **controle de peças da assistência**, **histórico do cliente**, **dashboards** (Meu Dashboard por perfil: vendedor, técnico, gerente e gestor — ver `docs/MEU-DASHBOARD.md`), **DRE**, **e-mail (SMTP)**, **WhatsApp automático via QR Code** a cada mudança de situação e **chat da equipe** (conversas, salas de reunião privadas, áudio gravado, chamadas de voz e vídeo pelo navegador, aviso no celular — ver `docs/CHAT.md`).

## Instalação (Windows)

1. Copie a pasta `meu-bling` para o PC servidor da loja (ex.: `C:\meu-bling`).
2. Clique com o botão direito em `scripts\instalar.ps1` → **Executar com o PowerShell**
   (ou `powershell -ExecutionPolicy Bypass -File .\scripts\instalar.ps1 -Demo` para já vir com dados de exemplo).
3. Use o atalho **MEU BLING** criado na Área de Trabalho. Acesse `http://localhost:3333`.
4. Login inicial: `admin@balao.info` / `admin123` — troque a senha em Configurações → Usuários.

Outros computadores da loja acessam por `http://<IP-do-servidor>:3333` (a janela do servidor mostra o IP).

### Linux/Mac (desenvolvimento)
```bash
npm install
cp apps/api/.env.example apps/api/.env   # edite JWT_SECRET e APP_SECRET
npm run db:push && npm run db:seed -- --demo
npm run dev        # API :3333 + frontend :5173
```

## Primeiros passos após instalar

| Passo | Onde |
|---|---|
| Dados da empresa, logo | Configurações → Empresa |
| Certificado A1 (.pfx + senha), série/numeração, ambiente (homologação → produção), CSC da NFC-e | Configurações → Fiscal |
| Conectar WhatsApp (ler QR Code com o celular da loja) | Comunicação → WhatsApp |
| SMTP (Gmail: senha de app) | Configurações → SMTP |
| Open Finance (Client ID/Secret da Pluggy — gratuito via Meu Pluggy, ver `docs/OPEN-FINANCE.md`) ou importação OFX | Configurações → Open Finance / Financeiro → Bancos |
| Trazer os dados do Bling (contatos, produtos, estoque, vendas, contas, notas) | Configurações → Migração do Bling |
| Ajustar situações, transições e ações | Configurações → Situações |
| Mensagens automáticas por situação | Comunicação → Templates |
| Usuários, vendedores e técnicos | Configurações |

## Estrutura

```
apps/api   Fastify + Prisma (SQLite) — API REST /api/v1 (contrato em docs/API.md)
  src/core/situacoes.ts     motor de situações (igual aos módulos de situação do Bling)
  src/modules/*             vendas, compras, ordens-servico, contatos, produtos/estoque, financeiro, bancos,
                            comissoes, notificacoes, dashboard, relatorios (DRE), situacoes, cadastros, empresa, auth,
                            chat (equipe: WebSocket/long polling, salas, áudio, WebRTC, Web Push)
  src/integracoes/fiscal    NF-e/NFC-e 4.00: XML, assinatura A1, SEFAZ (autorização, consulta, cancelamento, CC-e, inutilização), DANFE
  src/integracoes/whatsapp  sessão WhatsApp via QR Code (Baileys) + fila de mensagens
  src/integracoes/email     SMTP (nodemailer)
  src/integracoes/openfinance  Pluggy (saldo ao vivo + transações) / mock
  src/integracoes/bling     importador (OAuth + API v3 + CSV)
apps/web   React + Vite + Tailwind — interface
scripts/   instalar.ps1, iniciar.ps1, backup.ps1
docs/      ANALISE-BLING.md (análise do Bling), API.md (contrato), DEV.md (guia do código), OPEN-FINANCE.md (Pluggy), CHAT.md (chat da equipe), ROADMAP.md
```

## Acesso pela internet e perfis
Veja `docs/ONLINE.md`: Opção A (PC da loja + Cloudflare Tunnel, `scripts\publicar-online.ps1`) ou Opção B (VPS com `docker compose up -d`). Perfis: **ADMIN** (dono, acesso completo), **GERENTE** (administrativo, sem usuários/segredos), **VENDEDOR**, **TECNICO**, **FINANCEIRO** — criados em Configurações → Usuários pelo ADMIN. A API bloqueia cada função por perfil (`apps/api/src/plugins/politicas.ts`); teste: `npx tsx scripts/teste-perfis.ts`.

## Backup
Atalho **MEU BLING - Backup** (ou `scripts\backup.ps1`) gera um .zip do banco + XMLs/anexos na Área de Trabalho. Agende diariamente no Agendador de Tarefas. Para PostgreSQL, troque `provider` em `apps/api/prisma/schema.prisma` e `DATABASE_URL`.

## Segurança
- Segredos (senha do certificado, SMTP, tokens) ficam criptografados (AES-256-GCM) no banco com `APP_SECRET`.
- Nunca exponha a porta 3333 diretamente na internet; use VPN/Tailscale ou um proxy com HTTPS.
- Perfis: ADMIN, GERENTE, VENDEDOR, TECNICO, FINANCEIRO. Todas as mutações são auditadas.
