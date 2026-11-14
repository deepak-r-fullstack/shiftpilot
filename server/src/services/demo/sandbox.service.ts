import crypto from "crypto";
import { Model, Types } from "mongoose";
import { Authorization } from "../../models/authorization.model";
import { Caregiver } from "../../models/caregiver.model";
import { Client } from "../../models/client.model";
import { TEMPLATE_SANDBOX } from "../../models/common";
import { Sandbox, SandboxDoc } from "../../models/sandbox.model";
import { Service } from "../../models/service.model";
import { TemplateState } from "../../models/template.model";
import { Visit } from "../../models/visit.model";
import { ChangeRequest } from "../../models/changeRequest.model";
import { Proposal } from "../../models/proposal.model";
import { AppliedPlan } from "../../models/appliedPlan.model";
import { agencyToday } from "../../utils/clock";
import { logger } from "../../utils/logger";
import { DEFAULT_SEED, generateAgency } from "./seedData";

// ---------------------------------------------------------------------------
// Every demo visitor works on a private copy ("sandbox") of the template agency,
// so nobody sees anyone else's changes. Sandboxes are deleted after 24 hours.
// ---------------------------------------------------------------------------

export const SANDBOX_HOURS = 24;
const SCHEDULING_MODELS: Model<any>[] = [Service, Caregiver, Client, Authorization, Visit];

let seeding: Promise<void> | null = null;

/** Builds the template agency for a given day (default: today in Denver), replacing the old one. */
export async function seedTemplate(today = agencyToday()): Promise<void> {
  const data = generateAgency(DEFAULT_SEED, today);
  await Promise.all(SCHEDULING_MODELS.map((model) => model.deleteMany({ sandboxId: TEMPLATE_SANDBOX })));
  const withSandbox = <T extends object>(list: T[]) => list.map((item) => ({ ...item, sandboxId: TEMPLATE_SANDBOX }));
  await Service.insertMany(withSandbox(data.services));
  await Caregiver.insertMany(withSandbox(data.caregivers));
  await Client.insertMany(withSandbox(data.clients));
  await Authorization.insertMany(withSandbox(data.authorizations));
  await Visit.insertMany(withSandbox(data.visits));
  const lastNumber = Math.max(...data.visits.map((v) => Number(v.code.slice(2))));
  await TemplateState.findOneAndUpdate(
    { key: "template" },
    { seededFor: today, nextVisitNumber: lastNumber + 1 },
    { upsert: true }
  );
  logger.info("template agency seeded", { day: today, visits: data.visits.length });
}

/** Visits are placed relative to today, so yesterday's template is rebuilt before it is copied. */
export async function ensureFreshTemplate(today = agencyToday()): Promise<{ nextVisitNumber: number }> {
  let state = await TemplateState.findOne({ key: "template" }).lean();
  if (!state || state.seededFor !== today) {
    // One rebuild at a time, even when several visitors arrive together.
    seeding ??= seedTemplate(today).finally(() => {
      seeding = null;
    });
    await seeding;
    state = await TemplateState.findOne({ key: "template" }).lean();
  }
  return { nextVisitNumber: state!.nextVisitNumber };
}

async function copyTemplateInto(sandboxId: string) {
  for (const model of SCHEDULING_MODELS) {
    const docs = await model.find({ sandboxId: TEMPLATE_SANDBOX }).lean();
    if (docs.length === 0) continue;
    await model.insertMany(
      docs.map(({ _id, ...doc }: any) => ({ ...doc, sandboxId })),
      { ordered: false }
    );
  }
}

export async function createSandbox(today = agencyToday()): Promise<SandboxDoc> {
  const { nextVisitNumber } = await ensureFreshTemplate(today);
  const label = `Visitor ${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
  const sandbox = await Sandbox.create({
    label,
    nextVisitNumber,
    expiresAt: new Date(Date.now() + SANDBOX_HOURS * 3600 * 1000),
  });
  await copyTemplateInto(String(sandbox._id));
  return sandbox.toObject() as SandboxDoc;
}

/** Puts a visitor's sandbox back to a fresh copy of today's template. */
export async function resetSandbox(sandboxId: string, today = agencyToday()): Promise<void> {
  const { nextVisitNumber } = await ensureFreshTemplate(today);
  await Promise.all([
    ...SCHEDULING_MODELS.map((model) => model.deleteMany({ sandboxId })),
    ChangeRequest.deleteMany({ sandboxId }),
    Proposal.deleteMany({ sandboxId }),
    AppliedPlan.deleteMany({ sandboxId }),
  ]);
  await copyTemplateInto(sandboxId);
  await Sandbox.updateOne({ _id: sandboxId }, { nextVisitNumber });
}

/**
 * Expired sandboxes lose their scheduling records too (the TTL index only removes the Sandbox itself).
 * Only sandboxes made more than 2 hours ago are touched, so one being created right now is never cleared.
 */
export async function deleteOrphanedSandboxData(now = Date.now()): Promise<number> {
  const live = new Set((await Sandbox.find({}, { _id: 1 }).lean()).map((s) => String(s._id)));
  live.add(TEMPLATE_SANDBOX);
  const oldEnough = (id: string) => Types.ObjectId.isValid(id) && new Types.ObjectId(id).getTimestamp().getTime() < now - 2 * 3600 * 1000;
  let removed = 0;
  for (const model of [...SCHEDULING_MODELS, ChangeRequest, Proposal, AppliedPlan] as Model<any>[]) {
    const ids: string[] = await model.distinct("sandboxId");
    const dead = ids.filter((id) => !live.has(id) && oldEnough(id));
    if (dead.length) removed += (await model.deleteMany({ sandboxId: { $in: dead } })).deletedCount ?? 0;
  }
  return removed;
}

/** Hands out the next visit code for a sandbox, atomically. */
export async function nextVisitCode(sandboxId: string): Promise<string> {
  const sandbox = await Sandbox.findByIdAndUpdate(sandboxId, { $inc: { nextVisitNumber: 1 } }, { new: false }).lean();
  if (!sandbox) throw new Error("Sandbox not found");
  return `V-${sandbox.nextVisitNumber}`;
}
