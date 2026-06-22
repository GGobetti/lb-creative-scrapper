import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl || "", supabaseServiceKey || "");

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const job_id = searchParams.get("job_id");

    if (!job_id) {
      return NextResponse.json(
        { error: "job_id is required" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("telegram_scraper_jobs")
      .select("id, status, progress, file_name")
      .eq("id", job_id)
      .single();

    if (error) throw error;

    if (!data) {
      return NextResponse.json(
        { error: "Job not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      id: data.id,
      status: data.status,
      progress: data.progress || 0,
      file_name: data.file_name
    });
  } catch (error: any) {
    console.error("Failed to fetch job progress:", error);
    return NextResponse.json(
      { error: "Failed to fetch job progress" },
      { status: 500 }
    );
  }
}
