type Level = "error" | "warn" | "info" | "debug";
type Value = string | number | boolean | null | undefined;
type Fields = Record<string, Value>;

export type LogCall = {
  human: { message: string; hint?: string };
  json: { event: string; fields?: Fields };
};

type Stream = Pick<NodeJS.WriteStream, "write">;

let format: "human" | "json" =
  process.env.LEADTYPE_LOG_FORMAT === "json" ? "json" : "human";
let verbose = process.env.LEADTYPE_VERBOSE === "1";
let stderr: Stream = process.stderr;

export function setLogFormat(f: "human" | "json"): void {
  format = f;
}

export function setVerbose(v: boolean): void {
  verbose = v;
}

export function setLogStreams(s: { stderr: Stream }): void {
  stderr = s.stderr;
}

function emit(level: Level, call: LogCall): void {
  if (level === "debug" && !verbose) {
    return;
  }
  if (format === "json") {
    stderr.write(
      `${JSON.stringify({
        ts: new Date().toISOString(),
        level,
        event: call.json.event,
        ...call.json.fields,
      })}\n`
    );
    return;
  }
  let prefix = "";
  if (level === "error") {
    prefix = "Error: ";
  } else if (level === "warn") {
    prefix = "Warning: ";
  }
  stderr.write(`${prefix}${call.human.message}\n`);
  if (call.human.hint) {
    stderr.write(`  → ${call.human.hint}\n`);
  }
}

export const logger = {
  error: (call: LogCall): void => emit("error", call),
  warn: (call: LogCall): void => emit("warn", call),
  info: (call: LogCall): void => emit("info", call),
  debug: (call: LogCall): void => emit("debug", call),
};
