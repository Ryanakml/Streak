import { auth, clerkClient } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

export async function POST() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { ok: false, reason: "Use the plans page in production." },
      { status: 403 },
    );
  }

  const { userId } = await auth();
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  const client = await clerkClient();

  // Dev-only tier source. Replace this route with Polar checkout later,
  // but keep Clerk metadata as the app-facing tier contract.
  const user = await client.users.updateUserMetadata(userId, {
    publicMetadata: {
      subscriptionTier: "pro",
    },
  });

  return Response.json({
    ok: true,
    subscriptionTier: user.publicMetadata.subscriptionTier ?? "pro",
  });
}
