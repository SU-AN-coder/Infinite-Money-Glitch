import { createHash } from 'node:crypto';
import type { EarnMode, EarnModeContext, EarnModeRunResult } from './EarnMode.js';

export interface AuditFinding {
  tool: string;
  severity: 'info' | 'low' | 'moderate' | 'high' | 'critical';
  message: string;
  file?: string;
  line?: number;
}

export interface CodeAuditReport {
  generatedAt: string;
  agentAddress: string;
  tools: string[];
  findings: AuditFinding[];
  rawOutputs: Record<string, string>;
  summary: {
    totalFindings: number;
    bySeverity: Record<string, number>;
  };
  checksum: string;
}

/**
 * CodeAuditMode — runs real static-analysis / security-audit tools
 * (eslint, npm audit, tsc --noEmit) and produces a structured JSON report.
 *
 * This replaces the old fake `console.log()` stub with genuinely useful output
 * that can be uploaded to Walrus and verified on-chain.
 */
export class CodeAuditMode implements EarnMode {
  id = 'code-audit';
  name = 'Code Audit';
  status = 'live' as const;
  summary = 'Run eslint + npm audit + tsc on the workspace, produce a structured findings report.';

  isEnabled(env: NodeJS.ProcessEnv): boolean {
    // Enabled by default — can be disabled with EARN_MODE_CODE_AUDIT=false
    return env.EARN_MODE_CODE_AUDIT !== 'false';
  }

  async run(ctx: EarnModeContext): Promise<EarnModeRunResult> {
    try {
      const rawOutputs: Record<string, string> = {};
      const findings: AuditFinding[] = [];
      const tools: string[] = [];

      // 1. ESLint
      try {
        tools.push('eslint');
        const eslint = ctx.exec('npx eslint --format json . 2>&1 || true', 60);
        rawOutputs['eslint'] = eslint.output.slice(0, 50_000);
        findings.push(...this.parseEslintOutput(eslint.output));
      } catch (e) {
        rawOutputs['eslint'] = `error: ${e instanceof Error ? e.message : String(e)}`;
      }

      // 2. npm audit
      try {
        tools.push('npm-audit');
        const audit = ctx.exec('npm audit --json 2>&1 || true', 60);
        rawOutputs['npm-audit'] = audit.output.slice(0, 50_000);
        findings.push(...this.parseNpmAuditOutput(audit.output));
      } catch (e) {
        rawOutputs['npm-audit'] = `error: ${e instanceof Error ? e.message : String(e)}`;
      }

      // 3. TypeScript type-check
      try {
        tools.push('tsc');
        const tsc = ctx.exec('npx tsc --noEmit 2>&1 || true', 90);
        rawOutputs['tsc'] = tsc.output.slice(0, 50_000);
        findings.push(...this.parseTscOutput(tsc.output));
      } catch (e) {
        rawOutputs['tsc'] = `error: ${e instanceof Error ? e.message : String(e)}`;
      }

      // Compile report
      const bySeverity: Record<string, number> = {};
      for (const f of findings) {
        bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;
      }

      const reportBody = {
        generatedAt: ctx.now.toISOString(),
        agentAddress: ctx.agentAddress,
        tools,
        findings,
        rawOutputs,
        summary: {
          totalFindings: findings.length,
          bySeverity,
        },
      };

      const checksum = createHash('sha256')
        .update(JSON.stringify(reportBody))
        .digest('hex');

      const report: CodeAuditReport = { ...reportBody, checksum };

      return {
        modeId: this.id,
        modeName: this.name,
        status: this.status,
        attempted: true,
        success: true,
        earnedMist: 0n,
        details: {
          findings: findings.length,
          bySeverity,
          reportChecksum: checksum,
          report,
        },
      };
    } catch (error) {
      return {
        modeId: this.id,
        modeName: this.name,
        status: this.status,
        attempted: true,
        success: false,
        earnedMist: 0n,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ── Parsers ──────────────────────────────────────────────

  private parseEslintOutput(raw: string): AuditFinding[] {
    const findings: AuditFinding[] = [];
    try {
      // ESLint --format json emits an array of file results
      const jsonStart = raw.indexOf('[');
      if (jsonStart === -1) return findings;
      const data = JSON.parse(raw.slice(jsonStart)) as {
        filePath?: string;
        messages?: { severity?: number; message?: string; line?: number; ruleId?: string }[];
      }[];
      for (const file of data) {
        for (const msg of file.messages || []) {
          findings.push({
            tool: 'eslint',
            severity: msg.severity === 2 ? 'high' : 'low',
            message: `${msg.ruleId || 'unknown'}: ${msg.message || ''}`,
            file: file.filePath,
            line: msg.line,
          });
        }
      }
    } catch {
      // non-JSON output — treat entire output as single info finding
      if (raw.trim().length > 0) {
        findings.push({ tool: 'eslint', severity: 'info', message: raw.slice(0, 500) });
      }
    }
    return findings;
  }

  private parseNpmAuditOutput(raw: string): AuditFinding[] {
    const findings: AuditFinding[] = [];
    try {
      const jsonStart = raw.indexOf('{');
      if (jsonStart === -1) return findings;
      const data = JSON.parse(raw.slice(jsonStart)) as {
        vulnerabilities?: Record<string, {
          severity?: string;
          name?: string;
          via?: unknown[];
        }>;
      };
      for (const [name, vuln] of Object.entries(data.vulnerabilities || {})) {
        const sev = (vuln.severity || 'info') as AuditFinding['severity'];
        findings.push({
          tool: 'npm-audit',
          severity: ['critical', 'high', 'moderate', 'low', 'info'].includes(sev) ? sev : 'info',
          message: `Vulnerable package: ${name} (${vuln.severity || 'unknown'})`,
        });
      }
    } catch {
      if (raw.trim().length > 0) {
        findings.push({ tool: 'npm-audit', severity: 'info', message: raw.slice(0, 500) });
      }
    }
    return findings;
  }

  private parseTscOutput(raw: string): AuditFinding[] {
    const findings: AuditFinding[] = [];
    // tsc errors look like: src/foo.ts(12,5): error TS2345: ...
    const pattern = /^(.+?)\((\d+),\d+\):\s*error\s+(TS\d+):\s*(.+)$/gm;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(raw)) !== null) {
      findings.push({
        tool: 'tsc',
        severity: 'high',
        message: `${match[3]}: ${match[4]}`,
        file: match[1],
        line: Number(match[2]),
      });
    }
    // If no structured matches but output exists, add info-level
    if (findings.length === 0 && raw.trim().length > 0 && !raw.includes('error TS')) {
      findings.push({ tool: 'tsc', severity: 'info', message: raw.slice(0, 500) });
    }
    return findings;
  }
}
