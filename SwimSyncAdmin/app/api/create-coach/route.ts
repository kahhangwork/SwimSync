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
    .select("role, tenant_id")
    .eq("id", userData.user.id)
    .single();

  // A TENANT admin only. This used to admit platform_admin too, but a platform
  // admin belongs to no business, so their profile.tenant_id is NULL by design
  // — and line ~48 passes exactly that to the auth trigger, which REFUSES to
  // create a coach without a tenant rather than guessing. So the platform-admin
  // path could only ever produce a 500 from deep inside the trigger. Refusing it
  // here says why. A coach belongs to one business; whoever creates them must
  // be standing in it.
  if (profile?.role !== "tenant_admin") {
    return NextResponse.json(
      {
        error:
          profile?.role === "platform_admin"
            ? "A platform admin belongs to no business, so there is no tenant to add this coach to. Ask that business's own admin to add them."
            : "Forbidden",
      },
      { status: 403 }
    );
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
      // The auth trigger REFUSES to create a coach without a tenant rather than
      // guessing — with one business on the platform a wrong guess would look
      // like it worked. A tenant admin's coaches join their own business.
      user_metadata: { role: "coach", full_name: name, tenant_id: profile!.tenant_id },
    });

  if (createError || !newUser.user) {
    return NextResponse.json(
      { error: createError?.message ?? "Failed to create user" },
      { status: 500 }
    );
  }

  const userId = newUser.user.id;

  // The auth trigger (handle_new_user) already created the profiles row AND
  // the coaches row from the role metadata, so we only patch the phone here.
  if (phone) {
    await adminClient
      .from("profiles")
      .update({ phone })
      .eq("id", userId);
  }

  return NextResponse.json({ success: true });
}
