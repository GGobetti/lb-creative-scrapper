import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl || "", supabaseServiceKey || "");

export async function GET() {
  try {
    const { data, error } = await supabase
      .from("telegram_banned_images")
      .select("image_hash")
      .not("image_hash", "is", null);

    if (error) throw error;

    const banned_hashes = data?.map((item: any) => item.image_hash).filter(Boolean) || [];

    return NextResponse.json({
      banned_hashes,
      total: banned_hashes.length
    });
  } catch (error: any) {
    console.error("Failed to fetch banned images:", error);
    return NextResponse.json(
      { error: "Failed to fetch banned images" },
      { status: 500 }
    );
  }
}
