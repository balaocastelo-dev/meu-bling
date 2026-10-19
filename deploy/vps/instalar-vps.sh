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

msg "Pastas de dados em $DADOS"
mkdir -p "$DADOS/data" "$DADOS/storage"

msg "Construindo a imagem (base ${CAMINHO}/)"
docker build --build-arg "VITE_BASE_PATH=${CAMINHO}/" -t "$CONTAINER" "$CODIGO"

msg "Trocando o container"
if docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER"; then
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
   Backup diário sugerido (crontab -e):
     0 3 * * * tar czf /root/meu-bling-backup-\$(date +\\%F).tgz ${DADOS} ${ENV_FILE}
EOF
