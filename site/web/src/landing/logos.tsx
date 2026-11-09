import { asset } from "@/lib/base"
import { cn } from "@/lib/utils"

// Official logos from site/web/public/logos (sources and terms in SOURCES.md). The OpenAI wordmark is
// used as published (no recolor, crop or stretch); Codex has no logo of its own, so its name is set beside it.
// aside.svg and luma.svg are dark ink, so they sit on a light chip on this dark page.
export type LogoKey = "aside" | "gbrain" | "gstack" | "codex" | "luma" | "yc"

function Chip({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center rounded-lg bg-[#f4f4f2] px-2.5 py-1.5", className)}>{children}</span>
}

export function Logo({ name, className }: { name: LogoKey; className?: string }) {
  switch (name) {
    case "aside":
      return <Chip className={className}><img src={asset("logos/aside.svg")} alt="Aside" className="h-5 w-auto" /></Chip>
    case "gbrain":
      return <img src={asset("logos/gbrain-light.svg")} alt="gbrain" className={cn("h-6 w-auto", className)} />
    case "gstack":
      return (
        <span className={cn("inline-flex items-center gap-2", className)}>
          <img src={asset("logos/gstack.png")} alt="" className="size-7 rounded-md" />
          <span className="text-lg font-semibold tracking-tight">gstack</span>
        </span>
      )
    case "codex":
      return (
        <span className={cn("inline-flex items-center gap-2", className)}>
          <img src={asset("logos/openai-light.svg")} alt="OpenAI" className="-my-2 h-10 w-auto" />
          <span className="text-lg font-semibold tracking-tight">Codex</span>
        </span>
      )
    case "luma":
      return (
        <span className={cn("inline-flex items-center gap-2", className)}>
          <Chip className="p-1"><img src={asset("logos/luma.svg")} alt="" className="size-5" /></Chip>
          <span className="text-lg font-semibold tracking-tight">Luma</span>
        </span>
      )
    case "yc":
      return (
        <span className={cn("inline-flex items-center gap-2", className)}>
          <img src={asset("logos/ycombinator.svg")} alt="Y Combinator" className="size-7 rounded-[3px]" />
          <span className="text-sm leading-tight text-muted-foreground">YC RFS<br /><span className="text-foreground">Multiplayer AI · Self-Maintaining APIs</span></span>
        </span>
      )
  }
}

export function LogoStrip() {
  const items: { name: LogoKey; role: string }[] = [
    { name: "aside", role: "runs the browser" },
    { name: "codex", role: "runs the code" },
    { name: "gbrain", role: "remembers" },
    { name: "gstack", role: "argues" },
    { name: "luma", role: "today's data" },
  ]
  return (
    <div className="mx-auto mt-12 max-w-6xl">
      <p className="mb-5 text-center font-mono text-2xs tracking-widest text-muted-foreground uppercase">Built on real tools, called over CLI and HTTP</p>
      <ul className="flex flex-wrap items-center justify-center gap-x-10 gap-y-6">
        {items.map((it) => (
          <li key={it.name} className="flex flex-col items-center gap-2">
            <Logo name={it.name} />
            <span className="font-mono text-2xs text-muted-foreground">{it.role}</span>
          </li>
        ))}
        <li className="flex items-center border-l pl-10 max-sm:border-0 max-sm:pl-0"><Logo name="yc" /></li>
      </ul>
    </div>
  )
}
