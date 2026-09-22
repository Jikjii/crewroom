# Node 24 supplies node:sqlite; the lockfile pins JavaScript dependencies.
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# Only PUBLIC client configuration belongs in build arguments. Never put mail/API secrets here.
ARG EXPO_PUBLIC_API_URL
ARG EXPO_PUBLIC_WEB_URL
ENV EXPO_NO_TELEMETRY=1 EXPO_NO_CACHE=1 CI=1
RUN node --input-type=module -e 'import { publicHttpsOrigin } from "./server/runtime.mjs"; publicHttpsOrigin(process.env.EXPO_PUBLIC_API_URL,"EXPO_PUBLIC_API_URL"); publicHttpsOrigin(process.env.EXPO_PUBLIC_WEB_URL,"EXPO_PUBLIC_WEB_URL");'
RUN EXPO_PUBLIC_API_URL="$EXPO_PUBLIC_API_URL" EXPO_PUBLIC_WEB_URL="$EXPO_PUBLIC_WEB_URL" npm run build:web
RUN node --input-type=module -e 'import { writeFileSync } from "node:fs"; writeFileSync("dist/crewroom-build.json",JSON.stringify({apiUrl:process.env.EXPO_PUBLIC_API_URL,webUrl:process.env.EXPO_PUBLIC_WEB_URL,builtAt:new Date().toISOString()}));'
RUN npm prune --omit=dev --no-audit --no-fund

FROM node:24-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=10000 DATA_DIR=/var/data
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/server ./server
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/assets/demo ./assets/demo
RUN mkdir -p /var/data && chown node:node /var/data
USER node
EXPOSE 10000
CMD ["node", "server/index.mjs"]
