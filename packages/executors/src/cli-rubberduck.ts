import {
  Executor,
  ExecutorContext,
  Requirements,
  RubberduckDriver,
  RubberduckQuestion,
  RequirementsSchema,
} from '@volibear/contracts';

/**
 * LLM-backed Rubberduck driver that uses the configured executor to drive
 * discovery, answer delegation, and requirements generation.
 *
 * This replaces MockRubberduckDriver when a real executor (opencode, codex,
 * claude) is configured for the rubberduck agent. It sends structured prompts
 * to the coding CLI and parses the LLM's responses.
 */
export class CliRubberduckDriver implements RubberduckDriver {
  readonly id = 'cli-rubberduck';

  constructor(
    private executor: Executor,
    private context: {
      cwd: string;
      runDir: string;
      model?: string;
      router?: string;
      instructions?: string;
    },
  ) {}

  async discover(
    task: string,
    context: { findings?: unknown },
  ): Promise<RubberduckQuestion[]> {
    const findingsText = context.findings
      ? `\nExternal findings:\n${JSON.stringify(context.findings, null, 2)}\n`
      : '';

    const prompt = `You are the Rubberduck discovery agent. Your job is to analyze the task and identify decisions that need to be made before implementation can begin.

Task: ${task}
${findingsText}
Produce a JSON array of questions. Each question must have:
- "id": string like "Q1", "Q2", etc.
- "text": the question text
- "type": one of "BLOCKING", "OPTIONAL", "INFERABLE"

Rules:
- BLOCKING questions are critical decisions the user must make
- OPTIONAL questions improve quality but aren't required
- INFERABLE questions can be answered from context (project conventions, etc.)
- Return 1-3 BLOCKING, 0-2 OPTIONAL, 0-2 INFERABLE
- Output ONLY the JSON array, nothing else

Example output:
[{"id":"Q1","text":"Should the API remain backward compatible?","type":"BLOCKING"},{"id":"Q2","text":"Use the existing database schema?","type":"INFERABLE"}]`;

    const result = await this.runCli('rubberduck', prompt);
    return this.parseQuestions(result.stdout);
  }

  async decide(
    question: RubberduckQuestion,
    _task: string,
  ): Promise<{ answer: string; selectedBy: string }> {
    const prompt = `You are the Rubberduck agent. The user has delegated a decision to you.

Question: ${question.text}
Type: ${question.type}

Provide a reasonable default answer. Be specific and practical.
Output ONLY your answer text, nothing else.`;

    const result = await this.runCli('rubberduck', prompt);
    const answer = result.stdout.trim();
    if (!answer) {
      throw new Error(`rubberduck driver returned empty answer for "${question.id}"`);
    }
    return { answer, selectedBy: 'cli-rubberduck' };
  }

  async generateRequirements(
    task: string,
    questions: RubberduckQuestion[],
  ): Promise<Requirements> {
    const questionsText = questions
      .map((q) => {
        const answer = q.answer ? `Answer: ${q.answer}` : 'No answer';
        return `- [${q.id}] (${q.type}) ${q.text}\n  ${answer}`;
      })
      .join('\n');

    const prompt = `You are the Rubberduck agent. Generate structured requirements from the resolved questions.

Task: ${task}

Resolved questions:
${questionsText}

Output a JSON object with this exact structure:
{
  "version": 1,
  "task": "${task.replace(/"/g, '\\"')}",
  "decisions": [
    {"id": "Q1", "question": "...", "answer": "...", "answer_source": "delegated|user", "selected_by": "rubberduck", "approved_by_user": true}
  ],
  "assumptions": [],
  "constraints": [],
  "acceptance_intent": [],
  "unresolved": []
}

Output ONLY the JSON object, nothing else.`;

    const result = await this.runCli('rubberduck', prompt);
    const parsed = this.parseJson(result.stdout);
    return RequirementsSchema.parse(parsed);
  }

  // ── Internal helpers ────────────────────────────────

  private async runCli(
    agent: string,
    prompt: string,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const ctx: ExecutorContext = {
      cwd: this.context.cwd,
      runDir: this.context.runDir,
      task: prompt,
      agent,
      model: this.context.model,
      router: this.context.router,
      instructions: this.context.instructions,
    };
    return this.executor.runAgent(ctx);
  }

  private parseQuestions(stdout: string): RubberduckQuestion[] {
    const json = this.parseJson(stdout);
    if (!Array.isArray(json)) {
      throw new Error('rubberduck driver returned non-array for questions');
    }
    return json.map((q: Record<string, unknown>, i: number) => ({
      id: typeof q.id === 'string' ? q.id : `Q${i + 1}`,
      text: typeof q.text === 'string' ? q.text : `Question ${i + 1}`,
      type: (['BLOCKING', 'OPTIONAL', 'INFERABLE'].includes(q.type as string)
        ? q.type
        : 'BLOCKING') as 'BLOCKING' | 'OPTIONAL' | 'INFERABLE',
    }));
  }

  private parseJson(stdout: string): unknown {
    // Find the first JSON token — prefer array `[` over object `{` since
    // discover() returns a JSON array of questions.
    const arrStart = stdout.indexOf('[');
    const objStart = stdout.indexOf('{');
    let start = -1;
    if (arrStart !== -1 && (objStart === -1 || arrStart < objStart)) {
      start = arrStart;
    } else if (objStart !== -1) {
      start = objStart;
    }
    if (start === -1) {
      throw new Error(`rubberduck driver returned no JSON: ${stdout.slice(0, 200)}`);
    }
    return this.extractJson(stdout, start);
  }

  private extractJson(text: string, start: number): unknown {
    const openChar = text[start];
    const closeChar = openChar === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (c === '\\' && inString) {
        escape = true;
        continue;
      }
      if (c === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (c === openChar) depth++;
      else if (c === closeChar) {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(text.slice(start, i + 1));
          } catch {
            throw new Error(`rubberduck driver returned invalid JSON: ${text.slice(start, i + 1).slice(0, 200)}`);
          }
        }
      }
    }
    throw new Error(`rubberduck driver returned incomplete JSON from position ${start}`);
  }
}
