# NEW-API-MONITOR

面向 `new-api` 的多维度监控面板，核心视角是 API Key / token 消耗排行，并补充用户、模型、渠道和趋势分析。

## 本地开发

```bash
pnpm install
pnpm dev
```

默认开发地址：
- http://localhost:31891

运行前准备环境变量：

```bash
cp .env.example .env.local
```

然后填写：

```bash
DATABASE_URL="postgresql://USERNAME:PASSWORD@HOST:5432/DATABASE"
API_BASE_URL="https://your-api-management-host"
API_MANAGEMENT_KEY="your-server-only-management-key"
OAUTH_ACCESS_KEY="optional-dedicated-oauth-operation-key"
```

## Docker

本项目使用 Next.js standalone 输出，生产镜像监听：
- `31891`

本地构建：

```bash
docker build -t fffattiger/new-api-monitor:latest .
```

本地运行：

```bash
docker run --rm -p 31891:31891 \
  -e NODE_ENV=production \
  -e HOSTNAME=0.0.0.0 \
  -e PORT=31891 \
  -e DATABASE_URL="postgresql://USERNAME:PASSWORD@HOST:5432/DATABASE" \
  -e API_BASE_URL="https://your-api-management-host" \
  -e API_MANAGEMENT_KEY="your-server-only-management-key" \
  -e OAUTH_ACCESS_KEY="optional-dedicated-oauth-operation-key" \
  fffattiger/new-api-monitor:latest
```

## Portainer Stack

可直接参考仓库内：
- `docker-compose.portainer.yml`

默认镜像：
- `fffattiger/new-api-monitor:latest`

关键环境变量：
- `NEW_API_MONITOR_DATABASE_URL`
- `NEW_API_MONITOR_API_BASE_URL`
- `NEW_API_MONITOR_API_MANAGEMENT_KEY`
- `NEW_API_MONITOR_OAUTH_ACCESS_KEY`，可选；为空时 OAuth 操作密钥使用 `API_MANAGEMENT_KEY`
- `NEW_API_MONITOR_PORT`，默认 `31891`

如果和 `new-api` 的 `postgres` 在同一个 Docker network / stack，可使用类似：

```bash
postgresql://USERNAME:PASSWORD@postgres:5432/new-api
```

## GitHub Actions / Docker 发布

仓库会通过 GitHub Actions 自动发布 Docker Hub 镜像。

工作流：
- `.github/workflows/docker-build.yml`
  - push 到 `main` 时发布：
    - `fffattiger/new-api-monitor:dev-latest`
    - `fffattiger/new-api-monitor:dev-<timestamp>`
- `.github/workflows/release.yml`
  - 发布 GitHub Release 时发布：
    - `fffattiger/new-api-monitor:latest`
    - `fffattiger/new-api-monitor:<version>`

GitHub repository secrets：
- `DOCKERHUB_USERNAME`
- `DOCKERHUB_TOKEN`

## 安全说明

- 不要提交 `.env.local`
- 不要把真实数据库连接串写进仓库文件
- 当前项目默认没有登录保护，更适合放内网或放在反向代理认证后面
- `/oauth` 会写入后端认证文件，页面操作需要输入 `OAUTH_ACCESS_KEY`；未设置专用密钥时使用 `API_MANAGEMENT_KEY`
