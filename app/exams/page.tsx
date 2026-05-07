"use client";

import { useState, useEffect, useCallback } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";

const SUBJECTS = ["数学", "语文", "英语"];
const GRADES = ["一年级", "二年级", "三年级", "四年级", "五年级", "六年级", "初一", "初二", "初三"];
const EXAM_TYPES = ["月考", "期中", "期末"];
const TERMS = ["上学期", "下学期"];
const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - i);

interface ExamRecord {
  id: string;
  school: string;
  subject: string;
  grade: string;
  exam_type: string;
  year: number;
  term: string;
  file_name: string;
  analysis: {
    knowledgeDistribution: Array<{ topic: string; frequency: number; percentage: number }>;
    questionTypes: Array<{ type: string; count: number; percentage: number }>;
    difficultyProfile: { basic: number; medium: number; hard: number; coefficient: number };
    schoolStyle: string;
    keyFocusAreas: string[];
    typicalFormats: string[];
    weaknessPatterns: string[];
    suggestions: string;
  };
  created_at: string;
}

type UploadState = "idle" | "uploading" | "analyzing" | "done" | "error";

export default function ExamsPage() {
  const [subject, setSubject] = useState("数学");
  const [grade, setGrade] = useState("三年级");
  const [examType, setExamType] = useState("期中");
  const [year, setYear] = useState(CURRENT_YEAR);
  const [term, setTerm] = useState("上学期");
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [statusMsg, setStatusMsg] = useState("");

  const [exams, setExams] = useState<ExamRecord[]>([]);
  const [filterSubject, setFilterSubject] = useState("全部");
  const [selectedExam, setSelectedExam] = useState<ExamRecord | null>(null);
  const [loading, setLoading] = useState(true);

  async function fetchExams() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterSubject !== "全部") params.set("subject", filterSubject);
      const res = await fetch(`/api/exams?${params}`);
      if (res.ok) setExams(await res.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchExams(); }, [filterSubject]);

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
    setStatusMsg("正在上传试卷…");

    try {
      // Step 1: Get signed upload URL + token from server
      const signedRes = await fetch("/api/upload/signed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bucket: "exams", fileName: file.name }),
      });
      const signedData = await signedRes.json();
      if (!signedRes.ok) throw new Error(signedData.error);

      // Step 2: Upload directly to Supabase from browser using SDK (handles CORS + auth)
      const { error: uploadError } = await supabaseBrowser.storage
        .from("exams")
        .uploadToSignedUrl(signedData.filePath, signedData.token, file, {
          contentType: "application/pdf",
        });
      if (uploadError) throw new Error("上传失败：" + uploadError.message);

      const uploadData = { filePath: signedData.filePath };

      setUploadState("analyzing");
      setStatusMsg("AI 正在深度分析试卷考点和出题规律（约30-60秒）…");

      const analyzeRes = await fetch("/api/exam/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filePath: uploadData.filePath,
          school: "我的学校",
          subject,
          grade,
          examType,
          year,
          term,
          fileName: file.name,
        }),
      });
      const analyzeData = await analyzeRes.json();
      if (!analyzeRes.ok) throw new Error(analyzeData.error);

      setUploadState("done");
      setStatusMsg(`✅ 分析完成！`);
      setFile(null);
      fetchExams();
    } catch (err) {
      setUploadState("error");
      setStatusMsg(err instanceof Error ? err.message : "失败，请重试");
    }
  }

  return (
    <div className="page-content">
      <h2 className="page-title">试卷积累</h2>
      <p className="page-desc">上传学校历届月考、期中、期末试卷（PDF），AI 深度挖掘考点侧重和出题规律，出题时自动参考学校风格。</p>

      <div className="card">
        <h3 className="card-title">上传试卷</h3>
        <div className="selector-row">
          <label>科目
            <select value={subject} onChange={(e) => setSubject(e.target.value)}>
              {SUBJECTS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label>年级
            <select value={grade} onChange={(e) => setGrade(e.target.value)}>
              {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </label>
          <label>类型
            <select value={examType} onChange={(e) => setExamType(e.target.value)}>
              {EXAM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label>学年
            <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {YEARS.map((y) => <option key={y} value={y}>{y}年</option>)}
            </select>
          </label>
          <label>学期
            <select value={term} onChange={(e) => setTerm(e.target.value)}>
              {TERMS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
        </div>

        <div
          className={`upload-zone ${isDragging ? "dragging" : ""}`}
          onClick={() => document.getElementById("efile")?.click()}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <input
            id="efile"
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
          disabled={!file || uploadState === "uploading" || uploadState === "analyzing"}
        >
          {uploadState === "uploading" ? "上传中…" :
           uploadState === "analyzing" ? "AI分析中…" : "上传并分析试卷"}
        </button>
      </div>

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 className="card-title" style={{ margin: 0 }}>历届试卷（{exams.length}份）</h3>
          <select value={filterSubject} onChange={(e) => setFilterSubject(e.target.value)}>
            <option value="全部">全部科目</option>
            {SUBJECTS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        {loading ? (
          <p style={{ color: "#888", textAlign: "center" }}>加载中…</p>
        ) : exams.length === 0 ? (
          <p style={{ color: "#888", textAlign: "center" }}>暂无试卷，请先上传</p>
        ) : (
          <div className="exam-list">
            {exams.map((exam) => (
              <div
                key={exam.id}
                className={`exam-card ${selectedExam?.id === exam.id ? "active" : ""}`}
                onClick={() => setSelectedExam(selectedExam?.id === exam.id ? null : exam)}
              >
                <div className="ec-header">
                  <span className="ec-title">{exam.grade} {exam.subject} {exam.exam_type}</span>
                  <span className="ec-meta">{exam.year}年{exam.term}</span>
                </div>
                <div className="ec-tags">
                  {exam.analysis?.keyFocusAreas?.slice(0, 3).map((k) => (
                    <span key={k} className="kc-tag">{k}</span>
                  ))}
                </div>
                <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 4 }}>
                  {exam.file_name} · 点击查看分析报告
                </div>

                {selectedExam?.id === exam.id && exam.analysis && (
                  <div className="exam-analysis">
                    <div className="analysis-section">
                      <strong>考点分布</strong>
                      <div className="dist-bars">
                        {exam.analysis.knowledgeDistribution?.slice(0, 6).map((kd) => (
                          <div key={kd.topic} className="dist-bar-row">
                            <span className="dist-label">{kd.topic}</span>
                            <div className="dist-bar-bg">
                              <div className="dist-bar-fill" style={{ width: `${Math.min(kd.percentage, 100)}%` }} />
                            </div>
                            <span className="dist-pct">{kd.percentage}%</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="analysis-section">
                      <strong>题型分布</strong>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
                        {exam.analysis.questionTypes?.map((qt) => (
                          <span key={qt.type} className="kc-tag">
                            {qt.type} {qt.percentage}%
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="analysis-section">
                      <strong>难度分布</strong>
                      <p>基础 {exam.analysis.difficultyProfile?.basic}% / 中等 {exam.analysis.difficultyProfile?.medium}% / 难 {exam.analysis.difficultyProfile?.hard}%（估算难度系数 {exam.analysis.difficultyProfile?.coefficient}）</p>
                    </div>

                    <div className="analysis-section">
                      <strong>学校出题风格</strong>
                      <p>{exam.analysis.schoolStyle}</p>
                    </div>

                    {exam.analysis.weaknessPatterns?.length > 0 && (
                      <div className="analysis-section">
                        <strong>学生易失分点</strong>
                        <ul>{exam.analysis.weaknessPatterns.map((w, i) => <li key={i}>{w}</li>)}</ul>
                      </div>
                    )}

                    <div className="analysis-section">
                      <strong>备考建议</strong>
                      <p>{exam.analysis.suggestions}</p>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
