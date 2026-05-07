import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "晚辅练习题生成器",
  description: "根据知识薄弱点自动生成人教版A4练习学案",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <nav className="main-nav no-print">
          <a href="/" className="nav-brand">晚辅助手</a>
          <div className="nav-links">
            <a href="/" className="nav-link">生成练习题</a>
            <a href="/knowledge" className="nav-link">知识库</a>
            <a href="/exams" className="nav-link">试卷积累</a>
          </div>
        </nav>
        <main>{children}</main>
      </body>
    </html>
  );
}
