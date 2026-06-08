# Quota Provider Usage Prediction Design

## Goal

Add a provider-level usage prediction panel to the quota page. The panel helps estimate how long each configured quota provider group can continue before its overall quota is exhausted, based on current quota snapshots and recent new-api channel consumption.

This applies to all quota providers shown on the quota page, including Codex, Claude, Z.ai, MiniMax, Antigravity, Gemini CLI, Kimi, and future providers that expose quota windows.

## Confirmed Requirements

- Prediction is provider-level, not account/auth-file-level.
- Docker Compose / environment configuration maps each provider group to one or more new-api `channel_id` values.
- The recent-speed window is selected in the quota page UI.
- Default speed window is 12 hours.
- Available speed windows: 60 minutes, 3 hours, 6 hours, 12 hours, 1 day.
- Snapshot sampling interval is 5 minutes.
- First successful provider quota fetch writes a snapshot immediately.
- A provider reset-time change writes a snapshot immediately.
- Snapshots are retained for 30 days.

## Configuration

Add one environment variable:

```env
NEW_API_MONITOR_QUOTA_USAGE_GROUPS="codex=8,17,19;claude=12,13;zai=27;minimax=24"
```

The container maps this to:

```yaml
QUOTA_USAGE_GROUPS: ${NEW_API_MONITOR_QUOTA_USAGE_GROUPS:-}
```

Format:

```txt
provider=channelId,channelId;provider=channelId
```

Rules:

- Provider keys are normalized to lowercase and matched against existing quota `ProviderType` values.
- Channel IDs are parsed as positive integers.
- Invalid entries are ignored.
- A provider with no configured channels appears with a "未配置渠道映射" state in the prediction panel.

## Data Model

Create a lightweight table for provider quota snapshots:

```sql
CREATE TABLE IF NOT EXISTS quota_snapshots (
  id BIGSERIAL PRIMARY KEY,
  provider TEXT NOT NULL,
  remaining_percent DOUBLE PRECISION,
  used_percent DOUBLE PRECISION,
  reset_time TEXT,
  sampled_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_quota_snapshots_provider_sampled_at
  ON quota_snapshots (provider, sampled_at DESC);

CREATE INDEX IF NOT EXISTS idx_quota_snapshots_sampled_at
  ON quota_snapshots (sampled_at DESC);
```

`sampled_at` stores Unix seconds. `reset_time` is stored as text because provider payloads may return ISO strings, seconds, or provider-specific reset values.

## Snapshot Source

When the quota page refreshes provider data successfully, the client sends the current quota states to a server route that aggregates provider quota state and records snapshots.

Provider aggregation uses the same normalized quota window data already used by the UI:

- Prefer weekly/long-term quota windows when available.
- For providers without a weekly window, use the primary displayed total/current window.
- If multiple cards exist for the same provider, aggregate by taking the lowest remaining percentage among valid cards. This represents the limiting provider-level quota.
- `used_percent = 100 - remaining_percent` when only remaining is available.
- `reset_time` is the reset value from the selected limiting window.

Snapshot write policy:

- Write immediately when no snapshot exists for provider.
- Write when the latest snapshot is at least 5 minutes old.
- Write immediately when normalized `reset_time` changes.
- Skip writing when provider quota has no usable remaining/used percentage.
- Delete snapshots older than 30 days opportunistically during successful writes.

## Usage Query

Add a server route for prediction data, e.g. `/api/quota-usage-prediction`.

Inputs:

```txt
windowMinutes=60|180|360|720|1440
```

Output per provider:

```ts
{
  provider: ProviderType;
  channelIds: number[];
  configured: boolean;
  todayGptTokens: number;
  todayQuota: number;
  recentQuota: number;
  recentQuotaPerHour: number | null;
  latestRemainingPercent: number | null;
  latestUsedPercent: number | null;
  resetTime: string | null;
  minutesLeft: number | null;
  exhaustAt: number | null;
  status: "ready" | "unconfigured" | "no_snapshot" | "no_recent_usage" | "exhausted";
}
```

Data comes from Postgres `logs`:

- Today range uses Asia/Shanghai day boundaries, consistent with the dashboard.
- `todayGptTokens` sums prompt + completion tokens for GPT/Codex-family models in configured channels.
- `todayQuota` sums `logs.quota` for configured channels today.
- `recentQuota` sums `logs.quota` for configured channels over the selected speed window.
- `recentQuotaPerHour = recentQuota / (windowMinutes / 60)`.

GPT/Codex-family model filter:

```sql
lower(normalized_model) LIKE 'gpt%'
OR lower(normalized_model) LIKE '%codex%'
```

Prediction formula:

```txt
estimatedTotalQuota = todayQuota / latestUsedPercent * 100
remainingQuota = estimatedTotalQuota * latestRemainingPercent / 100
minutesLeft = remainingQuota / (recentQuota / windowMinutes)
exhaustAt = now + minutesLeft
```

Fallback behavior:

- If `latestRemainingPercent <= 0`, status is `exhausted`.
- If no snapshot exists, status is `no_snapshot`.
- If recent quota speed is zero, status is `no_recent_usage`.
- If latest used percent is zero and today quota cannot estimate total quota, show current remaining percentage without an exhaustion time.

## UI

Add a provider-level prediction panel under provider tabs and above the card grid.

Header:

```txt
额度预测                  速度窗口 [12 小时 v]
```

Rows show configured providers:

```txt
Codex    今日 GPT 12.4M · 今日 quota 38.2M · 近12小时 510k/h · 预计 2天4小时后耗尽 · 6月11日 18:30
Claude   ...
Z.ai     ...
MiniMax  ...
```

Provider states:

- `unconfigured`: `未配置渠道映射`
- `no_snapshot`: `等待 quota 快照`
- `no_recent_usage`: `近窗口暂无消耗`
- `exhausted`: `已耗尽或剩余为 0`

The panel respects the selected provider tab:

- `全部`: show all configured provider groups.
- Specific provider tab: show only that provider's prediction row.

The quota cards remain unchanged and continue to display per-card quota detail.

## API and Client Flow

1. Quota page loads auth files and provider quota states as today.
2. After successful quota refresh, client posts provider quota summaries to a snapshot route.
3. Client fetches prediction data with the selected speed window.
4. Changing the speed window refetches prediction data and does not trigger provider quota refresh.
5. Auto-refresh updates quota states, snapshots, and prediction rows.

## Error Handling

- Missing or malformed `QUOTA_USAGE_GROUPS` returns an empty configured map and the UI shows unconfigured states.
- Snapshot writes never block quota display; failures are logged server-side and ignored client-side.
- Prediction route returns safe empty rows if the database has no logs for configured channels.
- Invalid `windowMinutes` falls back to 720.

## Tests

Add focused unit tests for:

- Parsing `QUOTA_USAGE_GROUPS`.
- Window option normalization.
- Provider quota aggregation from `QuotaData` windows.
- Snapshot write policy: first write, 5-minute interval, reset-time change, stale cleanup.
- Prediction formula edge cases: no snapshot, no speed, exhausted, valid estimate.

Run verification after implementation:

```bash
node --experimental-strip-types --test <new quota usage tests> existing quota tests
npx tsc --noEmit
npm run lint
npm run build
```

## Deployment Notes

Add to `docker-compose.portainer.yml`:

```yaml
QUOTA_USAGE_GROUPS: ${NEW_API_MONITOR_QUOTA_USAGE_GROUPS:-}
```

Add to `.env.example`:

```env
QUOTA_USAGE_GROUPS="codex=8,17,19;claude=12,13;zai=27;minimax=24"
```

Portainer users configure:

```env
NEW_API_MONITOR_QUOTA_USAGE_GROUPS=codex=8,17,19;claude=12,13;zai=27;minimax=24
```
