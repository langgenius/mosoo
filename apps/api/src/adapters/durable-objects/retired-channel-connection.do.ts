import { DurableObject } from "cloudflare:workers";

/**
 * Compatibility tombstone for the immutable Durable Object migrations in wrangler.toml.
 * No active binding routes traffic here; the retired class name must remain exportable so
 * Wrangler can load existing local and production migration history.
 */
export class ChannelConnection extends DurableObject {
  override fetch(): Promise<Response> {
    return Promise.resolve(new Response(null, { status: 410 }));
  }
}
