import { componentMatrix, type SmokeCoverage } from "@/lib/docs";

function assertNever(value: never): never {
  throw new Error(`Unhandled coverage variant: ${value}`);
}

function coverageClassName(coverage: SmokeCoverage): string {
  switch (coverage) {
    case "agent docs":
      return "bg-accent-soft text-accent-strong";
    case "browser hydration":
      return "bg-foreground text-background";
    case "pipeline conversion":
      return "bg-warning-soft text-warning-strong";
    case "runtime render":
      return "bg-secondary text-foreground";
    case "search/API":
      return "bg-success-soft text-success-strong";
    default:
      return assertNever(coverage);
  }
}

export function ComponentMatrix() {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-left text-sm">
        <thead className="bg-secondary">
          <tr>
            <th className="min-w-40 px-4 py-3 font-medium">Surface</th>
            <th className="px-4 py-3 font-medium">Coverage</th>
            <th className="min-w-72 px-4 py-3 font-medium">What it proves</th>
          </tr>
        </thead>
        <tbody>
          {componentMatrix.map((item) => (
            <tr className="border-border border-t align-top" key={item.name}>
              <td className="px-4 py-3 font-medium">{item.name}</td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap gap-2">
                  {item.coverage.map((coverage) => (
                    <span
                      className={`inline-flex rounded-md px-2 py-1 font-medium text-xs ${coverageClassName(
                        coverage
                      )}`}
                      key={coverage}
                    >
                      {coverage}
                    </span>
                  ))}
                </div>
              </td>
              <td className="px-4 py-3 text-muted-foreground">{item.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
