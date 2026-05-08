"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { supabaseBrowser } from "@/lib/supabase-browser";

const MindMapView = dynamic(() => import("@/components/MindMapView"), { ssr: false });

const SUBJECTS = ["数学", "语文", "英语"];
const GRADES = ["一年级", "二年级", "三年级", "四年级", "五年级", "六年级", "初一", "初二", "初三"];
const TEXTBOOKS = ["人教版（2026版）", "广州教科版（2026版）", "广州沪教牛津版（2026版）"];
const VOLUMES = ["上册", "下册"];

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

interface KnowledgeTree {
  id: string;
  subject: string;
  grade: string;
  textbook: string;
  source_file: string;
  node_count: number;
  created_at: string;
  markdown: string;
}

type UploadState = "idle" | "uploading" | "processing" | "done" | "error";
type KnowledgeTab = "tree" | "list";

export default function KnowledgePage() {
  const router = useRouter();

  // Upload form state
  const [subject, setSubject] = useState("数学");
  const [grade, setGrade] = useState("三年级");
  const [textbook, setTextbook] = useState("人教版（2026版）");
  const [volume, setVolume] = useState("上册");
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [statusMsg, setStatusMsg] = useState("");

  // Tab state
  const [activeTab, setActiveTab] = useState<KnowledgeTab>("tree");

  // Mind map state
  const [trees, setTrees] = useState<KnowledgeTree[]>([]);
  const [selectedTree, setSelectedTree] = useState<KnowledgeTree | null>(null);
  const [treeLoading, setTreeLoading] = useState(true);
  const [selectedNodes, setSelectedNodes] = useState<string[]>([]);
  const [deletingTreeId, setDeletingTreeId] = useState<string | null>(null);

  // Flat list state
  const [points, setPoints] = useState<KnowledgePoint[]>([]);
  const [filterSubject, setFilterSubject] = useState("全部");
  const [filterGrade, setFilterGrade] = useState("全部");
  const [listLoading, setListLoading] = useState(true);

  async function fetchTrees() {
    setTreeLoading(true);
    try {
      const res = await fetch("/api/knowledge/tree");
      if (res.ok) {
        const data: KnowledgeTree[] = await res.json();
        setTrees(data);
        if (data.length > 0 && !selectedTree) setSelectedTree(data[0]);
      }
    } finally {
      setTreeLoading(false);
    }
  }

  async function fetchPoints() {
    setListLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterSubject !== "全部") params.set("subject", filterSubject);
      if (filterGrade !== "全部") params.set("grade", filterGrade);
      const res = await fetch(`/api/knowledge?${params}`);
      if (res.ok) setPoints(await res.json());
    } finally {
      setListLoading(false);
    }
  }

  useEffect(() => { fetchTrees(); }, []);
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
      const sizeMB = dropped.size / 1024 / 1024;
      if (sizeMB > 30) {
        setStatusMsg(`⚠️ 文件较大（${sizeMB.toFixed(0)}MB）。AI 每次只能读取约30页内容，建议按单元/章节拆分后分别上传，效果更好。`);
        setUploadState("error");
      } else {
        setStatusMsg("");
      }
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
      const signedRes = await fetch("/api/upload/signed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bucket: "knowledge", fileName: file.name }),
      });
      const signedData = await signedRes.json();
      if (!signedRes.ok) throw new Error(signedData.error);

      const { error: uploadError } = await supabaseBrowser.storage
        .from("knowledge")
        .uploadToSignedUrl(signedData.filePath, signedData.token, file, {
          contentType: "application/pdf",
        });
      if (uploadError) throw new Error("上传失败：" + uploadError.message);

      setUploadState("processing");
      setStatusMsg("AI 正在提取考点知识库 + 生成思维导图，请稍候（约60秒）…");

      const payload = {
        filePath: signedData.filePath,
        subject,
        grade,
        textbook: `${textbook}${volume}`,
        fileName: file.name,
      };

      // Call both APIs in parallel
      const [processRes, treeRes] = await Promise.all([
        fetch("/api/knowledge/process", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }),
        fetch("/api/knowledge/tree", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }),
      ]);

      const processData = await processRes.json();
      const treeData = await treeRes.json();

      if (!processRes.ok) throw new Error(processData.error);

      const treePart = treeRes.ok && treeData.nodeCount
        ? ` + 思维导图（${treeData.nodeCount} 个节点）`
        : "";
      setUploadState("done");
      setStatusMsg(`✅ 成功提取 ${processData.extracted} 个考点${treePart}！`);
      setFile(null);

      await Promise.all([fetchPoints(), fetchTrees()]);
    } catch (err) {
      setUploadState("error");
      setStatusMsg(err instanceof Error ? err.message : "上传失败，请重试");
    }
  }

  async function handleDeleteTree(id: string) {
    setDeletingTreeId(id);
    try {
      await fetch("/api/knowledge/tree", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      setTrees((prev) => prev.filter((t) => t.id !== id));
      if (selectedTree?.id === id) {
        const remaining = trees.filter((t) => t.id !== id);
        setSelectedTree(remaining[0] ?? null);
      }
    } finally {
      setDeletingTreeId(null);
    }
  }

  function handleNodeClick(label: string) {
    if (!selectedNodes.includes(label)) {
      setSelectedNodes((prev) => [...prev, label]);
    }
  }

  function removeNode(label: string) {
    setSelectedNodes((prev) => prev.filter((n) => n !== label));
  }

  function goGenerate() {
    sessionStorage.setItem("targetNodes", JSON.stringify(selectedNodes));
    router.push("/");
  }

  return (
    <div className="page-content">
      <h2 className="page-title">知识库管理</h2>
      <p className="page-desc">上传课本或教辅资料（电子版PDF），AI 自动提取考点并生成层级思维导图，可点击节点直接用于出题。</p>

      {/* Upload card */}
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
          <label>
            册次
            <select value={volume} onChange={(e) => setVolume(e.target.value)}>
              {VOLUMES.map((v) => <option key={v} value={v}>{v}</option>)}
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
              const picked = e.target.files?.[0] || null;
              setFile(picked);
              if (picked) {
                const sizeMB = picked.size / 1024 / 1024;
                if (sizeMB > 30) {
                  setStatusMsg(`⚠️ 文件较大（${sizeMB.toFixed(0)}MB）。AI 每次只能读取约30页内容，建议按单元/章节拆分后分别上传，效果更好。`);
                  setUploadState("error");
                } else {
                  setUploadState("idle");
                  setStatusMsg("");
                }
              }
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
           uploadState === "processing" ? "AI提取中（含思维导图）…" : "上传并提取考点 + 生成思维导图"}
        </button>
      </div>

      {/* Tab switcher */}
      <div className="knowledge-tabs">
        <button
          className={`knowledge-tab ${activeTab === "tree" ? "active" : ""}`}
          onClick={() => setActiveTab("tree")}
        >
          知识图谱（思维导图）
        </button>
        <button
          className={`knowledge-tab ${activeTab === "list" ? "active" : ""}`}
          onClick={() => setActiveTab("list")}
        >
          知识点列表（{points.length}个）
        </button>
      </div>

      {/* Mind map tab */}
      {activeTab === "tree" && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          {treeLoading ? (
            <p style={{ color: "#888", textAlign: "center", padding: 32 }}>加载中…</p>
          ) : trees.length === 0 ? (
            <p style={{ color: "#888", textAlign: "center", padding: 32 }}>暂无思维导图，请先上传教材</p>
          ) : (
            <div style={{ display: "flex", height: 600 }}>
              {/* Left sidebar: tree list */}
              <div className="tree-sidebar">
                {trees.map((t) => (
                  <div
                    key={t.id}
                    className={`tree-sidebar-item ${selectedTree?.id === t.id ? "active" : ""}`}
                    onClick={() => { setSelectedTree(t); setSelectedNodes([]); }}
                  >
                    <div className="tree-item-title">{t.subject} · {t.grade}</div>
                    <div className="tree-item-meta">{t.textbook}</div>
                    <div className="tree-item-meta">{t.node_count} 个节点</div>
                    <div className="tree-item-file" title={t.source_file}>{t.source_file}</div>
                    <button
                      className="tree-item-delete"
                      onClick={(e) => { e.stopPropagation(); handleDeleteTree(t.id); }}
                      disabled={deletingTreeId === t.id}
                    >
                      {deletingTreeId === t.id ? "…" : "删除"}
                    </button>
                  </div>
                ))}
              </div>

              {/* Right: mind map */}
              <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
                {selectedTree ? (
                  <>
                    <div className="mindmap-toolbar">
                      <span style={{ fontWeight: 600 }}>{selectedTree.subject} {selectedTree.grade} — {selectedTree.textbook}</span>
                      <span style={{ color: "#888", fontSize: 12 }}>点击节点可选中用于出题</span>
                    </div>
                    <div style={{ flex: 1, overflow: "hidden" }}>
                      <MindMapView
                        markdown={selectedTree.markdown}
                        height={490}
                        onNodeClick={handleNodeClick}
                      />
                    </div>

                    {/* Selected nodes for generation */}
                    {selectedNodes.length > 0 && (
                      <div className="mindmap-selected-bar">
                        <span style={{ fontSize: 13, color: "#555", marginRight: 8 }}>已选知识点：</span>
                        {selectedNodes.map((n) => (
                          <span key={n} className="mindmap-node-chip">
                            {n}
                            <button onClick={() => removeNode(n)}>×</button>
                          </span>
                        ))}
                        <button className="btn-use-nodes" onClick={goGenerate}>
                          用选中节点生成练习题 →
                        </button>
                      </div>
                    )}
                  </>
                ) : (
                  <p style={{ color: "#888", textAlign: "center", padding: 32 }}>请从左侧选择一份教材</p>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Flat list tab */}
      {activeTab === "list" && (
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

          {listLoading ? (
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
      )}
    </div>
  );
}
