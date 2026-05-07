"use client";

import { useState, useEffect, useCallback } from "react";

const SUBJECTS = ["数学", "语文", "英语"];
const GRADES = ["一年级", "二年级", "三年级", "四年级", "五年级", "六年级", "初一", "初二", "初三"];
const TEXTBOOKS = ["人教版（2026版）", "广州教科版（2026版）", "广州沪教牛津版（2026版）"];

interface KnowledgePoint {
  id: string;
  subject: string;
  grade: string;
  topic: string;
  keywords: string[];
  content: string;
  source_file: string;
  created_at: string;
}

type UploadState = "idle" | "uploading" | "processing" | "done" | "error";

export default function KnowledgePage() {
  const [subject, setSubject] = useState("数学");
  const [grade, setGrade] = useState("三年级");
  const [textbook, setTextbook] = useState("人教版（2026版）");
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [statusMsg, setStatusMsg] = useState("");

  const [points, setPoints] = useState<KnowledgePoint[]>([]);
  const [filterSubject, setFilterSubject] = useState("全部");
  const [filterGrade, setFilterGrade] = useState("全部");
  const [loading, setLoading] = useState(true);

  async function fetchPoints() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterSubject !== "全部") params.set("subject", filterSubject);
      if (filterGrade !== "全部") params.set("grade", filterGrade);
      const res = await fetch(`/api/knowledge?${params}`);
      if (res.ok) setPoints(await res.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchPoints(); }, [filterSubject, filterGrade]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped?.name.toLowerCase().endsWith(".pdf")) {
      setFile(dropped);
      setUploadState("idle");
      setStatusMsg("");
    } else if (dropped) {
      setStatusMsg("只支持PDF格式");
      setUploadState("error");
    }
  }, []);

  async function handleUpload() {
    if (!file) return;
    setUploadState("uploading");
    setStatusMsg("正在上传文件…");

    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("bucket", "knowledge");
      // No folder param — upload route uses timestamp-only key to avoid Chinese path issues

      const uploadRes = await fetch("/api/upload", { method: "POST", body: fd });
      const uploadData = await uploadRes.json();
      if (!uploadRes.ok) throw new Error(uploadData.error);

      setUploadState("processing");
      setStatusMsg("AI 正在提取考点知识库，请稍候（约30-60秒）…");

      const processRes = await fetch("/api/knowledge/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filePath: uploadData.filePath,
          subject,
          grade,
          textbook,
          fileName: file.name,
        }),
      });
      const processData = await processRes.json();
      if (!processRes.ok) throw new Error(processData.error);

      setUploadState("done");
      setStatusMsg(`✅ 成功提取 ${processData.extracted} 个考点！`);
      setFile(null);
      fetchPoints();
    } catch (err) {
      setUploadState("error");
      setStatusMsg(err instanceof Error ? err.message : "上传失败，请重试");
    }
  }

  return (
    <div className="page-content">
      <h2 className="page-title">知识库管理</h2>
      <p className="page-desc">上传人教版/教科版课本或教辅资料（PDF），AI 自动提取考点建立知识库，用于优化练习题生成质量。仅支持可选中文字的电子版PDF。</p>

      <div className="card">
        <h3 className="card-title">上传教材/教辅资料</h3>
        <div className="selector-row">
          <label>
            科目
            <select value={subject} onChange={(e) => setSubject(e.target.value)}>
              {SUBJECTS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
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
        </div>

        <div
          className={`upload-zone ${isDragging ? "dragging" : ""}`}
          onClick={() => document.getElementById("kfile")?.click()}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <input
            id="kfile"
            type="file"
            accept=".pdf"
            style={{ display: "none" }}
            onChange={(e) => {
              setFile(e.target.files?.[0] || null);
              setUploadState("idle");
              setStatusMsg("");
            }}
          />
          {isDragging ? (
            <p style={{ color: "#1a56db", fontWeight: 600 }}>松开鼠标上传</p>
          ) : file ? (
            <p>📄 {file.name}<br /><span style={{ fontSize: 12, color: "#888" }}>{(file.size / 1024 / 1024).toFixed(1)} MB · 点击重新选择</span></p>
          ) : (
            <p>📂 拖拽 PDF 到这里，或点击选择文件</p>
          )}
        </div>

        {statusMsg && (
          <div className={`status-msg ${uploadState}`}>{statusMsg}</div>
        )}

        <button
          className="btn-generate"
          onClick={handleUpload}
          disabled={!file || uploadState === "uploading" || uploadState === "processing"}
        >
          {uploadState === "uploading" ? "上传中…" :
           uploadState === "processing" ? "AI提取中…" : "上传并提取考点"}
        </button>
      </div>

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 className="card-title" style={{ margin: 0 }}>
            知识库（{points.length} 个考点）
          </h3>
          <div style={{ display: "flex", gap: 8 }}>
            <select value={filterSubject} onChange={(e) => setFilterSubject(e.target.value)}>
              <option value="全部">全部科目</option>
              {SUBJECTS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={filterGrade} onChange={(e) => setFilterGrade(e.target.value)}>
              <option value="全部">全部年级</option>
              {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
        </div>

        {loading ? (
          <p style={{ color: "#888", textAlign: "center" }}>加载中…</p>
        ) : points.length === 0 ? (
          <p style={{ color: "#888", textAlign: "center" }}>暂无知识点，请先上传教材</p>
        ) : (
          <div className="knowledge-list">
            {points.map((p) => (
              <div key={p.id} className="knowledge-card">
                <div className="kc-header">
                  <span className="kc-topic">{p.topic}</span>
                  <span className="kc-meta">{p.grade} · {p.subject}</span>
                </div>
                <div className="kc-keywords">
                  {p.keywords?.map((k) => <span key={k} className="kc-tag">{k}</span>)}
                </div>
                <div className="kc-content">{p.content}</div>
                <div className="kc-source">来源：{p.source_file}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
