import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma, seed } from '@lp-ai/lib-db';

import { McpStdioClient } from './mcp-client.js';

const isLocalDb = (process.env['DATABASE_URL'] ?? '').includes('localhost');
const describeLocal = isLocalDb ? describe : describe.skip;

describeLocal('MCP tool handlers (integration)', () => {
  let client: McpStdioClient;

  beforeAll(async () => {
    await seed({ force: true });
    client = new McpStdioClient();
  });

  afterAll(async () => {
    client.close();
    await prisma.$disconnect();
  });

  it('tools/list exposes all 22 tools', async () => {
    const tools = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'get_entity_brief',
        'get_finance_brief',
        'get_student_info',
        'grant_build_draft',
        'grant_match_question',
        'query_attendance',
        'query_certifications',
        'query_competency',
        'query_donors',
        'query_employment',
        'query_enrollment',
        'query_finances',
        'query_outcomes',
        'query_postsecondary',
        'query_students',
        'search_by_person',
        'search_conversations',
        'search_documents',
        'skill_board_reporting',
        'skill_finance_audit',
        'skill_grant_prospecting',
        'skill_grant_writing',
      ].sort(),
    );
  });

  it('get_student_info resolves a Slack handle to canonical record', async () => {
    const result = (await client.callTool('get_student_info', {
      student_name: '@maria.g',
    })) as {
      student: {
        canonical_name: string;
        student_number: string;
        current_phase: string;
        known_aliases: Array<{ source: string; alias: string }>;
      };
      entity_resolved: boolean;
      entity_confidence: number;
      match_type: string;
    };
    expect(result.entity_resolved).toBe(true);
    expect(result.match_type).toBe('exact');
    expect(result.entity_confidence).toBe(1);
    expect(result.student.canonical_name).toBe('Maria Garcia');
    expect(result.student.student_number).toBe('LP1042');
    expect(result.student.current_phase).toBe('101');
    const sources = result.student.known_aliases.map((a) => a.source).sort();
    expect(sources).toEqual(['bigquery', 'drive', 'drive', 'slack']);
  });

  it('get_student_info returns entity_not_found for unknown name', async () => {
    const result = (await client.callTool('get_student_info', {
      student_name: 'Nonexistent Person',
    })) as { error?: { code: string } };
    expect(result.error?.code).toBe('entity_not_found');
  });

  it('query_certifications summary returns valid shape', async () => {
    const result = (await client.callTool('query_certifications', {
      query_type: 'summary',
    })) as {
      query_type: string;
      total: number;
      passed: number;
      failed: number;
      pass_rate_pct: number | null;
    };
    expect(result.query_type).toBe('summary');
    expect(typeof result.total).toBe('number');
    expect(typeof result.passed).toBe('number');
    expect(typeof result.failed).toBe('number');
  });

  it('query_certifications by_result returns valid shape', async () => {
    const result = (await client.callTool('query_certifications', {
      query_type: 'by_result',
    })) as { breakdown: Array<{ result: string; count: number }> };
    expect(Array.isArray(result.breakdown)).toBe(true);
  });

  it('query_competency scores returns valid shape', async () => {
    const result = (await client.callTool('query_competency', {
      query_type: 'scores',
    })) as {
      record_count: number;
      records: Array<{ student_number: string; competency: string }>;
    };
    expect(typeof result.record_count).toBe('number');
    expect(Array.isArray(result.records)).toBe(true);
  });

  it('query_attendance aggregate returns valid shape', async () => {
    const result = (await client.callTool('query_attendance', {
      query_type: 'aggregate',
    })) as {
      overall: { student_count: number; attendance_rate_pct: number | null };
      breakdown: Array<{ group: string; student_count: number }>;
    };
    expect(typeof result.overall.student_count).toBe('number');
    expect(Array.isArray(result.breakdown)).toBe(true);
  });

  it('query_students list returns seeded students', async () => {
    const result = (await client.callTool('query_students', {
      query_type: 'list',
    })) as {
      student_count: number;
      students: Array<{ canonical_name: string }>;
    };
    expect(result.student_count).toBe(3);
    const names = result.students.map((s) => s.canonical_name).sort();
    expect(names).toEqual(['Janelle Brooks', 'Maria Garcia', 'Tai Pham']);
  });

  it('query_donors summary reflects seeded donors', async () => {
    const result = (await client.callTool('query_donors', {
      query_type: 'summary',
    })) as { total_donors: number; lifetime_giving: { total: number } };
    expect(result.total_donors).toBe(2);
    expect(result.lifetime_giving.total).toBeGreaterThan(0);
  });

  it('get_entity_brief surfaces student profile', async () => {
    const result = (await client.callTool('get_entity_brief', {
      person_name: 'Maria Garcia',
    })) as {
      entity: { canonical_name: string; entity_type: string };
      profile: { current_phase: string };
      certifications: Array<{ type: string | null; result: string | null }>;
      phase_progression: Array<{ phase: string; status: string | null }>;
      sources_active: string[];
    };
    expect(result.entity.entity_type).toBe('student');
    expect(result.entity.canonical_name).toBe('Maria Garcia');
    expect(result.profile.current_phase).toBe('101');
    expect(Array.isArray(result.certifications)).toBe(true);
    expect(Array.isArray(result.phase_progression)).toBe(true);
    expect(result.sources_active).toContain('google_sheets');
  });

  // The G3 gate condition: a full form fixture returns a draft package and a figure work order,
  // through the real server rather than through the library. `aug7_truist` is the richest fixture —
  // 17 questions, every one with a stated limit.
  it('grant_build_draft returns a draft package and a figure work order for a full form', async () => {
    const result = (await client.callTool('grant_build_draft', {
      form_id: 'aug7_truist',
    })) as {
      form: { funder: string };
      summary: {
        total: number;
        by_status: Record<string, number>;
        by_actor: { none: number; llm: number; staff: number };
      };
      results: Array<{
        incoming: string;
        status: string;
        actor: string;
        action: string;
        handback?: { task: string; source_text: string; rules: string[]; verify_with: string };
      }>;
      kb_refs_used: string[];
      figure_work_order: {
        policy: string;
        items: Array<{ key: string; tool: string; args: Record<string, string> }>;
        definitional_conflicts: string[];
      };
      your_tasks: Array<{ status: string; count: number; questions: number[]; next_step: string }>;
      staff_actions: Array<{ status: string; count: number; questions: number[]; next_step: string }>;
      markdown: string;
    };

    expect(result.form.funder).toContain('Truist');
    expect(result.summary.total).toBe(17);
    expect(result.results).toHaveLength(17);
    for (const r of result.results) expect(r.action.length).toBeGreaterThan(0);

    // The work order is the deliverable that keeps figures honest: it must name calls to make.
    expect(result.figure_work_order.items.length).toBeGreaterThan(0);
    expect(result.kb_refs_used.length).toBeGreaterThan(0);
    for (const item of result.figure_work_order.items) {
      expect(item.tool).toMatch(/^(query_|get_|search_)/);
    }
    // This form draws on kb.metrics, whose "145 served" is a definitional conflict, not drift.
    expect(result.figure_work_order.definitional_conflicts.length).toBeGreaterThan(0);

    // Outstanding work is split by who does it, and the model's share arrives ready to do: the
    // handback carries the source text and the guardrail, so no second tool call is needed to start.
    expect(result.your_tasks.length).toBeGreaterThan(0);
    expect(result.staff_actions.length).toBeGreaterThan(0);
    expect(result.summary.by_actor.llm).toBeGreaterThan(0);
    expect(result.summary.by_actor.staff).toBeGreaterThan(0);
    expect(
      result.summary.by_actor.none + result.summary.by_actor.llm + result.summary.by_actor.staff,
    ).toBe(17);

    for (const r of result.results) {
      if (r.actor !== 'llm') continue;
      expect(r.handback?.source_text.length).toBeGreaterThan(0);
      expect(r.handback?.rules.join(' ')).toMatch(/NEVER invent|ONLY from the source material/);
      // Never point the caller at a tool that is not registered yet.
      expect(r.handback?.verify_with).not.toContain('grant_resize_answer');
    }

    expect(result.markdown).toContain('not submittable as-is');
  });

  it('grant_build_draft rejects an unknown form fixture', async () => {
    const result = (await client.callTool('grant_build_draft', {
      form_id: 'no_such_form',
    })) as { error?: { code: string } };
    expect(result.error?.code).toBe('entity_not_found');
  });

  it('grant_build_draft requires a funder alongside inline questions', async () => {
    const result = (await client.callTool('grant_build_draft', {
      questions: [{ text: 'What is your mission?' }],
    })) as { error?: { code: string } };
    expect(result.error?.code).toBe('no_records');
  });
});
