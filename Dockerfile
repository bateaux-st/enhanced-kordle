# 배포는 docker compose로 한다 (compose.yaml). kordle.db(213MB)는 이미지에 넣지 않고 볼륨으로 마운트해
# 사전을 재빌드해도 이미지 재빌드 없이 파일 교체 + 재시작으로 끝나게 한다.
#   python3 build_dict.py kordle.db --stdict dict/stdict --krdict dict/nikl/krdict --opendict dict/nikl/opendict \
#       --kowiki dict/kowiki/kowiki-20260901-page.sql.gz
#   docker compose up -d --build
FROM node:22-alpine AS build
WORKDIR /app
RUN npm install -g pnpm@10
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# adapter-node가 의존성까지 번들하므로 런타임에는 node_modules가 필요 없다.
FROM node:22-alpine
WORKDIR /app
# adapter-node는 HOST 기본값이 0.0.0.0 — 컨테이너 밖에서 접근하려면 그대로 둬야 한다.
ENV NODE_ENV=production PORT=3000 KORDLE_DB=/data/kordle.db
COPY --from=build /app/build ./build
COPY --from=build /app/package.json ./
EXPOSE 3000
# KORDLE_SECRET은 compose의 env_file(.env)로 주입한다. 없으면 dev 기본값으로 뜨니 운영에서는 반드시 넣는다.
CMD ["node", "build"]
