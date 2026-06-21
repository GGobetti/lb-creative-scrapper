import { NextResponse } from "next/server";

export async function GET() {
  // TODO: Fetch from Supabase telegram_scraper_settings
  return NextResponse.json({
    size_limit_mb: 750,
    last_heartbeat: new Date().toISOString()
  });
}
