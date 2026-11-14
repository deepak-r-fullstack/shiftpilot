// Plain data shapes the scheduling rules work on. No Mongoose here: the rule
// checker, schedule builder and candidate finder are pure and unit tested.

export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export const WEEKDAYS: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export interface LatLng {
  lat: number;
  lng: number;
}

// "HH:mm" in Denver wall-clock time.
export interface WeeklyWindow {
  day: Weekday;
  start: string;
  end: string;
}

export interface ServiceFacts {
  code: string;
  name: string;
  unitMinutes: number;
  requiredSkill: string;
}

// Dates are "YYYY-MM-DD" (Denver), inclusive at both ends.
export interface AuthorizationFacts {
  id: string;
  clientId: string;
  serviceCode: string;
  startDate: string;
  endDate: string;
  totalUnits: number;
  maxUnitsPerVisit?: number | null;
  maxUnitsPerWeek?: number | null;
}

export interface CaregiverFacts {
  id: string;
  name: string;
  skills: string[];
  homeLocation: LatLng;
  weeklyAvailability: WeeklyWindow[];
  timeOff: { start: Date; end: Date }[];
  maxHoursPerWeek: number;
}

export interface ClientFacts {
  id: string;
  name: string;
  location: LatLng;
  preferredCaregiverIds: string[];
}

export type VisitStatus = "scheduled" | "cancelled" | "completed";

export interface VisitFacts {
  id: string;
  clientId: string;
  caregiverId: string | null;
  authorizationId: string;
  serviceCode: string;
  start: Date;
  end: Date;
  units: number;
  status: VisitStatus;
}

export type RuleId =
  | "whole_units"
  | "authorized_service"
  | "inside_dates"
  | "units_left"
  | "per_visit_limit"
  | "per_week_limit"
  | "caregiver_available"
  | "caregiver_qualified"
  | "no_clash"
  | "hours_limit"
  | "travel_buffer";

export interface RuleResult {
  rule: RuleId;
  passed: boolean;
  message: string;
}
