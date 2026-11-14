import { Authorization } from "../../models/authorization.model";
import { Service } from "../../models/service.model";
import { Visit } from "../../models/visit.model";
import { BadRequestError, NotFoundError } from "../../helpers/errors";
import { wallMinutes } from "../../utils/time";
import { loadRuleContext, SiblingVisit, unitsLeft } from "./factsLoader";
import { isLowRisk } from "./lowRisk";
import { VisitRecord } from "./mappers";
import { allPassed, checkVisit } from "./ruleChecker";
import { RuleResult, VisitFacts } from "./types";

// ---------------------------------------------------------------------------
// Checks one proposed change against the database and the rule checker.
// Used by the agent's check_change tool, when a proposal is saved, when a
// coordinator edits a change, and again when a plan is applied.
// ---------------------------------------------------------------------------

export type ChangeKind = "assign" | "move" | "cancel" | "create";

export interface ChangeInput {
  kind: ChangeKind;
  visitCode?: string; // assign, move, cancel
  caregiverCode?: string | null; // assign (required), move / create (optional)
  start?: string; // ISO, move and create
  end?: string;
  clientCode?: string; // create
  authorizationCode?: string; // create
}

export interface VisitShape {
  visitCode: string | null;
  clientCode: string;
  caregiverCode: string | null;
  authorizationCode: string;
  serviceCode: string;
  start: Date;
  end: Date;
  units: number;
  status: "scheduled" | "cancelled" | "completed";
  version: number | null;
}

export interface CheckedChange {
  input: ChangeInput;
  before: VisitShape | null;
  after: VisitShape | null;
  ruleResults: RuleResult[];
  ok: boolean;
  unitsLeftBefore: number | null;
  unitsLeftAfter: number | null;
  lowRisk: boolean;
}

export function shapeOf(record: VisitRecord): VisitShape {
  return {
    visitCode: record.code,
    clientCode: record.clientCode,
    caregiverCode: record.caregiverCode ?? null,
    authorizationCode: record.authorizationCode,
    serviceCode: record.serviceCode,
    start: new Date(record.start),
    end: new Date(record.end),
    units: record.units,
    status: record.status,
    version: record.version ?? 0,
  };
}

/** A visit shape as rule facts. A visit not created yet gets the temporary id given. */
export function factsOf(shape: VisitShape, temporaryId = "new"): VisitFacts {
  return {
    id: shape.visitCode ?? temporaryId,
    clientId: shape.clientCode,
    caregiverId: shape.caregiverCode,
    authorizationId: shape.authorizationCode,
    serviceCode: shape.serviceCode,
    start: shape.start,
    end: shape.end,
    units: shape.units,
    status: shape.status,
  };
}

function parseDate(value: string | undefined, field: string): Date {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) throw new BadRequestError(`"${field}" must be a date and time.`);
  return date;
}

async function unitsFor(sandboxId: string, serviceCode: string, start: Date, end: Date): Promise<number> {
  const service = await Service.findOne({ sandboxId, code: serviceCode }).lean();
  if (!service) throw new NotFoundError(`Service ${serviceCode} was not found.`);
  // May be fractional on purpose: the whole_units rule then explains the problem.
  return wallMinutes(start, end) / service.unitMinutes;
}

async function loadVisit(sandboxId: string, code: string | undefined): Promise<VisitShape> {
  if (!code) throw new BadRequestError("Which visit? A visit code like V-1042 is needed.");
  const record = await Visit.findOne({ sandboxId, code: code.toUpperCase() }).lean<VisitRecord>();
  if (!record) throw new NotFoundError(`Visit ${code} was not found.`);
  if (record.status === "completed") throw new BadRequestError(`Visit ${record.code} already happened and cannot be changed.`);
  if (record.status === "cancelled") throw new BadRequestError(`Visit ${record.code} is already cancelled.`);
  return shapeOf(record);
}

/** Works out the visit after the change, without checking any rule. */
export async function resolveChange(sandboxId: string, change: ChangeInput): Promise<{ before: VisitShape | null; after: VisitShape }> {
  if (change.kind === "create") {
    if (!change.clientCode || !change.authorizationCode) throw new BadRequestError("A new visit needs a client and an authorization.");
    const authorization = await Authorization.findOne({ sandboxId, code: change.authorizationCode.toUpperCase() }).lean();
    if (!authorization) throw new NotFoundError(`Authorization ${change.authorizationCode} was not found.`);
    const start = parseDate(change.start, "start");
    const end = parseDate(change.end, "end");
    return {
      before: null,
      after: {
        visitCode: null,
        clientCode: change.clientCode.toUpperCase(),
        caregiverCode: change.caregiverCode ? change.caregiverCode.toUpperCase() : null,
        authorizationCode: authorization.code,
        serviceCode: authorization.serviceCode,
        start,
        end,
        units: await unitsFor(sandboxId, authorization.serviceCode, start, end),
        status: "scheduled",
        version: null,
      },
    };
  }

  const before = await loadVisit(sandboxId, change.visitCode);
  if (change.kind === "cancel") return { before, after: { ...before, status: "cancelled" } };
  if (change.kind === "assign") {
    if (change.caregiverCode === undefined) throw new BadRequestError("Assigning a visit needs a caregiver (or null to leave it open).");
    return { before, after: { ...before, caregiverCode: change.caregiverCode ? change.caregiverCode.toUpperCase() : null } };
  }
  // move
  const start = parseDate(change.start, "start");
  const end = parseDate(change.end, "end");
  const caregiverCode = change.caregiverCode === undefined ? before.caregiverCode : change.caregiverCode ? change.caregiverCode.toUpperCase() : null;
  return { before, after: { ...before, start, end, caregiverCode, units: await unitsFor(sandboxId, before.serviceCode, start, end) } };
}

/** Checks one change. "siblings" = the proposal's other (not rejected) changes, as they would be after. */
export async function checkChange(sandboxId: string, change: ChangeInput, siblings: SiblingVisit[] = []): Promise<CheckedChange> {
  const { before, after } = await resolveChange(sandboxId, change);
  const leftBefore = await unitsLeft(sandboxId, after.authorizationCode, siblings);
  const activeUnits = (shape: VisitShape | null) => (shape && shape.status !== "cancelled" ? shape.units : 0);
  const unitsLeftAfter = leftBefore === null ? null : leftBefore + activeUnits(before) - activeUnits(after);

  let ruleResults: RuleResult[] = [];
  if (after.status !== "cancelled") {
    const ctx = await loadRuleContext(sandboxId, factsOf(after), siblings);
    ruleResults = checkVisit(ctx);
  }
  return {
    input: change,
    before,
    after,
    ruleResults,
    ok: allPassed(ruleResults),
    unitsLeftBefore: leftBefore,
    unitsLeftAfter,
    lowRisk: change.kind === "move" && before !== null && isLowRisk(factsOf(before), factsOf(after)),
  };
}
