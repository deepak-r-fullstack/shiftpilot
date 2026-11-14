import { Request, Response } from "express";
import { z } from "zod";
import { BadRequestError, ServiceUnavailableError } from "../helpers/errors";
import { successResponseWithData } from "../helpers/response";
import { getSandboxId, getSession } from "../middlewares/sandbox.middleware";
import { ChangeRequest } from "../models/changeRequest.model";
import { runAgent } from "../services/agent/agentLoop";
import { AgentEvent } from "../services/agent/events";
import { getModel, isAiConfigured } from "../services/agent/model";
import { canSpend, recordSpend } from "../services/demo/costGuard";
import { freeRequestsLeft, takeFreeRequest } from "../services/demo/requestLimit";
import { playSavedRun } from "../services/demo/savedRuns";
import { findStory, STORIES } from "../services/demo/stories";
import { startRecording } from "../services/integrations/agentReplay";
import { logger, serializeError } from "../utils/logger";

export const agentRequestSchema = z
  .object({
    text: z.string().trim().min(3).max(500).optional(),
    storyKey: z.string().trim().max(40).optional(),
  })
  .refine((body) => Boolean(body.text) !== Boolean(body.storyKey), { message: "Send either text or a storyKey." });

/** What the request box needs to know: stories, free requests left, whether live AI is on. */
export async function getRequestOptions(_req: Request, res: Response) {
  const live = isAiConfigured() && (await canSpend());
  return successResponseWithData(res, "Request options.", {
    stories: STORIES,
    freeRequestsLeft: await freeRequestsLeft(getSandboxId(res)),
    liveAi: live,
  });
}

function openStream(res: Response) {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no"); // stop proxies from holding the stream back
  res.flushHeaders();
  const events: AgentEvent[] = [];
  const emit = (event: AgentEvent) => {
    events.push(event);
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  return { emit, events };
}

/**
 * Runs the agent for one request and streams each step to the screen.
 * Limits are checked before the stream opens, so they come back as normal JSON errors.
 */
export async function createAgentRequest(_req: Request, res: Response) {
  const body = res.locals.body as z.infer<typeof agentRequestSchema>;
  const sandboxId = getSandboxId(res);
  const { coordinator, sandbox } = getSession(res);
  const story = body.storyKey ? findStory(body.storyKey) : null;
  if (body.storyKey && !story) throw new BadRequestError("Unknown story.");
  const text = story?.text ?? body.text!;

  const model = getModel();
  const live = Boolean(model) && (await canSpend());
  if (!live && !story) {
    throw new ServiceUnavailableError("Live AI is resting for today. Try the story buttons.");
  }
  if (!story) await takeFreeRequest(sandboxId);

  if (!live) {
    const { emit } = openStream(res);
    const played = await playSavedRun(story!.key, model ? "budget" : "off", emit);
    if (!played) emit({ type: "error", message: "This story has not been recorded yet. Please try again later." });
    emit({ type: "done" });
    return res.end();
  }

  const changeRequest = await ChangeRequest.create({ sandboxId, text, storyKey: story?.key ?? null, createdBy: coordinator.email });
  const { emit } = openStream(res);
  emit({ type: "status", text: "Reading your request…" });
  try {
    const result = await runAgent({
      sandboxId,
      requestId: String(changeRequest._id),
      text,
      model: model!,
      emit,
      recorder: startRecording(text, sandbox.label),
    });
    await recordSpend(result.usd);
    await ChangeRequest.updateOne(
      { _id: changeRequest._id },
      { status: result.proposalId ? "proposed" : result.asked ? "asked" : "failed", proposalId: result.proposalId }
    );
  } catch (err) {
    logger.error("agent request failed", serializeError(err));
    emit({ type: "error", message: "Something went wrong on our side. Please try again." });
  }
  emit({ type: "done" });
  return res.end();
}
