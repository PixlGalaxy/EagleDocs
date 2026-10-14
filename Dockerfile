# 1: Frontend build
FROM node:26-alpine AS build-frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend ./
# Translations are shared with the backend and imported from ../locales.
COPY locales /app/locales
RUN npm run build

# 2: Backend build (with PixlAI-Engine, which the backend links as file:../pixlai-engine)
# argon2 is a native module: when no prebuilt binary matches the Node ABI it
# falls back to node-gyp, which needs this toolchain. It never reaches the
# final image, which only receives the built output.
FROM node:26-alpine AS build-backend
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY pixlai-engine/package.json pixlai-engine/package-lock.json ./pixlai-engine/
RUN cd pixlai-engine && npm ci
COPY pixlai-engine ./pixlai-engine
COPY backend/package.json backend/package-lock.json ./backend/
RUN cd backend && npm ci
COPY backend ./backend
# prebuild compiles the engine first.
RUN cd backend && npm run build && npm prune --omit=dev

# 3: Final image, nginx + Node.js
FROM node:26-alpine
WORKDIR /app

# Filled in by the publish workflow; "dev" for a plain local `docker build`.
ARG APP_IMAGE_REF=dev
ARG APP_IMAGE_REVISION=
ENV APP_IMAGE_REF=$APP_IMAGE_REF \
    APP_IMAGE_REVISION=$APP_IMAGE_REVISION

LABEL org.opencontainers.image.source="https://github.com/PixlGalaxy/EagleDocs" \
      org.opencontainers.image.title="EagleDocs" \
      org.opencontainers.image.description="Hosted academic AI agent for university students: Canvas, Degree Works and a private workspace."

RUN apk add --no-cache nginx tini

COPY --from=build-frontend /app/frontend/dist /usr/share/nginx/html
COPY --from=build-backend /app/pixlai-engine/dist /app/pixlai-engine/dist
COPY --from=build-backend /app/pixlai-engine/package.json /app/pixlai-engine/package.json
COPY --from=build-backend /app/backend/dist /app/backend/dist
COPY --from=build-backend /app/backend/node_modules /app/backend/node_modules
COPY --from=build-backend /app/backend/package.json /app/backend/package.json
COPY locales /app/locales

COPY nginx.conf /etc/nginx/nginx.conf
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV NODE_ENV=production \
    PORT=4000 \
    DATA_ROOT=/data \
    LOCALES_DIR=/app/locales \
    LANGUAGE=en

# Shared storage (NFS/SMB) mounted on every replica: avatars, branding, workspaces.
# The database is external (DATABASE_URL), so nothing else needs a volume.
VOLUME ["/data"]
EXPOSE 80

# /api/health also checks the database.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# tini as PID 1 so signals and zombie processes are handled properly.
ENTRYPOINT ["tini", "--", "/entrypoint.sh"]
