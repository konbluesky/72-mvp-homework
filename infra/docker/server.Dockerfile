FROM node:26.13.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/protocol/package.json packages/protocol/package.json
COPY packages/webgal-parser/package.json packages/webgal-parser/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci
COPY tsconfig.base.json ./
COPY scripts/compile-scenario.ts scripts/compile-scenario.ts
COPY packages/protocol packages/protocol
COPY apps/server apps/server
RUN npm run build:server

FROM node:26.13.0-bookworm-slim AS production-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/protocol/package.json packages/protocol/package.json
COPY packages/webgal-parser/package.json packages/webgal-parser/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --omit=dev --workspace=@mira/server --workspace=@mira/protocol --ignore-scripts && npm cache clean --force

FROM node:26.13.0-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 APP_MODE=mock
WORKDIR /app
COPY --from=production-deps /app/node_modules node_modules
COPY --from=production-deps /app/package.json package.json
COPY --from=build /app/packages/protocol/package.json packages/protocol/package.json
COPY --from=build /app/packages/protocol/dist packages/protocol/dist
COPY --from=build /app/apps/server/package.json apps/server/package.json
COPY --from=build /app/apps/server/dist apps/server/dist
COPY assets assets
RUN mkdir -p apps/server/data/media && chown -R node:node apps/server/data
USER node
EXPOSE 3000
HEALTHCHECK --interval=20s --timeout=3s CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","apps/server/dist/server.js"]
