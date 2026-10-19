# Colocar o MEU BLING online (acesso de qualquer lugar)

O sistema já tem login com perfis e a API bloqueia cada função por perfil. Para acessar pela internet com segurança é obrigatório **HTTPS** — as duas opções abaixo fazem isso automaticamente.

## Opção A — PC da loja + Cloudflare Tunnel (recomendada para começar)

Sem servidor para pagar, sem abrir portas no roteador, sem IP fixo. O PC da loja fica ligado rodando o sistema; a Cloudflare cria uma ponte HTTPS até ele. Funciona com o WhatsApp (QR Code) e com o certificado A1 ficando dentro da loja.

1. Instale e inicie o MEU BLING (`scripts\instalar.ps1`, atalho "MEU BLING").
2. Para ele subir sozinho quando o PC ligar (sem precisar entrar no Windows): PowerShell **como administrador** → `.\scripts\instalar-servico.ps1`.
3. **Teste agora** (URL temporária): `.\scripts\publicar-online.ps1 -Rapido` → aparece `https://xxxx.trycloudflare.com`.
4. **Permanente com seu domínio**: crie conta gratuita em cloudflare.com, adicione o domínio `balao.info` (a Cloudflare pede para trocar os nameservers no registrador), depois:
   `.\scripts\publicar-online.ps1 -Dominio erp.balao.info`
   O script instala o túnel como serviço do Windows e ajusta `APP_URL`.
5. (Opcional, mais segurança) No painel Cloudflare → Zero Trust → Access → Applications: proteja `erp.balao.info` exigindo e-mail autorizado antes mesmo da tela de login.

Limitação: se o PC da loja desligar ou a internet cair, o sistema fica fora do ar. Faça backup diário (`scripts\backup.ps1`).

## Opção C — A VPS que a loja já tem (Hostinger) em www.balao.info/sistema ← escolhida

A VPS `srv1963897.hstgr.cloud` (Hostinger KVM 2, Ubuntu 24.04, Docker + Caddy no host) já serve o CRM de WhatsApp. O ERP entra nela como mais um container (`meu-bling`, porta 127.0.0.1:3333) e o Caddy ganha a rota `/sistema/*`. No site (Vercel, repositório `balao2026`), um rewrite em `next.config.ts` repassa `www.balao.info/sistema` para a VPS — o endereço visível é sempre o do site.

1. No site: mesclar o ramo `meu-bling-sistema` do `balao2026` (rewrite `/sistema` → VPS). A Vercel publica sozinha.
2. No Windows, dentro da pasta do projeto (`C:\meu-bling`): `.\scripts\deploy-vps.ps1`. O PC da loja entra na VPS por chave SSH (`C:\Users\user\.ssh\id_ed25519`, já autorizada em `root@179.199.148.87`), então não pede senha. O script envia o código para `/opt/meu-bling` e roda `deploy/vps/instalar-vps.sh`, que: gera `/etc/meu-bling.env` com segredos aleatórios (só na primeira vez), constrói a imagem com base `/sistema/`, sobe o container com dados em `/var/lib/meu-bling`, adiciona `handle_path /sistema/*` no `/etc/caddy/Caddyfile` (com backup), recarrega o Caddy e agenda o backup diário.
3. Abrir https://www.balao.info/sistema → `admin@balao.info` / `admin123` → trocar a senha.
4. Atualizações futuras: `git pull` + `.\scripts\deploy-vps.ps1` de novo (banco e arquivos ficam em `/var/lib/meu-bling`, fora do container). Leva uns 5 minutos (build do Docker); o sistema fica fora do ar só nos segundos da troca do container.
5. Backup: `deploy/vps/backup.sh` roda todo dia às 03:00 pelo cron da VPS → `/root/backups/meu-bling/meu-bling-AAAA-MM-DD.tgz` (guarda 14 dias; log em `/var/log/meu-bling-backup.log`). Baixe uma cópia de vez em quando: `scp root@179.199.148.87:/root/backups/meu-bling/*.tgz D:\backups\`.

Guarde `/etc/meu-bling.env`: o `APP_SECRET` dele descriptografa o certificado A1, a senha SMTP e os tokens (está dentro do backup).

**Status: no ar desde 19/10/2026.** Primeiro deploy quebrou duas vezes — CRLF nos scripts (resolvido com `.gitattributes`) e `npm install` rodando `prisma generate` antes de o schema estar na imagem (resolvido no `Dockerfile`).

Comandos úteis na VPS: `docker logs -f meu-bling` · `docker restart meu-bling` · `curl 127.0.0.1:3333/api/v1/saude` · `bash /opt/meu-bling/deploy/vps/backup.sh`.

## Opção B — Servidor na nuvem (VPS) com Docker

Para disponibilidade 24h independente da loja. Um VPS pequeno (2 vCPU / 2 GB, ex.: Hetzner, Contabo, Oracle Cloud Free, DigitalOcean) é suficiente.

1. No VPS (Ubuntu): `curl -fsSL https://get.docker.com | sh`
2. `git clone https://github.com/balaocastelo-dev/meu-bling.git && cd meu-bling`
3. `cp .env.docker.example .env` e edite `DOMINIO`, `JWT_SECRET`, `APP_SECRET` (48 caracteres aleatórios cada).
4. Aponte o DNS `erp.balao.info` (registro A) para o IP do VPS.
5. `docker compose up -d --build` → o Caddy emite o certificado HTTPS sozinho.
6. Acesse `https://erp.balao.info`, entre com `admin@balao.info` / `admin123`, **troque a senha** e crie os usuários.
7. Backup: `docker run --rm -v meu-bling_meubling_data:/d -v $PWD:/b alpine tar czf /b/backup-$(date +%F).tgz /d` (e o mesmo para `meubling_storage`).

O WhatsApp é conectado lendo o QR Code na tela do sistema (Comunicação → WhatsApp), de qualquer lugar. O certificado A1 é enviado pela tela de Configurações → Fiscal e fica criptografado no banco do servidor.

## Perfis de acesso

| Perfil | Quem | O que pode |
|---|---|---|
| **ADMIN** | Thiago | Tudo: usuários, configurações, certificado, SMTP, Open Finance, Bling, situações, exclusões. |
| **GERENTE** | Gerente | Acesso administrativo do dia a dia: vendas, compras, OS, estoque, financeiro, fiscal (emitir/cancelar NF), relatórios, DRE, comissões, cadastros, WhatsApp, templates. Não cria usuários nem mexe em certificado/SMTP/Open Finance/Bling/situações. |
| **VENDEDOR** | Vendedores | Vendas, clientes, OS, consulta de produtos e estoque, NF-e da própria venda, mensagens ao cliente, suas comissões. Sem financeiro, compras, relatórios ou configurações. |
| **TECNICO** | Técnicos | Ordens de serviço, clientes, consulta de produtos/estoque, suas comissões. |
| **FINANCEIRO** | Financeiro | Contas, bancos, conciliação, compras, comissões, relatórios, DRE, notas; leitura do resto. |

Criação de usuários: Configurações → Usuários (somente ADMIN). Vincule cada vendedor ao seu cadastro de vendedor para a comissão padrão. Senhas com no mínimo 8 caracteres; o sistema avisa quando a senha padrão ainda está em uso.

## Checklist de segurança antes de abrir para a internet
- [x] HTTPS (túnel ou Caddy) — nunca exponha a porta 3333 direto.
- [x] Troque `admin123` e o e-mail do admin para o seu.
- [x] `JWT_SECRET`/`APP_SECRET` aleatórios (o instalador gera).
- [x] Arquivos sensíveis (sessão do WhatsApp, XMLs, DANFEs, anexos) só com sessão válida; logos públicos.
- [x] CORS restrito à própria origem em produção.
- [x] Limite de tentativas de login (20/min) e auditoria de ações.
- [ ] Backup diário (`scripts\backup.ps1` ou volumes do Docker).
