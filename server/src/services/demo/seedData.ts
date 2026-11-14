import { haversineKm } from "../../utils/geo";
import { addDays, atDenver, weekdayOfDate } from "../../utils/time";
import { findCandidates } from "../scheduling/candidateFinder";
import { MemoryAgency } from "../scheduling/memoryAgency";
import { AuthorizationRecord, CaregiverRecord, ClientRecord, ServiceRecord, toCaregiverFacts, VisitRecord } from "../scheduling/mappers";
import { allPassed, checkVisit } from "../scheduling/ruleChecker";
import { LatLng, VisitFacts, Weekday, WEEKDAYS } from "../scheduling/types";

// ---------------------------------------------------------------------------
// The demo agency: one made-up Colorado home care agency. 100% fake people and
// places. Deterministic: the same seed and the same "today" give the same data,
// so evals and story buttons always meet the same situation.
// Every generated visit passes the rule checker, because it is placed with it.
// ---------------------------------------------------------------------------

export interface AgencyData {
  services: ServiceRecord[];
  caregivers: CaregiverRecord[];
  clients: ClientRecord[];
  authorizations: AuthorizationRecord[];
  visits: VisitRecord[];
}

export const DEFAULT_SEED = 42;
const CENTER: LatLng = { lat: 39.7392, lng: -104.9903 };

export const SERVICES: ServiceRecord[] = [
  { code: "PC-15", name: "Personal care", unitMinutes: 15, requiredSkill: "personal_care" },
  { code: "HM-15", name: "Homemaker", unitMinutes: 15, requiredSkill: "homemaker" },
  { code: "RC-60", name: "Respite care", unitMinutes: 60, requiredSkill: "respite" },
];

// Fixed people the story buttons and evals rely on.
export const FIXTURES = {
  priya: "CG-01",
  floatPool: ["CG-02", "CG-03", "CG-04"],
  mariaLopez: "CG-07",
  mariaChen: "CG-08",
  asha: "CL-01",
  ashaAuthorization: "AU-01",
  mohanRao: "CL-02",
  priyaClients: ["CL-03", "CL-04", "CL-05"],
  nearlyUsedUp: "CL-06",
  nearlyUsedUpAuthorization: "AU-06",
} as const;

const CAREGIVER_NAMES = [
  "Priya Nair", "Daniel Brooks", "Grace Okafor", "Ravi Menon", "Helen Park", "Tomás Rivera", "Maria Lopez", "Maria Chen",
  "Aisha Bello", "Ben Carter", "Chloe Nguyen", "David Kim", "Elena Petrova", "Farah Haddad", "George Mills", "Hana Sato",
  "Isaac Turner", "Julia Santos", "Kevin O'Neil", "Lina Haddad", "Marcus Reed", "Nadia Rahman", "Owen Price", "Paula Diaz",
  "Quinn Foster",
];
const CLIENT_NAMES = [
  "Asha Patel", "Mohan Rao", "Eleanor Wright", "Harold Jensen", "Margaret Ellis", "Ruth Bennett", "Walter Hughes",
  "Dorothy Green", "Frank Moreno", "Betty Coleman", "Arthur Lane", "Irene Walsh", "Leonard Fox", "Mildred Shaw",
  "Raymond Cruz", "Evelyn Stone", "Howard Bishop", "Gloria Vance", "Stanley Webb", "Lorraine Hayes", "Eugene Pratt",
  "Doris Kane", "Clarence Dunn", "Agnes Ford", "Vernon Lowe", "Hazel Curtis", "Lloyd Barker", "Edna Fleming",
  "Willard Ross", "Thelma Park", "Chester Boyd", "Opal Jennings", "Ernest Gill", "Virginia Hale", "Melvin Cross",
  "Bernice Shah", "Rudy Alvarez", "Myrtle Quinn", "Floyd Harper", "Ida Chandler",
];
const TOWNS = ["Cedar Ridge", "Pine Hollow", "Red Mesa", "Willow Creek", "Silver Bend", "Aspen Flats", "Juniper Park", "Clearwater"];

// Small seeded random number generator (mulberry32).
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
const minutesOf = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

function windows(days: Weekday[], start: string, end: string) {
  return days.map((day) => ({ day, start, end }));
}

const WEEKDAY_SHAPES: { days: Weekday[]; start: string; end: string }[] = [
  { days: ["mon", "tue", "wed", "thu", "fri"], start: "07:00", end: "15:00" },
  { days: ["mon", "tue", "wed", "thu", "fri"], start: "09:00", end: "17:00" },
  { days: ["tue", "wed", "thu", "fri", "sat"], start: "08:00", end: "16:00" },
  { days: ["mon", "wed", "fri"], start: "07:00", end: "19:00" },
  { days: ["sun", "mon", "tue", "wed", "thu"], start: "10:00", end: "18:00" },
];

export function generateAgency(seed: number, today: string): AgencyData {
  const random = rng(seed);
  const pick = <T>(list: readonly T[]) => list[Math.floor(random() * list.length)];
  const between = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
  const near = (km: number): LatLng => {
    const distance = Math.sqrt(random()) * km;
    const angle = random() * Math.PI * 2;
    return {
      lat: Math.round((CENTER.lat + (distance / 111) * Math.cos(angle)) * 10000) / 10000,
      lng: Math.round((CENTER.lng + (distance / 85) * Math.sin(angle)) * 10000) / 10000,
    };
  };

  const data: AgencyData = { services: SERVICES.map((s) => ({ ...s })), caregivers: [], clients: [], authorizations: [], visits: [] };
  const tomorrow = addDays(today, 1);
  const tomorrowDay = weekdayOfDate(tomorrow);

  // ---- caregivers ----
  CAREGIVER_NAMES.forEach((name, index) => {
    const code = `CG-${pad(index + 1)}`;
    let skills: string[];
    let weeklyAvailability;
    let maxHoursPerWeek = between(34, 40);
    if (code === FIXTURES.priya) {
      skills = ["personal_care", "homemaker"];
      weeklyAvailability = windows([...WEEKDAYS], "07:00", "17:00");
      maxHoursPerWeek = 40;
    } else if ((FIXTURES.floatPool as readonly string[]).includes(code)) {
      // On-call float caregivers: kept free so a sick call can always be covered.
      skills = ["personal_care", "homemaker", "respite"];
      weeklyAvailability = windows([...WEEKDAYS], "07:00", "19:00");
      maxHoursPerWeek = 40;
    } else {
      skills = [];
      if (random() < 0.85) skills.push("personal_care");
      if (random() < 0.5) skills.push("homemaker");
      if (random() < 0.3) skills.push("respite");
      if (skills.length === 0) skills.push("homemaker");
      const shape = pick(WEEKDAY_SHAPES);
      weeklyAvailability = windows(shape.days, shape.start, shape.end);
    }
    data.caregivers.push({ code, name, skills, homeLocation: near(22), weeklyAvailability, timeOff: [], maxHoursPerWeek });
  });
  // A few planned leaves in the coming weeks (not Priya, not the float pool).
  ["CG-10", "CG-15", "CG-21"].forEach((code, i) => {
    const start = addDays(today, 5 + i * 6);
    data.caregivers.find((c) => c.code === code)!.timeOff.push({ start: atDenver(start, "00:00"), end: atDenver(addDays(start, 3), "00:00"), reason: "Vacation" });
  });

  // ---- clients ----
  CLIENT_NAMES.forEach((name, index) => {
    data.clients.push({ code: `CL-${pad(index + 1)}`, name, town: pick(TOWNS), location: near(25), preferredCaregiverCodes: [] });
  });
  const book = new MemoryAgency(data);
  let visitNumber = 1000;
  const nextCode = () => `V-${(visitNumber += 1)}`;

  // ---- authorizations and their visit patterns ----
  interface Pattern {
    auth: AuthorizationRecord;
    days: Weekday[];
    startTime: string;
    units: number;
    weeklyLimit: boolean;
    preferred?: string;
    usedUpTo?: number; // leave exactly this many units free
  }
  const patterns: Pattern[] = [];
  let authNumber = 0;
  const newAuth = (clientCode: string, serviceCode: string, startDate: string, endDate: string): AuthorizationRecord => {
    authNumber += 1;
    const auth = { code: `AU-${pad(authNumber)}`, clientCode, serviceCode, startDate, endDate, totalUnits: 0, maxUnitsPerVisit: null, maxUnitsPerWeek: null };
    data.authorizations.push(auth);
    return auth;
  };
  const sixMonthsFrom = (start: string) => addDays(start, 181);

  // AU-01: Asha's new personal care authorization, no visits yet (story 1 builds them).
  const ashaStart = tomorrow;
  const asha = newAuth(FIXTURES.asha, "PC-15", ashaStart, addDays(ashaStart, 174));
  asha.totalUnits = 400;
  asha.maxUnitsPerWeek = 20;

  // AU-02: Mohan Rao, Monday and Thursday mornings, so Friday is free for the move story.
  const raoStart = addDays(today, -90);
  patterns.push({ auth: newAuth(FIXTURES.mohanRao, "PC-15", raoStart, sixMonthsFrom(raoStart)), days: ["mon", "thu"], startTime: "10:00", units: 8, weeklyLimit: false });

  // AU-03..05: Priya's three clients, each with a visit tomorrow.
  const priyaTimes = [
    { start: "08:00", units: 8 },
    { start: "10:30", units: 6 },
    { start: "13:00", units: 8 },
  ];
  FIXTURES.priyaClients.forEach((clientCode, i) => {
    const start = addDays(today, -60 - i * 10);
    const other = WEEKDAYS[(WEEKDAYS.indexOf(tomorrowDay) + 3 + i) % 7];
    patterns.push({
      auth: newAuth(clientCode, "PC-15", start, sixMonthsFrom(start)),
      days: [tomorrowDay, other],
      startTime: priyaTimes[i].start,
      units: priyaTimes[i].units,
      weeklyLimit: false,
      preferred: FIXTURES.priya,
    });
  });

  // AU-06: a client whose authorization has exactly 4 units left.
  const usedUpStart = addDays(today, -120);
  patterns.push({ auth: newAuth(FIXTURES.nearlyUsedUp, "PC-15", usedUpStart, sixMonthsFrom(usedUpStart)), days: ["tue", "fri"], startTime: "09:00", units: 8, weeklyLimit: false, usedUpTo: 4 });

  // Everyone else: one main authorization, and every second client a second service.
  data.clients.slice(6).forEach((client, i) => {
    const start = addDays(today, -between(60, 120));
    const dayCount = pick([1, 2, 2, 2, 3]);
    const days = shuffle([...WEEKDAYS.slice(0, 5)], random).slice(0, dayCount) as Weekday[];
    patterns.push({
      auth: newAuth(client.code, "PC-15", start, sixMonthsFrom(start)),
      days,
      startTime: pick(["08:00", "09:00", "10:00", "13:00", "14:00"]),
      units: between(4, 12),
      weeklyLimit: random() < 0.35,
    });
    if ((i % 2 === 0 || i % 7 === 3) && authNumber < 60) {
      const serviceCode = random() < 0.6 ? "HM-15" : "RC-60";
      const secondDay = [shuffle([...WEEKDAYS.slice(0, 6)], random).find((d) => !days.includes(d as Weekday)) as Weekday];
      patterns.push({
        auth: newAuth(client.code, serviceCode, start, sixMonthsFrom(start)),
        days: secondDay,
        startTime: pick(["11:00", "15:00"]),
        units: serviceCode === "RC-60" ? between(2, 3) : between(4, 8),
        weeklyLimit: false,
      });
    }
  });

  // ---- place visits, date by date, with the rule checker ----
  const freeForGeneralWork = (code: string) => !(FIXTURES.floatPool as readonly string[]).includes(code);
  for (const pattern of patterns) {
    const { auth } = pattern;
    const service = SERVICES.find((s) => s.code === auth.serviceCode)!;
    // Units are set generously while placing; trimmed to what was used afterwards.
    auth.totalUnits = 100000;
    const client = data.clients.find((c) => c.code === auth.clientCode)!;
    let preferred = pattern.preferred ?? null;

    for (let date = auth.startDate; date <= auth.endDate; date = addDays(date, 1)) {
      if (!pattern.days.includes(weekdayOfDate(date))) continue;
      const start = atDenver(date, pattern.startTime);
      const end = atDenver(date, hhmm(minutesOf(pattern.startTime) + pattern.units * service.unitMinutes));
      const code = nextCode();
      const status = date < today ? "completed" : "scheduled";
      const draft: VisitFacts = { id: code, clientId: auth.clientCode, caregiverId: null, authorizationId: auth.code, serviceCode: auth.serviceCode, start, end, units: pattern.units, status };

      let caregiverCode: string | null = null;
      if (preferred && allPassed(checkVisit(book.context(draft, preferred)))) {
        caregiverCode = preferred;
      } else {
        const pool = data.caregivers.filter((c) => freeForGeneralWork(c.code) && c.code !== FIXTURES.priya).map(toCaregiverFacts);
        const [best] = findCandidates({
          visit: draft,
          caregivers: pool,
          contextFor: (caregiver) => book.context(draft, caregiver.id),
          visitsWithClient: (cg) => book.visitsWith(cg, auth.clientCode),
          limit: 1,
        });
        caregiverCode = best?.caregiverId ?? null;
        if (!preferred && caregiverCode) preferred = caregiverCode;
      }
      // Past visits always had someone. A future uncovered visit is an open shift, and must
      // still pass the client and authorization rules.
      if (!caregiverCode && (status === "completed" || !allPassed(checkVisit(book.context(draft, null))))) continue;
      book.add({ code, clientCode: auth.clientCode, caregiverCode, authorizationCode: auth.code, serviceCode: auth.serviceCode, start, end, units: pattern.units, status, version: 0 });
    }

    const used = data.visits.filter((v) => v.authorizationCode === auth.code).reduce((sum, v) => sum + v.units, 0);
    auth.totalUnits = pattern.usedUpTo !== undefined ? used + pattern.usedUpTo : Math.ceil((used * (1 + random() * 0.15)) / 4) * 4;
    if (pattern.weeklyLimit) auth.maxUnitsPerWeek = pattern.units * pattern.days.length + pick([0, 2, 4]);
    if (preferred && !client.preferredCaregiverCodes.includes(preferred)) client.preferredCaregiverCodes.push(preferred);
  }

  data.visits.sort((a, b) => a.start.getTime() - b.start.getTime());
  return data;
}

function shuffle<T>(list: T[], random: () => number): T[] {
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

/** Distance helper for tests and the agent's explanations. */
export function clientDistanceKm(data: AgencyData, caregiverCode: string, clientCode: string) {
  const caregiver = data.caregivers.find((c) => c.code === caregiverCode)!;
  const client = data.clients.find((c) => c.code === clientCode)!;
  return haversineKm(caregiver.homeLocation, client.location);
}
