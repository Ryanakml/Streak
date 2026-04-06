import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "min-h-10 w-full min-w-0 rounded-none border-2 border-black bg-background px-3 py-2 text-sm font-medium uppercase tracking-[0.08em] text-foreground outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-xs file:font-bold file:uppercase placeholder:text-muted-foreground focus-visible:border-[#DF3B23] disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-secondary disabled:opacity-50 aria-invalid:border-destructive",
        className
      )}
      {...props}
    />
  )
}

export { Input }
