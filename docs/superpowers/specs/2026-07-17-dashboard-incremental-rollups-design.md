# Dashboard Incremental Rollups Design

## Goal

Prevent the dashboard's **30 天** and **不限** filters from saturating CPU, including the first request, cache refreshes, application restarts, and initial historical reconstruction.

The solution must remove wide-window raw-log aggregation from the request path. It must not depend on expiring caches, periodic full recomputation, or a one-time unbounded backfill.

## Confirmed Requirements

- Selecting `30d` or `all` must never run the existing multi-query aggregation over the matching raw `logs` rows.
- No time-based cache is used as the primary optimization. There is no expiry event that triggers a full rebuild.
- Each source log is normalized and accumulated once per rollup formula version. A formula-version rebuild intentionally processes it once for that new version while the previous version remains readable.
- Initial history is processed in small, rate-limited batches with a hard row limit.
- Page requests do not start, accelerate, or fall back from rollups to historical raw-log computation.
- If a requested rollup is not ready, the page shows build progress instead of executing the legacy long-range query.
- Existing metric formulas and filter combinations retain the same displayed semantics at minute precision. Counts and token sums remain exact; averaged decimal metrics must match within the existing UI's numeric precision.
- Processed statistics are retained permanently even if old source logs are later deleted.
- Source `logs` rows are treated as append-only. Updates or deletions after processing do not subtract from rollups.
- Formula changes use a new rollup version built incrementally; the active completed version remains readable until an atomic switch.

## Root Cause

The current dashboard fans one filter window out into independent summary, ranking, stability, and trend queries. A normal page load performs roughly nine filtered aggregates over `logs`, plus time bounds and a full-history model `DISTINCT` query.

For every matching row, several queries repeat expensive work:

- parsing `logs.other` as JSONB;
- extracting cache and first-token-latency values;
- normalizing model names with a regular expression;
- grouping and sorting by token, user, model, channel, and time bucket.

`preset=all` has no time predicate, so these operations cover the complete source table. Streaming the page improves perceived loading order but does not reduce total database work.

## Chosen Architecture

Use a **persistent, versioned, incremental multidimensional rollup** maintained by a single background worker.

```text
new-api logs (append-only)
       │
       │ bounded keyset batches
       ▼
normalizer + fixed 16-mask data cube
       │
       ├── all/filter/ranking dimension masks
       ├── minute rollups
       ├── hour rollups
       ├── day rollups
       └── all-time rollups
                    │
                    ▼
        30d / all dashboard queries
```

A source row is normalized only by a bounded worker batch and only once per rollup version. JSON parsing and model normalization happen once for that version. The page reads compact rollup rows and never parses raw JSON for long ranges.

This is intentionally different from a materialized view: refreshing a materialized view would periodically repeat large computations and recreate the CPU spike.

## Source Preconditions and Safety

The upstream New API `logs` schema provides an integer `id` primary key and Unix-second `created_at`. The worker verifies the live database rather than assuming the schema:

- `logs.id` exists and is usable for ordered keyset pagination;
- `logs.created_at` exists;
- the source table identity/OID still matches the state recorded for the rollup version.

If the table is replaced, the newest source ID moves behind the committed live cursor, or no usable `id` cursor exists, the worker enters an unhealthy state and stops. It must not silently reset a cursor or duplicate statistics. Deleting already-processed old rows is allowed and does not invalidate permanent rollups; rows deleted before backfill reaches them cannot be reconstructed.

A leading `created_at` index, preferably `(created_at, id)`, enables the optional recent-history lane described below. The application never creates this index automatically because building an index on a large source table may itself cause an unacceptable resource spike.

## Permanent Data Model

All tables are application-owned and created with `IF NOT EXISTS` during worker initialization.

### Rollup Registry

```sql
CREATE TABLE IF NOT EXISTS dashboard_rollup_registry (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  active_version INTEGER,
  building_version INTEGER,
  updated_at BIGINT NOT NULL
);
```

- `active_version` is the fully completed version normally used by page queries.
- `building_version` is populated incrementally.
- Activation is a single transactional update only after historical coverage is complete and the live lane has caught up.
- During the first-ever build, when no `active_version` exists, `30d` and covered custom ranges may read the `building_version` after recent-coverage readiness passes. `all` cannot read it until activation.
- During later formula-version rebuilds, all page queries remain on the previous `active_version`; the partially built version is never exposed.
- Old versions are not deleted automatically. Cleanup is an explicit operator action.

### Rollup State

```sql
CREATE TABLE IF NOT EXISTS dashboard_rollup_state (
  version INTEGER PRIMARY KEY,
  source_table_oid OID NOT NULL,
  source_boundary_id BIGINT NOT NULL,
  live_cursor_id BIGINT NOT NULL,
  recent_cutoff BIGINT,
  recent_cursor_created_at BIGINT,
  recent_cursor_id BIGINT,
  recent_complete BOOLEAN NOT NULL DEFAULT FALSE,
  history_cursor_id BIGINT,
  history_complete BOOLEAN NOT NULL DEFAULT FALSE,
  processed_min_created_at BIGINT,
  processed_max_created_at BIGINT,
  processed_rows BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  last_error TEXT,
  updated_at BIGINT NOT NULL
);
```

At version initialization:

- `source_boundary_id` is the latest committed source ID observed once.
- Rows above the boundary are discovered by the live lane.
- The optional recent lane accelerates 30-day readiness.
- The historical lane still walks every ID up to the boundary, including the recent period, so it provides complete coverage and catches rows that committed after the initial recent scan.
- A processed-source table makes these overlapping lanes idempotent.

PostgreSQL sequences may allocate IDs in transactions that commit out of order. Advancing a plain `MAX(id)` cursor can therefore skip a lower ID that commits later. The worker records numeric ID gaps found during live and historical keyset scans and probes those ranges in separate bounded attempts. This avoids a trigger on the upstream table while preventing cursor gaps from being silently forgotten.

### Processed Sources and ID Gaps

```sql
CREATE TABLE IF NOT EXISTS dashboard_rollup_processed_sources (
  version INTEGER NOT NULL,
  source_id BIGINT NOT NULL,
  processed_at BIGINT NOT NULL,
  PRIMARY KEY (version, source_id)
);

CREATE TABLE IF NOT EXISTS dashboard_rollup_id_gaps (
  version INTEGER NOT NULL,
  gap_start_id BIGINT NOT NULL,
  gap_end_id BIGINT NOT NULL,
  next_probe_at BIGINT NOT NULL,
  probe_attempts INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (version, gap_start_id, gap_end_id),
  CHECK (gap_start_id <= gap_end_id)
);

CREATE INDEX IF NOT EXISTS idx_dashboard_rollup_id_gaps_due
  ON dashboard_rollup_id_gaps (version, next_probe_at);
```

The processed-source marker is inserted in the same transaction as all metric upserts. Overlapping recent/history scans, retries, and gap probes can therefore fetch the same source row but cannot normalize or accumulate it twice for one version.

Gap ranges are coalesced where possible. One due range is probed per scheduled gap opportunity with a keyset query and the normal batch limit. Empty permanent sequence gaps use exponential backoff capped at one hour; they never cause a tight loop or an unbounded query. If rows later appear inside a range, they are processed and the interval is shrunk or split transactionally.

### Dimension Combinations

```sql
CREATE TABLE IF NOT EXISTS dashboard_rollup_dimensions (
  id BIGSERIAL PRIMARY KEY,
  version INTEGER NOT NULL,
  dimension_mask SMALLINT NOT NULL,
  dimension_hash BYTEA NOT NULL,
  token_id BIGINT,
  token_name TEXT,
  user_id BIGINT,
  username TEXT,
  model_name TEXT,
  channel_id BIGINT,
  UNIQUE (version, dimension_hash),
  CHECK (dimension_mask BETWEEN 0 AND 15)
);
```

The four filter dimensions are assigned fixed mask bits: token `1`, user `2`, model `4`, channel `8`. Every combination from `0` through `15` has a defined meaning. Only dimensions selected by the mask participate in the hash and grouping key. The hash includes the mask and a length-prefixed canonical representation with an explicit marker that distinguishes `NULL` from an empty string or zero.

Raw nullable dimension values are retained so `COUNT(DISTINCT ...)`, `ILIKE`, and later regrouping can match the current SQL; model values use the current normalized form. Dimension keys follow source semantics: token uses raw `(token_id, token_name)`, user uses raw `(user_id, username)`, model uses normalized model name, and channel uses raw `channel_id`. Non-key legacy fallback values are stored in the time-bucket rollup row rather than globally, so a 30-day query cannot accidentally use a representative value seen only outside that range.

When an existing hash is loaded, the worker compares the mask and all stored key values. A mismatch is treated as a collision and stops the batch rather than merging unrelated dimensions.

Add focused indexes for exact filters and joins:

```sql
CREATE INDEX IF NOT EXISTS idx_dashboard_rollup_dimensions_username
  ON dashboard_rollup_dimensions (version, dimension_mask, username);
CREATE INDEX IF NOT EXISTS idx_dashboard_rollup_dimensions_model
  ON dashboard_rollup_dimensions (version, dimension_mask, model_name);
CREATE INDEX IF NOT EXISTS idx_dashboard_rollup_dimensions_channel
  ON dashboard_rollup_dimensions (version, dimension_mask, channel_id);
CREATE INDEX IF NOT EXISTS idx_dashboard_rollup_dimensions_token
  ON dashboard_rollup_dimensions (version, dimension_mask, token_id);
```

Token-name substring filtering may scan only the selected mask's compact dimension rows, but never the raw logs table. No PostgreSQL extension is required.

### Metric Rollups

```sql
CREATE TABLE IF NOT EXISTS dashboard_rollups (
  version INTEGER NOT NULL,
  grain SMALLINT NOT NULL,
  bucket_start BIGINT NOT NULL,
  dimension_id BIGINT NOT NULL REFERENCES dashboard_rollup_dimensions(id),
  request_count BIGINT NOT NULL,
  input_tokens BIGINT NOT NULL,
  output_tokens BIGINT NOT NULL,
  cache_tokens BIGINT NOT NULL,
  attempt_count BIGINT NOT NULL,
  success_count BIGINT NOT NULL,
  error_count BIGINT NOT NULL,
  first_token_latency_sum NUMERIC NOT NULL,
  first_token_latency_count BIGINT NOT NULL,
  response_time_sum NUMERIC NOT NULL,
  response_time_count BIGINT NOT NULL,
  output_tokens_per_sec_sum NUMERIC NOT NULL,
  output_tokens_per_sec_count BIGINT NOT NULL,
  representative_user_id BIGINT,
  representative_username TEXT,
  representative_channel_name TEXT,
  first_used_at BIGINT NOT NULL,
  latest_used_at BIGINT NOT NULL,
  PRIMARY KEY (version, grain, bucket_start, dimension_id)
);
```

Grain values are fixed constants:

- `1`: minute
- `2`: hour
- `3`: Asia/Shanghai calendar day
- `4`: all time, with `bucket_start = 0`

Indexes:

```sql
CREATE INDEX IF NOT EXISTS idx_dashboard_rollups_dimension_bucket
  ON dashboard_rollups (version, grain, dimension_id, bucket_start);
```

Rollup rows are permanent. There is no TTL or scheduled invalidation.

## Metric Normalization

For each source log, the worker computes the current dashboard semantics once and then emits additive contributions to the fixed data cube:

- normalized model name;
- cache tokens from `other`;
- input tokens, including Anthropic semantic cache handling;
- output and total tokens;
- attempt, success, and error contributions from `type`;
- valid first-token latency;
- valid total response time;
- valid per-request output tokens per second;
- range-local representative values used by legacy fallbacks: `MAX(user_id)`, `MAX(username)`, and `MAX(channel_name)`;
- first and latest use timestamps;
- all 16 dimension masks needed by the four current filter dimensions.

Averages are represented as `sum + count`, never as averages of averages. A normalized source contributes to at most `16 masks × 4 grains = 64` in-memory cells. This is a fixed upper bound independent of history size, and duplicate cells are combined before database upsert. Page queries calculate:

```text
average = accumulated_sum / accumulated_count
```

This preserves exact results when minute, hour, day, and all-time rows are combined.

The metric implementation has an integer `DASHBOARD_ROLLUP_VERSION`. Any formula change increments it and starts a new permanent build. A release that starts a replacement version must retain executable normalizers for both the active and building versions until activation, so live ingestion into the old active version remains correct during backfill.

## Time Semantics

Rollup-backed ranges use half-open intervals `[start, end)` aligned to minute boundaries.

- The worker exposes a watermark at the end of the latest closed minute supported by both processed event timestamps and the committed live cursor. If no logs arrive for hours, the anchor remains at the latest processed log minute, preserving the current dashboard's data-anchored fixed-range behavior. The watermark is capped at the current closed minute so a future-dated source row cannot move the dashboard into the future.
- `24h`, `7d`, and `30d` subtract their duration from this minute-aligned watermark.
- Custom inputs already have minute precision; the end input is converted to the next minute as the exclusive bound.
- Asia/Shanghai is used explicitly for calendar-day boundaries.

This removes the current inclusive-boundary ambiguity and permits exact composition from minute/hour/day rollups without reading individual source rows. Data in the currently open minute appears after that minute closes and the worker processes it.

## Bounded Worker

The worker starts from `src/instrumentation.ts`, following the existing background-sampler pattern, but maintains independent state and locking.

Conservative configurable defaults:

```text
DASHBOARD_ROLLUP_BATCH_SIZE=200
DASHBOARD_ROLLUP_PAUSE_MS=250
DASHBOARD_ROLLUP_STATEMENT_TIMEOUT_MS=5000
```

Rules:

- Exactly one source batch is processed at a time.
- Every source `SELECT` contains an explicit `LIMIT` no greater than the configured batch size.
- Pagination is keyset-based; no `OFFSET` is used.
- Each transaction executes `SET LOCAL max_parallel_workers_per_gather = 0`.
- Each transaction applies a local statement timeout.
- Batch parsing is performed in the Node process, keeping expensive JSON casts out of PostgreSQL.
- Rows are first claimed with `INSERT ... ON CONFLICT DO NOTHING RETURNING source_id`; only newly claimed IDs are normalized and grouped.
- Rows are grouped in memory before multi-row dimension and rollup upserts.
- The rollup updates and the corresponding cursor update commit in the same transaction.
- If any operation fails, both metrics and cursor roll back, making the batch retry-safe.
- A PostgreSQL transaction advisory lock ensures only one application instance processes a batch.
- The scheduler prevents overlapping runs inside one process.
- A pause occurs between batches so historical work cannot form an unbroken CPU loop.

### Scheduling Priority

At version initialization, bounded indexed lookups establish the lanes:

- `source_boundary_id` comes from `ORDER BY id DESC LIMIT 1`.
- `live_cursor_id` starts at `source_boundary_id`.
- `history_cursor_id` starts immediately above `source_boundary_id` and moves downward through every initial source row.
- If a verified time-leading index exists, the newest timestamp comes from `ORDER BY created_at DESC, id DESC LIMIT 1`; `recent_cutoff` is 31 days before that timestamp and the recent cursor starts at that cutoff.
- Numeric gaps observed between adjacent IDs are persisted for later bounded probing rather than assumed to be permanently absent.

The worker alternates bounded work rather than running an unbounded loop:

1. Keep the active version's live lane and due gap reconciliation current.
2. Keep the building version's live lane current.
3. Process one additional due ID-gap probe when scheduled.
4. While the building version's recent history is incomplete, process one recent batch after a configurable number of live batches.
5. After recent history completes, process building-version historical batches using the same weighted schedule.

During the first build there is no active-version lane. During a later formula rebuild, the old active version continues ingesting new rows while the new version backfills. Exactly one batch transaction runs at a time across all versions and instances.

The default weighting is three live opportunities for one backfill opportunity. If no live work exists, the worker can use that opportunity for backfill, but still observes the inter-batch pause.

### Live Lane

```sql
SELECT ...
FROM logs
WHERE id > $live_cursor_id
ORDER BY id ASC
LIMIT $batch_size;
```

The transaction records any skipped numeric range between the prior cursor and returned IDs, claims unprocessed source IDs, accumulates only newly claimed rows, and advances `live_cursor_id` to the largest returned ID.

### Recent Lane

When a suitable leading `created_at` index exists, initialize `recent_cutoff` with enough safety coverage for the 30-day range and process:

```sql
SELECT ...
FROM logs
WHERE id <= $source_boundary_id
  AND created_at >= $recent_cutoff
  AND (created_at, id) > ($cursor_created_at, $cursor_id)
ORDER BY created_at ASC, id ASC
LIMIT $batch_size;
```

The recent query may overlap rows later visited by the historical lane. Processed-source claims make the overlap safe. The cutoff includes a one-day safety margin, so the initial lane covers at least 31 days. `recent_complete` becomes true only after this keyset query is exhausted, all fetched rows are durably claimed, the live lane has caught up, and recent-period ID gaps have passed a bounded grace/probe cycle. Permanently empty sequence gaps do not block readiness.

If the required time-leading index is absent, the application does not create it and does not run a potentially expensive recent query. It uses only the ID-based historical lane; `30d` remains unavailable until full history completes.

### Historical Lane

```sql
SELECT ...
FROM logs
WHERE id < $history_cursor_id
  AND id <= $source_boundary_id
ORDER BY id DESC
LIMIT $batch_size;
```

The transaction records numeric gaps between returned IDs, claims and accumulates only unprocessed rows, then moves `history_cursor_id` below the smallest returned ID. When the initial ID walk is exhausted and no immediately due gap probe contains a committed row, `history_complete` becomes true and `all` can be served. Permanently empty gaps remain on low-frequency bounded reconciliation without blocking readiness.

## Rollup Upsert

Each normalized source log contributes to all 16 fixed dimension masks at four grains: minute, hour, day, and all time. This creates at most 64 in-memory cells per source row before batch-level combination. Rows sharing a mask, dimension key, and bucket within the batch are combined in memory.

The database uses additive `INSERT ... ON CONFLICT DO UPDATE` operations:

- counts and sums are incremented;
- representative fields use the same `MAX` semantics as the legacy filtered aggregate;
- `first_used_at` uses `LEAST`;
- `latest_used_at` uses `GREATEST`.

The processed-source claim, all metric updates, gap-range changes, and cursor update occur only after all four grains are updated successfully and commit in the same transaction.

## Dashboard Query Path

### Scope

The first release routes these requests to rollups:

- `preset=30d`;
- `preset=all`;
- token-detail requests opened from either range;
- custom ranges longer than seven days once the required rollup coverage is ready.

Short presets retain their existing query path initially. This keeps the change focused while the new rollup is validated. The permanent schema supports moving all presets later without another data rebuild.

### Range Composition

A range query is decomposed into non-overlapping segments using the largest safe grain:

1. complete Asia/Shanghai days;
2. complete hours at the edges;
3. complete minutes at the remaining edges.

At most two partial-day regions and two partial-hour regions use finer grains. No source-log edge scan is needed.

`all` reads only `grain=all` rows for the exact masks needed by the request, independent of source-history length. An unfiltered summary is mask `0`; unfiltered rankings use masks `1`, `2`, `4`, and `8` instead of regrouping the full joint cube.

### One Shared Data Packet

The long-range page builds one request-local data promise shared by summary, ranking, stability, and trend sections. This is render-pass deduplication, not persistent or expiring storage. No timed response cache is introduced.

The SQL requests only the exact fixed masks needed for the current filters and outputs one data packet for:

- total summary;
- active user and channel counts;
- token, user, model, and channel rankings;
- model and channel stability;
- trend buckets.

It does not execute the current nine independent `logs` aggregates.

Long-range rollup reads use one database connection and one transaction with `SET LOCAL max_parallel_workers_per_gather = 0` plus a bounded statement timeout. A timeout renders the readiness/error state and never retries against `logs`.

Token detail uses a separate on-demand rollup query restricted to the selected token. It never falls back to raw logs for `30d` or `all`.

### Filter Semantics

For a current filter mask `F`:

- summary and trend read mask `F`;
- active-user count reads `F | user` and counts distinct non-null raw user IDs;
- active-channel count reads `F | channel` and counts distinct non-null raw channel IDs;
- each ranking or stability section reads `F | groupedDimension` and applies the legacy coalesce/regrouping semantics to nullable dimension values;
- token and channel ranking display fallbacks aggregate the range-local representative fields from the selected rollup rows;
- token detail adds the selected token bit and then uses the corresponding model/channel masks.

This means arbitrary current filter combinations remain exact without scanning and regrouping mask `15` for every request. The rollup dimension key preserves:

- token name substring;
- exact log username;
- normalized model name;
- channel ID.

Rankings regroup the selected joint dimensions by token, user, model, or channel. Current `tokens`, `users`, and `channels` tables remain the preferred display-name/status source, matching current behavior.

### Shell Queries

For rollup-backed ranges:

- time bounds and watermarks come from rollup state;
- model options come from `dashboard_rollup_dimensions`;
- users and channels continue to come from their dimension tables;
- no `MIN/MAX(logs.created_at)` or full-history model `DISTINCT` is executed.

## Readiness and UI Behavior

Readiness is explicit and never causes fallback computation:

- During the initial build with no active version, `30d` is ready when the building version has complete recent coverage through the live watermark. During later rebuilds, the old active version remains in use until atomic activation.
- `all` is ready only on an active version whose historical backfill is complete and whose live lane is current enough to expose a closed-minute watermark.
- A long custom range is ready when its start is at or after the processed historical lower bound.

If unavailable, the page renders a status panel such as:

```text
正在分批构建 30 天统计
已永久处理 1,240,000 条日志；页面不会执行全表计算。
```

Progress uses stored processed-row and cursor metadata. It does not issue `COUNT(*)` against `logs`.

If the worker is unhealthy, the panel includes the stored error and keeps long-range data unavailable. Existing completed active versions remain readable during a new-version rebuild.

## Permanent-History Semantics

Once a log contributes to a rollup, that contribution remains present.

- Deleting old `logs` rows does not reduce `all` statistics.
- Editing a processed source row is not reflected.
- New rows are incorporated by ID, including rows whose `created_at` points to an older time bucket.

This behavior is intentional: the rollup is a durable analytics record, not a cache of the current physical source table.

## Failure Handling

- Batch failure: transaction rollback; retry the same cursor later.
- malformed `other`: record zero for JSON-derived metrics, keep base token/count metrics, increment a worker diagnostic counter, and still commit the source claim with its safe normalized contribution;
- Hash collision: stop the worker and report an unhealthy state.
- Advisory lock unavailable: skip this attempt without error.
- Statement timeout: rollback the batch; log duration and retry later. Operators can lower batch size.
- Source table replacement or newest-ID regression behind the live cursor: stop and require an explicit new rollup version or operator reset. Deletion of already-processed old rows remains allowed.
- Missing recent index: skip the recent lane; continue safe ID-based history batches.
- Page query failure: show the section error boundary; never retry against raw logs for a long range.

## Observability

Log one compact record per completed or failed batch:

```text
lane, version, source_rows, grouped_rows, duration_ms,
from_cursor, to_cursor, processed_rows, lag_rows/lag_seconds
```

Expose rollup state through an internal query helper for the dashboard readiness panel. Do not expose database error details to unauthenticated browser clients beyond a safe status message.

## Alternatives Rejected

### Expiring Result Cache

Rejected because cache expiry still triggers the original wide computation and reproduces the CPU spike.

### Single Combined Raw-Log Query

A single filtered SQL query would reduce repeated scans, but `all` would still parse and aggregate the complete raw table in one request. It lowers total work but does not bound peak work.

### Periodically Refreshed Materialized View

Rejected because each refresh performs a large recomputation and moves the spike to a timer.

### Database Trigger on Every Log Insert

Triggers provide immediate incremental updates but add parsing, multiple rollup writes, and hot-row contention to the New API request transaction. A bounded asynchronous worker isolates analytics cost and permits explicit backpressure.

### Unbounded One-Time Backfill

Rejected because deployment would immediately reproduce the same saturation problem. Backfill must use the same hard limits as steady-state ingestion.

## Testing

Add focused unit tests for:

- metric extraction parity with the current cache-token, Anthropic input-token, first-token-latency, response-time, and output-speed formulas;
- dimension masks, hashing, and range-local representative-field updates preserve `NULL`, empty-string, zero, and legacy display semantics;
- all 16 masks are emitted exactly once per claimed source;
- minute/hour/Asia-Shanghai-day bucket selection;
- half-open range parsing and rollup range decomposition without overlap or gaps;
- in-batch grouping, processed-source claiming, and additive metric merging;
- live/recent/history overlap is idempotent;
- out-of-order source-ID commits are retained as bounded gap ranges and eventually processed;
- worker scheduling and non-overlap;
- readiness decisions for 30-day, all-time, and custom ranges;
- permanent-history behavior;
- formula-version rebuild keeps the active version's live lane current until atomic activation;
- long-range query selection never choosing the legacy raw path.

Add database-facing tests with a temporary fixture schema or mocked query layer for:

- transaction rollback leaves both rollups and cursor unchanged;
- retrying a failed batch does not double count;
- competing lanes claiming the same source ID do not double count;
- late rows inside recorded ID gaps are processed once;
- competing workers respect the advisory lock;
- all four grain upserts and cursor commit atomically;
- page queries for `30d` and `all` contain no `FROM logs` reference;
- token-detail under long ranges contains no `FROM logs` reference.

Parity fixtures compare legacy and rollup results for a small controlled log set across:

- no filters;
- each individual filter;
- combined filters;
- `30d`;
- `all`;
- custom minute-aligned ranges;
- malformed JSON follows the new safe behavior while valid fixtures preserve the previous metric results;
- boundary timestamps.

## Performance Acceptance Criteria

- A `30d` or `all` page request executes zero SQL statements against raw `logs` data.
- A long-range token-detail request executes zero SQL statements against raw `logs` data.
- Every worker source or gap-probe query has a keyset/range predicate and `LIMIT <= DASHBOARD_ROLLUP_BATCH_SIZE`.
- A source log is normalized and accumulated at most once per rollup version, even if overlapping lanes fetch it more than once.
- Only one worker batch transaction is active across all application instances.
- PostgreSQL parallel gather workers are disabled inside batch transactions.
- Restarting the application resumes from committed cursors without rebuilding completed rows.
- A formula-version rebuild does not stop live ingestion into the currently active version.
- Initial backfill and formula-version rebuild never execute an unbounded source query.
- Selecting `all` has query cost based on the exact requested all-time cube masks, not the number of source log rows or source-history duration.
- Unfiltered `all` summary reads one mask-0 all-time row; it does not scan the full joint-dimension rollup.

## Verification

Run after implementation:

```bash
node --experimental-strip-types --test src/lib/dashboard/**/*.test.ts
npx tsc --noEmit
npm run lint
npm run build
```

With a staging database, additionally inspect:

- catalog detection of `logs(id)` and any `(created_at, id)` index;
- worker batch logs and statement duration;
- request SQL logging proving no raw-log query for `30d`/`all`;
- `EXPLAIN (ANALYZE, BUFFERS)` for rollup page queries only;
- database and application CPU during sustained bounded backfill.

## Deployment and Rollout

1. Deploy schema and worker with long-range rollup reads disabled.
2. Verify live batches, advisory locking, transaction behavior, and CPU limits.
3. Allow recent/history backfill to progress under conservative defaults.
4. Enable `30d` automatically only after readiness criteria pass.
5. Compare controlled legacy and rollup fixtures before activating `all`.
6. Enable `all` only after historical completion.
7. Keep legacy long-range functions temporarily for rollback, but make them unreachable from the `30d`/`all` request dispatcher.
8. Remove legacy long-range code only after production parity and resource monitoring are satisfactory.

Rollback disables rollup-backed routing and the worker. It must not automatically re-enable expensive `30d`/`all` raw queries; those filters remain unavailable until an operator explicitly chooses otherwise.
