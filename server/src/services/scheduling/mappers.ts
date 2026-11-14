import { AuthorizationFacts, CaregiverFacts, ClientFacts, LatLng, ServiceFacts, VisitFacts, Weekday } from "./types";

// Turns stored records (which point at each other by code) into the plain facts
// the rule checker uses. Inside the rules, a record's "id" IS its code.

export interface ServiceRecord {
  code: string;
  name: string;
  unitMinutes: number;
  requiredSkill: string;
}
export interface CaregiverRecord {
  code: string;
  name: string;
  skills: string[];
  homeLocation: LatLng;
  weeklyAvailability: { day: string; start: string; end: string }[];
  timeOff: { start: Date; end: Date; reason?: string | null }[];
  maxHoursPerWeek: number;
}
export interface ClientRecord {
  code: string;
  name: string;
  town?: string | null;
  location: LatLng;
  preferredCaregiverCodes: string[];
}
export interface AuthorizationRecord {
  code: string;
  clientCode: string;
  serviceCode: string;
  startDate: string;
  endDate: string;
  totalUnits: number;
  maxUnitsPerVisit?: number | null;
  maxUnitsPerWeek?: number | null;
}
export interface VisitRecord {
  code: string;
  clientCode: string;
  caregiverCode: string | null;
  authorizationCode: string;
  serviceCode: string;
  start: Date;
  end: Date;
  units: number;
  status: "scheduled" | "cancelled" | "completed";
  version?: number;
}

export const toServiceFacts = (s: ServiceRecord): ServiceFacts => ({
  code: s.code,
  name: s.name,
  unitMinutes: s.unitMinutes,
  requiredSkill: s.requiredSkill,
});

export const toCaregiverFacts = (c: CaregiverRecord): CaregiverFacts => ({
  id: c.code,
  name: c.name,
  skills: [...c.skills],
  homeLocation: { lat: c.homeLocation.lat, lng: c.homeLocation.lng },
  weeklyAvailability: c.weeklyAvailability.map((w) => ({ day: w.day as Weekday, start: w.start, end: w.end })),
  timeOff: c.timeOff.map((t) => ({ start: new Date(t.start), end: new Date(t.end) })),
  maxHoursPerWeek: c.maxHoursPerWeek,
});

export const toClientFacts = (c: ClientRecord): ClientFacts => ({
  id: c.code,
  name: c.name,
  location: { lat: c.location.lat, lng: c.location.lng },
  preferredCaregiverIds: [...c.preferredCaregiverCodes],
});

export const toAuthorizationFacts = (a: AuthorizationRecord): AuthorizationFacts => ({
  id: a.code,
  clientId: a.clientCode,
  serviceCode: a.serviceCode,
  startDate: a.startDate,
  endDate: a.endDate,
  totalUnits: a.totalUnits,
  maxUnitsPerVisit: a.maxUnitsPerVisit ?? null,
  maxUnitsPerWeek: a.maxUnitsPerWeek ?? null,
});

export const toVisitFacts = (v: VisitRecord): VisitFacts => ({
  id: v.code,
  clientId: v.clientCode,
  caregiverId: v.caregiverCode ?? null,
  authorizationId: v.authorizationCode,
  serviceCode: v.serviceCode,
  start: new Date(v.start),
  end: new Date(v.end),
  units: v.units,
  status: v.status,
});
