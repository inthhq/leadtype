const VERBOSE = process.env.LEADTYPE_VERBOSE === "1";

export const log = {
  error(message: string): void {
    process.stderr.write(`[leadtype] error: ${message}\n`);
  },
  summary(message: string): void {
    process.stdout.write(`[leadtype] ${message}\n`);
  },
  verbose(message: string): void {
    if (VERBOSE) {
      process.stderr.write(`[leadtype] ${message}\n`);
    }
  },
};
