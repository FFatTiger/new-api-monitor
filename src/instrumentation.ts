export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const [{ startQuotaBackgroundSampler }, { startClickHouseSyncWorker }] =
      await Promise.all([
        import("./lib/quota/background-sampler"),
        import("./lib/clickhouse/sync-worker"),
      ]);
    startQuotaBackgroundSampler();
    startClickHouseSyncWorker();
  }
}
