# MEU BLING — imagem única (API + frontend compilado)
# Build:  docker build -t meu-bling .
# Run:    docker compose up -d   (ver docker-compose.yml)
FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm install --no-audit --no-fund

FROM base AS build
# Caminho base do frontend: "/" (raiz) ou "/sistema/" (www.balao.info/sistema)
ARG VITE_BASE_PATH=/
ENV VITE_BASE_PATH=$VITE_BASE_PATH
COPY . .
RUN cd apps/api && npx prisma generate && cd ../web && npm run build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app /app
RUN mkdir -p /app/apps/api/data /app/apps/api/storage
VOLUME ["/app/apps/api/data", "/app/apps/api/storage"]
EXPOSE 3333
WORKDIR /app/apps/api
# cria/atualiza o banco e roda o seed base (idempotente) antes de subir
CMD ["sh", "-c", "npx prisma db push --skip-generate && npx tsx prisma/seed.ts && npx tsx src/server.ts"]
