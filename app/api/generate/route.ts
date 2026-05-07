import { NextRequest, NextResponse } from "next/server";
import { jsonrepair } from "jsonrepair";

// Conditionally import supabase — only works when env vars are set
async function getKnowledgeContext(grade: string, gaps: string): Promise<string> {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) return "";
  try {
    const { supabase } = await import("@/lib/supabase");
    const keywords = gaps.split(/[\n，,、]/).map((s) => s.trim()).filter(Boolean);
    const results: string[] = [];
    for (const kw of keywords.slice(0, 3)) {
      const { data } = await supabase
        .from("knowledge_points")
        .select("topic, content, keywords")
        .eq("grade", grade)
        .ilike("topic", `%${kw}%`)
        .limit(2);
      if (data?.length) {
        results.push(...data.map((d) => `【${d.topic}】${d.content}`));
      }
    }
    return results.length ? results.slice(0, 5).join("\n\n") : "";
  } catch {
    return "";
  }
}

async function getExamContext(grade: string, subject: string): Promise<string> {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) return "";
  try {
    const { supabase } = await import("@/lib/supabase");
    const { data } = await supabase
      .from("exams")
      .select("analysis, exam_type, year, term")
      .eq("grade", grade)
      .eq("subject", subject)
      .order("created_at", { ascending: false })
      .limit(3);
    if (!data?.length) return "";
    const styles = data
      .filter((e) => e.analysis?.schoolStyle)
      .map((e) => `${e.year}年${e.term}${e.analysis.exam_type ?? ""}：${e.analysis.schoolStyle}`)
      .join("\n");
    const focusAreas = [...new Set(data.flatMap((e) => e.analysis?.keyFocusAreas ?? []))].slice(0, 6);
    return `学校出题风格：\n${styles}\n\n高频考点：${focusAreas.join("、")}`;
  } catch {
    return "";
  }
}

function getDifficultyInfo(coeff: number): { desc: string; dist: string } {
  if (coeff >= 0.90) return {
    desc: "很容易",
    dist: "基础题占90%，提升题10%，不出挑战题",
  };
  if (coeff >= 0.85) return {
    desc: "较易",
    dist: "基础题占75%，提升题20%，挑战题5%",
  };
  if (coeff >= 0.80) return {
    desc: "中等（适合一般巩固）",
    dist: "基础题占60%，提升题30%，挑战题10%",
  };
  if (coeff >= 0.75) return {
    desc: "中等偏难",
    dist: "基础题占50%，提升题30%，挑战题20%",
  };
  if (coeff >= 0.70) return {
    desc: "较难",
    dist: "基础题占40%，提升题35%，挑战题25%",
  };
  return {
    desc: "困难（适合能力拔高）",
    dist: "基础题占30%，提升题35%，挑战题35%",
  };
}

const PROMPT_TEMPLATE = `你是一位专业的中国小学/初中练习册编写专家，深度熟悉【{{TEXTBOOK}}】{{GRADE}}的教材体系与考点分布。

## 专家身份说明
- 小学数学/语文（人教版2026版）：按照最新人教版编排，紧扣单元考点
- 小学数学/语文（广州教科版2026版）：按照广州教科版编排差异出题，避免与人教版混淆
- 初中英语（广州沪教牛津版2026版）：基于该版词汇表、语法体系和话题单元出题
- 其他学科版本参照通用课标

## 任务
根据以下学生的知识薄弱点，生成一份练习学案，共 {{PAGE_COUNT}} 页A4纸。

## 学生信息
- 年级：{{GRADE}}
- 教材版本：{{TEXTBOOK}}
- 试卷难度系数：{{DIFFICULTY}}（{{DIFFICULTY_DESC}}）

## 知识薄弱点
{{GAPS}}

## 生成规则

### 难度控制（严格执行）
难度系数 {{DIFFICULTY}}，题目整体比例：{{DIFFICULTY_DIST}}
不在单道题上标注"基础/提升/挑战"文字，整体分布符合系数即可。
挑战题在 instruction 开头加"★"标记。

### 内容规则
1. 每个知识点设计3-5道题，由简到难自然递进
2. 题型多样：填空、计算、判断、应用、连线，避免单一题型
3. 答案数字规则（重要）：
   - 不强制要求整数或标准分数
   - 若知识点本身涉及无理数、无限不循环小数、循环小数等，答案应如实反映该考点形态
   - 低年级（1-3年级）基础题优先使用整数或简单分数，但不强制
4. 出题内容严格对应【{{TEXTBOOK}}】{{GRADE}}的知识范围，不超纲也不降格

### 格式规则
1. 每道题用圆圈数字标号：①②③④⑤
2. socratesHint 字段（苏格拉底引导）：
   - 只给思考方向的问题，绝不直接或间接给出解题方法或答案
   - 正确示例："你能找到12和18都能被哪个最大的数整除吗？"
   - 错误示例："方法：用分子分母同除以最大公因数"（这是直接给方法，禁止）
   - 该字段可选，仅在题目有引导价值时添加
3. 不在题目中渲染"算式："或"答："固定行
4. JSON字符串内不得使用英文双引号（"），如需标注选项用（）括号代替

### 版面规则（严格遵守，这是打印约束）
- 共生成 {{PAGE_COUNT}} 页A4
- 每页物理约束：可打印高度 269mm，字号 11pt，行距 1.6，每页最多容纳 42 行内容
- 每个知识点最多出 4 道题，每道题的 items 最多 5 条
- 若知识点数量多，优先减少每个知识点的题量，确保不超页
- 宁可内容偏少也不要超出一页的物理限制，否则打印会溢出变成多页

## 输出格式
必须严格返回以下JSON结构，不要有任何额外文字或markdown代码块标记：

{
  "studentName": "",
  "date": "{{DATE}}",
  "grade": "{{GRADE}}",
  "textbook": "{{TEXTBOOK}}",
  "pages": [
    {
      "pageNumber": 1,
      "sections": [
        {
          "topic": "知识点名称",
          "errorType": "错因简述",
          "goal": "本节学习目标（一句话）",
          "exercises": [
            {
              "number": 1,
              "type": "填空",
              "instruction": "题目指导语",
              "items": ["具体题目第1行", "具体题目第2行"],
              "socratesHint": "引导思考的问题（可选，没有则省略该字段）"
            }
          ]
        }
      ]
    }
  ]
}

type 只能是以下之一："填空" | "计算" | "判断" | "应用" | "连线"`;

export async function POST(req: NextRequest) {
  try {
    const { gaps, grade, textbook, difficulty, pageCount } = await req.json();

    if (!gaps || !gaps.trim()) {
      return NextResponse.json({ error: "请输入知识薄弱点" }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey || apiKey.startsWith("请在")) {
      return NextResponse.json(
        { error: "请先在 .env.local 中填入有效的 API Key" },
        { status: 500 }
      );
    }

    const today = new Date().toLocaleDateString("zh-CN", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const diffCoeff = parseFloat(difficulty) || 0.80;
    const { desc, dist } = getDifficultyInfo(diffCoeff);
    const pages = parseInt(pageCount) || 2;

    // Query knowledge base and exam context from Supabase (optional)
    const resolvedGrade = grade || "三年级";
    const resolvedSubject = (() => {
      const t = textbook || "";
      if (t.includes("牛津")) return "英语";
      // Default: infer from gaps content
      return "数学";
    })();

    const [knowledgeContext, examContext] = await Promise.all([
      getKnowledgeContext(resolvedGrade, gaps.trim()),
      getExamContext(resolvedGrade, resolvedSubject),
    ]);

    const knowledgeSection = knowledgeContext
      ? `\n\n## 教材知识库参考（请结合以下考点内容出题）\n${knowledgeContext}`
      : "";
    const examSection = examContext
      ? `\n\n## 学校历年考试风格参考（请参考该校出题偏好）\n${examContext}`
      : "";

    const prompt = (PROMPT_TEMPLATE + knowledgeSection + examSection)
      .replace(/{{GAPS}}/g, gaps.trim())
      .replace(/{{DATE}}/g, today)
      .replace(/{{GRADE}}/g, resolvedGrade)
      .replace(/{{TEXTBOOK}}/g, textbook || "人教版（2026版）")
      .replace(/{{DIFFICULTY}}/g, diffCoeff.toFixed(2))
      .replace(/{{DIFFICULTY_DESC}}/g, desc)
      .replace(/{{DIFFICULTY_DIST}}/g, dist)
      .replace(/{{PAGE_COUNT}}/g, String(pages));

    const baseUrl = process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com";

    const apiRes = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 4096,
        stream: false,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!apiRes.ok) {
      const errBody = await apiRes.text();
      console.error("API error:", apiRes.status, errBody);
      return NextResponse.json(
        { error: `API请求失败 (${apiRes.status})` },
        { status: 500 }
      );
    }

    const apiData = await apiRes.json();
    const text: string = apiData.choices?.[0]?.message?.content ?? "";

    console.log("=== RAW MODEL OUTPUT (first 2000 chars) ===");
    console.log(text.slice(0, 2000));
    console.log("=== END ===");

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("No JSON found in response");
      return NextResponse.json(
        { error: "AI返回格式异常，请重试" },
        { status: 500 }
      );
    }

    let worksheet;
    try {
      const repaired = jsonrepair(jsonMatch[0]);
      worksheet = JSON.parse(repaired);
    } catch (parseErr) {
      console.error("JSON repair/parse error:", parseErr);
      console.error("Problematic JSON (first 1500 chars):", jsonMatch[0].slice(0, 1500));
      return NextResponse.json(
        { error: "AI返回格式异常，请重试" },
        { status: 500 }
      );
    }

    return NextResponse.json(worksheet);
  } catch (err) {
    console.error("Generate error:", err);
    return NextResponse.json(
      { error: String(err) || "生成失败，请重试" },
      { status: 500 }
    );
  }
}
