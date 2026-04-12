import { auth, clerkClient } from "@clerk/nextjs/server";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { polar, POLAR_ORGANIZATION_ID } from "@/lib/polar";
import { loadDefaultPolarProduct } from "@/lib/polar-products";

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
  const wantsJson =
    contentType.includes("application/json") ||
    (req.headers.get("accept") || "").includes("application/json");

  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  const currentTier =
    user.publicMetadata.subscriptionTier === "pro" ? "pro" : "free";
  const safeOrigin = getSafeOrigin();
  const successUrl = new URL(
    "/dashboard?billing=success",
    safeOrigin,
  ).toString();
  const returnUrl = new URL("/plans", safeOrigin).toString();

  if (currentTier === "pro") {
    if (wantsJson) {
      return NextResponse.json(
        { ok: false, reason: "Account is already on Pro" },
        { status: 409 },
      );
    }

    return NextResponse.redirect(new URL("/dashboard", safeOrigin), 303);
  }

  if (!productId) {
    productId = (await loadDefaultPolarProduct())?.id ?? null;
  }

  if (!productId) {
    if (wantsJson) {
      return NextResponse.json(
        { ok: false, reason: "No active Polar product available" },
        { status: 404 },
      );
    }

    return NextResponse.redirect(new URL("/plans", safeOrigin), 303);
  }

  const product = await polar.products.get({ id: productId });
  if (product.organizationId !== POLAR_ORGANIZATION_ID || product.isArchived) {
    if (wantsJson) {
      return NextResponse.json(
        { ok: false, reason: "Product is not available for this organization" },
        { status: 400 },
      );
    }

    return NextResponse.redirect(new URL("/plans", safeOrigin), 303);
  }

  const checkout = await polar.checkouts.create({
    products: [product.id],
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

  if (wantsJson) {
    return NextResponse.json({ ok: true, url: checkout.url });
  }

  return NextResponse.redirect(checkout.url, 303);
}
