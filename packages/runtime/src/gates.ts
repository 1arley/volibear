import {
  GateResult,
  Requirements,
  Review,
  Verification,
} from '@volibear/contracts';

/**
 * A deterministic gate. All gates must be code-driven, never model-driven.
 */
export interface Gate {
  readonly id: string;
  readonly description: string;
  evaluate(params: GateParams): GateResult;
}

export interface GateParams {
  requirements?: Requirements | null;
  review?: Review | null;
  verification?: Verification | null;
  repairCycle?: number;
  maxRepairCycles?: number;
  rejectOn?: string[];
  requiredArtifacts?: string[];
  /** True when requirements.lock exists for this run. */
  requirementsLocked?: boolean;
  extra?: Record<string, unknown>;
}

/**
 * Gate: all blocking Rubberduck questions are answered.
 */
export class BlockingQuestionsResolvedGate implements Gate {
  readonly id = 'blocking-questions-resolved';
  readonly description = 'All blocking questions must be answered';

  evaluate(params: GateParams): GateResult {
    const req = params.requirements;
    if (!req) {
      return { passed: false, gate: this.id, reason: 'requirements artifact missing' };
    }
    const blocking = req.unresolved.filter((u) => u.type === 'BLOCKING');
    if (blocking.length > 0) {
      return {
        passed: false,
        gate: this.id,
        reason: `${blocking.length} blocking question(s) remain unanswered`,
        details: { unresolved: blocking.map((b) => b.id) },
      };
    }
    return { passed: true, gate: this.id, reason: 'all blocking questions answered' };
  }
}

/**
 * Gate: requirements are locked (requirements.lock exists).
 */
export class RequirementsLockedGate implements Gate {
  readonly id = 'requirements-locked';
  readonly description = 'Requirements must be locked';

  evaluate(params: GateParams): GateResult {
    if (!params.requirements) {
      return { passed: false, gate: this.id, reason: 'requirements artifact missing' };
    }
    if (params.requirementsLocked === false) {
      return { passed: false, gate: this.id, reason: 'requirements are not locked' };
    }
    return { passed: true, gate: this.id, reason: 'requirements present and locked' };
  }
}

/**
 * Gate: no review findings above the configured threshold.
 */
export class NoFindingsAboveThresholdGate implements Gate {
  readonly id = 'no-findings-above-threshold';
  readonly description = 'Review must have no findings above the threshold';

  /** Lower rank = less severe. Unknown severities rank as critical (fail closed). */
  private rank(severity: string): number {
    const normalized = severity.toLowerCase().trim();
    const ranks: Record<string, number> = {
      info: 0,
      low: 1,
      medium: 2,
      high: 3,
      critical: 4,
    };
    return ranks[normalized] ?? 4;
  }

  evaluate(params: GateParams): GateResult {
    const review = params.review;
    if (!review) {
      return { passed: false, gate: this.id, reason: 'review artifact missing' };
    }
    const rejectOn = params.rejectOn ?? ['critical', 'high'];
    // The threshold is the least severe configured rejection level; any
    // finding at or above it rejects. Unknown severities rank as critical.
    const threshold = Math.min(...rejectOn.map((s) => this.rank(s)));
    const rejected = review.findings.filter((f) => this.rank(f.severity) >= threshold);
    if (rejected.length > 0) {
      return {
        passed: false,
        gate: this.id,
        reason: `${rejected.length} finding(s) above threshold`,
        details: { rejected: rejected.map((f) => ({ id: f.id, severity: f.severity, title: f.title })) },
      };
    }
    return { passed: true, gate: this.id, reason: 'no findings above threshold' };
  }
}

/**
 * Gate: repair cycles are within the configured limit.
 */
export class RepairCyclesWithinLimitGate implements Gate {
  readonly id = 'repair-cycles-within-limit';
  readonly description = 'Repair cycles must be within the configured limit';

  evaluate(params: GateParams): GateResult {
    const cycle = params.repairCycle ?? 0;
    const max = params.maxRepairCycles ?? 3;
    if (cycle > max) {
      return {
        passed: false,
        gate: this.id,
        reason: `${cycle} repair cycles exceed limit of ${max}`,
      };
    }
    return { passed: true, gate: this.id, reason: `repair cycle ${cycle} within limit ${max}` };
  }
}

/**
 * Gate: required artifacts exist.
 */
export class ArtifactsExistGate implements Gate {
  readonly id = 'artifacts-exist';
  readonly description = 'Required artifacts must exist';

  evaluate(params: GateParams): GateResult {
    const required = params.requiredArtifacts ?? [];
    const missing = required.filter(
      (name) => !(params.extra?.[name] === true),
    );
    if (missing.length > 0) {
      return {
        passed: false,
        gate: this.id,
        reason: `missing artifacts: ${missing.join(', ')}`,
      };
    }
    return { passed: true, gate: this.id, reason: 'all required artifacts exist' };
  }
}

/**
 * Gate registry — maps gate IDs to gate instances.
 */
export class GateRegistry {
  private gates = new Map<string, Gate>();

  constructor() {
    this.register(new BlockingQuestionsResolvedGate());
    this.register(new RequirementsLockedGate());
    this.register(new NoFindingsAboveThresholdGate());
    this.register(new RepairCyclesWithinLimitGate());
    this.register(new ArtifactsExistGate());
  }

  register(gate: Gate): void {
    this.gates.set(gate.id, gate);
  }

  get(id: string): Gate | undefined {
    return this.gates.get(id);
  }

  has(id: string): boolean {
    return this.gates.has(id);
  }
}