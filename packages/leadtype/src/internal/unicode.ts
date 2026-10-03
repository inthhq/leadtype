const HIGH_SURROGATE_MIN = 0xd8_00;
const HIGH_SURROGATE_MAX = 0xdb_ff;
const LOW_SURROGATE_MIN = 0xdc_00;
const LOW_SURROGATE_MAX = 0xdf_ff;

/** Return whether a JavaScript string contains malformed UTF-16. */
export function hasUnpairedUtf16Surrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= HIGH_SURROGATE_MIN && codeUnit <= HIGH_SURROGATE_MAX) {
      const nextCodeUnit = value.charCodeAt(index + 1);
      const isPaired =
        nextCodeUnit >= LOW_SURROGATE_MIN && nextCodeUnit <= LOW_SURROGATE_MAX;
      if (!isPaired) {
        return true;
      }
      index += 1;
    } else if (codeUnit >= LOW_SURROGATE_MIN && codeUnit <= LOW_SURROGATE_MAX) {
      return true;
    }
  }
  return false;
}
