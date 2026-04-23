import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSkillProposalMarkdown,
  extractSkillProposalPayload,
} from "./write-skill-proposal.mjs";

test("buildSkillProposalMarkdown renders a reader-facing proposal without transcript residue", () => {
  const markdown = buildSkillProposalMarkdown({
    title: "Add an issue-ledger recap skill",
    issueUrl: "https://github.com/nilstate/aster/issues/42",
    jsonPath: "/tmp/issue-ledger-recap.json",
    payload: {
      skill_spec: {
        skill_name: "issue-ledger-recap",
        summary: "Summarize approval issue threads into a reusable packet.",
        objective: "Distill a bounded collaboration subject into a rebuildable approval packet.",
        kind: "composite_skill",
        status: "proposed",
        governance: {
          mutating: false,
          public_write_allowed: false,
        },
        invariants: [
          "Preserve receipts.",
        ],
        inputs: [
          {
            name: "subject_locator",
            type: "string",
            required: true,
            description: "Portable locator.",
          },
        ],
        outputs: [
          {
            name: "followup_packet",
            type: "object",
            description: "One bounded next-action packet.",
          },
        ],
      },
      pain_points: [
        "Maintainers lose the thread of review decisions when work moves between comments and draft PRs.",
      ],
      catalog_fit: {
        adjacent_skills: ["issue-triage", "skill-lab"],
        why_new: "Neither adjacent skill emits one bounded review packet from the living work ledger.",
      },
      maintainer_decisions: [
        {
          question: "Should the first version stop at a review packet?",
          options: ["yes", "no, also scaffold the skill"],
          why: "Keeps the first cut small and inspectable.",
        },
      ],
      execution_plan: {
        runner: "chain",
      },
      findings: [
        {
          claim: "The issue thread is the living ledger.",
          source: "issue body",
        },
      ],
      recommended_flow: [
        {
          step: "Read the living ledger.",
          basis: "Keeps the issue canonical.",
        },
      ],
      sources: [
        {
          title: "Issue #42",
          locator: "https://github.com/nilstate/aster/issues/42",
          notes: "Primary request",
        },
      ],
      risks: [
        {
          risk: "Provider lock-in",
          mitigation: "Keep portable nouns in the core contract.",
        },
      ],
      harness_fixture: [
        {
          name: "success",
        },
      ],
      acceptance_checks: [
        {
          id: "ac-fixture-passes",
          assertion: "fixture passes",
        },
      ],
    },
    issuePacket: {
      source_issue: {
        repo: "nilstate/aster",
        number: 42,
        ledger_revision: "deadbeefcafebabe",
      },
      sections: {
        objective: "Add an issue-ledger recap skill that turns issue discussion into a bounded approval summary.",
        why_it_matters: "Issue review should train the operator.",
        constraints: "- proposal only",
        evidence: "- state/thread-teaching.json",
        additional_notes: "Prefer bounded review surfaces.",
      },
      amendments: [
        {
          author: "kam",
          recorded_at: "2026-04-21T12:24:06Z",
          body: "Hard-cut the contract to subject_locator, subject_memory, and publication_target.",
          url: "https://github.com/nilstate/aster/issues/42#issuecomment-1",
        },
        {
          author: "kam",
          recorded_at: "2026-04-21T12:30:59Z",
          url: "https://github.com/nilstate/aster/issues/42#issuecomment-2",
          thread_teaching_record: {
            kind: "publish_authorization",
            summary: "Refresh the single rolling draft PR from the same work ledger.",
            applies_to: ["skill-lab.publish"],
            decisions: [
              {
                gate_id: "skill-lab.publish",
                decision: "allow",
                reason: "refresh the existing rolling draft PR",
              },
            ],
          },
        },
      ],
    },
  });

  assert.match(markdown, /^title: "issue-ledger-recap"$/m);
  assert.doesNotMatch(markdown, /## Work Ledger/);
  assert.doesNotMatch(markdown, /## Maintainer Amendments/);
  assert.doesNotMatch(markdown, /## Original Request/);
  assert.doesNotMatch(markdown, /## Raw Packet/);
  assert.doesNotMatch(markdown, /Later maintainer amendments on the living ledger take precedence/);
  assert.doesNotMatch(markdown, /Hard-cut the contract to subject_locator/);
  assert.doesNotMatch(markdown, /Refresh the single rolling draft PR from the same work ledger/);
  assert.match(markdown, /## Thesis/);
  assert.match(markdown, /## Job To Be Done/);
  assert.match(markdown, /## Why This Matters/);
  assert.match(markdown, /Issue review should train the operator\./);
  assert.match(markdown, /## Contract/);
  assert.match(markdown, /## Governance/);
  assert.match(markdown, /mutating: false/);
  assert.match(markdown, /## Findings/);
  assert.match(markdown, /The issue thread is the living ledger\./);
  assert.match(markdown, /## Pain Points/);
  assert.match(markdown, /Maintainers lose the thread of review decisions/);
  assert.match(markdown, /## Catalog Fit/);
  assert.match(markdown, /issue-triage, skill-lab/);
  assert.match(markdown, /## Open Decisions/);
  assert.match(markdown, /Should the first version stop at a review packet\?/);
  assert.match(markdown, /## Implementation Shape/);
  assert.match(markdown, /Read the living ledger\./);
  assert.match(markdown, /## Boundaries/);
  assert.match(markdown, /proposal only/);
  assert.match(markdown, /Provider lock-in/);
  assert.match(markdown, /## Acceptance Checks/);
  assert.match(markdown, /`ac-fixture-passes`: fixture passes/);
  assert.match(markdown, /## Provenance/);
  assert.match(markdown, /Work issue: `nilstate\/aster#42`/);
  assert.match(markdown, /Ledger revision: `deadbeefcafebabe`/);
  assert.match(markdown, /Trusted maintainer amendments considered: 2/);
  assert.match(markdown, /Evidence note: - state\/thread-teaching\.json/);
  assert.match(markdown, /Machine-readable packet: \[issue-ledger-recap\.json\]/);
  assert.doesNotMatch(markdown, /\[object Object\]/);
  assert.match(markdown, /description: "Summarize approval issue threads into a reusable packet\."/);
});

test("extractSkillProposalPayload reads nested execution stdout payloads", () => {
  const payload = extractSkillProposalPayload({
    execution: {
      stdout: JSON.stringify({
        skill_spec: {
          name: "issue-ledger-followup",
        },
        execution_plan: {
          runner: "chain",
        },
      }),
    },
  });

  assert.equal(payload.skill_spec?.name, "issue-ledger-followup");
  assert.equal(payload.execution_plan?.runner, "chain");
});

test("buildSkillProposalMarkdown uses purpose when summary is absent", () => {
  const markdown = buildSkillProposalMarkdown({
    title: "Add decision brief",
    issueUrl: "https://github.com/nilstate/aster/issues/115",
    jsonPath: "/tmp/decision-brief.json",
    payload: {
      skill_spec: {
        name: "decision-brief",
        purpose: "Turn one living work ledger into one bounded maintainer decision packet.",
      },
      pain_points: ["Maintainers need one current decision packet."],
      catalog_fit: {
        adjacent_capabilities: [
          {
            name: "issue-triage",
            why: "Compared with issue-triage, this owns the decision handoff.",
          },
        ],
        why_new: "Compared with issue-triage, this owns the decision handoff.",
      },
      maintainer_decisions: [
        {
          question: "Add this skill?",
          options: [
            {
              option: "add_new_skill",
              effect: "Create the reusable handoff primitive.",
            },
          ],
        },
      ],
      acceptance_checks: ["Returns one packet.", "Stops at review.", "Preserves provenance."],
    },
    issuePacket: {
      source_issue: {
        repo: "nilstate/aster",
        number: 115,
      },
      sections: {
        constraints: "- Stop at review.\n- Do not publish.",
      },
      amendments: [],
    },
  });

  assert.match(markdown, /description: "Turn one living work ledger into one bounded maintainer decision packet\."/);
  assert.match(markdown, /- description: Turn one living work ledger into one bounded maintainer decision packet\./);
  assert.match(markdown, /## Job To Be Done\n\nTurn one living work ledger into one bounded maintainer decision packet\./);
  assert.match(markdown, /- adjacent_capabilities:\n  - issue-triage: Compared with issue-triage, this owns the decision handoff\./);
  assert.match(markdown, /options: add_new_skill: Create the reusable handoff primitive\./);
  assert.match(markdown, /- Stop at review\.\n- Do not publish\./);
  assert.doesNotMatch(markdown, /\[object Object\]/);
  assert.doesNotMatch(markdown, /\{"name":/);
});

test("buildSkillProposalMarkdown prefers maintainer pain over raw issue why text", () => {
  const markdown = buildSkillProposalMarkdown({
    title: "Add decision brief",
    issueUrl: "https://github.com/nilstate/aster/issues/115",
    jsonPath: "/tmp/decision-brief.json",
    payload: {
      skill_spec: {
        name: "decision-brief",
        summary: "Return one bounded maintainer decision packet.",
        maintainer_pain: "Maintainers need the current decision without replaying a long issue thread.",
      },
      acceptance_checks: ["Returns one packet.", "Stops at review.", "Preserves provenance."],
    },
    issuePacket: {
      source_issue: {
        repo: "nilstate/aster",
        number: 115,
      },
      sections: {
        why_it_matters: "The machine should turn raw issue context into an answer.",
      },
      amendments: [],
    },
  });

  assert.match(markdown, /Maintainers need the current decision without replaying a long issue thread\./);
  assert.doesNotMatch(markdown, /The machine should/);
});

test("buildSkillProposalMarkdown cleans machine-framed reader prose", () => {
  const markdown = buildSkillProposalMarkdown({
    title: "Add decision brief",
    issueUrl: "https://github.com/nilstate/aster/issues/115",
    jsonPath: "/tmp/decision-brief.json",
    payload: {
      skill_spec: {
        name: "decision-brief",
        summary: "The machine should return a compact decision brief from prior machine output.",
        maintainer_pain: "Maintainers lose time reconstructing state from prior machine output.",
      },
      pain_points: [
        "The machine should expose one answer instead of asking maintainers to replay agent output.",
      ],
      catalog_fit: {
        adjacent_skills: ["issue-triage"],
        why_new: "The provided catalog evidence does not show this handoff.",
      },
      acceptance_checks: [
        "The machine should produce a reviewable packet.",
        "The adapter may run when no policy is supplied.",
        "It keeps provenance.",
        "It stops at review.",
      ],
    },
    issuePacket: {
      source_issue: {
        repo: "nilstate/aster",
        number: 115,
      },
      amendments: [],
    },
  });

  assert.match(markdown, /the skill should return a compact decision brief from prior run artifacts/i);
  assert.match(markdown, /Maintainers lose time reconstructing state from prior run artifacts\./);
  assert.match(markdown, /the skill should expose one answer instead of asking maintainers to replay run output/i);
  assert.match(markdown, /The current catalog does not show this handoff\./);
  assert.match(markdown, /when no policy is provided/i);
  assert.doesNotMatch(markdown, /\bmachine output\b/i);
  assert.doesNotMatch(markdown, /\bagent output\b/i);
  assert.doesNotMatch(markdown, /\bthe machine should\b/i);
  assert.doesNotMatch(markdown, /\bsupplied\b/i);
  assert.doesNotMatch(markdown, /\bprovided catalog evidence\b/i);
});
