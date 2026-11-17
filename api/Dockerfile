# Imagem do scheduling-service. Build a partir da raiz do repositório:
#   docker build -f api/Dockerfile -t scheduling-service:$(git rev-parse HEAD) .

# ---------- Estágio 1: build (com dependências de desenvolvimento) ----------
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY core/package.json core/
COPY api/package.json api/
# Instala tudo (inclusive as devDependencies da raiz: TypeScript, Jest).
RUN npm ci --no-audit --no-fund
COPY core/ core/
COPY api/ api/
RUN npm run build -w core && npm run build -w api

# ---------- Estágio 2: runtime (só dependências de produção) ----------
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
# Aplica correções de segurança dos pacotes do Alpine publicadas depois da imagem base.
RUN apk upgrade --no-cache
WORKDIR /app
COPY package.json package-lock.json ./
COPY core/package.json core/
COPY api/package.json api/
# Instala só as dependências de produção e remove o npm/yarn da imagem final
# (não são usados em runtime e reduzem a superfície de ataque).
RUN npm ci --omit=dev --workspace api --no-audit --no-fund \
 && npm cache clean --force \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn-* /usr/local/bin/yarn /usr/local/bin/yarnpkg
COPY --from=build /app/core/dist core/dist
COPY --from=build /app/api/dist api/dist

# Usuário não-root (já existe na imagem oficial do Node).
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1
CMD ["node", "api/dist/server.js"]
