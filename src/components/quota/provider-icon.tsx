import type { ProviderType } from "@/types/quota";

import { QuotaIcons } from "@/components/quota/quota-icons";

const KimiIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" {...props}>
    <path d="M19.738 5.776c.163-.209.306-.4.457-.585.07-.087.064-.153-.004-.244-.655-.861-.717-1.817-.34-2.787.283-.73.909-1.072 1.674-1.145.477-.045.945.004 1.379.236.57.305.902.77 1.01 1.412.086.512.07 1.012-.075 1.508-.257.878-.888 1.333-1.753 1.448-.718.096-1.446.108-2.17.157-.056.004-.113 0-.178 0z" />
    <path d="M17.962 1.844h-4.326l-3.425 7.81H5.369V1.878H1.5V22h3.87v-8.477h6.824a3.025 3.025 0 002.743-1.75V22h3.87v-8.477a3.87 3.87 0 00-3.588-3.86v-.01h-2.125a3.94 3.94 0 002.323-2.12l2.545-5.689z" />
  </svg>
);

const GrokIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" {...props}>
    <title>Grok</title>
    <path
      fillRule="evenodd"
      d="M9.27 15.29l7.978-5.897c.391-.29.95-.177 1.137.272.98 2.369.542 5.215-1.41 7.169-1.951 1.954-4.667 2.382-7.149 1.406l-2.711 1.257c3.889 2.661 8.611 2.003 11.562-.953 2.341-2.344 3.066-5.539 2.388-8.42l.006.007c-.983-4.232.242-5.924 2.75-9.383.06-.082.12-.164.179-.248l-3.301 3.305v-.01L9.267 15.292M7.623 16.723c-2.792-2.67-2.31-6.801.071-9.184 1.761-1.763 4.647-2.483 7.166-1.425l2.705-1.25a7.808 7.808 0 00-1.829-1A8.975 8.975 0 005.984 5.83c-2.533 2.536-3.33 6.436-1.962 9.764 1.022 2.487-.653 4.246-2.34 6.022-.599.63-1.199 1.259-1.682 1.925l7.62-6.815"
    />
  </svg>
);

export function ProviderIcon({ type }: { type: ProviderType }) {
  switch (type) {
    case "antigravity":
      return <QuotaIcons.Antigravity className="h-4 w-4" />;
    case "claude":
      return <QuotaIcons.Spark className="h-4 w-4 text-orange-500" />;
    case "codex":
      return <QuotaIcons.OpenAI className="h-4 w-4 text-emerald-500" />;
    case "gemini-cli":
      return <QuotaIcons.Cloud className="h-4 w-4 text-blue-500" />;
    case "kimi":
      return <KimiIcon className="h-4 w-4 text-blue-600" />;
    case "minimax":
      return <QuotaIcons.Spark className="h-4 w-4 text-indigo-500" />;
    case "xai":
      return <GrokIcon className="h-4 w-4 text-[var(--foreground)]" />;
    case "zai":
      return <QuotaIcons.Spark className="h-4 w-4 text-cyan-500" />;
    default:
      return <QuotaIcons.Server className="h-4 w-4 text-[var(--foreground-faint)]" />;
  }
}
