import { type ComponentCoverage, componentMatrix } from "@/lib/docs";

function coverageClassName(coverage: ComponentCoverage): string {
  switch (coverage) {
    case "interactive":
      return "bg-foreground text-background";
    case "pipeline-only":
      return "border border-border bg-background text-muted-foreground";
    default:
      return "bg-secondary text-foreground";
  }
}

export function ComponentMatrix() {
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <table className="w-full border-collapse text-left text-sm">
        <thead className="bg-secondary">
          <tr>
            <th className="px-4 py-3 font-medium">Component</th>
            <th className="px-4 py-3 font-medium">Coverage</th>
            <th className="px-4 py-3 font-medium">Notes</th>
          </tr>
        </thead>
        <tbody>
          {componentMatrix.map((item) => (
            <tr className="border-border border-t align-top" key={item.name}>
              <td className="px-4 py-3 font-medium">{item.name}</td>
              <td className="px-4 py-3">
                <span
                  className={`inline-flex rounded-md px-2 py-1 font-medium text-xs ${coverageClassName(
                    item.coverage
                  )}`}
                >
                  {item.coverage}
                </span>
              </td>
              <td className="px-4 py-3 text-muted-foreground">{item.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
