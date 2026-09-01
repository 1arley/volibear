import {
  Executor,
  ExecutorContext,
  ExecutorResult,
  Requirements,
  RubberduckDriver,
  RubberduckQuestion,
  RequirementsSchema,
} from '@volibear/contracts';

/** Valid values for the optional `type` field on unresolved entries. */
const UNRESOLVED_TYPES = ['BLOCKING', 'OPTIONAL', 'INFERABLE'] as const;

/** Field order for extracting text from malformed string-array entries. */
const STRING_FIELDS = ['text', 'description', 'summary', 'message'];

/** Field order for extracting the question text from malformed entries. */
const QUESTION_FIELDS = ['question', 'text', 'description', 'summary', 'message'];

/** Take the first value that is a string, walking the given field order. */
function firstStringField(entry: Record<string, unknown>, fields: string[]): string | undefined {
  for (const field of fields) {
    const value = entry[field];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

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
      execution?: {
        prepare(operation: string, prompt: string): Partial<ExecutorContext>;
        complete(operation: string, result: ExecutorResult): void;
      };
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

    const result = await this.runCli('rubberduck', 'discover', prompt);
    return this.parseQuestions(this.selectOutput(result));
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

    const result = await this.runCli('rubberduck', `decide-${question.id}`, prompt);
    const answer = this.selectOutput(result).trim();
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
  "assumptions": ["plain string", "another plain string"],
  "constraints": ["plain string"],
  "acceptance_intent": ["plain string"],
  "unresolved": [{"id":"U1","question":"...","type":"OPTIONAL"}]
}

Rules:
- assumptions, constraints, and acceptance_intent must be arrays of plain strings — never objects.
- Each unresolved entry must use this exact shape: {"id":"U1","question":"...","type":"OPTIONAL"}
- "type" on an unresolved entry must be one of "BLOCKING", "OPTIONAL", "INFERABLE".

Output ONLY the JSON object, nothing else.`;

    const result = await this.runCli('rubberduck', 'requirements', prompt);
    const parsed = this.parseJson(this.selectOutput(result));
    return RequirementsSchema.parse(this.normalizeRequirements(parsed, task, questions));
  }

  // ── Internal helpers ────────────────────────────────

  /**
   * Prefer the executor's structured output (e.g. opencode's parsed NDJSON
   * text) over the raw stdout, which may contain TUI noise. Falls back to
   * raw stdout when no structured output was reported.
   */
  private selectOutput(result: ExecutorResult): string {
    const structured = result.structured?.output;
    return typeof structured === 'string' && structured.trim().length > 0
      ? structured
      : result.stdout;
  }

  /**
   * Defensive normalization before strict schema validation. The schema
   * stays strict; this only coerces LLM-shaped values into the shape the
   * schema expects so mildly malformed responses still round-trip.
   */
  private normalizeRequirements(parsed: unknown, task: string, questions: RubberduckQuestion[]): unknown {
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return parsed;
    }
    const obj = parsed as Record<string, unknown>;

    return {
      ...obj,
      // LLM-omitted or non-integer/non-positive versions default to 1.
      version:
        typeof obj.version === 'number' && Number.isInteger(obj.version) && obj.version > 0
          ? obj.version
          : 1,
      // The driver always knows the true task — never trust the LLM copy.
      task,
      decisions: questions
        .filter((question) => typeof question.answer === 'string')
        .map((question) => ({
          id: question.id,
          question: question.text,
          answer: question.answer!,
          answer_source: question.answer_source ?? 'delegated',
          selected_by: question.selected_by,
          approved_by_user: question.approved_by_user ?? true,
        })),
      assumptions: this.coerceStringArray(obj.assumptions),
      constraints: this.coerceStringArray(obj.constraints),
      acceptance_intent: this.coerceStringArray(obj.acceptance_intent),
      unresolved: this.coerceUnresolved(obj.unresolved),
    };
  }

  /** LLM variance tolerance; schema remains source of truth for field shape. */
  private coerceStringArray(value: unknown): string[] {
    if (typeof value === 'string') value = [value];
    if (!Array.isArray(value)) return [];
    const out: string[] = [];
    for (const entry of value) {
      if (typeof entry === 'string') {
        out.push(entry);
        continue;
      }
      if (entry !== null && typeof entry === 'object') {
        const extracted = firstStringField(entry as Record<string, unknown>, STRING_FIELDS);
        out.push(extracted ?? JSON.stringify(entry));
        continue;
      }
      if (typeof entry === 'number' || typeof entry === 'boolean') {
        out.push(String(entry));
      }
      // null/undefined entries are dropped.
    }
    return out;
  }

  /** Keep only decisions with string id/question/answer; fill answer_source. */
  private coerceDecisions(value: unknown): unknown[] {
    if (!Array.isArray(value)) return [];
    const out: unknown[] = [];
    for (const entry of value) {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const rec = entry as Record<string, unknown>;
      if (
        typeof rec.id !== 'string' ||
        typeof rec.question !== 'string' ||
        typeof rec.answer !== 'string'
      ) {
        continue;
      }
      out.push({
        ...rec,
        answer_source: rec.answer_source === 'user' ? 'user' : 'delegated',
      });
    }
    return out;
  }

  /**
   * Coerce unresolved entries into {id, question, type?} objects.
   * Strings become entries with a generated U-id; malformed objects fall
   * back to field extraction, then JSON.stringify; nulls are dropped.
   */
  private coerceUnresolved(value: unknown): unknown[] {
    if (!Array.isArray(value)) return [];
    const out: unknown[] = [];
    const usedIds = new Set<string>();
    const nextFallbackId = (): string => {
      let index = 1;
      while (usedIds.has(`U${index}`)) index++;
      const id = `U${index}`;
      usedIds.add(id);
      return id;
    };
    value.forEach((entry) => {
      if (typeof entry === 'string') {
        out.push({ id: nextFallbackId(), question: entry });
        return;
      }
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return;
      const rec = entry as Record<string, unknown>;
      const question =
        typeof rec.question === 'string' && rec.question.length > 0
          ? rec.question
          : firstStringField(rec, QUESTION_FIELDS) ?? JSON.stringify(rec);
      const id = typeof rec.id === 'string' && rec.id.length > 0 ? rec.id : nextFallbackId();
      usedIds.add(id);
      const item: Record<string, unknown> = {
        id,
        question,
      };
      if (typeof rec.type === 'string' && (UNRESOLVED_TYPES as readonly string[]).includes(rec.type)) {
        item.type = rec.type;
      }
      out.push(item);
    });
    return out;
  }

  private async runCli(
    agent: string,
    operation: string,
    prompt: string,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const execution = this.context.execution?.prepare(operation, prompt) ?? {};
    const ctx: ExecutorContext = {
      cwd: this.context.cwd,
      runDir: this.context.runDir,
      task: prompt,
      agent,
      model: this.context.model,
      router: this.context.router,
      instructions: this.context.instructions,
      ...execution,
    };
    const result = await this.executor.runAgent(ctx);
    this.context.execution?.complete(operation, result);
    if (result.exitCode !== 0) {
      throw new Error(result.failure?.message ?? (result.stderr || `rubberduck executor exited with ${result.exitCode}`));
    }
    return result;
  }

  private parseQuestions(stdout: string): RubberduckQuestion[] {
    let json: unknown;
    try {
      json = this.parseJson(stdout);
    } catch (error) {
      const recovered = this.parseRenderedQuestions(stdout);
      if (recovered.length > 0) return recovered;
      throw error;
    }
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

  /** Recover OpenCode-rendered question lists when a model wraps the requested JSON. */
  private parseRenderedQuestions(output: string): RubberduckQuestion[] {
    const questions: RubberduckQuestion[] = [];
    const defaultType = /\bOPTIONAL\b/i.test(output) && !/\bBLOCKING\b/i.test(output)
      ? 'OPTIONAL'
      : /\bINFERABLE\b/i.test(output) && !/\bBLOCKING\b/i.test(output)
        ? 'INFERABLE'
        : 'BLOCKING';
    const pattern = /(?:\*\*)?(Q\d+)(?:\*\*)?\s*(?:—|–|-|:)+\s*([^\n]+)/gi;
    for (const match of output.matchAll(pattern)) {
      const text = match[2].trim().replace(/\*\*$/g, '').trim();
      if (text) questions.push({ id: match[1].toUpperCase(), text, type: defaultType });
    }
    return questions;
  }

  private parseJson(stdout: string): unknown {
    // Strip ANSI escape codes and markdown fences before parsing.
    const cleaned = stdout
      .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')   // ANSI codes
      .replace(/```[\s\S]*?\n/g, '')             // markdown fences
      .replace(/^>.*$/gm, '');                   // opencode header lines
    // Find the first JSON token — prefer array `[` over object `{` since
    // discover() returns a JSON array of questions.
    const arrStart = cleaned.indexOf('[');
    const objStart = cleaned.indexOf('{');
    let start = -1;
    if (arrStart !== -1 && (objStart === -1 || arrStart < objStart)) {
      start = arrStart;
    } else if (objStart !== -1) {
      start = objStart;
    }
    if (start === -1) {
      throw new Error(`rubberduck driver returned no JSON: ${stdout.slice(0, 200)}`);
    }
    return this.extractJson(cleaned, start);
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
