import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('http://localhost:3000'),
  title: 'Cost & Quote Workbench · 报价管控台',
  description:
    'A local project, cost, pricing, and review workbench. 本地项目成本、报价与评审工作台。',
  openGraph: {
    title: 'Cost & Quote Workbench · 报价管控台',
    description: 'Projects · Cost · Reviews / 项目 · 成本 · 评审',
    type: 'website',
    locale: 'zh_CN',
    images: [
      {
        url: '/og.png',
        width: 1200,
        height: 630,
        alt: '报价管控台 — 项目、成本、评审',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Cost & Quote Workbench · 报价管控台',
    description: 'Projects · Cost · Reviews / 项目 · 成本 · 评审',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
