import { auth, clerkClient } from "@clerk/nextjs/server";

export async function POST() {
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
