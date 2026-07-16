import type {
  AnswersResponse,
  CreateGenerateResponse,
  Job,
  JobDraft,
} from "@codply/contracts";
import type { ApiGateway } from "../gateway";

/** Generation-job lifecycle: create, snapshot, answer questions, cancel. */
export class JobService {
  constructor(private readonly gateway: ApiGateway) {}

  generate(
    prompt: string,
    options?: { skipQuestions?: boolean; generationMode?: "agent" | "engine" },
  ): Promise<CreateGenerateResponse> {
    const opts: { skip_questions?: boolean; generation_mode?: "agent" | "engine" } = {};
    if (options?.skipQuestions !== undefined) opts.skip_questions = options.skipQuestions;
    if (options?.generationMode !== undefined) opts.generation_mode = options.generationMode;
    return this.gateway.client.generate(
      { prompt, options: Object.keys(opts).length > 0 ? opts : undefined },
      { idempotencyKey: crypto.randomUUID() },
    );
  }

  snapshot(jobId: string, signal?: AbortSignal): Promise<Job> {
    return this.gateway.client.jobSnapshot(jobId, { signal });
  }

  /** Answers carry option IDs natively (E26) — free-text answers ride as-is. */
  answers(jobId: string, answers: Record<string, string>): Promise<AnswersResponse> {
    return this.gateway.client.answers(jobId, { answers });
  }

  cancel(jobId: string): Promise<void> {
    return this.gateway.client.cancel(jobId);
  }

  /** Live draft source (E04-F14): the code as it is being written. */
  draft(jobId: string, signal?: AbortSignal): Promise<JobDraft> {
    return this.gateway.client.jobDraft(jobId, { signal });
  }
}
