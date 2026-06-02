import { configure } from "arktype/config";

// Cloudflare workerd forbids dynamic code generation from strings. ArkType's
// default JIT path uses Function under the hood, so the API Worker must run
// validators in jitless mode before any schema module is imported.
configure({ jitless: true });

export const arktypeWorkerConfigInitialized = true;
