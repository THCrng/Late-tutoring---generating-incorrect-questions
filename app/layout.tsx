import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "晚辅练习题生成器",
  description: "根据知识薄弱点自动生成人教版A4练习学案",
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
