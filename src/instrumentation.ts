export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startQuotaBackgroundSampler } = await import("./lib/quota/background-sampler");
    startQuotaBackgroundSampler();
  }
}
