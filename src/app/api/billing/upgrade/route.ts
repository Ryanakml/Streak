import { auth, clerkClient } from "@clerk/nextjs/server";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { polar, POLAR_ORGANIZATION_ID } from "@/lib/polar";

function getSafeOrigin(req: NextRequest) {
  let origin = req.nextUrl.origin;

  if (!origin || origin === "null") {
    origin = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  }

  if (!origin.startsWith("http://") && !origin.startsWith("https://")) {
    origin = origin.includes("localhost")
      ? `http://${origin}`
      : `https://${origin}`;
  }

  return origin;
}

export async function GET(req: NextRequest) {
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json(
      { ok: false, reason: "Unauthorized" },
      { status: 401 },
    );
  }

  const productId = req.nextUrl.searchParams.get("productId");
  if (!productId) {
    return NextResponse.json(
      { error: "Product ID is required" },
      { status: 400 },
    );
  }

  const product = await polar.products.get({ id: productId });
  if (product.organizationId !== POLAR_ORGANIZATION_ID || product.isArchived) {
    return NextResponse.json(
      { ok: false, reason: "Product is not available for this organization" },
      { status: 400 },
    );
  }

  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  const safeOrigin = getSafeOrigin(req);
  const successUrl = new URL(
    "/dashboard?billing=success",
    safeOrigin,
  ).toString();
  const returnUrl = new URL("/plans", safeOrigin).toString();

  const checkout = await polar.checkouts.create({
    products: [productId],
    successUrl,
    returnUrl,
    customerEmail: user.primaryEmailAddress?.emailAddress ?? undefined,
    customerName:
      [user.firstName, user.lastName].filter(Boolean).join(" ") || undefined,
    externalCustomerId: userId,
    customerMetadata: {
      clerkUserId: userId,
    },
    metadata: {
      clerkUserId: userId,
      subscriptionTier: "pro",
    },
  });

  return NextResponse.redirect(checkout.url, 303);
}
