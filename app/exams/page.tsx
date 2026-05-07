"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";

const SUBJECTS = ["数学", "语文", "英语"];
const GRADES = ["一年级", "二年级", "三年级", "四年级", "五年级", "六年级", "初一", "初二", "初三"];
const EXAM_TYPES = ["月考", "期中", "期末"];
const TERMS = ["上学期", "下学期"];
const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - i);

interface ExamQuestion {
  number: string;
  type: string;
  score: number;
  content: string;
  specificItems: string[];
  knowledgePoints: string[];
}

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
    questions: ExamQuestion[];
    knowledgeDistribution: Array<{
      topic: string;
      percentage: number;
      specificContent: string;
      sourceQuestions: string[];
    }>;
    questionTypes: Array<{ type: string; count: number; percentage: number }>;
    difficultyProfile: { basic: number; medium: number; hard: number; coefficient: number };
    schoolStyle: string;
    keyFocusAreas: string[];
    weaknessPatterns: string[];
    suggestions: string[];
  };
  created_at: string;
}

type ItemStatus = "waiting" | "uploading" | "analyzing" | "done" | "error";

interface FileMeta {
  subject: string;
  grade: string;
  examType: string;
  year: number;
  term: string;
}

interface QueueItem {
  id: string;
  file: File;
  status: ItemStatus;
  meta: FileMeta;
  error?: string;
}

// ── 文件名解析器 ──────────────────────────────────────────────────────────────
function parseFilename(filename: string, defaults: FileMeta): FileMeta {
  const name = filename.replace(/\.pdf$/i, "");

  // 年份：优先取4位数字
  const yearMatch = name.match(/20(\d{2})/);
  const year = yearMatch ? parseInt("20" + yearMatch[1]) : defaults.year;

  // 年级
  const gradeMap: [RegExp, string][] = [
    [/初三|九年级|9年级/, "初三"],
    [/初二|八年级|8年级/, "初二"],
    [/初一|七年级|7年级/, "初一"],
    [/六年级|6年级/, "六年级"],
    [/五年级|5年级/, "五年级"],
    [/四年级|4年级/, "四年级"],
    [/三年级|3年级/, "三年级"],
    [/二年级|2年级/, "二年级"],
    [/一年级|1年级/, "一年级"],
  ];
  let grade = defaults.grade;
  for (const [re, val] of gradeMap) {
    if (re.test(name)) { grade = val; break; }
  }

  // 考试类型
  let examType = defaults.examType;
  if (/期末/.test(name)) examType = "期末";
  else if (/期中/.test(name)) examType = "期中";
  else if (/月考/.test(name)) examType = "月考";
  else if (/单元考|单元测|单元/.test(name)) examType = "月考";

  // 学期/册次
  let term = defaults.term;
  if (/下学期|第二学期|下册|二学期/.test(name)) term = "下学期";
  else if (/上学期|第一学期|上册|一学期/.test(name)) term = "上学期";

  // 学科
  let subject = defaults.subject;
  if (/语文/.test(name)) subject = "语文";
  else if (/数学/.test(name)) subject = "数学";
  else if (/英语/.test(name)) subject = "英语";

  return { year, grade, examType, term, subject };
}

// ── 导出报告渲染 ──────────────────────────────────────────────────────────────
function ExamReportView({ exams, onClose }: { exams: ExamRecord[]; onClose: () => void }) {
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
                      {/* 题目清单 */}
                      {exam.analysis.questions?.length > 0 && (
                        <div className="report-section">
                          <div className="report-section-title">题目清单</div>
                          {exam.analysis.questions.map((q, i) => (
                            <div key={i} className="report-question-block">
                              <div className="report-question-header">
                                <span className="rq-number">{q.number}</span>
                                <span className="rq-type">{q.type}</span>
                                {q.score > 0 && <span className="rq-score">{q.score}分</span>}
                              </div>
                              {q.specificItems?.length > 0 && (
                                <div className="rq-items">
                                  {q.specificItems.map((item, j) => <span key={j} className="rq-item">{item}</span>)}
                                </div>
                              )}
                              {q.knowledgePoints?.length > 0 && (
                                <div className="rq-kp">
                                  考查：{q.knowledgePoints.join("；")}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* 考点分布（含具体内容） */}
                      <div className="report-section">
                        <div className="report-section-title">考点分布</div>
                        {exam.analysis.knowledgeDistribution?.slice(0, 8).map(kd => (
                          <div key={kd.topic} style={{ marginBottom: 8 }}>
                            <div className="dist-bar-row">
                              <span className="dist-label">{kd.topic}</span>
                              <div className="dist-bar-bg"><div className="dist-bar-fill" style={{ width: `${Math.min(kd.percentage, 100)}%` }} /></div>
                              <span className="dist-pct">{kd.percentage}%</span>
                            </div>
                            {kd.specificContent && (
                              <div style={{ fontSize: 11, color: "#555", marginTop: 2, paddingLeft: 4 }}>
                                {kd.specificContent}
                                {kd.sourceQuestions?.length > 0 && <span style={{ color: "#9ca3af" }}> 【{kd.sourceQuestions.join("、")}】</span>}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>

                      <div className="report-grid">
                        <div className="report-section">
                          <div className="report-section-title">题型分布</div>
                          {exam.analysis.questionTypes?.map(qt => (
                            <div key={qt.type} style={{ fontSize: 12, marginBottom: 3 }}>{qt.type}：{qt.count}题（{qt.percentage}%）</div>
                          ))}
                        </div>
                        <div className="report-section">
                          <div className="report-section-title">难度分布</div>
                          <div style={{ fontSize: 12 }}>
                            <div>基础题：{exam.analysis.difficultyProfile?.basic}%</div>
                            <div>中等题：{exam.analysis.difficultyProfile?.medium}%</div>
                            <div>难题：{exam.analysis.difficultyProfile?.hard}%</div>
                            <div style={{ marginTop: 4, fontWeight: 700 }}>难度系数：{exam.analysis.difficultyProfile?.coefficient}</div>
                          </div>
                        </div>
                      </div>

                      <div className="report-section">
                        <div className="report-section-title">高频考点（含规律）</div>
                        <ul style={{ fontSize: 12, paddingLeft: 18, lineHeight: 1.8 }}>
                          {exam.analysis.keyFocusAreas?.map((k, i) => <li key={i}>{k}</li>)}
                        </ul>
                      </div>

                      <div className="report-section">
                        <div className="report-section-title">出题风格</div>
                        <p style={{ fontSize: 12, lineHeight: 1.7 }}>{exam.analysis.schoolStyle}</p>
                      </div>

                      {exam.analysis.weaknessPatterns?.length > 0 && (
                        <div className="report-section">
                          <div className="report-section-title">学生易失分点</div>
                          <ul style={{ fontSize: 12, paddingLeft: 18, lineHeight: 1.8 }}>
                            {exam.analysis.weaknessPatterns.map((w, i) => <li key={i}>{w}</li>)}
                          </ul>
                        </div>
                      )}

                      {exam.analysis.suggestions?.length > 0 && (
                        <div className="report-section">
                          <div className="report-section-title">备考建议</div>
                          <ul style={{ fontSize: 12, paddingLeft: 18, lineHeight: 1.8 }}>
                            {(Array.isArray(exam.analysis.suggestions)
                              ? exam.analysis.suggestions
                              : [exam.analysis.suggestions]
                            ).map((s, i) => <li key={i}>{s}</li>)}
                          </ul>
                        </div>
                      )}
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

// ── 状态图标 ─────────────────────────────────────────────────────────────────
function StatusBadge({ status, error }: { status: ItemStatus; error?: string }) {
  const map: Record<ItemStatus, { label: string; cls: string }> = {
    waiting:   { label: "等待中", cls: "badge-waiting" },
    uploading: { label: "上传中…", cls: "badge-uploading" },
    analyzing: { label: "AI分析中…", cls: "badge-analyzing" },
    done:      { label: "✅ 完成", cls: "badge-done" },
    error:     { label: "❌ 失败", cls: "badge-error" },
  };
  const { label, cls } = map[status];
  return (
    <span className={`queue-badge ${cls}`} title={error}>
      {status === "uploading" || status === "analyzing" ? <span className="queue-spinner" /> : null}
      {label}
    </span>
  );
}

// ── 主页面 ───────────────────────────────────────────────────────────────────
// Default fallback values when filename parsing yields nothing
const PARSE_DEFAULTS: FileMeta = {
  subject: "数学",
  grade: "三年级",
  examType: "期中",
  year: CURRENT_YEAR,
  term: "上学期",
};

export default function ExamsPage() {
  const [isDragging, setIsDragging] = useState(false);
  const [batchRunning, setBatchRunning] = useState(false);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const queueRef = useRef<QueueItem[]>([]);

  const [exams, setExams] = useState<ExamRecord[]>([]);
  const [selectedExam, setSelectedExam] = useState<ExamRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [showReport, setShowReport] = useState(false);

  const [filterYear, setFilterYear] = useState("全部");
  const [filterGrade, setFilterGrade] = useState("全部");
  const [filterTerm, setFilterTerm] = useState("全部");
  const [filterSubject, setFilterSubject] = useState("全部");
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

  const filtered = exams.filter(e => {
    if (filterYear !== "全部" && String(e.year) !== filterYear) return false;
    if (filterGrade !== "全部" && e.grade !== filterGrade) return false;
    if (filterTerm !== "全部" && e.term !== filterTerm) return false;
    if (filterSubject !== "全部" && e.subject !== filterSubject) return false;
    return true;
  });

  const selectedForExport = exams.filter(e => selectedIds.has(e.id));

  function toggleSelect(id: string) {
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function selectAll() { setSelectedIds(new Set(filtered.map(e => e.id))); }
  function clearSelection() { setSelectedIds(new Set()); }

  function handleDownload(exam: ExamRecord) {
    const { data } = supabaseBrowser.storage.from("exams").getPublicUrl(exam.file_url);
    const a = document.createElement("a");
    a.href = data.publicUrl;
    a.download = exam.file_name || exam.file_url;
    a.target = "_blank";
    a.click();
  }

  async function handleDelete(exam: ExamRecord) {
    if (!confirm(`确定删除「${exam.grade} ${exam.subject} ${exam.exam_type}」的记录？此操作不可恢复。`)) return;
    const res = await fetch(`/api/exams/${exam.id}`, { method: "DELETE" });
    if (res.ok) {
      setExams(prev => prev.filter(e => e.id !== exam.id));
      if (selectedExam?.id === exam.id) setSelectedExam(null);
    } else {
      const data = await res.json();
      alert("删除失败：" + (data.error || "未知错误"));
    }
  }

  // ── 添加文件到队列（自动解析文件名）──
  function addFiles(files: FileList | File[]) {
    const pdfs = Array.from(files).filter(f => f.name.toLowerCase().endsWith(".pdf"));
    if (pdfs.length === 0) return;
    const defaults = PARSE_DEFAULTS;
    const items: QueueItem[] = pdfs.map(f => ({
      id: `${Date.now()}-${Math.random()}`,
      file: f,
      status: "waiting",
      meta: parseFilename(f.name, defaults),
    }));
    setQueue(prev => {
      const next = [...prev, ...items];
      queueRef.current = next;
      return next;
    });
  }

  function updateItem(id: string, patch: Partial<QueueItem>) {
    setQueue(prev => {
      const next = prev.map(item => item.id === id ? { ...item, ...patch } : item);
      queueRef.current = next;
      return next;
    });
  }

  function updateItemMeta(id: string, metaPatch: Partial<FileMeta>) {
    setQueue(prev => {
      const next = prev.map(item =>
        item.id === id ? { ...item, meta: { ...item.meta, ...metaPatch } } : item
      );
      queueRef.current = next;
      return next;
    });
  }

  function removeItem(id: string) {
    setQueue(prev => {
      const next = prev.filter(item => item.id !== id);
      queueRef.current = next;
      return next;
    });
  }

  // ── 批量处理 ──
  async function startBatch() {
    const waiting = queueRef.current.filter(i => i.status === "waiting" || i.status === "error");
    if (waiting.length === 0) return;
    setBatchRunning(true);

    for (const item of waiting) {
      // Upload
      updateItem(item.id, { status: "uploading", error: undefined });
      let filePath: string;
      try {
        const signedRes = await fetch("/api/upload/signed", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bucket: "exams", fileName: item.file.name }),
        });
        const signedData = await signedRes.json();
        if (!signedRes.ok) throw new Error(signedData.error);

        const { error: uploadError } = await supabaseBrowser.storage
          .from("exams")
          .uploadToSignedUrl(signedData.filePath, signedData.token, item.file, {
            contentType: "application/pdf",
          });
        if (uploadError) throw new Error(uploadError.message);
        filePath = signedData.filePath;
      } catch (err) {
        updateItem(item.id, { status: "error", error: err instanceof Error ? err.message : "上传失败" });
        continue;
      }

      // Analyze — use per-file metadata
      updateItem(item.id, { status: "analyzing" });
      try {
        const m = item.meta;
        const baseBody = {
          filePath,
          school: "我的学校",
          subject: m.subject, grade: m.grade,
          examType: m.examType, year: m.year, term: m.term,
          fileName: item.file.name,
        };

        let res = await fetch("/api/exam/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(baseBody),
        });
        let data = await res.json();

        // Scanned PDF: ask server to render images and retry
        if (res.status === 422 && data.error === "NEEDS_VISION") {
          updateItem(item.id, { status: "analyzing", error: undefined });
          res = await fetch("/api/exam/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...baseBody, useVision: true }),
          });
          data = await res.json();
        }

        if (!res.ok) throw new Error(data.error);
        updateItem(item.id, { status: "done" });
      } catch (err) {
        updateItem(item.id, { status: "error", error: err instanceof Error ? err.message : "分析失败" });
      }
    }

    setBatchRunning(false);
    fetchExams();
  }

  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); }, []);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    addFiles(e.dataTransfer.files);
  }, []);

  const doneCount = queue.filter(i => i.status === "done").length;
  const errorCount = queue.filter(i => i.status === "error").length;
  const waitingCount = queue.filter(i => i.status === "waiting").length;

  if (showReport) {
    return <ExamReportView exams={selectedForExport} onClose={() => setShowReport(false)} />;
  }

  return (
    <div className="page-content">
      <h2 className="page-title">试卷积累</h2>
      <p className="page-desc">支持批量上传，AI 逐个深度分析考点和出题规律。</p>

      {/* Upload card */}
      <div className="card">
        <h3 className="card-title">批量上传试卷</h3>
        <p style={{ fontSize: 13, color: "#666", marginBottom: 10 }}>
          系统自动从文件名识别年份、年级、学期、科目、考试类型，识别后可逐条修改。
        </p>

        <div
          className={`upload-zone ${isDragging ? "dragging" : ""}`}
          onClick={() => document.getElementById("efile")?.click()}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <input
            id="efile" type="file" accept=".pdf" multiple style={{ display: "none" }}
            onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }}
          />
          {isDragging
            ? <p style={{ color: "#1a56db", fontWeight: 600 }}>松开鼠标添加到队列</p>
            : <p>📂 拖拽多个 PDF 到这里，或点击选择文件（支持多选）</p>}
        </div>

        {/* Queue list */}
        {queue.length > 0 && (
          <div className="batch-queue">
            <div className="batch-queue-header">
              <span>队列（{queue.length} 个文件 · 完成 {doneCount} · 失败 {errorCount} · 等待 {waitingCount}）</span>
              {!batchRunning && (
                <button className="btn-clear-queue" onClick={() => { setQueue([]); queueRef.current = []; }}>
                  清空队列
                </button>
              )}
            </div>
            <div className="batch-queue-list">
              {queue.map(item => {
                const editable = (item.status === "waiting" || item.status === "error") && !batchRunning;
                return (
                  <div key={item.id} className="batch-queue-item">
                    <div className="bq-row-top">
                      <span className="bq-name" title={item.file.name}>{item.file.name}</span>
                      <span className="bq-size">{(item.file.size / 1024 / 1024).toFixed(1)} MB</span>
                      <StatusBadge status={item.status} error={item.error} />
                      {editable && <button className="bq-remove" onClick={() => removeItem(item.id)}>✕</button>}
                    </div>
                    <div className="bq-meta-row">
                      <select disabled={!editable} value={item.meta.subject} onChange={e => updateItemMeta(item.id, { subject: e.target.value })}>
                        {SUBJECTS.map(s => <option key={s}>{s}</option>)}
                      </select>
                      <select disabled={!editable} value={item.meta.grade} onChange={e => updateItemMeta(item.id, { grade: e.target.value })}>
                        {GRADES.map(g => <option key={g}>{g}</option>)}
                      </select>
                      <select disabled={!editable} value={item.meta.examType} onChange={e => updateItemMeta(item.id, { examType: e.target.value })}>
                        {EXAM_TYPES.map(t => <option key={t}>{t}</option>)}
                      </select>
                      <select disabled={!editable} value={String(item.meta.year)} onChange={e => updateItemMeta(item.id, { year: Number(e.target.value) })}>
                        {YEARS.map(y => <option key={y} value={y}>{y}年</option>)}
                      </select>
                      <select disabled={!editable} value={item.meta.term} onChange={e => updateItemMeta(item.id, { term: e.target.value })}>
                        {TERMS.map(t => <option key={t}>{t}</option>)}
                      </select>
                    </div>
                    {item.error && <span className="bq-error">{item.error}</span>}
                  </div>
                );
              })}
            </div>
            <button
              className="btn-generate"
              onClick={startBatch}
              disabled={batchRunning || (waitingCount === 0 && errorCount === 0)}
              style={{ marginTop: 10 }}
            >
              {batchRunning
                ? `分析中…（${doneCount}/${queue.length} 完成）`
                : errorCount > 0 && waitingCount === 0
                  ? `重试失败项（${errorCount} 个）`
                  : `开始批量分析（${waitingCount + errorCount} 个）`}
            </button>
          </div>
        )}
      </div>

      {/* Archive card */}
      <div className="card">
        <div className="exam-filter-row">
          <span style={{ fontWeight: 700, fontSize: 15 }}>历届试卷（{filtered.length} / {exams.length}份）</span>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <select value={filterYear} onChange={e => setFilterYear(e.target.value)}>
              <option value="全部">全部学年</option>
              {YEARS.map(y => <option key={y} value={String(y)}>{y}年</option>)}
            </select>
            <select value={filterGrade} onChange={e => setFilterGrade(e.target.value)}>
              <option value="全部">全部年级</option>
              {GRADES.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
            <select value={filterTerm} onChange={e => setFilterTerm(e.target.value)}>
              <option value="全部">上/下学期</option>
              {TERMS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={filterSubject} onChange={e => setFilterSubject(e.target.value)}>
              <option value="全部">全部科目</option>
              {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>

        <div className="exam-select-toolbar">
          <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 13 }}>
            <input type="checkbox"
              checked={filtered.length > 0 && filtered.every(e => selectedIds.has(e.id))}
              onChange={e => e.target.checked ? selectAll() : clearSelection()} />
            全选筛选结果
          </label>
          {selectedIds.size > 0 && (
            <>
              <span style={{ fontSize: 13, color: "#666" }}>已选 {selectedIds.size} 份</span>
              <button className="btn-export-report" onClick={() => setShowReport(true)}>导出分析报告</button>
              <button className="btn-reset" style={{ padding: "6px 14px", fontSize: 13 }} onClick={clearSelection}>取消选择</button>
            </>
          )}
        </div>

        {loading ? (
          <p style={{ color: "#888", textAlign: "center" }}>加载中…</p>
        ) : filtered.length === 0 ? (
          <p style={{ color: "#888", textAlign: "center" }}>没有符合条件的试卷</p>
        ) : (
          <div className="exam-list">
            {filtered.map(exam => (
              <div key={exam.id} className={`exam-card ${selectedExam?.id === exam.id ? "active" : ""} ${selectedIds.has(exam.id) ? "selected" : ""}`}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <input type="checkbox" style={{ marginTop: 3, cursor: "pointer" }}
                    checked={selectedIds.has(exam.id)}
                    onChange={() => toggleSelect(exam.id)}
                    onClick={e => e.stopPropagation()} />
                  <div style={{ flex: 1 }} onClick={() => setSelectedExam(selectedExam?.id === exam.id ? null : exam)}>
                    <div className="ec-header">
                      <span className="ec-title">{exam.year}年 {exam.term} · {exam.grade} {exam.subject} {exam.exam_type}</span>
                      <span className="ec-meta">{exam.file_name}</span>
                    </div>
                    <div className="ec-tags" style={{ marginTop: 4 }}>
                      {exam.analysis?.keyFocusAreas?.slice(0, 4).map(k => <span key={k} className="kc-tag">{k}</span>)}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
                      <span style={{ fontSize: 12, color: "#9ca3af" }}>点击展开分析报告</span>
                      <button className="btn-download-exam" onClick={e => { e.stopPropagation(); handleDownload(exam); }}>⬇ 下载原卷</button>
                      <button className="btn-delete-exam" onClick={e => { e.stopPropagation(); handleDelete(exam); }}>删除</button>
                    </div>

                    {selectedExam?.id === exam.id && exam.analysis && (
                      <div className="exam-analysis">
                        {/* 题目清单 */}
                        {exam.analysis.questions?.length > 0 && (
                          <div className="analysis-section">
                            <strong>题目清单</strong>
                            {exam.analysis.questions.map((q, i) => (
                              <div key={i} className="card-question-block">
                                <div className="cq-header">
                                  <span className="cq-num">{q.number}</span>
                                  <span className="cq-type">{q.type}</span>
                                  {q.score > 0 && <span className="cq-score">{q.score}分</span>}
                                </div>
                                {q.specificItems?.length > 0 && (
                                  <div className="cq-items">
                                    {q.specificItems.map((item, j) => <span key={j} className="cq-item">{item}</span>)}
                                  </div>
                                )}
                                {q.knowledgePoints?.length > 0 && (
                                  <div className="cq-kp">考查：{q.knowledgePoints.join("；")}</div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}

                        {/* 考点分布（含具体内容） */}
                        <div className="analysis-section">
                          <strong>考点分布</strong>
                          <div className="dist-bars">
                            {exam.analysis.knowledgeDistribution?.slice(0, 6).map(kd => (
                              <div key={kd.topic} style={{ marginBottom: 6 }}>
                                <div className="dist-bar-row">
                                  <span className="dist-label">{kd.topic}</span>
                                  <div className="dist-bar-bg"><div className="dist-bar-fill" style={{ width: `${Math.min(kd.percentage, 100)}%` }} /></div>
                                  <span className="dist-pct">{kd.percentage}%</span>
                                </div>
                                {kd.specificContent && (
                                  <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>
                                    {kd.specificContent}
                                    {kd.sourceQuestions?.length > 0 && <span style={{ color: "#9ca3af" }}> 【{kd.sourceQuestions.join("、")}】</span>}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="analysis-section">
                          <strong>题型分布</strong>
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
                            {exam.analysis.questionTypes?.map(qt => <span key={qt.type} className="kc-tag">{qt.type} {qt.percentage}%</span>)}
                          </div>
                        </div>
                        <div className="analysis-section">
                          <strong>难度</strong>
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
                        {exam.analysis.suggestions?.length > 0 && (
                          <div className="analysis-section">
                            <strong>备考建议</strong>
                            <ul>
                              {(Array.isArray(exam.analysis.suggestions)
                                ? exam.analysis.suggestions
                                : [exam.analysis.suggestions]
                              ).map((s, i) => <li key={i}>{s}</li>)}
                            </ul>
                          </div>
                        )}
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
