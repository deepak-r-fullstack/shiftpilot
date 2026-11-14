import { Authorization } from "../../models/authorization.model";
import { Caregiver } from "../../models/caregiver.model";
import { Client } from "../../models/client.model";
import { Service } from "../../models/service.model";
import { Visit } from "../../models/visit.model";
import { NotFoundError } from "../../helpers/errors";
import { dayRange, weekRange } from "../../utils/time";
import { toAuthorizationFacts, toCaregiverFacts, toServiceFacts, toVisitFacts, VisitRecord } from "./mappers";
import { RuleContext } from "./ruleChecker";
import { LatLng, VisitFacts } from "./types";

// ---------------------------------------------------------------------------
// Loads, from one sandbox, exactly the records the rules need for one visit:
// the caregiver's week, the client's day and the whole authorization.
// "siblings" are the other changes in the same proposal: they replace the
// stored version of a visit, so two changes in one plan cannot clash.
// ---------------------------------------------------------------------------

export type SiblingVisit = VisitFacts; // id = visit code, or a temporary "new-…" id for a visit not created yet

export async function loadRuleContext(sandboxId: string, visit: VisitFacts, siblings: SiblingVisit[] = []): Promise<RuleContext> {
  const [service, authorization, caregiver, client] = await Promise.all([
    Service.findOne({ sandboxId, code: visit.serviceCode }).lean(),
    Authorization.findOne({ sandboxId, code: visit.authorizationId, clientCode: visit.clientId }).lean(),
    visit.caregiverId ? Caregiver.findOne({ sandboxId, code: visit.caregiverId }).lean() : null,
    Client.findOne({ sandboxId, code: visit.clientId }).lean(),
  ]);
  if (!service) throw new NotFoundError(`Service ${visit.serviceCode} was not found.`);
  if (!client) throw new NotFoundError(`Client ${visit.clientId} was not found.`);
  if (visit.caregiverId && !caregiver) throw new NotFoundError(`Caregiver ${visit.caregiverId} was not found.`);

  const week = weekRange(visit.start);
  const day = dayRange(visit.start);
  const or: Record<string, unknown>[] = [
    { clientCode: visit.clientId, start: { $lt: day.to }, end: { $gt: day.from } },
    { authorizationCode: visit.authorizationId },
  ];
  if (visit.caregiverId) or.push({ caregiverCode: visit.caregiverId, start: { $lt: week.to }, end: { $gt: week.from } });
  const stored = await Visit.find({ sandboxId, status: { $ne: "cancelled" }, $or: or }).lean<VisitRecord[]>();

  // Merge: siblings win over the stored copy; the visit being checked is never in the list.
  const byId = new Map<string, VisitFacts>();
  stored.forEach((record) => byId.set(record.code, toVisitFacts(record)));
  siblings.forEach((sibling) => byId.set(sibling.id, sibling));
  byId.delete(visit.id);
  const others = [...byId.values()].filter((other) => other.status !== "cancelled");

  const clientCodes = [...new Set(others.map((other) => other.clientId))];
  const locations = new Map<string, LatLng>(
    (await Client.find({ sandboxId, code: { $in: clientCodes } }, { code: 1, location: 1 }).lean()).map((c) => [c.code, c.location])
  );

  return {
    visit,
    service: toServiceFacts(service),
    authorization: authorization ? toAuthorizationFacts(authorization) : null,
    caregiver: caregiver ? toCaregiverFacts(caregiver) : null,
    clientLocation: client.location,
    otherVisits: others.map((other) => ({ ...other, clientLocation: locations.get(other.clientId) ?? client.location })),
  };
}

/** Units still free on an authorization, counting the proposal's other changes. */
export async function unitsLeft(sandboxId: string, authorizationCode: string, siblings: SiblingVisit[] = []): Promise<number | null> {
  const authorization = await Authorization.findOne({ sandboxId, code: authorizationCode }).lean();
  if (!authorization) return null;
  const stored = await Visit.find({ sandboxId, authorizationCode, status: { $ne: "cancelled" } }, { code: 1, units: 1 }).lean();
  const units = new Map<string, number>(stored.map((v) => [v.code, v.units]));
  siblings
    .filter((s) => s.authorizationId === authorizationCode)
    .forEach((s) => (s.status === "cancelled" ? units.delete(s.id) : units.set(s.id, s.units)));
  return authorization.totalUnits - [...units.values()].reduce((sum, n) => sum + n, 0);
}
