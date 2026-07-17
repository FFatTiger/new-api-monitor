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
- `NEW_API_MONITOR_PORT`，默认 `31891`
- `NEW_API_MONITOR_QUOTA_USAGE_GROUPS`，例如 `codex=8,17;claude=12`
- `NEW_API_MONITOR_QUOTA_SNAPSHOT_INTERVAL_SECONDS`，quota 后台采样/快照间隔，默认 `300`

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

## 长期统计 Rollup 部署

长期统计（`30d` / `all`）依赖后台增量 rollup，**默认全部关闭**，部署后不会自动在上游 `logs` 上创建昂贵索引，也不会立刻改写短周期（`today` / `24h` / `7d`）既有 raw 路径。

### 分阶段启用

1. **Phase 1：只开 worker，不开读**
   - `DASHBOARD_ROLLUP_WORKER_ENABLED=true`
   - `DASHBOARD_ROLLUP_READS_ENABLED=false`
   - 保持单实例/单 worker 有界批处理：默认 `batch=100`、`pause=500ms`、`statement_timeout=5s`
   - 批处理使用事务级 advisory lock，并关闭并行 gather（`max_parallel_workers_per_gather=0`）
   - 此阶段 `30d` / `all` 会显示构建进度，**绝不会回退到 raw 全表扫描**
2. **观察**
   - 应用日志中的每批处理结果
   - `dashboard_rollup_state` 的进度、`history_complete`、active version
   - 存储增长：6 个 mask × 4 个 grain（每个 source 最多 24 cell；稀疏维度会复用 dimension 行）
3. **等待历史回填完成并激活版本** 后进入 Phase 2
4. **Phase 2：开启读取**
   - `DASHBOARD_ROLLUP_READS_ENABLED=true`
   - 本版本中 `30d` 与 `all` **同时**启用（不支持只开其中一个）

### 启用后验证

- 面板页与 token 详情的长期查询不应再扫 raw `logs`
- `30d` 趋势分段应为 day / hour / minute；`all` 汇总用 all-time、趋势用 day
- 长期结果不走限时缓存

### 回滚

- 关闭 `DASHBOARD_ROLLUP_READS_ENABLED` 与 `DASHBOARD_ROLLUP_WORKER_ENABLED`
- 长期预设保持不可用，**不得**恢复为 raw 扫描
- rollup 表是永久分析数据；删除上游 source 日志**不会**扣减已处理历史

### 环境变量

| 应用变量 | Portainer / compose 变量 | 默认 |
|---|---|---|
| `DASHBOARD_ROLLUP_WORKER_ENABLED` | `NEW_API_MONITOR_DASHBOARD_ROLLUP_WORKER_ENABLED` | `false` |
| `DASHBOARD_ROLLUP_READS_ENABLED` | `NEW_API_MONITOR_DASHBOARD_ROLLUP_READS_ENABLED` | `false` |
| `DASHBOARD_ROLLUP_BATCH_SIZE` | `NEW_API_MONITOR_DASHBOARD_ROLLUP_BATCH_SIZE` | `100` |
| `DASHBOARD_ROLLUP_PAUSE_MS` | `NEW_API_MONITOR_DASHBOARD_ROLLUP_PAUSE_MS` | `500` |
| `DASHBOARD_ROLLUP_STATEMENT_TIMEOUT_MS` | `NEW_API_MONITOR_DASHBOARD_ROLLUP_STATEMENT_TIMEOUT_MS` | `5000` |

### 集成测试数据库

- 仅使用专用变量 `DASHBOARD_ROLLUP_TEST_DATABASE_URL`
- **禁止**指向生产库，也**禁止**复用普通 `DATABASE_URL` 作为回退
- 未设置该变量时，集成测试会安全 skip

本地聚焦验证：

```bash
npm run test:dashboard
```

## 安全说明

- 不要提交 `.env.local`
- 不要把真实数据库连接串写进仓库文件
- 当前项目默认没有登录保护，更适合放内网或放在反向代理认证后面
- `/oauth` 会写入后端认证文件，页面通过服务端 API 路由使用 `API_MANAGEMENT_KEY` 转发管理请求
