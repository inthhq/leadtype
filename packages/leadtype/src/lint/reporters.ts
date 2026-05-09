import type { LintResult, LintViolation } from "./runner";

export type ReporterFormat = "pretty" | "json" | "github";

function severitySymbol(severity: LintViolation["severity"]): string {
  return severity === "error" ? "×" : "!";
}

/**
 * Human-readable reporter for terminal output. Groups violations by file.
 */
export function prettyReporter(result: LintResult): string {
  if (result.violations.length === 0) {
    return `All ${result.summary.filesScanned} files pass.\n`;
  }

  const byFile = new Map<string, LintViolation[]>();
  for (const violation of result.violations) {
    const existing = byFile.get(violation.file) ?? [];
    existing.push(violation);
    byFile.set(violation.file, existing);
  }

  const lines: string[] = [];
  const sortedFiles = Array.from(byFile.keys()).sort();
  for (const file of sortedFiles) {
    lines.push(file);
    for (const violation of byFile.get(file) ?? []) {
      const symbol = severitySymbol(violation.severity);
      const tag = `[${violation.severity} ${violation.rule}]`;
      lines.push(`  ${symbol} ${tag} ${violation.message}`);
    }
    lines.push("");
  }

  lines.push(
    `${result.summary.filesScanned} files scanned — ${result.summary.errors} error(s), ${result.summary.warnings} warning(s)`
  );

  return `${lines.join("\n")}\n`;
}

/**
 * JSON reporter — stable machine-readable shape for CI pipelines and custom
 * tooling.
 */
export function jsonReporter(result: LintResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

/**
 * Escape a value used in a GitHub Actions `::...::` command property
 * (e.g. `file=<here>`). Runner parser requires %/CR/LF/`:`/`,` escaped.
 * Ref: https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/workflow-commands-for-github-actions
 */
function escapeGithubProperty(value: string): string {
  return value
    .replace(/%/g, "%25")
    .replace(/\r/g, "%0D")
    .replace(/\n/g, "%0A")
    .replace(/:/g, "%3A")
    .replace(/,/g, "%2C");
}

/**
 * Escape the message body of a GitHub Actions command. Only %/CR/LF matter
 * here — commas and colons are allowed inside the message.
 */
function escapeGithubMessage(value: string): string {
  return value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

/**
 * GitHub Actions workflow-command reporter. Each violation becomes a
 * `::error::` or `::warning::` annotation that attaches to the file in the PR
 * review UI.
 */
export function githubReporter(result: LintResult): string {
  const lines: string[] = [];
  for (const violation of result.violations) {
    const command = violation.severity === "error" ? "error" : "warning";
    const message = violation.field
      ? `[${violation.rule}] ${violation.message}`
      : violation.message;
    lines.push(
      `::${command} file=${escapeGithubProperty(violation.file)}::${escapeGithubMessage(message)}`
    );
  }
  lines.push(
    `::notice::docs lint: ${result.summary.filesScanned} files scanned, ${result.summary.errors} error(s), ${result.summary.warnings} warning(s)`
  );
  return `${lines.join("\n")}\n`;
}

export function renderReport(
  format: ReporterFormat,
  result: LintResult
): string {
  if (format === "json") {
    return jsonReporter(result);
  }
  if (format === "github") {
    return githubReporter(result);
  }
  return prettyReporter(result);
}
