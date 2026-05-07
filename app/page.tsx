"use client";

import { useState } from "react";
import WorksheetPreview, {
  WorksheetData,
} from "../components/WorksheetPreview";

const GRADES = ["一年级", "二年级", "三年级", "四年级", "五年级", "六年级"];
const TEXTBOOKS = ["人教版（PEP）"];

const DIFFICULTY_OPTIONS = [
  { value: "0.90", label: "0.90 — 很容易（基础巩固）" },
  { value: "0.85", label: "0.85 — 较易" },
  { value: "0.80", label: "0.80 — 中等（推荐）" },
  { value: "0.75", label: "0.75 — 中等偏难" },
  { value: "0.70", label: "0.70 — 较难" },
  { value: "0.65", label: "0.65 — 困难（能力拔高）" },
];

type State = "idle" | "loading" | "preview" | "error";

export default function Home() {
  const [gaps, setGaps] = useState("");
  const [grade, setGrade] = useState("三年级");
  const [textbook, setTextbook] = useState("人教版（PEP）");
  const [difficulty, setDifficulty] = useState("0.80");
  const [uiState, setUiState] = useState<State>("idle");
  const [worksheetData, setWorksheetData] = useState<WorksheetData | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [exporting, setExporting] = useState(false);

  async function handleGenerate() {
    if (!gaps.trim()) return;
    setUiState("loading");
    setErrorMsg("");

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gaps, grade, textbook, difficulty }),
      });

      let json: unknown;
      try {
        json = await res.json();
      } catch {
        throw new Error(`服务器响应异常 (HTTP ${res.status})，请查看终端日志`);
      }

      const data = json as { error?: string } & Record<string, unknown>;
      if (!res.ok || data.error) {
        throw new Error(data.error || "未知错误");
      }
      setWorksheetData(data as unknown as WorksheetData);
      setUiState("preview");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "生成失败，请重试";
      setErrorMsg(msg);
      setUiState("error");
    }
  }

  async function handleExportPDF() {
    setExporting(true);
    try {
      const { default: html2pdf } = await import("html2pdf.js");
      const element = document.querySelector(".worksheet-wrap");
      if (!element) return;
      const filename = `练习题_${worksheetData?.grade}_${worksheetData?.date}.pdf`;
      await html2pdf()
        .set({
          margin: 0,
          filename,
          image: { type: "jpeg", quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true },
          jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
          pagebreak: { mode: ["css", "legacy"] },
        })
        .from(element)
        .save();
    } finally {
      setExporting(false);
    }
  }

  if (uiState === "loading") {
    return (
      <div className="loading-wrap no-print">
        <div className="spinner" />
        <p>AI 正在根据人教版教材生成练习题…</p>
        <p style={{ fontSize: 13, color: "#888", marginTop: 6 }}>
          通常需要 15–30 秒
        </p>
      </div>
    );
  }

  if (uiState === "error") {
    return (
      <div className="error-box no-print">
        <p style={{ fontWeight: 700, marginBottom: 8 }}>生成失败</p>
        <p style={{ fontSize: 14 }}>{errorMsg}</p>
        <button
          className="btn-generate"
          style={{ marginTop: 16, width: "auto", padding: "10px 24px" }}
          onClick={() => setUiState("idle")}
        >
          返回重试
        </button>
      </div>
    );
  }

  if (uiState === "preview" && worksheetData) {
    return (
      <>
        <div className="print-toolbar no-print">
          <button className="btn-print" onClick={() => window.print()}>
            打印（2页A4）
          </button>
          <button
            className="btn-pdf"
            onClick={handleExportPDF}
            disabled={exporting}
          >
            {exporting ? "生成中…" : "导出 PDF"}
          </button>
          <button className="btn-reset" onClick={() => setUiState("idle")}>
            ← 重新生成
          </button>
          <span style={{ fontSize: 13, color: "#666" }}>
            {worksheetData.grade} · {worksheetData.textbook} · 难度{difficulty} · {worksheetData.date}
          </span>
        </div>
        <WorksheetPreview data={worksheetData} />
      </>
    );
  }

  // idle state
  return (
    <div className="input-area no-print">
      <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 20 }}>
        晚辅练习题生成器
      </h1>

      <div className="selector-row">
        <label>
          年级
          <select value={grade} onChange={(e) => setGrade(e.target.value)}>
            {GRADES.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        </label>
        <label>
          教材版本
          <select value={textbook} onChange={(e) => setTextbook(e.target.value)}>
            {TEXTBOOKS.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </label>
        <label>
          试卷难度系数
          <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
            {DIFFICULTY_OPTIONS.map((d) => (
              <option key={d.value} value={d.value}>{d.label}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="difficulty-hint">
        难度系数 = 预期平均分 ÷ 满分。系数越小题目越难，0.80 表示预期得分约 80%。
      </div>

      <textarea
        value={gaps}
        onChange={(e) => setGaps(e.target.value)}
        placeholder={"输入今天记录的知识薄弱点，每行一个或用逗号分隔，例如：\n分数化简\n带小数点的竖式除法\n多边形内角和公式"}
      />

      <button
        className="btn-generate"
        onClick={handleGenerate}
        disabled={!gaps.trim()}
      >
        生成练习题（2页A4）
      </button>

      <p style={{ marginTop: 16, fontSize: 12, color: "#888", textAlign: "center" }}>
        AI 将根据人教版教材知识点自动出题，生成后可直接打印或导出 PDF
      </p>
    </div>
  );
}
