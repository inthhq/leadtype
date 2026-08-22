/**
 * Paths the NLWeb surface publishes. They live apart from the generators so
 * the artifact writer and the OpenAPI description can both name them without
 * importing each other.
 */

export const NLWEB_SCHEMA_FEED_PATH = "feeds/schema.jsonl";
export const NLWEB_SCHEMA_MAP_PATH = "schema-map.xml";
export const NLWEB_GENERATION_STATE_FILE = "nlweb.json";
export const DEFAULT_NLWEB_ASK_PATH = "/ask";

/**
 * Methods the `/ask` handler serves. The handler's `Allow` and CORS headers and
 * the generated OpenAPI document both read this, so a description can never
 * drift from the endpoint it describes.
 */
export const NLWEB_ALLOWED_METHODS = "GET, POST, OPTIONS";

/** Request headers the `/ask` CORS preflight allows. */
export const NLWEB_ALLOWED_REQUEST_HEADERS = "content-type, accept";
