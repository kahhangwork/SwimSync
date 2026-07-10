import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: NextRequest) {
  // Verify caller is an authenticated superadmin
  const authHeader = req.headers.get("authorization");
  const token = authHeader?.replace("Bearer ", "") ?? "";

  const callerClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const { data: userData } = await callerClient.auth.getUser(token);
  if (!userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const adminClient = createAdminClient();
  const { data: profile } = await adminClient
    .from("profiles")
    .select("role")
    .eq("id", userData.user.id)
    .single();

  if (profile?.role !== "superadmin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Parse body
  const { name, email, phone, password } = await req.json();
  if (!name || !email || !password) {
    return NextResponse.json(
      { error: "name, email and password are required" },
      { status: 400 }
    );
  }

  // Create Supabase auth user
  const { data: newUser, error: createError } =
    await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { role: "coach", full_name: name },
    });

  if (createError || !newUser.user) {
    return NextResponse.json(
      { error: createError?.message ?? "Failed to create user" },
      { status: 500 }
    );
  }

  const userId = newUser.user.id;

  // Update phone on the auto-created profile (from the auth trigger)
  if (phone) {
    await adminClient
      .from("profiles")
      .update({ phone })
      .eq("id", userId);
  }

  // Insert coaches record
  const { error: coachError } = await adminClient
    .from("coaches")
    .insert({ profile_id: userId });

  if (coachError) {
    return NextResponse.json(
      { error: coachError.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
