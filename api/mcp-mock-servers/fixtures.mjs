// Canned tool definitions for Plot's bundled mock MCP servers (one logical server per connector).
// Tool NAMES are deliberately chosen so the API's classifyRisk() heuristics classify them with no
// special-casing: create_* → WRITE, book_*/reserve_* → HOLD, buy_*/purchase_* → PURCHASE.
//
// Result SHAPES match what McpRenderService renders well: list tools return { summary, items:[…] }
// (items become titled list rows + scalar fields); mutating tools return a confirmation object of
// scalars (+ summary) that become a receipt's fields. Nested arrays are pre-joined to strings since
// only scalars become fields. No external services, no credentials.

const obj = (properties, required = []) => ({ type: "object", properties, required });
const str = (description) => ({ type: "string", description });
const int = (description) => ({ type: "integer", description });

export const FIXTURES = {
  "google-calendar": {
    tools: [
      {
        name: "list_events",
        description: "List upcoming calendar events in a time window.",
        inputSchema: obj({ timeMin: str("ISO start"), timeMax: str("ISO end") }),
        result: () => ({
          summary: "2 upcoming events",
          items: [
            { id: "evt_1", name: "Team standup", start: "2026-06-08T16:00:00Z", end: "2026-06-08T16:15:00Z" },
            { id: "evt_2", name: "Dentist", start: "2026-06-09T21:30:00Z", end: "2026-06-09T22:15:00Z" },
          ],
        }),
      },
      {
        name: "create_event",
        description: "Create a calendar event.",
        inputSchema: obj({ title: str("event title"), start: str("ISO start"), end: str("ISO end") }, ["title", "start"]),
        result: (a) => ({ summary: `Created “${a.title ?? "Plot event"}”`, confirmation: "evt_new", title: a.title ?? "Plot event", start: a.start, end: a.end, status: "confirmed" }),
      },
    ],
  },

  "google-maps": {
    tools: [
      {
        name: "search_places",
        description: "Search for places by free-text query near an area.",
        inputSchema: obj({ query: str("what to search for"), near: str("area or city") }, ["query"]),
        result: (a) => ({
          summary: `2 places for “${a.query ?? ""}”`,
          items: [
            { id: "pl_1", name: "Blue Bottle Coffee", address: "66 Mint St", rating: 4.6, openNow: "yes" },
            { id: "pl_2", name: "Sightglass Coffee", address: "270 7th St", rating: 4.5, openNow: "yes" },
          ],
        }),
      },
      {
        name: "directions",
        description: "Get travel time and route summary between two places.",
        inputSchema: obj({ origin: str("from"), destination: str("to"), mode: str("DRIVE|TRANSIT|WALK") }, ["origin", "destination"]),
        result: (a) => ({ summary: `18 min ${(a.mode ?? "DRIVE").toLowerCase()} · 6.2 km`, origin: a.origin, destination: a.destination, mode: a.mode ?? "DRIVE", durationMin: 18, distanceKm: 6.2 }),
      },
    ],
  },

  resy: {
    tools: [
      {
        name: "search_restaurants",
        description: "Search bookable restaurants by cuisine/area/party size.",
        inputSchema: obj({ query: str("cuisine or name"), partySize: int("seats"), date: str("ISO date") }, ["query"]),
        result: (a) => ({
          summary: `2 restaurants for “${a.query ?? ""}”`,
          items: [
            { id: "rst_1", name: "Nopa", cuisine: "Californian", priceTier: "$$$", slots: "18:30, 19:00, 21:15" },
            { id: "rst_2", name: "Rich Table", cuisine: "New American", priceTier: "$$$", slots: "18:00, 20:45" },
          ],
        }),
      },
      {
        name: "book_reservation",
        description: "Book a restaurant reservation (holds a table).",
        inputSchema: obj({ restaurantId: str("from search"), date: str("ISO"), time: str("HH:MM"), partySize: int("seats") }, ["restaurantId", "time"]),
        result: (a) => ({ summary: `Held a table for ${a.partySize ?? 2} at ${a.time ?? "19:00"}`, confirmation: "RESY-8842", restaurantId: a.restaurantId, time: a.time, partySize: a.partySize ?? 2, status: "held" }),
      },
    ],
  },

  ticketmaster: {
    tools: [
      {
        name: "search_events",
        description: "Search live events (concerts, sports) by query and city.",
        inputSchema: obj({ query: str("artist/team/keyword"), city: str("city") }, ["query"]),
        result: (a) => ({
          summary: `2 events for “${a.query ?? ""}”`,
          items: [
            { id: "tm_1", name: "Phoenix — World Tour", venue: "The Fillmore", date: "2026-06-20", from: "$65" },
            { id: "tm_2", name: "Giants vs Dodgers", venue: "Oracle Park", date: "2026-06-21", from: "$32" },
          ],
        }),
      },
      {
        name: "buy_tickets",
        description: "Purchase tickets for an event.",
        inputSchema: obj({ eventId: str("from search"), quantity: int("ticket count") }, ["eventId", "quantity"]),
        result: (a) => ({ summary: `Purchased ${a.quantity ?? 2} tickets`, confirmation: "TM-5521", eventId: a.eventId, quantity: a.quantity ?? 2, status: "purchased" }),
      },
    ],
  },

  flights: {
    tools: [
      {
        name: "search_flights",
        description: "Search flights between two airports on a date.",
        inputSchema: obj({ from: str("origin IATA"), to: str("dest IATA"), date: str("ISO date") }, ["from", "to"]),
        result: (a) => ({
          summary: `2 flights ${a.from ?? "?"} → ${a.to ?? "?"}`,
          items: [
            { id: "fl_1", name: "UA · nonstop", depart: "08:10", arrive: "16:45", stops: 0, priceUsd: "$312" },
            { id: "fl_2", name: "DL · 1 stop", depart: "11:20", arrive: "21:05", stops: 1, priceUsd: "$268" },
          ],
        }),
      },
      {
        name: "purchase_flight",
        description: "Purchase a flight (charges payment).",
        inputSchema: obj({ flightId: str("from search"), passengers: int("count") }, ["flightId"]),
        result: (a) => ({ summary: `Ticketed ${a.passengers ?? 1} passenger(s)`, confirmation: "FL-7730", flightId: a.flightId, passengers: a.passengers ?? 1, status: "ticketed" }),
      },
    ],
  },

  lodging: {
    tools: [
      {
        name: "search_lodging",
        description: "Search hotels / stays by city and dates.",
        inputSchema: obj({ city: str("city"), checkIn: str("ISO"), checkOut: str("ISO") }, ["city"]),
        result: (a) => ({
          summary: `2 stays in ${a.city ?? "your area"}`,
          items: [
            { id: "lg_1", name: "Hotel Zephyr", nightlyUsd: "$219", rating: 4.3 },
            { id: "lg_2", name: "The Marker", nightlyUsd: "$289", rating: 4.6 },
          ],
        }),
      },
      {
        name: "book_stay",
        description: "Reserve a stay (holds the room).",
        inputSchema: obj({ stayId: str("from search"), checkIn: str("ISO"), checkOut: str("ISO") }, ["stayId"]),
        result: (a) => ({ summary: "Held your room", confirmation: "LG-3310", stayId: a.stayId, status: "held" }),
      },
    ],
  },
};
