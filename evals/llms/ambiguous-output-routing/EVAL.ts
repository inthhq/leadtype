import { assertLlmsFixture } from "../../lib/llms-eval";

await assertLlmsFixture(new URL(".", import.meta.url));
