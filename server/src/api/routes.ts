import { Router } from "express";
import { successResponseWithData } from "../helpers/response";

// Every endpoint and who may call it, in one place.
const router = Router();

router.get("/health", (_req, res) => {
  return successResponseWithData(res, "ShiftPilot is running.", { status: "ok" });
});

export default router;
