export function Placeholder({ title }: { title: string }) {
  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <div className="mt-6 flex h-64 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
        Coming soon — this section is next in the build.
      </div>
    </div>
  )
}
