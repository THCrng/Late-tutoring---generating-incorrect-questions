"use client";

import { useState, useEffect } from "react";
import WorksheetPreview, { WorksheetData } from "../components/WorksheetPreview";

const GRADES = [
  "一年级", "二年级", "三年级", "四年级", "五年级", "六年级",
  "初一", "初二", "初三",
];

const TEXTBOOKS = [
  "人教版（2026版）",
  "广州教科版（2026版）",
  "广州沪教牛津版（2026版）",
];

const DIFFICULTY_OPTIONS = [
  { value: "0.90", label: "0.90 — 很容易（基础巩固）" },
  { value: "0.85", label: "0.85 — 较易" },
  { value: "0.80", label: "0.80 — 中等（推荐）" },
  { value: "0.75", label: "0.75 — 中等偏难" },
  { value: "0.70", label: "0.70 — 较难" },
  { value: "0.65", label: "0.65 — 困难（能力拔高）" },
];

const PAGE_COUNT_OPTIONS = [
  { value: "1", label: "1页" },
  { value: "2", label: "2页（推荐）" },
  { value: "3", label: "3页" },
  { value: "4", label: "4页" },
];

const VOLUME_OPTIONS = [
  { value: "", label: "不限" },
  { value: "上册", label: "上册" },
  { value: "下册", label: "下册" },
];

type State = "idle" | "loading" | "preview" | "error";
type InputMode = "gaps" | "wechat";

export default function Home() {
  const [inputMode, setInputMode] = useState<InputMode>("gaps");
  const [gaps, setGaps] = useState("");
  const [wechatText, setWechatText] = useState("");
  const [grade, setGrade] = useState("三年级");
  const [textbook, setTextbook] = useState("人教版（2026版）");
  const [volume, setVolume] = useState("");
  const [difficulty, setDifficulty] = useState("0.80");
  const [pageCount, setPageCount] = useState("2");
  const [uiState, setUiState] = useState<State>("idle");
  const [worksheetData, setWorksheetData] = useState<WorksheetData | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [exporting, setExporting] = useState(false);
  const [targetNodes, setTargetNodes] = useState<string[]>([]);

  useEffect(() => {
    const stored = sessionStorage.getItem("targetNodes");
    if (stored) {
      const nodes: string[] = JSON.parse(stored);
      sessionStorage.removeItem("targetNodes");
      if (nodes.length) {
        setTargetNodes(nodes);
        setGaps((prev) => prev || nodes.join("\n"));
      }
    }
  }, []);

  const canGenerate = inputMode === "gaps" ? !!gaps.trim() : !!wechatText.trim();

  async function handleGenerate() {
    if (!canGenerate) return;
    setUiState("loading");
    setErrorMsg("");

    try {
      const body = inputMode === "wechat"
        ? { wechatText, grade, textbook, volume, difficulty, pageCount, targetNodes }
        : { gaps, grade, textbook, volume, difficulty, pageCount, targetNodes };
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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
    const element = document.querySelector(".worksheet-wrap") as HTMLElement;
    if (!element) { setExporting(false); return; }

    // Remove inter-page screen margins so html2pdf paginates at exact A4 boundaries
    element.classList.add("exporting");
    try {
      const { default: html2pdf } = await import("html2pdf.js");
      const filename = `练习题_${worksheetData?.grade}_${worksheetData?.date}.pdf`;
      await html2pdf()
        .set({
          margin: 0,
          filename,
          image: { type: "jpeg", quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true },
          jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
        })
        .from(element)
        .save();
    } finally {
      element.classList.remove("exporting");
      setExporting(false);
    }
  }

  if (uiState === "loading") {
    return (
      <div className="loading-wrap no-print">
        <div className="spinner" />
        <p>AI 正在{inputMode === "wechat" ? "解析微信反馈并" : ""}根据{textbook}{volume ? `${volume}` : ""}教材生成练习题…</p>
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
            打印（{pageCount}页A4）
          </button>
          <button className="btn-pdf" onClick={handleExportPDF} disabled={exporting}>
            {exporting ? "生成中…" : "导出 PDF"}
          </button>
          <button className="btn-reset" onClick={() => setUiState("idle")}>
            ← 重新生成
          </button>
          <span style={{ fontSize: 13, color: "#666" }}>
            {worksheetData.grade} · {worksheetData.textbook}{volume ? ` ${volume}` : ""} · 难度{difficulty} · {worksheetData.date}
          </span>
        </div>
        <WorksheetPreview data={worksheetData} />
      </>
    );
  }

  return (
    <div className="input-area no-print">
      <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 20 }}>
        晚辅练习题生成器
      </h1>

      <div className="selector-row">
        <label>
          年级
          <select value={grade} onChange={(e) => setGrade(e.target.value)}>
            {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </label>
        <label>
          教材版本
          <select value={textbook} onChange={(e) => setTextbook(e.target.value)}>
            {TEXTBOOKS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label>
          上下册
          <select value={volume} onChange={(e) => setVolume(e.target.value)}>
            {VOLUME_OPTIONS.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
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
        <label>
          学案长度
          <select value={pageCount} onChange={(e) => setPageCount(e.target.value)}>
            {PAGE_COUNT_OPTIONS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="difficulty-hint">
        难度系数 = 预期平均分 ÷ 满分。系数越小题目越难，0.80 表示预期得分约 80%。
      </div>

      {/* 输入模式切换 */}
      <div style={{ display: "flex", gap: 0, marginBottom: 10, borderRadius: 8, overflow: "hidden", border: "1px solid #ccc" }}>
        <button
          onClick={() => setInputMode("gaps")}
          style={{
            flex: 1, padding: "9px 0", border: "none", cursor: "pointer", fontSize: 14, fontWeight: 600,
            background: inputMode === "gaps" ? "#1a56db" : "white",
            color: inputMode === "gaps" ? "white" : "#555",
            transition: "all 0.15s",
          }}
        >
          手动输入知识点
        </button>
        <button
          onClick={() => setInputMode("wechat")}
          style={{
            flex: 1, padding: "9px 0", border: "none", borderLeft: "1px solid #ccc", cursor: "pointer", fontSize: 14, fontWeight: 600,
            background: inputMode === "wechat" ? "#1a56db" : "white",
            color: inputMode === "wechat" ? "white" : "#555",
            transition: "all 0.15s",
          }}
        >
          微信反馈生成
        </button>
      </div>

      {inputMode === "gaps" ? (
        <textarea
          value={gaps}
          onChange={(e) => setGaps(e.target.value)}
          placeholder={"输入今天记录的知识薄弱点，每行一个或用逗号分隔，例如：\n分数化简\n带小数点的竖式除法\n多边形内角和公式"}
        />
      ) : (
        <textarea
          value={wechatText}
          onChange={(e) => setWechatText(e.target.value)}
          placeholder={"粘贴老师的微信反馈内容，AI 会自动提取学生薄弱点并出题。例如：\n\n今天孩子做作业，分数加减法老是搞错，尤其是异分母的那种\n应用题审题不仔细，单位换算也不太会"}
          style={{ height: 160 }}
        />
      )}

      <button
        className="btn-generate"
        onClick={handleGenerate}
        disabled={!canGenerate}
      >
        {inputMode === "wechat" ? "解析反馈并生成练习题" : "生成练习题"}（{pageCount}页A4）
      </button>

      <p style={{ marginTop: 16, fontSize: 12, color: "#888", textAlign: "center" }}>
        {inputMode === "wechat"
          ? "AI 将先从微信内容中提取薄弱点，再根据教材自动出题"
          : `AI 将根据${textbook}${volume ? volume : ""}知识点自动出题，生成后可直接打印或导出 PDF`}
      </p>
    </div>
  );
}
