import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { image_url } = body;

    if (!image_url) {
      return NextResponse.json(
        { error: "image_url is required" },
        { status: 400 }
      );
    }

    // TODO: Add to banned images list in Supabase
    return NextResponse.json({
      success: true,
      message: "Image banned"
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to ban image" },
      { status: 500 }
    );
  }
}
