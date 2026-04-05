import { SignUp } from "@clerk/nextjs";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function SignUpPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-black px-6 py-12 text-white">
      <Card className="w-full max-w-md border-zinc-800 bg-zinc-950 text-white">
        <CardHeader className="space-y-2">
          <CardTitle className="text-2xl">Create Account</CardTitle>
          <CardDescription className="text-zinc-400">
            Start building consistency with Streak.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SignUp
            appearance={{
              elements: {
                card: "bg-transparent shadow-none",
                header: "hidden",
                footer: "hidden",
                formButtonPrimary:
                  "bg-white text-black hover:bg-zinc-200 shadow-none",
                socialButtonsBlockButton:
                  "border border-zinc-700 bg-transparent text-white hover:bg-zinc-900",
                formFieldInput:
                  "border-zinc-700 bg-zinc-900 text-white placeholder:text-zinc-500",
                formFieldLabel: "text-zinc-300",
                dividerLine: "bg-zinc-800",
                dividerText: "text-zinc-500",
                identityPreviewText: "text-zinc-300",
                identityPreviewEditButton:
                  "text-zinc-300 hover:text-white",
              },
            }}
          />
        </CardContent>
      </Card>
    </main>
  );
}
