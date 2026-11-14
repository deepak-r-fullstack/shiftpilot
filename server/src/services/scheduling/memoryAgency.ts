import { denverDate, weekKey } from "../../utils/time";
import { Candidate, findCandidates } from "./candidateFinder";
import {
  AuthorizationRecord,
  CaregiverRecord,
  ClientRecord,
  ServiceRecord,
  toAuthorizationFacts,
  toCaregiverFacts,
  toServiceFacts,
  toVisitFacts,
  VisitRecord,
} from "./mappers";
import { allPassed, checkVisit, RuleContext } from "./ruleChecker";
import { CaregiverFacts, LatLng, VisitFacts } from "./types";

// ---------------------------------------------------------------------------
// A whole agency held in memory with fast lookups. Used when many visits are
// placed at once (the demo seed, and building a schedule from an authorization),
// where asking the database for every single rule check would be far too slow.
// Same rule checker, same candidate finder: only the lookups are different.
// ---------------------------------------------------------------------------

export interface AgencyRecords {
  services: ServiceRecord[];
  caregivers: CaregiverRecord[];
  clients: ClientRecord[];
  authorizations: AuthorizationRecord[];
  visits: VisitRecord[];
}

function push<T>(map: Map<string, T[]>, key: string, value: T) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export class MemoryAgency {
  private byCaregiverWeek = new Map<string, VisitFacts[]>();
  private byClientDay = new Map<string, VisitFacts[]>();
  private byAuthorization = new Map<string, VisitFacts[]>();
  private visitCountByPair = new Map<string, number>();
  private clientLocation = new Map<string, LatLng>();
  private caregiverFacts = new Map<string, CaregiverFacts>();

  constructor(private readonly data: AgencyRecords) {
    data.clients.forEach((client) => this.clientLocation.set(client.code, client.location));
    data.caregivers.forEach((caregiver) => this.caregiverFacts.set(caregiver.code, toCaregiverFacts(caregiver)));
    data.visits.filter((visit) => visit.status !== "cancelled").forEach((visit) => this.index(visit));
  }

  private index(record: VisitRecord) {
    const visit = toVisitFacts(record);
    if (visit.caregiverId) push(this.byCaregiverWeek, `${visit.caregiverId}|${weekKey(visit.start)}`, visit);
    push(this.byClientDay, `${visit.clientId}|${denverDate(visit.start)}`, visit);
    push(this.byAuthorization, visit.authorizationId, visit);
    if (visit.caregiverId) {
      const key = `${visit.caregiverId}|${visit.clientId}`;
      this.visitCountByPair.set(key, (this.visitCountByPair.get(key) ?? 0) + 1);
    }
  }

  /** Adds a visit to the agency (and to its records). */
  add(record: VisitRecord) {
    this.data.visits.push(record);
    if (record.status !== "cancelled") this.index(record);
  }

  /** Adds a planned visit to the lookups only, so later planned visits are checked against it. */
  hold(record: VisitRecord) {
    this.index(record);
  }

  caregivers(): CaregiverFacts[] {
    return [...this.caregiverFacts.values()];
  }

  visitsWith(caregiverCode: string, clientCode: string) {
    return this.visitCountByPair.get(`${caregiverCode}|${clientCode}`) ?? 0;
  }

  context(visit: VisitFacts, caregiverCode: string | null): RuleContext {
    const auth = this.data.authorizations.find((a) => a.code === visit.authorizationId);
    const service = this.data.services.find((s) => s.code === visit.serviceCode)!;
    const seen = new Set<string>();
    const others: VisitFacts[] = [];
    const addAll = (list?: VisitFacts[]) =>
      list?.forEach((other) => {
        if (other.id !== visit.id && !seen.has(other.id)) {
          seen.add(other.id);
          others.push(other);
        }
      });
    if (caregiverCode) addAll(this.byCaregiverWeek.get(`${caregiverCode}|${weekKey(visit.start)}`));
    addAll(this.byClientDay.get(`${visit.clientId}|${denverDate(visit.start)}`));
    addAll(this.byAuthorization.get(visit.authorizationId));
    return {
      visit: { ...visit, caregiverId: caregiverCode },
      service: toServiceFacts(service),
      authorization: auth ? toAuthorizationFacts(auth) : null,
      caregiver: caregiverCode ? this.caregiverFacts.get(caregiverCode) ?? null : null,
      clientLocation: this.clientLocation.get(visit.clientId)!,
      otherVisits: others.map((other) => ({ ...other, clientLocation: this.clientLocation.get(other.clientId)! })),
    };
  }

  passes(visit: VisitFacts, caregiverCode: string | null): boolean {
    return allPassed(checkVisit(this.context(visit, caregiverCode)));
  }

  candidates(visit: VisitFacts, options: { exclude?: string[]; limit?: number } = {}): Candidate[] {
    const exclude = new Set(options.exclude ?? []);
    return findCandidates({
      visit,
      caregivers: this.caregivers().filter((caregiver) => !exclude.has(caregiver.id)),
      contextFor: (caregiver) => this.context(visit, caregiver.id),
      visitsWithClient: (code) => this.visitsWith(code, visit.clientId),
      limit: options.limit,
    });
  }
}
