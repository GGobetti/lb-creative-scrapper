import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl || "", supabaseServiceKey || "");

export async function GET() {
  try {
    const { data, error } = await supabase
      .from("telegram_scraper_settings")
      .select("*")
      .eq("id", "default")
      .single();

    if (error) throw error;

    return NextResponse.json({
      size_limit_mb: data?.size_limit_mb || 750,
      last_heartbeat: data?.last_heartbeat || null
    });
  } catch (error: any) {
    console.error("Failed to fetch settings:", error);
    return NextResponse.json({
      size_limit_mb: 750,
      last_heartbeat: null
    });
  }
}
