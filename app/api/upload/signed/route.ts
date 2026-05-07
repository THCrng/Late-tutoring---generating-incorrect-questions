import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  try {
    const { bucket, fileName } = await req.json();
    if (!bucket || !fileName) {
      return NextResponse.json({ error: "缺少参数" }, { status: 400 });
    }

    const filePath = `${Date.now()}.pdf`;

    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUploadUrl(filePath);

    if (error || !data) {
      return NextResponse.json({ error: "生成上传链接失败：" + error?.message }, { status: 500 });
    }

    return NextResponse.json({ signedUrl: data.signedUrl, filePath, token: data.token });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
