import { getMosooCustomEventVisibility } from "@mosoo/ag-ui-session";
import type { AgUiSessionEvent as SessionDeliveryEvent } from "@mosoo/ag-ui-session";

type SessionDeliveryEventVisibility = "all_consumers" | "owner_debug";

function getSessionDeliveryEventVisibility(
  event: SessionDeliveryEvent,
): SessionDeliveryEventVisibility {
  if (event.type === "RAW") {
    throw new Error("Raw session delivery events are unsupported.");
  }

  if (event.type === "CUSTOM") {
    return getMosooCustomEventVisibility(event.name) ?? "all_consumers";
  }

  return "all_consumers";
}

export function getBroadcastableSessionDeliveryEvents(
  events: SessionDeliveryEvent[],
): SessionDeliveryEvent[] {
  return events.filter((event) => getSessionDeliveryEventVisibility(event) !== "owner_debug");
}
