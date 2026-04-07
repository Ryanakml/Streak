import { auth } from "@clerk/nextjs/server";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function PlansPage() {
  await auth.protect();

  return (
    <main className="min-h-screen bg-background px-6 py-8 text-foreground">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <section className="border-2 border-black bg-card p-6 shadow-[8px_8px_0px_0px_rgba(26,24,20,1)] sm:p-8">
          <p className="brutal-meta">Billing</p>
          <h1 className="text-4xl font-black uppercase tracking-[-0.08em]">
            Plans
          </h1>
          <p className="mt-3 max-w-2xl text-sm uppercase tracking-[0.12em] text-muted-foreground">
            Clerk payment plans will live here. This is a placeholder route for
            the production Upgrade to Pro flow.
          </p>
        </section>

        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">Placeholder Checkout Surface</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              Next step: embed Clerk plan selection and connect successful
              upgrades to the same `subscriptionTier` contract the app already
              reads.
            </p>
            <p>
              For now this page exists so production no longer uses the dev-only
              metadata toggle endpoints.
            </p>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
