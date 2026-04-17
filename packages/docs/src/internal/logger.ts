const VERBOSE = process.env.INTH_DOCS_VERBOSE === "1";

export const log = {
  error(message: string): void {
    process.stderr.write(`[inth-docs] error: ${message}\n`);
  },
  summary(message: string): void {
    process.stdout.write(`[inth-docs] ${message}\n`);
  },
  verbose(message: string): void {
    if (VERBOSE) {
      process.stderr.write(`[inth-docs] ${message}\n`);
    }
  },
};
