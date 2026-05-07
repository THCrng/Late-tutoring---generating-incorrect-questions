import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const subject = searchParams.get("subject");
  const grade = searchParams.get("grade");
  const search = searchParams.get("search");

  let query = supabase
    .from("knowledge_points")
    .select("*")
    .order("created_at", { ascending: false });

  if (subject) query = query.eq("subject", subject);
  if (grade) query = query.eq("grade", grade);
  if (search) query = query.ilike("content", `%${search}%`);

  const { data, error } = await query.limit(100);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data || []);
}
