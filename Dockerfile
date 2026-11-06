# Single-origin production image (docs/08 — Docker): the server serves the built client from
# server/public, so the browser talks to ONE origin (same-site cookie, no CORS, ws on 'self').

# ---- build: install everything, build the client
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json client/
COPY server/package.json server/
COPY shared/package.json shared/
RUN npm ci --ignore-scripts
COPY shared shared
COPY client client
RUN npm run build -w client

# ---- runtime: server + shared production dependencies only
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY client/package.json client/
COPY server/package.json server/
COPY shared/package.json shared/
RUN npm ci --omit=dev --ignore-scripts -w server -w shared --include-workspace-root && npm cache clean --force
COPY shared/src shared/src
COPY server/src server/src
COPY --from=build /app/client/dist server/public
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD wget -qO- http://localhost:4000/api/healthz || exit 1
CMD ["node", "server/src/index.js"]
