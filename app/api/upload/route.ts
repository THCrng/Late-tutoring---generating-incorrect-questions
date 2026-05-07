import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// Supabase Storage only allows ASCII in keys — strip all non-ASCII chars
function toSafeKey(str: string): string {
  return str
    .replace(/[^\x00-\x7F]/g, "")   // remove non-ASCII (Chinese, etc.)
    .replace(/[^a-zA-Z0-9._-]/g, "_") // replace remaining special chars
    .replace(/_+/g, "_")              // collapse multiple underscores
    .replace(/^_|_$/g, "");           // trim leading/trailing underscores
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;
    const bucket = (formData.get("bucket") as string) || "knowledge";

    if (!file) {
      return NextResponse.json({ error: "请选择文件" }, { status: 400 });
    }
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      return NextResponse.json({ error: "只支持PDF格式" }, { status: 400 });
    }

    const timestamp = Date.now();
    // Use only timestamp as key to avoid any Chinese character issues
    const filePath = `${timestamp}.pdf`;

    const arrayBuffer = await file.arrayBuffer();
    const { error } = await supabase.storage
      .from(bucket)
      .upload(filePath, arrayBuffer, {
        contentType: "application/pdf",
        upsert: false,
      });

    if (error) {
      console.error("Upload error:", error);
      return NextResponse.json({ error: "上传失败：" + error.message }, { status: 500 });
    }

    const { data: { publicUrl } } = supabase.storage
      .from(bucket)
      .getPublicUrl(filePath);

    return NextResponse.json({ filePath, publicUrl, fileName: file.name });
  } catch (err) {
    console.error("Upload error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
