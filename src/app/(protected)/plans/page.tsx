import { auth, clerkClient } from "@clerk/nextjs/server";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPolarPrice, loadPolarProducts } from "@/lib/polar-products";

export default async function PlansPage() {
  const { userId } = await auth.protect();
  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  const currentTier =
    user.publicMetadata.subscriptionTier === "pro" ? "pro" : "free";

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
            {currentTier === "pro"
              ? "Your account is already on Pro. Billing stays managed through Polar."
              : "Select a Polar sandbox plan below. The checkout session is created server-side and returns you to the app after payment."}
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
                    <p className="text-lg font-black">
                      {formatPolarPrice(product)}
                    </p>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                      {currentTier === "pro" ? "Current plan" : "Sandbox checkout"}
                    </span>
                    {currentTier === "pro" ? (
                      <span className="inline-flex h-11 items-center justify-center border-2 border-black bg-secondary px-4 text-xs font-black uppercase tracking-[0.2em] text-foreground">
                        Already Pro
                      </span>
                    ) : (
                      <form action="/api/billing/upgrade" method="post">
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
                    )}
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
