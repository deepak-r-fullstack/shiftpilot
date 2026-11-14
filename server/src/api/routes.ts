import { Router } from "express";
import rateLimit from "express-rate-limit";
import { isTest } from "../config/env";
import { asyncHandler } from "../helpers/asyncHandler";
import { successResponseWithData } from "../helpers/response";
import { validateRequest } from "../middlewares/validateRequest.middleware";
import { authenticateSession } from "../middlewares/sandbox.middleware";
import * as sessionController from "../controllers/session.controller";
import * as scheduleController from "../controllers/schedule.controller";
import * as proposalsController from "../controllers/proposals.controller";

// Every endpoint and who may call it, in one place.
const router = Router();

// Starting a demo copies a whole agency, so it is limited per IP address.
const sessionLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: isTest ? 1000 : 20, standardHeaders: true, legacyHeaders: false });
const apiLimiter = rateLimit({ windowMs: 60 * 1000, limit: isTest ? 10000 : 300, standardHeaders: true, legacyHeaders: false });

router.get("/health", (_req, res) => {
  return successResponseWithData(res, "ShiftPilot is running.", { status: "ok" });
});

// ---- demo session (one sandbox per visitor) ----
router.post("/session", sessionLimiter, asyncHandler(sessionController.createSession));
router.get("/session", apiLimiter, authenticateSession, asyncHandler(sessionController.getCurrentSession));
router.post("/session/reset", sessionLimiter, authenticateSession, asyncHandler(sessionController.resetSession));

// ---- the agency (read only) ----
router.get("/schedule", apiLimiter, authenticateSession, validateRequest(scheduleController.scheduleQuerySchema, "query"), asyncHandler(scheduleController.getSchedule));
router.get("/caregivers", apiLimiter, authenticateSession, asyncHandler(scheduleController.getCaregivers));
router.get("/clients", apiLimiter, authenticateSession, asyncHandler(scheduleController.getClients));
router.get("/services", apiLimiter, authenticateSession, asyncHandler(scheduleController.getServices));
router.get(
  "/authorizations",
  apiLimiter,
  authenticateSession,
  validateRequest(scheduleController.authorizationsQuerySchema, "query"),
  asyncHandler(scheduleController.getAuthorizations)
);

// ---- proposals (review before anything changes) ----
router.get("/proposals/:id", apiLimiter, authenticateSession, asyncHandler(proposalsController.getProposalById));
router.post("/proposals/:id/approve-all", apiLimiter, authenticateSession, asyncHandler(proposalsController.approveAllChanges));
router.post(
  "/proposals/:id/changes/:changeId/decision",
  apiLimiter,
  authenticateSession,
  validateRequest(proposalsController.decisionSchema),
  asyncHandler(proposalsController.decide)
);
router.put(
  "/proposals/:id/changes/:changeId",
  apiLimiter,
  authenticateSession,
  validateRequest(proposalsController.editChangeSchema),
  asyncHandler(proposalsController.edit)
);
router.get("/proposals/:id/changes/:changeId/candidates", apiLimiter, authenticateSession, asyncHandler(proposalsController.getCandidates));

export default router;
