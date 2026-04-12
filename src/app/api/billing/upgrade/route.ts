import { auth, clerkClient } from "@clerk/nextjs/server";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { polar, POLAR_ORGANIZATION_ID } from "@/lib/polar";

function getSafeOrigin() {
  const fallbackOrigin = "http://localhost:3000";
  const envOriginRaw =
    process.env.NEXT_PUBLIC_APP_URL?.trim() || fallbackOrigin;

  const normalizedOrigin =
    envOriginRaw.startsWith("http://") || envOriginRaw.startsWith("https://")
      ? envOriginRaw
      : envOriginRaw.includes("localhost")
        ? `http://${envOriginRaw}`
        : `https://${envOriginRaw}`;

  try {
    return new URL(normalizedOrigin).origin;
  } catch {
    return fallbackOrigin;
  }
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json(
      { ok: false, reason: "Unauthorized" },
      { status: 401 },
    );
  }

  const contentType = req.headers.get("content-type") || "";
  let productId: string | null = null;

  if (contentType.includes("application/json")) {
    const body = (await req.json().catch(() => null)) as {
      productId?: unknown;
    } | null;
    productId = typeof body?.productId === "string" ? body.productId : null;
  } else {
    const formData = await req.formData().catch(() => null);
    const formValue = formData?.get("productId");
    productId = typeof formValue === "string" ? formValue : null;
  }

  productId = productId?.trim() || null;
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
  const safeOrigin = getSafeOrigin();
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
