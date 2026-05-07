import { NextRequest, NextResponse } from "next/server";
import { jsonrepair } from "jsonrepair";

const PROMPT_TEMPLATE = `你是一位专业的中国小学数学、语文、英语练习册编写专家。

## 任务
根据以下学生今天的知识薄弱点，生成一份可打印的练习学案（共2页A4纸）。

## 学生信息
- 年级：{{GRADE}}
- 教材版本：{{TEXTBOOK}}

## 知识薄弱点
{{GAPS}}

## 生成规则

### 内容规则
1. 难度定位：假设学生有基本概念，但不会灵活应用，从"基础应用"开始（不是补零基础）
2. 每个知识点设计3-5道小题，按"基础→提升→挑战"递进
3. 题型要多样：填空、竖式计算、判断对错、应用题，避免全是单一题型
4. 数字要真实：计算题答案必须是整数或标准分数，不要出现循环小数
5. 知识点内容与【{{TEXTBOOK}}】{{GRADE}}教材一致，题目表达和难度适合该年级学生
6. 英语题目（词汇、句型）使用中英文混排，符合人教版课标要求

### 格式规则
1. 每道题用圆圈数字标号：①②③④⑤
2. 竖式题要留足够空白（workSpace字段设为6-8）
3. 应用题要有"算式："和"答："两行空白（type设为"应用"）
4. 适当加"方法提示"帮助学生回忆方法（hint字段）
5. 挑战题在instruction开头加"★"标记

### 版面规则
- 第1页：前半部分知识点（内容饱满但不超出A4页，约400字题目内容）
- 第2页：后半部分知识点（约400字题目内容）
- 若知识点只有1-2个，合理分配到两页，每页题量均衡

## 输出格式
必须严格返回以下JSON结构，不要有任何额外文字、解释或markdown代码块标记：

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
              "difficulty": "基础",
              "instruction": "题目指导语（说明怎么做这道题）",
              "items": ["具体题目第1行", "具体题目第2行"],
              "workSpace": 2,
              "hint": "方法提示（可选，没有则省略该字段）"
            }
          ]
        }
      ]
    },
    {
      "pageNumber": 2,
      "sections": []
    }
  ]
}

type 只能是以下之一："填空" | "计算" | "判断" | "应用" | "连线"
difficulty 只能是以下之一："基础" | "提升" | "挑战"
workSpace 是整数，表示留白行数（普通题2-3，竖式题6-8，应用题4-5）
重要：JSON字符串内不得使用英文双引号（"），如需标注答案用（）括号代替，例如：打（√）或打（×）`;

export async function POST(req: NextRequest) {
  try {
    const { gaps, grade, textbook } = await req.json();

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

    const prompt = PROMPT_TEMPLATE.replace(/{{GAPS}}/g, gaps.trim())
      .replace(/{{DATE}}/g, today)
      .replace(/{{GRADE}}/g, grade || "三年级")
      .replace(/{{TEXTBOOK}}/g, textbook || "人教版");

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

    // Strip markdown code block if present
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
