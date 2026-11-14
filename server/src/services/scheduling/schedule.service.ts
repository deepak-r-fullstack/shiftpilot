import { Authorization } from "../../models/authorization.model";
import { Caregiver } from "../../models/caregiver.model";
import { Client } from "../../models/client.model";
import { Service } from "../../models/service.model";
import { Visit } from "../../models/visit.model";
import { unitsLeft } from "./factsLoader";

// Read-only views of a sandbox's agency, for the screens and the agent's tools.

export async function listCaregivers(sandboxId: string) {
  return Caregiver.find({ sandboxId }, { _id: 0, sandboxId: 0, __v: 0 }).sort({ code: 1 }).lean();
}

export async function listClients(sandboxId: string) {
  return Client.find({ sandboxId }, { _id: 0, sandboxId: 0, __v: 0 }).sort({ code: 1 }).lean();
}

export async function listServices(sandboxId: string) {
  return Service.find({ sandboxId }, { _id: 0, sandboxId: 0, __v: 0 }).sort({ code: 1 }).lean();
}

export async function listAuthorizations(sandboxId: string, clientCode?: string) {
  const filter: Record<string, unknown> = { sandboxId };
  if (clientCode) filter.clientCode = clientCode.toUpperCase();
  const authorizations = await Authorization.find(filter, { _id: 0, sandboxId: 0, __v: 0 }).sort({ code: 1 }).lean();
  return Promise.all(authorizations.map(async (a) => ({ ...a, unitsLeft: await unitsLeft(sandboxId, a.code) })));
}

export interface ScheduleFilter {
  from: Date;
  to: Date;
  caregiverCode?: string;
  clientCode?: string;
}

/** Visits in a time range, with caregiver and client names. */
export async function listVisits(sandboxId: string, filter: ScheduleFilter) {
  const query: Record<string, unknown> = { sandboxId, start: { $lt: filter.to }, end: { $gt: filter.from } };
  if (filter.caregiverCode) query.caregiverCode = filter.caregiverCode.toUpperCase();
  if (filter.clientCode) query.clientCode = filter.clientCode.toUpperCase();
  const [visits, caregivers, clients] = await Promise.all([
    Visit.find(query, { _id: 0, sandboxId: 0, __v: 0 }).sort({ start: 1 }).limit(2000).lean(),
    Caregiver.find({ sandboxId }, { code: 1, name: 1 }).lean(),
    Client.find({ sandboxId }, { code: 1, name: 1 }).lean(),
  ]);
  const caregiverName = new Map(caregivers.map((c) => [c.code, c.name]));
  const clientName = new Map(clients.map((c) => [c.code, c.name]));
  return visits.map((visit) => ({
    ...visit,
    caregiverName: visit.caregiverCode ? caregiverName.get(visit.caregiverCode) ?? null : null,
    clientName: clientName.get(visit.clientCode) ?? visit.clientCode,
  }));
}
