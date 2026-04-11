import { auth } from "@clerk/nextjs/server";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { POLAR_ORGANIZATION_ID, polar } from "@/lib/polar";

type PolarProduct = Awaited<ReturnType<typeof polar.products.get>>;

function formatPrice(product: PolarProduct) {
  const price = product.prices.find(
    (entry: { amountType?: string }) => entry.amountType === "fixed",
  );

  if (!price || price.amountType !== "fixed") {
    return "Custom pricing";
  }

  const formattedAmount = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: price.priceCurrency,
    maximumFractionDigits: 2,
  }).format(price.priceAmount / 100);

  if (!product.isRecurring) {
    return formattedAmount;
  }

  const interval = product.recurringInterval ?? "month";
  const intervalCount =
    product.recurringIntervalCount && product.recurringIntervalCount > 1
      ? ` every ${product.recurringIntervalCount} ${interval}s`
      : ` / ${interval}`;

  return `${formattedAmount}${intervalCount}`;
}

async function loadPolarProducts() {
  const page = await polar.products.list({
    organizationId: POLAR_ORGANIZATION_ID,
    isArchived: false,
    isRecurring: true,
    limit: 100,
  });

  const products: PolarProduct[] = [];
  for await (const result of page) {
    const items = result?.result?.items ?? [];
    products.push(...items);
  }

  return products.sort(
    (left, right) =>
      right.createdAt.getTime() - left.createdAt.getTime() ||
      left.name.localeCompare(right.name),
  );
}

export default async function PlansPage() {
  await auth.protect();

  const products = await loadPolarProducts();

  return (
    <main className="min-h-screen bg-background px-6 py-8 text-foreground">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <section className="border-2 border-black bg-card p-6 shadow-[8px_8px_0px_0px_rgba(26,24,20,1)] sm:p-8">
          <p className="brutal-meta">Billing</p>
          <h1 className="text-4xl font-black uppercase tracking-[-0.08em]">
            Plans
          </h1>
          <p className="mt-3 max-w-2xl text-sm uppercase tracking-[0.12em] text-muted-foreground">
            Select a Polar sandbox plan below. The checkout session is created
            server-side and returns you to the app after payment.
          </p>
        </section>

        {products.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-2xl">
                No Polar products found
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>
                Make sure your sandbox organization has at least one recurring
                product published and that `POLAR_ORGANIZATION_ID` matches that
                sandbox org.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {products.map((product) => (
              <Card key={product.id}>
                <CardHeader>
                  <CardTitle className="text-2xl">{product.name}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 text-sm text-muted-foreground">
                  <p>{product.description ?? "Polar sandbox subscription."}</p>
                  <div className="space-y-1 border border-black/10 bg-background px-4 py-3 text-foreground">
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                      Price
                    </p>
                    <p className="text-lg font-black">{formatPrice(product)}</p>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                      Sandbox checkout
                    </span>
                    <form action="/api/billing/upgrade" method="get">
                      <input
                        type="hidden"
                        name="productId"
                        value={product.id}
                      />
                      <button
                        type="submit"
                        className="inline-flex h-11 items-center justify-center border-2 border-black bg-black px-4 text-xs font-black uppercase tracking-[0.2em] text-white transition-transform hover:-translate-y-0.5"
                      >
                        Upgrade to Pro
                      </button>
                    </form>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
