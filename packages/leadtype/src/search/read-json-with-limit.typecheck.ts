/**
 * Compile-time contract for `readJsonWithLimit` overloads. Dynamic options
 * can enable empty-body handling at runtime, so their result must stay
 * optional even when a particular call does not use an inline `true` literal.
 */
import { type ReadJsonWithLimitOptions, readJsonWithLimit } from "./search";

type Payload = { query: string };

declare const request: Request;
declare const dynamicOptions: ReadJsonWithLimitOptions;
declare const optionalDynamicOptions: ReadJsonWithLimitOptions | undefined;

export const requiredBody: Promise<Payload> =
  readJsonWithLimit<Payload>(request);
export const explicitlyRequiredBody: Promise<Payload> =
  readJsonWithLimit<Payload>(request, { allowEmpty: false });
export const optionalBody: Promise<Payload | undefined> =
  readJsonWithLimit<Payload>(request, { allowEmpty: true });
export const dynamicallyOptionalBody: Promise<Payload | undefined> =
  readJsonWithLimit<Payload>(request, dynamicOptions);
export const optionallyConfiguredBody: Promise<Payload | undefined> =
  readJsonWithLimit<Payload>(request, optionalDynamicOptions);

// @ts-expect-error `allowEmpty: true` may resolve to undefined.
export const unsafelyRequiredOptionalBody: Promise<Payload> =
  readJsonWithLimit<Payload>(request, { allowEmpty: true });

// @ts-expect-error Dynamic options may set `allowEmpty`, so `undefined` is possible.
export const unsafelyRequiredBody: Promise<Payload> =
  readJsonWithLimit<Payload>(request, dynamicOptions);

// @ts-expect-error Pass-through options may enable `allowEmpty` at runtime.
export const unsafelyRequiredOptionalOptions: Promise<Payload> =
  readJsonWithLimit<Payload>(request, optionalDynamicOptions);
