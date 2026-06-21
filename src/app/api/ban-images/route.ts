import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl || "", supabaseServiceKey || "");

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { image_url, image_hash } = body;

    if (!image_url) {
      return NextResponse.json(
        { error: "image_url is required" },
        { status: 400 }
      );
    }

    // Add to banned_images table
    const { error } = await supabase
      .from("banned_images")
      .insert({
        image_url,
        image_hash: image_hash || null,
        created_at: new Date().toISOString()
      });

    if (error) throw error;

    return NextResponse.json({
      success: true,
      message: "Image banned"
    });
  } catch (error: any) {
    console.error("Failed to ban image:", error);
    return NextResponse.json(
      { error: "Failed to ban image" },
      { status: 500 }
    );
  }
}
