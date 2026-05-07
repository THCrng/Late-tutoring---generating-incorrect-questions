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
  file_url: string;
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

// ── 导出报告渲染 ──────────────────────────────────────────────────────────────
function ExamReportView({ exams, onClose }: { exams: ExamRecord[]; onClose: () => void }) {
  // Group by year → grade → term
  const grouped: Record<string, Record<string, Record<string, ExamRecord[]>>> = {};
  for (const exam of exams) {
    const y = String(exam.year);
    const g = exam.grade;
    const t = exam.term;
    if (!grouped[y]) grouped[y] = {};
    if (!grouped[y][g]) grouped[y][g] = {};
    if (!grouped[y][g][t]) grouped[y][g][t] = [];
    grouped[y][g][t].push(exam);
  }

  return (
    <div className="report-overlay">
      <div className="report-toolbar no-print">
        <button className="btn-print" onClick={() => window.print()}>打印 / 导出PDF</button>
        <button className="btn-reset" onClick={onClose}>← 返回</button>
        <span style={{ fontSize: 13, color: "#666" }}>共 {exams.length} 份试卷分析报告</span>
      </div>

      <div className="report-body">
        <div className="report-cover a4-page">
          <h1 style={{ fontSize: 24, fontWeight: 900, marginBottom: 12 }}>试卷分析汇总报告</h1>
          <p style={{ color: "#555", marginBottom: 6 }}>我的学校 · 生成时间：{new Date().toLocaleDateString("zh-CN")}</p>
          <p style={{ color: "#555" }}>共收录 {exams.length} 份试卷，涵盖：{[...new Set(exams.map(e => e.subject))].join("、")}</p>
          <div style={{ marginTop: 24, borderTop: "1px solid #ddd", paddingTop: 16 }}>
            <strong>目录</strong>
            {Object.keys(grouped).sort((a, b) => Number(b) - Number(a)).map(year => (
              <div key={year} style={{ marginTop: 10 }}>
                <div style={{ fontWeight: 700, color: "#1a56db" }}>{year} 学年</div>
                {Object.keys(grouped[year]).map(grade => (
                  <div key={grade} style={{ marginLeft: 16, marginTop: 4 }}>
                    {grade}：{Object.keys(grouped[year][grade]).map(term => (
                      <span key={term} style={{ marginRight: 12 }}>
                        {term}（{grouped[year][grade][term].map(e => e.subject + e.exam_type).join("、")}）
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        {Object.keys(grouped).sort((a, b) => Number(b) - Number(a)).map(year =>
          Object.keys(grouped[year]).map(grade =>
            Object.keys(grouped[year][grade]).map(term =>
              grouped[year][grade][term].map(exam => (
                <div key={exam.id} className="a4-page report-exam-page">
                  <div className="report-exam-header">
                    <h2>{year}学年 · {grade} · {term}</h2>
                    <span className="report-badge">{exam.subject} {exam.exam_type}</span>
                  </div>

                  {exam.analysis && (
                    <>
                      <div className="report-section">
                        <div className="report-section-title">考点分布</div>
                        {exam.analysis.knowledgeDistribution?.slice(0, 8).map(kd => (
                          <div key={kd.topic} className="dist-bar-row" style={{ marginBottom: 4 }}>
                            <span className="dist-label">{kd.topic}</span>
                            <div className="dist-bar-bg">
                              <div className="dist-bar-fill" style={{ width: `${Math.min(kd.percentage, 100)}%` }} />
                            </div>
                            <span className="dist-pct">{kd.percentage}%</span>
                          </div>
                        ))}
                      </div>

                      <div className="report-grid">
                        <div className="report-section">
                          <div className="report-section-title">题型分布</div>
                          {exam.analysis.questionTypes?.map(qt => (
                            <div key={qt.type} style={{ fontSize: 12, marginBottom: 3 }}>
                              {qt.type}：{qt.count}题（{qt.percentage}%）
                            </div>
                          ))}
                        </div>
                        <div className="report-section">
                          <div className="report-section-title">难度分布</div>
                          <div style={{ fontSize: 12 }}>
                            <div>基础题：{exam.analysis.difficultyProfile?.basic}%</div>
                            <div>中等题：{exam.analysis.difficultyProfile?.medium}%</div>
                            <div>难题：{exam.analysis.difficultyProfile?.hard}%</div>
                            <div style={{ marginTop: 4, fontWeight: 700 }}>
                              难度系数：{exam.analysis.difficultyProfile?.coefficient}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="report-section">
                        <div className="report-section-title">高频考点</div>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {exam.analysis.keyFocusAreas?.map(k => (
                            <span key={k} className="kc-tag">{k}</span>
                          ))}
                        </div>
                      </div>

                      <div className="report-section">
                        <div className="report-section-title">出题风格</div>
                        <p style={{ fontSize: 12, lineHeight: 1.7 }}>{exam.analysis.schoolStyle}</p>
                      </div>

                      {exam.analysis.weaknessPatterns?.length > 0 && (
                        <div className="report-section">
                          <div className="report-section-title">学生易失分点</div>
                          <ul style={{ fontSize: 12, paddingLeft: 18, lineHeight: 1.7 }}>
                            {exam.analysis.weaknessPatterns.map((w, i) => <li key={i}>{w}</li>)}
                          </ul>
                        </div>
                      )}

                      <div className="report-section">
                        <div className="report-section-title">备考建议</div>
                        <p style={{ fontSize: 12, lineHeight: 1.7 }}>{exam.analysis.suggestions}</p>
                      </div>
                    </>
                  )}
                </div>
              ))
            )
          )
        )}
      </div>
    </div>
  );
}

// ── 主页面 ───────────────────────────────────────────────────────────────────
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
  const [selectedExam, setSelectedExam] = useState<ExamRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [showReport, setShowReport] = useState(false);

  // Filter state
  const [filterYear, setFilterYear] = useState("全部");
  const [filterGrade, setFilterGrade] = useState("全部");
  const [filterTerm, setFilterTerm] = useState("全部");
  const [filterSubject, setFilterSubject] = useState("全部");

  // Multi-select for export
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  async function fetchExams() {
    setLoading(true);
    try {
      const res = await fetch("/api/exams");
      if (res.ok) setExams(await res.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchExams(); }, []);

  // Apply filters client-side for instant response
  const filtered = exams.filter(e => {
    if (filterYear !== "全部" && String(e.year) !== filterYear) return false;
    if (filterGrade !== "全部" && e.grade !== filterGrade) return false;
    if (filterTerm !== "全部" && e.term !== filterTerm) return false;
    if (filterSubject !== "全部" && e.subject !== filterSubject) return false;
    return true;
  });

  const selectedForExport = exams.filter(e => selectedIds.has(e.id));

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelectedIds(new Set(filtered.map(e => e.id)));
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  async function handleDownload(exam: ExamRecord) {
    const { data, error } = await supabaseBrowser.storage
      .from("exams")
      .createSignedUrl(exam.file_url, 120); // 2-minute link
    if (error || !data) {
      alert("生成下载链接失败：" + error?.message);
      return;
    }
    const a = document.createElement("a");
    a.href = data.signedUrl;
    a.download = exam.file_name || exam.file_url;
    a.click();
  }

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
      const signedRes = await fetch("/api/upload/signed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bucket: "exams", fileName: file.name }),
      });
      const signedData = await signedRes.json();
      if (!signedRes.ok) throw new Error(signedData.error);

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
      setStatusMsg("✅ 分析完成！");
      setFile(null);
      fetchExams();
    } catch (err) {
      setUploadState("error");
      setStatusMsg(err instanceof Error ? err.message : "失败，请重试");
    }
  }

  if (showReport) {
    return <ExamReportView exams={selectedForExport} onClose={() => setShowReport(false)} />;
  }

  return (
    <div className="page-content">
      <h2 className="page-title">试卷积累</h2>
      <p className="page-desc">上传学校历届月考、期中、期末试卷（PDF），AI 深度挖掘考点侧重和出题规律，出题时自动参考学校风格。</p>

      {/* Upload card */}
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
          <input id="efile" type="file" accept=".pdf" style={{ display: "none" }}
            onChange={(e) => { setFile(e.target.files?.[0] || null); setUploadState("idle"); setStatusMsg(""); }} />
          {isDragging ? <p style={{ color: "#1a56db", fontWeight: 600 }}>松开鼠标上传</p>
            : file ? <p>📄 {file.name}<br /><span style={{ fontSize: 12, color: "#888" }}>{(file.size / 1024 / 1024).toFixed(1)} MB · 点击重新选择</span></p>
            : <p>📂 拖拽 PDF 到这里，或点击选择文件</p>}
        </div>

        {statusMsg && <div className={`status-msg ${uploadState}`}>{statusMsg}</div>}

        <button className="btn-generate" onClick={handleUpload}
          disabled={!file || uploadState === "uploading" || uploadState === "analyzing"}>
          {uploadState === "uploading" ? "上传中…" : uploadState === "analyzing" ? "AI分析中…" : "上传并分析试卷"}
        </button>
      </div>

      {/* Archive card */}
      <div className="card">
        {/* Filter row */}
        <div className="exam-filter-row">
          <span style={{ fontWeight: 700, fontSize: 15 }}>历届试卷（{filtered.length} / {exams.length}份）</span>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <select value={filterYear} onChange={(e) => setFilterYear(e.target.value)}>
              <option value="全部">全部学年</option>
              {YEARS.map(y => <option key={y} value={String(y)}>{y}年</option>)}
            </select>
            <select value={filterGrade} onChange={(e) => setFilterGrade(e.target.value)}>
              <option value="全部">全部年级</option>
              {GRADES.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
            <select value={filterTerm} onChange={(e) => setFilterTerm(e.target.value)}>
              <option value="全部">上/下学期</option>
              {TERMS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={filterSubject} onChange={(e) => setFilterSubject(e.target.value)}>
              <option value="全部">全部科目</option>
              {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>

        {/* Selection toolbar */}
        <div className="exam-select-toolbar">
          <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 13 }}>
            <input type="checkbox"
              checked={filtered.length > 0 && filtered.every(e => selectedIds.has(e.id))}
              onChange={(e) => e.target.checked ? selectAll() : clearSelection()} />
            全选筛选结果
          </label>
          {selectedIds.size > 0 && (
            <>
              <span style={{ fontSize: 13, color: "#666" }}>已选 {selectedIds.size} 份</span>
              <button className="btn-export-report" onClick={() => setShowReport(true)}>
                导出分析报告
              </button>
              <button className="btn-reset" style={{ padding: "6px 14px", fontSize: 13 }} onClick={clearSelection}>
                取消选择
              </button>
            </>
          )}
        </div>

        {loading ? (
          <p style={{ color: "#888", textAlign: "center" }}>加载中…</p>
        ) : filtered.length === 0 ? (
          <p style={{ color: "#888", textAlign: "center" }}>没有符合条件的试卷</p>
        ) : (
          <div className="exam-list">
            {filtered.map((exam) => (
              <div key={exam.id}
                className={`exam-card ${selectedExam?.id === exam.id ? "active" : ""} ${selectedIds.has(exam.id) ? "selected" : ""}`}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <input type="checkbox" style={{ marginTop: 3, cursor: "pointer" }}
                    checked={selectedIds.has(exam.id)}
                    onChange={() => toggleSelect(exam.id)}
                    onClick={(e) => e.stopPropagation()} />
                  <div style={{ flex: 1 }} onClick={() => setSelectedExam(selectedExam?.id === exam.id ? null : exam)}>
                    <div className="ec-header">
                      <span className="ec-title">{exam.year}年 {exam.term} · {exam.grade} {exam.subject} {exam.exam_type}</span>
                      <span className="ec-meta">{exam.file_name}</span>
                    </div>
                    <div className="ec-tags" style={{ marginTop: 4 }}>
                      {exam.analysis?.keyFocusAreas?.slice(0, 4).map(k => (
                        <span key={k} className="kc-tag">{k}</span>
                      ))}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
                      <span style={{ fontSize: 12, color: "#9ca3af" }}>点击展开分析报告</span>
                      <button
                        className="btn-download-exam"
                        onClick={(e) => { e.stopPropagation(); handleDownload(exam); }}
                      >
                        ⬇ 下载原卷
                      </button>
                    </div>

                    {selectedExam?.id === exam.id && exam.analysis && (
                      <div className="exam-analysis">
                        <div className="analysis-section">
                          <strong>考点分布</strong>
                          <div className="dist-bars">
                            {exam.analysis.knowledgeDistribution?.slice(0, 6).map(kd => (
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
                            {exam.analysis.questionTypes?.map(qt => (
                              <span key={qt.type} className="kc-tag">{qt.type} {qt.percentage}%</span>
                            ))}
                          </div>
                        </div>
                        <div className="analysis-section">
                          <strong>难度分布</strong>
                          <p>基础 {exam.analysis.difficultyProfile?.basic}% / 中等 {exam.analysis.difficultyProfile?.medium}% / 难 {exam.analysis.difficultyProfile?.hard}%（系数约 {exam.analysis.difficultyProfile?.coefficient}）</p>
                        </div>
                        <div className="analysis-section">
                          <strong>出题风格</strong>
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
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
