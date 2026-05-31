import { Injectable, Logger } from "@nestjs/common";
import { config } from "../../common/config";

export interface Forecast {
  status: "READY" | "DEGRADED";
  conditionCode?: string; // e.g. "Clear", "Rain", "Thunderstorms"
  tempC?: number;
  precipitationChance?: number; // 0..1
  severe?: boolean; // active severe-weather warning
  summary: string;
  attribution: { label: string; url?: string }[];
}

// WeatherKit REST connector (Slice 3): venue/time forecast + severe-weather warnings so the agent
// can apply an outdoor-plan fallback ("storm incoming → move indoors", §C4). Token-gated; with no
// WEATHERKIT_TOKEN it degrades to a clear DEGRADED status rather than throwing.
@Injectable()
export class WeatherKitProvider {
  private readonly log = new Logger("WeatherKit");
  private readonly attribution = [{ label: "Weather", url: "https://developer.apple.com/weatherkit/data-source-attribution/" }];

  async forecast(lat: number, lng: number, whenIso?: string): Promise<Forecast> {
    if (!config.weatherkitToken) {
      return { status: "DEGRADED", summary: "weather unavailable (not configured)", attribution: this.attribution };
    }
    try {
      const url = `https://weatherkit.apple.com/api/v1/weather/en/${lat}/${lng}?dataSets=currentWeather,forecastDaily,weatherAlerts`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${config.weatherkitToken}` } });
      if (!res.ok) {
        this.log.warn(`weatherkit ${res.status}`);
        return { status: "DEGRADED", summary: "weather lookup failed", attribution: this.attribution };
      }
      const d = (await res.json()) as any;
      const cur = d.currentWeather ?? {};
      const severe = Array.isArray(d.weatherAlerts?.alerts) && d.weatherAlerts.alerts.length > 0;
      const cond = cur.conditionCode ?? "Unknown";
      return {
        status: "READY",
        conditionCode: cond,
        tempC: cur.temperature,
        precipitationChance: d.forecastDaily?.days?.[0]?.precipitationChance,
        severe,
        summary: severe ? `⚠ Severe weather warning — ${cond}` : `${cond}, ${Math.round(cur.temperature ?? 0)}°C`,
        attribution: this.attribution,
      };
    } catch (e) {
      this.log.warn(`weatherkit failed: ${(e as Error).message}`);
      return { status: "DEGRADED", summary: "weather lookup error", attribution: this.attribution };
    }
  }
}
