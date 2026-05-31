import { Injectable, Logger } from "@nestjs/common";
import { config } from "../../common/config";
import { LatLng, RouteCell, RoutesProvider, TravelMode } from "./maps.types";

// Native Google Routes `computeRouteMatrix` — member origins × candidate venues. The matrix request
// takes ONE travel mode, so to honor per-member modes we group origins by mode, call once per mode,
// and map results back to the GLOBAL origin index. Field-masked to duration/distance/condition only.
// Privacy: origins are passed in already-decrypted by the service and never logged here.
const MODE: Record<TravelMode, string> = {
  DRIVE: "DRIVE",
  TRANSIT: "TRANSIT",
  WALK: "WALK",
  BICYCLE: "BICYCLE",
  AUTO: "DRIVE",
};

@Injectable()
export class GoogleRoutesProvider implements RoutesProvider {
  private readonly log = new Logger("GoogleRoutes");

  async computeRouteMatrix(
    origins: { location: LatLng; mode: TravelMode }[],
    destinations: { location?: LatLng; placeId?: string }[],
  ): Promise<RouteCell[]> {
    if (!config.googleMapsApiKey || origins.length === 0 || destinations.length === 0) return [];

    const dest = destinations.map((d) =>
      d.placeId
        ? { waypoint: { placeId: d.placeId } }
        : { waypoint: { location: { latLng: { latitude: d.location!.lat, longitude: d.location!.lng } } } },
    );

    // group global origin indices by travel mode
    const byMode = new Map<string, number[]>();
    origins.forEach((o, i) => {
      const m = MODE[o.mode] ?? "DRIVE";
      (byMode.get(m) ?? byMode.set(m, []).get(m)!).push(i);
    });

    const cells: RouteCell[] = [];
    for (const [mode, globalIdx] of byMode) {
      const reqOrigins = globalIdx.map((gi) => ({
        waypoint: { location: { latLng: { latitude: origins[gi].location.lat, longitude: origins[gi].location.lng } } },
      }));
      try {
        const res = await fetch("https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": config.googleMapsApiKey,
            "X-Goog-FieldMask": "originIndex,destinationIndex,duration,distanceMeters,condition",
          },
          body: JSON.stringify({ origins: reqOrigins, destinations: dest, travelMode: mode }),
        });
        if (!res.ok) {
          this.log.warn(`computeRouteMatrix ${res.status}: ${(await res.text()).slice(0, 160)}`);
          continue;
        }
        const rows = (await res.json()) as any[];
        for (const r of rows) {
          const ok = r.condition === "ROUTE_EXISTS" && r.duration != null;
          cells.push({
            originIndex: globalIdx[r.originIndex], // map per-mode index → global origin index
            destinationIndex: r.destinationIndex,
            durationSeconds: ok ? parseInt(String(r.duration).replace("s", ""), 10) : null,
            distanceMeters: r.distanceMeters ?? null,
            ok,
          });
        }
      } catch (e) {
        this.log.warn(`route matrix (${mode}) failed: ${(e as Error).message}`);
      }
    }
    return cells;
  }
}
