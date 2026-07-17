export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const [{ startQuotaBackgroundSampler }, { startDashboardRollupWorker }] =
      await Promise.all([
        import("./lib/quota/background-sampler"),
        import("./lib/dashboard/rollup-worker"),
      ]);
    startQuotaBackgroundSampler();
    startDashboardRollupWorker();
  }
}
