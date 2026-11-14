import { Caregiver } from "../../models/caregiver.model";
import { Visit } from "../../models/visit.model";
import { Candidate, findCandidates } from "./candidateFinder";
import { loadRuleContext, SiblingVisit } from "./factsLoader";
import { toCaregiverFacts } from "./mappers";
import { RuleContext } from "./ruleChecker";
import { VisitFacts } from "./types";

// Database side of the candidate finder: who in this sandbox could take this visit?
export async function findCandidatesForVisit(
  sandboxId: string,
  visit: VisitFacts,
  options: { siblings?: SiblingVisit[]; exclude?: string[]; limit?: number } = {}
): Promise<Candidate[]> {
  const exclude = new Set((options.exclude ?? []).map((code) => code.toUpperCase()));
  const caregivers = (await Caregiver.find({ sandboxId }).lean()).filter((c) => !exclude.has(c.code)).map(toCaregiverFacts);

  const contexts = new Map<string, RuleContext>();
  await Promise.all(
    caregivers.map(async (caregiver) => {
      contexts.set(caregiver.id, await loadRuleContext(sandboxId, { ...visit, caregiverId: caregiver.id }, options.siblings ?? []));
    })
  );

  const history = await Visit.aggregate<{ _id: string; count: number }>([
    { $match: { sandboxId, clientCode: visit.clientId, caregiverCode: { $ne: null }, status: { $ne: "cancelled" } } },
    { $group: { _id: "$caregiverCode", count: { $sum: 1 } } },
  ]);
  const counts = new Map(history.map((row) => [row._id, row.count]));

  return findCandidates({
    visit,
    caregivers,
    contextFor: (caregiver) => contexts.get(caregiver.id)!,
    visitsWithClient: (code) => counts.get(code) ?? 0,
    limit: options.limit,
  });
}
