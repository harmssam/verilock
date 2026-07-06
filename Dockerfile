FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY client/package.json client/package-lock.json ./client/
COPY server/package.json server/package-lock.json ./server/

RUN npm ci --prefix client && npm ci --prefix server

COPY shared ./shared
COPY client ./client
COPY server ./server

RUN npm run build --prefix client

FROM node:22-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production
ENV DATA_DIR=/data

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY server/package.json server/package-lock.json ./server/
RUN npm ci --omit=dev --prefix server

COPY --from=build /app/shared ./shared
COPY --from=build /app/server/src ./server/src
COPY --from=build /app/client/dist ./client/dist

RUN mkdir -p /data/docs

WORKDIR /app/server

EXPOSE 8080

CMD ["node", "--import", "tsx", "src/index.ts"]