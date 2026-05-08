"use client";

interface Exercise {
  number: number;
  type: "填空" | "计算" | "判断" | "应用" | "连线";
  instruction: string;
  items: string[];
  socratesHint?: string;
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

const CIRCLE_NUMS = [
  "①","②","③","④","⑤","⑥","⑦","⑧","⑨","⑩",
  "⑪","⑫","⑬","⑭","⑮","⑯","⑰","⑱","⑲","⑳",
];

function ExerciseItem({ ex }: { ex: Exercise }) {
  return (
    <div className="exercise-block">
      <div className="exercise-header">
        <span className="ex-num">
          {CIRCLE_NUMS[ex.number - 1] ?? ex.number}
        </span>
        <span className="ex-type">{ex.type}</span>
      </div>

      <div className="exercise-instruction">{ex.instruction}</div>

      {ex.items.map((item, i) => (
        <div key={i} className="item-line">{item}</div>
      ))}

      {ex.socratesHint && (
        <div className="socrates-hint">
          💭 {ex.socratesHint}
        </div>
      )}
    </div>
  );
}

function SectionBlock({ section }: { section: Section }) {
  return (
    <div className="section-block">
      <div className="section-title">
        【{section.topic}】
        {section.errorType && (
          <span style={{ fontSize: "9pt", fontWeight: 400, marginLeft: 8, color: "#555" }}>
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
                <span style={{
                  display: "inline-block",
                  width: 80,
                  borderBottom: "1px solid #555",
                }} />
              </span>
              <span>{data.grade} · {data.textbook}</span>
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
