import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "new-api-monitor",
  description: "new-api 多维度监控面板",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="min-h-full bg-slate-950 text-slate-100">{children}</body>
    </html>
  );
}
