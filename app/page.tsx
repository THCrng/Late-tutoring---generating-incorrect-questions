"use client";

import { useState } from "react";
import WorksheetPreview, {
  WorksheetData,
} from "../components/WorksheetPreview";

const GRADES = [
  "一年级",
  "二年级",
  "三年级",
  "四年级",
  "五年级",
  "六年级",
];

const TEXTBOOKS = ["人教版（PEP）"];

type State = "idle" | "loading" | "preview" | "error";

export default function Home() {
  const [gaps, setGaps] = useState("");
  const [grade, setGrade] = useState("三年级");
  const [textbook, setTextbook] = useState("人教版（PEP）");
  const [uiState, setUiState] = useState<State>("idle");
  const [worksheetData, setWorksheetData] = useState<WorksheetData | null>(
    null
  );
  const [errorMsg, setErrorMsg] = useState("");

  async function handleGenerate() {
    if (!gaps.trim()) return;
    setUiState("loading");
    setErrorMsg("");

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gaps, grade, textbook }),
      });

      let json: { error?: string } & Record<string, unknown>;
      try {
        json = await res.json();
      } catch {
        throw new Error(`服务器响应异常 (HTTP ${res.status})，请查看终端日志`);
      }

      if (!res.ok || json.error) {
        throw new Error(json.error || "未知错误");
      }
      setWorksheetData(json as WorksheetData);
      setUiState("preview");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "生成失败，请重试";
      setErrorMsg(msg);
      setUiState("error");
    }
  }

  if (uiState === "loading") {
    return (
      <div className="loading-wrap no-print">
        <div className="spinner" />
        <p>AI 正在根据人教版教材生成练习题…</p>
        <p style={{ fontSize: 13, color: "#888", marginTop: 6 }}>
          通常需要 10–20 秒
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
          <button className="btn-reset" onClick={() => setUiState("idle")}>
            ← 重新生成
          </button>
          <span style={{ fontSize: 13, color: "#666" }}>
            {worksheetData.grade} · {worksheetData.textbook} ·{" "}
            {worksheetData.date}
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
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </label>
        <label>
          教材版本
          <select
            value={textbook}
            onChange={(e) => setTextbook(e.target.value)}
          >
            {TEXTBOOKS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
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

      <p
        style={{
          marginTop: 16,
          fontSize: 12,
          color: "#888",
          textAlign: "center",
        }}
      >
        AI 将根据人教版教材知识点自动出题，生成后可直接打印
      </p>
    </div>
  );
}
