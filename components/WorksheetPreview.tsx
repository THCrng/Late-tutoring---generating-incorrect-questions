"use client";

interface Exercise {
  number: number;
  type: "填空" | "计算" | "判断" | "应用" | "连线";
  difficulty: "基础" | "提升" | "挑战";
  instruction: string;
  items: string[];
  workSpace: number;
  hint?: string;
}

interface Section {
  topic: string;
  errorType: string;
  goal: string;
  exercises: Exercise[];
}

interface Page {
  pageNumber: number;
  sections: Section[];
}

export interface WorksheetData {
  studentName: string;
  date: string;
  grade: string;
  textbook: string;
  pages: Page[];
}

function WorkspaceLines({ count }: { count: number }) {
  return (
    <div className="workspace-box">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="workspace-line" />
      ))}
    </div>
  );
}

function ExerciseItem({ ex }: { ex: Exercise }) {
  const isChallenge = ex.difficulty === "挑战";

  return (
    <div className="exercise-block">
      <div className="exercise-header">
        <span className="ex-num">
          {["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"][
            ex.number - 1
          ] ?? ex.number}
        </span>
        <span className="ex-type">{ex.type}</span>
        {isChallenge && <span className="ex-diff-challenge">★ 挑战</span>}
      </div>

      <div className="exercise-instruction">{ex.instruction}</div>

      {ex.hint && <div className="hint-box">💡 {ex.hint}</div>}

      {ex.items.map((item, i) => (
        <div key={i} className="item-line">
          {item}
        </div>
      ))}

      {ex.type === "应用" ? (
        <div className="answer-lines">
          <div className="answer-line">
            <span className="answer-label">算式：</span>
            <div className="answer-blank" />
          </div>
          <div className="answer-line">
            <span className="answer-label">答：</span>
            <div className="answer-blank" />
          </div>
        </div>
      ) : ex.workSpace > 0 ? (
        <WorkspaceLines count={ex.workSpace} />
      ) : null}
    </div>
  );
}

function SectionBlock({ section }: { section: Section }) {
  return (
    <div className="section-block">
      <div className="section-title">
        【{section.topic}】
        {section.errorType && (
          <span
            style={{ fontSize: "9pt", fontWeight: 400, marginLeft: 8, color: "#555" }}
          >
            错因：{section.errorType}
          </span>
        )}
      </div>
      {section.goal && (
        <div className="section-goal">目标：{section.goal}</div>
      )}
      {section.exercises.map((ex) => (
        <ExerciseItem key={ex.number} ex={ex} />
      ))}
    </div>
  );
}

export default function WorksheetPreview({ data }: { data: WorksheetData }) {
  return (
    <div className="worksheet-wrap">
      {data.pages.map((page) => (
        <div key={page.pageNumber} className="a4-page">
          <div className="page-header">
            <h2>晚辅练习学案</h2>
            <div className="page-meta">
              <span>
                姓名：
                <span
                  style={{
                    display: "inline-block",
                    width: 80,
                    borderBottom: "1px solid #555",
                  }}
                />
              </span>
              <span>
                {data.grade} · {data.textbook}
              </span>
              <span>{data.date}</span>
              <span>第 {page.pageNumber} 页 / 共 {data.pages.length} 页</span>
            </div>
          </div>
          {page.sections.map((section, i) => (
            <SectionBlock key={i} section={section} />
          ))}
        </div>
      ))}
    </div>
  );
}
