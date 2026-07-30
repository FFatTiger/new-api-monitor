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

## ClickHouse Dashboard 统计

Dashboard 现在只使用 ClickHouse 作为统计查询层。ClickHouse 未启用、正在同步、过载或不可用时，页面会显示安全状态，**不会回退聚合 PostgreSQL `logs`**。

> 当前实现按分钟聚合，因此自定义时间范围精确到分钟；开始和结束时间所在分钟会作为完整分钟统计。

### Portainer 部署顺序

1. 设置强密码 `NEW_API_MONITOR_CLICKHOUSE_PASSWORD`，部署 `docker-compose.portainer.yml`。
2. 设置 `NEW_API_MONITOR_CLICKHOUSE_SYNC_ENABLED=true`，保持 `NEW_API_MONITOR_CLICKHOUSE_READS_ENABLED=false`。
3. 查看 ClickHouse 中的同步游标：

   ```sql
   SELECT argMax(last_source_id, version)
   FROM new_api_monitor.dashboard_sync_state
   WHERE singleton = 1;
   ```

   等它追平 PostgreSQL 最新的 `logs.id`。
4. 设置 `NEW_API_MONITOR_CLICKHOUSE_READS_ENABLED=true` 并重新部署。
5. 旧 PostgreSQL rollup 已停用，不要再打开相关开关。

### 数据和查询设计

- PostgreSQL 仍是事实来源；ClickHouse 是随时可以重建的分析索引。
- 同步器按 `logs.id` 顺序读取，每批在 Node.js 中完成 JSON 解析、模型名规范化和分钟级联合维度聚合。
- 聚合行保留完整的 token / user / model / channel 元组，因此这些维度可以任意组合过滤并重新分组。
- 重试使用确定性的 `(batch_id, minute, dimensions)` 键和 `argMax(version)` 去重，不在查询中执行昂贵的 `FINAL`。
- 页面只创建一个统一 packet；摘要、排名、稳定性和趋势查询共享同一过滤范围。

### 资源保护

默认限制如下：

| 限制 | 默认值 |
|---|---:|
| ClickHouse 容器 CPU | 1 核 |
| ClickHouse 容器内存 | 4 GB |
| 单查询线程 | 2 |
| 单查询执行时间 | 3 秒 |
| 单查询读取行数 | 500 万 |
| 单查询读取字节 | 1 GB |
| 单查询内存 | 512 MB |
| 应用内并发查询 | 2 |
| 等待队列 | 8，等待超过 1 秒失败 |

ClickHouse 不映射宿主机端口，只能从 stack 内部网络访问。超过超时、扫描量、内存或队列预算的查询会失败并显示安全提示，不会继续消耗无限资源。

### 环境变量

| 应用变量 | Portainer / compose 变量 | 默认值 |
|---|---|---:|
| `CLICKHOUSE_SYNC_ENABLED` | `NEW_API_MONITOR_CLICKHOUSE_SYNC_ENABLED` | `false` |
| `CLICKHOUSE_READS_ENABLED` | `NEW_API_MONITOR_CLICKHOUSE_READS_ENABLED` | `false` |
| `CLICKHOUSE_SYNC_BATCH_SIZE` | `NEW_API_MONITOR_CLICKHOUSE_SYNC_BATCH_SIZE` | `5000` |
| `CLICKHOUSE_SYNC_PAUSE_MS` | `NEW_API_MONITOR_CLICKHOUSE_SYNC_PAUSE_MS` | `1000` |
| `CLICKHOUSE_QUERY_TIMEOUT_MS` | `NEW_API_MONITOR_CLICKHOUSE_QUERY_TIMEOUT_MS` | `3000` |
| `CLICKHOUSE_MAX_THREADS` | `NEW_API_MONITOR_CLICKHOUSE_MAX_THREADS` | `2` |
| `CLICKHOUSE_MAX_ROWS_TO_READ` | `NEW_API_MONITOR_CLICKHOUSE_MAX_ROWS_TO_READ` | `5000000` |
| `CLICKHOUSE_MAX_BYTES_TO_READ` | `NEW_API_MONITOR_CLICKHOUSE_MAX_BYTES_TO_READ` | `1073741824` |
| `CLICKHOUSE_MAX_MEMORY_USAGE` | `NEW_API_MONITOR_CLICKHOUSE_MAX_MEMORY_USAGE` | `536870912` |
| `CLICKHOUSE_MAX_CONCURRENT_QUERIES` | `NEW_API_MONITOR_CLICKHOUSE_MAX_CONCURRENT_QUERIES` | `2` |
| `CLICKHOUSE_MAX_QUEUED_QUERIES` | `NEW_API_MONITOR_CLICKHOUSE_MAX_QUEUED_QUERIES` | `8` |
| ClickHouse 容器 CPU | `NEW_API_MONITOR_CLICKHOUSE_CPUS` | `1.0` |
| ClickHouse 容器内存 | `NEW_API_MONITOR_CLICKHOUSE_MEMORY` | `4g` |

### 重建

1. 关闭 ClickHouse reads 和 sync。
2. 删除 `clickhouse-data` volume。
3. 重新部署并只开启 sync。
4. 等待游标追平后再开启 reads。

本地验证：

```bash
pnpm test:clickhouse
pnpm test:dashboard
pnpm exec tsc --noEmit
pnpm lint
pnpm build
```
