# Larvis im Eigenbetrieb: ein Image, das die gebaute PWA und die api/-Endpoints
# ausliefert. Die Datenbank ist eine eigene Supabase, der Container hält keinen Zustand.
#
# Der Build-Stage baut in der Reihenfolge shared → mcp-Bundles → Typecheck → Vite und
# zusätzlich die Endpoints nach dist-api/. Der Runtime-Stage bekommt nur das
# Ergebnis plus die Pakete, die die Bundles bewusst extern lassen.

FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/mcp-server/package.json packages/mcp-server/
RUN npm ci

COPY . .

# Öffentliche Client-Konfiguration. Der Code hat dafür keine Vorgabewerte mehr,
# deshalb bricht der Build hier ab statt ein Image zu erzeugen, das im Browser
# gegen das falsche Backend läuft.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_VAPID_PUBLIC_KEY
# Ort und optionale Module (siehe apps/web/src/lib/modules.ts); leer = aus.
ARG VITE_WEATHER_PLACE=""
ARG VITE_WEATHER_LAT=""
ARG VITE_WEATHER_LON=""
ARG VITE_HOME_PLACE=""
ARG VITE_LEARNWEB_ENABLED=""
ARG VITE_MENSA_CANTEENS=""
ARG VITE_BUS_STOP_ID=""
ARG VITE_BUS_STOP_NAME=""
ARG VITE_BUS_HBF_MINUTES=""
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY \
    VITE_VAPID_PUBLIC_KEY=$VITE_VAPID_PUBLIC_KEY \
    VITE_WEATHER_PLACE=$VITE_WEATHER_PLACE \
    VITE_WEATHER_LAT=$VITE_WEATHER_LAT \
    VITE_WEATHER_LON=$VITE_WEATHER_LON \
    VITE_HOME_PLACE=$VITE_HOME_PLACE \
    VITE_LEARNWEB_ENABLED=$VITE_LEARNWEB_ENABLED \
    VITE_MENSA_CANTEENS=$VITE_MENSA_CANTEENS \
    VITE_BUS_STOP_ID=$VITE_BUS_STOP_ID \
    VITE_BUS_STOP_NAME=$VITE_BUS_STOP_NAME \
    VITE_BUS_HBF_MINUTES=$VITE_BUS_HBF_MINUTES
RUN test -n "$VITE_SUPABASE_URL" || (echo "VITE_SUPABASE_URL fehlt" >&2; exit 1)
RUN test -n "$VITE_SUPABASE_ANON_KEY" || (echo "VITE_SUPABASE_ANON_KEY fehlt" >&2; exit 1)

RUN npm run build:selfhost -w @larvis/web

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=3000

ARG VITE_WEATHER_PLACE=""
ARG VITE_WEATHER_LAT=""
ARG VITE_WEATHER_LON=""
ARG VITE_HOME_PLACE=""
ARG VITE_LEARNWEB_ENABLED=""
ARG VITE_MENSA_CANTEENS=""
ENV VITE_WEATHER_PLACE=$VITE_WEATHER_PLACE \
    VITE_WEATHER_LAT=$VITE_WEATHER_LAT \
    VITE_WEATHER_LON=$VITE_WEATHER_LON \
    VITE_HOME_PLACE=$VITE_HOME_PLACE \
    VITE_LEARNWEB_ENABLED=$VITE_LEARNWEB_ENABLED \
    VITE_MENSA_CANTEENS=$VITE_MENSA_CANTEENS

# Nur die Laufzeit-Pakete, die esbuild extern lässt (siehe scripts/build-api.mjs).
# Versionen gepinnt auf den Stand des Lockfiles.
RUN printf '%s\n' '{"name":"larvis-runtime","private":true,"type":"module","dependencies":{"@modelcontextprotocol/sdk":"1.29.0","@supabase/supabase-js":"2.108.2","web-push":"3.6.7"}}' > package.json \
    && npm install --omit=dev --no-audit --no-fund \
    && npm cache clean --force

COPY --from=build /app/apps/web/dist ./dist
COPY --from=build /app/apps/web/dist-api ./dist-api
COPY --from=build /app/apps/web/server ./server

ENV LARVIS_STATIC_DIR=/app/dist LARVIS_API_DIR=/app/dist-api

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.mjs"]
