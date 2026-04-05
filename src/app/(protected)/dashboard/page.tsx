import { auth } from "@clerk/nextjs/server";

import { DashboardShell } from "@/components/custom/dashboard-shell";

export default async function DashboardPage() {
  await auth.protect();
  return <DashboardShell />;
}
