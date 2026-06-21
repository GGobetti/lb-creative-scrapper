import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Missing Supabase credentials");
}

const supabase = createClient(supabaseUrl || "", supabaseServiceKey || "");

export async function GET() {
  try {
    const { data, error } = await supabase
      .from("telegram_scraper_jobs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(300);

    if (error) throw error;

    return NextResponse.json({
      jobs: data || []
    });
  } catch (error: any) {
    console.error("Failed to fetch jobs:", error);
    return NextResponse.json(
      { error: "Failed to fetch jobs" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, jobId } = body;

    if (action === "approve") {
      const { error } = await supabase
        .from("telegram_scraper_jobs")
        .update({ status: "approved" })
        .eq("id", jobId);

      if (error) throw error;

      return NextResponse.json({
        success: true,
        message: "Job approved"
      });
    }

    if (action === "reject") {
      const { error } = await supabase
        .from("telegram_scraper_jobs")
        .update({ status: "rejected" })
        .eq("id", jobId);

      if (error) throw error;

      return NextResponse.json({
        success: true,
        message: "Job rejected"
      });
    }

    return NextResponse.json(
      { error: "Invalid action" },
      { status: 400 }
    );
  } catch (error: any) {
    console.error("Failed to process job action:", error);
    return NextResponse.json(
      { error: "Failed to process request" },
      { status: 500 }
    );
  }
}
