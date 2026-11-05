#!/usr/bin/env bash
#
# MEU BLING na VPS do Balão (Hostinger KVM 2 · Ubuntu 24.04 · Docker + Caddy no host)
# Publica o ERP em  https://www.balao.info/sistema  (via rewrite da Vercel → Caddy desta VPS)
#
# Uso, como root na VPS (o código já deve estar em /opt/meu-bling — o scripts\deploy-vps.ps1 manda):
#   bash /opt/meu-bling/deploy/vps/instalar-vps.sh
#
# Rodar de novo depois de atualizar o código: reconstrói a imagem e troca o container.
# Banco e arquivos (XMLs, DANFEs, anexos, sessão do WhatsApp) ficam em /var/lib/meu-bling — não se perdem.

set -euo pipefail

CODIGO="${CODIGO:-/opt/meu-bling}"
DADOS="${DADOS:-/var/lib/meu-bling}"
ENV_FILE="${ENV_FILE:-/etc/meu-bling.env}"
CONTAINER="${CONTAINER:-meu-bling}"
PORTA="${PORTA:-3333}"
CAMINHO="${CAMINHO:-/sistema}"                       # subpasta pública
URL_PUBLICA="${URL_PUBLICA:-https://www.balao.info${CAMINHO}}"
CADDYFILE="${CADDYFILE:-/etc/caddy/Caddyfile}"
MEMORIA="${MEMORIA:-1500m}"

msg()  { printf '\n\033[1;32m==> %s\033[0m\n' "$1"; }
erro() { printf '\n\033[1;31m[ERRO] %s\033[0m\n' "$1" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || erro "Rode como root (sudo bash instalar-vps.sh)"
[ -f "$CODIGO/package.json" ] || erro "Código não encontrado em $CODIGO. Rode o scripts\\deploy-vps.ps1 no Windows (ou git clone) primeiro."

msg "Conferindo o Docker"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
fi
docker --version

msg "Segredos em $ENV_FILE"
if [ ! -f "$ENV_FILE" ]; then
  gerar() { tr -dc 'A-Za-z0-9' </dev/urandom | head -c 48; }
  cat > "$ENV_FILE" <<EOF
NODE_ENV=production
PORT=3333
HOST=0.0.0.0
DATABASE_URL=file:../data/meubling.db
STORAGE_DIR=./storage
APP_URL=${URL_PUBLICA}
BASE_PATH=${CAMINHO}
CORS_ORIGENS=https://www.balao.info,https://balao.info
JWT_SECRET=$(gerar)
APP_SECRET=$(gerar)
EOF
  chmod 600 "$ENV_FILE"
  echo "criado (JWT_SECRET/APP_SECRET aleatórios). GUARDE ESTE ARQUIVO: o APP_SECRET descriptografa certificado/SMTP/tokens."
else
  echo "já existia — mantido"
  grep -q '^APP_URL=' "$ENV_FILE" || echo "APP_URL=${URL_PUBLICA}" >> "$ENV_FILE"
  grep -q '^BASE_PATH=' "$ENV_FILE" || echo "BASE_PATH=${CAMINHO}" >> "$ENV_FILE"
fi
# chave da porta do site (PDV do www.balao.info -> /sistema). Criada uma vez; a mesma vai na Vercel como MEU_BLING_CHAVE.
if ! grep -q '^SITE_CHAVE_INTEGRACAO=' "$ENV_FILE"; then
  echo "SITE_CHAVE_INTEGRACAO=$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 48)" >> "$ENV_FILE"
  echo "chave do PDV do site criada (SITE_CHAVE_INTEGRACAO)"
fi

# ---- chat da equipe (29/10/2026): tempo real direto nesta VPS + TURN para as chamadas de voz/vídeo fora da loja
HOSTVPS="$(grep -m1 -oE '^[A-Za-z0-9.-]+\.[a-z]+ *\{' "$CADDYFILE" 2>/dev/null | sed 's/ *{//' || true)"
if [ -n "$HOSTVPS" ]; then
  # O WebSocket do chat não passa pelo rewrite da Vercel (www.balao.info/sistema): o navegador liga direto nesta VPS.
  grep -q '^CHAT_REALTIME_URL=' "$ENV_FILE" || { echo "CHAT_REALTIME_URL=https://${HOSTVPS}${CAMINHO}" >> "$ENV_FILE"; echo "CHAT_REALTIME_URL definido (https://${HOSTVPS}${CAMINHO})"; }
  grep -q '^TURN_HOST=' "$ENV_FILE" || { echo "TURN_HOST=${HOSTVPS}" >> "$ENV_FILE"; echo "TURN_HOST definido (${HOSTVPS})"; }
fi
grep -q '^TURN_PORT=' "$ENV_FILE" || echo "TURN_PORT=3478" >> "$ENV_FILE"
if ! grep -q '^TURN_SECRET=' "$ENV_FILE"; then
  echo "TURN_SECRET=$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 48)" >> "$ENV_FILE"
  echo "segredo do TURN criado (TURN_SECRET)"
fi
TURN_SECRET_ATUAL="$(grep -m1 '^TURN_SECRET=' "$ENV_FILE" | cut -d= -f2-)"
TURN_PORT_ATUAL="$(grep -m1 '^TURN_PORT=' "$ENV_FILE" | cut -d= -f2-)"

msg "Pastas de dados em $DADOS"
mkdir -p "$DADOS/data" "$DADOS/storage"

msg "Construindo a imagem (base ${CAMINHO}/)"
docker build --build-arg "VITE_BASE_PATH=${CAMINHO}/" -t "$CONTAINER" "$CODIGO"

msg "Cópia do banco antes de mexer (fica em $DADOS/antes-do-deploy)"
# Se o passo seguinte falhar, esta cópia é o caminho de volta mais curto.
mkdir -p "$DADOS/antes-do-deploy"
if [ -f "$DADOS/data/meubling.db" ]; then
  cp "$DADOS/data/meubling.db" "$DADOS/antes-do-deploy/meubling-$(date +%Y%m%d%H%M%S).db"
  # guarda as 5 últimas
  ls -1t "$DADOS/antes-do-deploy"/meubling-*.db 2>/dev/null | tail -n +6 | xargs -r rm -f
  echo "cópia feita"
fi

msg "Conferindo a mudança de banco ANTES de derrubar o sistema"
# Aplica as migrações (prisma migrate deploy, inclusive Usuario.telefone) numa CÓPIA do banco.
# Sem --accept-data-loss e sem migrate reset: se a mudança apagaria dados, o teste falha
# e o sistema que está no ar continua. Só troca o container se a cópia passar.
TEMP_DB="$(mktemp -d)"
cp -a "$DADOS/data/." "$TEMP_DB/" 2>/dev/null || true
if docker run --rm --env-file "$ENV_FILE" -v "$TEMP_DB:/app/apps/api/data" "$CONTAINER" \
     node prisma/aplicar-migracoes.mjs >/tmp/meu-bling-migracao.log 2>&1; then
  echo "o banco aceita a mudança"
  rm -rf "$TEMP_DB"
else
  rm -rf "$TEMP_DB"
  echo
  tail -25 /tmp/meu-bling-migracao.log
  echo
  erro "A mudança de banco não passou (detalhes acima). O sistema NÃO foi derrubado e continua no ar com a versão anterior.
   Resolva a pendência no banco (a cópia de segurança está em $DADOS/antes-do-deploy) e rode este instalador de novo."
fi

msg "Trocando o container"
# (docker inspect em vez de "docker ps | grep -q": com pipefail o grep -q pode quebrar o pipe e dar falso negativo)
if docker inspect "$CONTAINER" >/dev/null 2>&1; then
  docker stop -t 15 "$CONTAINER" >/dev/null 2>&1 || true
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
fi
docker run -d \
  --name "$CONTAINER" \
  --restart unless-stopped \
  -p "127.0.0.1:${PORTA}:3333" \
  --env-file "$ENV_FILE" \
  -v "$DADOS/data:/app/apps/api/data" \
  -v "$DADOS/storage:/app/apps/api/storage" \
  -e TZ=America/Sao_Paulo \
  --memory="$MEMORIA" \
  "$CONTAINER"

# Um QR Code só: o sistema precisa alcançar o servidor Evolution (que fica na rede do
# compose dele). Sem isso, Configurações → WhatsApp não consegue falar com o servidor.
REDE_EVOLUTION="${REDE_EVOLUTION:-balaoevo_default}"
if docker network inspect "$REDE_EVOLUTION" >/dev/null 2>&1; then
  if docker inspect "$CONTAINER" --format '{{json .NetworkSettings.Networks}}' | grep -q "$REDE_EVOLUTION"; then
    echo "já está na rede $REDE_EVOLUTION"
  else
    docker network connect "$REDE_EVOLUTION" "$CONTAINER" 2>/dev/null \
      && echo "ligado à rede $REDE_EVOLUTION (WhatsApp com um QR Code só)" \
      || echo "não consegui ligar à rede $REDE_EVOLUTION — configure o endereço do servidor pelo IP em Configurações → WhatsApp"
  fi
else
  echo "rede $REDE_EVOLUTION não existe nesta VPS — o WhatsApp segue com a sessão própria do sistema"
fi

msg "TURN (coturn) para as chamadas de voz/vídeo de fora da loja"
# Servidor de passagem do WebRTC: quando o navegador de alguém na rua/em casa não consegue falar direto com o outro,
# o áudio/vídeo passa por aqui. Credenciais temporárias (use-auth-secret) geradas pela API com o TURN_SECRET.
IP_PUBLICO="$(curl -fsS -m 5 https://api.ipify.org 2>/dev/null || curl -fsS -m 5 https://ifconfig.me 2>/dev/null || true)"
if docker inspect meu-bling-turn >/dev/null 2>&1; then
  docker rm -f meu-bling-turn >/dev/null 2>&1 || true
fi
docker run -d \
  --name meu-bling-turn \
  --restart unless-stopped \
  --network host \
  coturn/coturn:4 \
  -n --log-file=stdout --no-tls --fingerprint \
  --listening-port="${TURN_PORT_ATUAL}" \
  --min-port=49160 --max-port=49200 \
  --use-auth-secret --static-auth-secret="${TURN_SECRET_ATUAL}" \
  --realm=balao.info \
  --no-multicast-peers --stale-nonce=600 \
  ${IP_PUBLICO:+--external-ip="$IP_PUBLICO"} >/dev/null && echo "coturn no ar na porta ${TURN_PORT_ATUAL} (udp/tcp) + 49160-49200/udp${IP_PUBLICO:+, IP ${IP_PUBLICO}}"
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q '^Status: active'; then
  ufw allow "${TURN_PORT_ATUAL}/udp" >/dev/null 2>&1 || true
  ufw allow "${TURN_PORT_ATUAL}/tcp" >/dev/null 2>&1 || true
  ufw allow 49160:49200/udp >/dev/null 2>&1 || true
  echo "ufw liberado para o TURN"
fi
echo "Se a Hostinger (hPanel → Firewall) estiver filtrando, libere ${TURN_PORT_ATUAL} udp/tcp e 49160-49200 udp."

msg "Esperando a API responder"
ok=0
for _ in $(seq 1 40); do
  if curl -sf -m 2 "http://127.0.0.1:${PORTA}/api/v1/saude" >/dev/null 2>&1; then ok=1; break; fi
  sleep 3
done
[ "$ok" -eq 1 ] || { docker logs --tail 40 "$CONTAINER"; erro "A API não respondeu. Veja os logs acima."; }
curl -s "http://127.0.0.1:${PORTA}/api/v1/saude"; echo

msg "Rota ${CAMINHO} no Caddy ($CADDYFILE)"
if [ ! -f "$CADDYFILE" ]; then
  erro "Caddyfile não encontrado. Se o HTTPS desta VPS é feito de outro jeito (Nginx/túnel), adicione manualmente: ${CAMINHO}/* -> http://127.0.0.1:${PORTA} (removendo o prefixo)."
fi
if grep -q "handle_path ${CAMINHO}/\*" "$CADDYFILE"; then
  echo "rota já existia — mantida"
else
  BAK="$CADDYFILE.bak-$(date +%Y%m%d%H%M%S)"
  cp "$CADDYFILE" "$BAK"
  # insere logo depois da primeira linha que abre um bloco de site ("dominio {")
  awk -v caminho="$CAMINHO" -v porta="$PORTA" '
    BEGIN { feito = 0 }
    {
      print
      if (!feito && $0 ~ /\{[[:space:]]*$/ && $0 !~ /^[[:space:]]*(handle|handle_path|route|@)/) {
        print "\t# MEU BLING (ERP): www.balao.info" caminho " chega aqui pela Vercel"
        print "\thandle_path " caminho "/* {"
        print "\t\treverse_proxy 127.0.0.1:" porta
        print "\t}"
        print "\thandle " caminho " {"
        print "\t\trewrite * /"
        print "\t\treverse_proxy 127.0.0.1:" porta
        print "\t}"
        feito = 1
      }
    }' "$BAK" > "$CADDYFILE.novo"
  if caddy validate --config "$CADDYFILE.novo" --adapter caddyfile >/dev/null 2>&1; then
    mv "$CADDYFILE.novo" "$CADDYFILE"
    systemctl reload caddy
    echo "rota adicionada e Caddy recarregado"
  else
    rm -f "$CADDYFILE.novo"
    erro "Caddyfile gerado inválido — nada foi alterado. Adicione manualmente dentro do bloco do site:\n\thandle_path ${CAMINHO}/* { reverse_proxy 127.0.0.1:${PORTA} }"
  fi
fi

msg "Backup diário (cron 03:00 → /root/backups/meu-bling, guarda 14 dias)"
chmod +x "$CODIGO/deploy/vps/backup.sh"
LINHA_CRON="0 3 * * * bash $CODIGO/deploy/vps/backup.sh >> /var/log/meu-bling-backup.log 2>&1"
# mantém as outras linhas do cron; "|| true" porque o grep -v sem linhas sobrando sai com 1 (e o set -e mataria o script)
{ crontab -l 2>/dev/null | grep -v 'meu-bling' || true; echo "$LINHA_CRON"; } | crontab -
echo "agendado: $LINHA_CRON"

HOSTVPS="$(grep -m1 -oE '^[A-Za-z0-9.-]+\.[a-z]+ *\{' "$CADDYFILE" | sed 's/ *{//' || true)"
msg "Testando pela VPS"
if [ -n "$HOSTVPS" ]; then
  curl -s -o /dev/null -w "https://${HOSTVPS}${CAMINHO}/api/v1/saude → HTTP %{http_code}\n" "https://${HOSTVPS}${CAMINHO}/api/v1/saude" || true
fi

cat <<EOF

✅ MEU BLING no ar nesta VPS em 127.0.0.1:${PORTA} (rota ${CAMINHO}/ no Caddy).
   Site: ${URL_PUBLICA}   (depende do rewrite /sistema no repositório balao2026, já publicado na Vercel)
   Login inicial: admin@balao.info / admin123 — troque na primeira entrada.
   Dados: ${DADOS}   Segredos: ${ENV_FILE}   Logs: docker logs -f ${CONTAINER}
   Backup: todo dia às 03:00 em /root/backups/meu-bling (log em /var/log/meu-bling-backup.log)
   PDV do site: chave SITE_CHAVE_INTEGRACAO em ${ENV_FILE} (a mesma vai na Vercel como MEU_BLING_CHAVE).
   Chat da equipe: tempo real em CHAT_REALTIME_URL, TURN (coturn) no container meu-bling-turn, porta ${TURN_PORT_ATUAL}.
EOF
