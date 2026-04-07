import { auth, clerkClient } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

export async function POST() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { ok: false, reason: "Downgrade is disabled in production." },
      { status: 403 },
    );
  }

  const { userId } = await auth();
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  const client = await clerkClient();

  // Dev-only tier source. A future Polar webhook should update the same
  // Clerk metadata field instead of changing downstream gating logic.
  const user = await client.users.updateUserMetadata(userId, {
    publicMetadata: {
      subscriptionTier: "free",
    },
  });

  return Response.json({
    ok: true,
    subscriptionTier: user.publicMetadata.subscriptionTier ?? "free",
  });
}
