# kordle.db는 git에 없다(213MB, build_dict.py 산출물). 빌드 컨텍스트에 파일을 넣어 두고 빌드한다:
#   python3 build_dict.py kordle.db --stdict dict/stdict --krdict dict/nikl/krdict --opendict dict/nikl/opendict \
#       --kowiki dict/kowiki/kowiki-20260901-page.sql.gz
#   docker build -t n-kordle .
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
ENV NODE_ENV=production PORT=3000 KORDLE_DB=/app/kordle.db
COPY --from=build /app/build ./build
COPY --from=build /app/package.json ./
COPY kordle.db ./kordle.db
EXPOSE 3000
# KORDLE_SECRET은 실행 시 주입한다(k8s Secret → secretKeyRef). 없으면 dev 기본값으로 뜨니 운영에서는 반드시 넣는다.
CMD ["node", "build"]
