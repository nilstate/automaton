import test from "node:test";
import assert from "node:assert/strict";

import { evaluateSkillProposalQuality } from "./evaluate-skill-proposal-quality.mjs";

test("evaluateSkillProposalQuality passes a crisp first-party proposal", () => {
  const evaluation = evaluateSkillProposalQuality({
    report: {
      execution: {
        stdout: JSON.stringify({
          skill_spec: {
            skill_name: "decision-brief",
            summary: "Read one bounded issue thread and return one concise maintainer decision brief.",
            inputs: [{ name: "subject_memory", type: "object" }],
            outputs: [{ name: "decision_brief", type: "object" }],
          },
          pain_points: [
            "Maintainers need a compact next-step packet instead of re-reading the whole work thread.",
          ],
          catalog_fit: {
            adjacent_skills: ["issue-triage", "skill-lab"],
            why_new: "The current catalog does not have a narrow single-packet decision skill.",
          },
          maintainer_decisions: [
            {
              question: "Should the first version stop at review?",
            },
          ],
          findings: [
            {
              claim: "The source issue asked for reusable decision support instead of another broad planning agent.",
            },
          ],
          acceptance_checks: [{ id: "ac-1" }, { id: "ac-2" }, { id: "ac-3" }],
          harness_fixture: [
            {
              target: "../decision-brief",
              expected: "Returns one decision packet with recommendation, rationale, and next action.",
            },
          ],
        }),
      },
    },
    catalogEntries: ["issue-triage", "skill-lab", "issue-to-pr"],
  });

  assert.equal(evaluation.status, "pass");
  assert.equal(evaluation.checks.proposal_named, true);
  assert.equal(evaluation.checks.pain_points_explicit, true);
  assert.equal(evaluation.checks.catalog_overlap_explained, true);
  assert.equal(evaluation.findings.length, 0);
});

test("evaluateSkillProposalQuality accepts purpose as the proposal summary field", () => {
  const evaluation = evaluateSkillProposalQuality({
    report: {
      execution: {
        stdout: JSON.stringify({
          skill_spec: {
            skill_name: "decision-brief",
            purpose: "Turn one living work ledger into one bounded maintainer decision packet.",
            inputs: [{ name: "thread", type: "object" }],
            output_schema: { name: "decision_packet" },
          },
          pain_points: ["Maintainers need one current decision packet instead of replaying a whole thread."],
          catalog_fit: {
            adjacent_capabilities: [{ name: "issue-triage" }],
            why_this_is_a_candidate_new_capability: "Compared with issue-triage, this owns the ledger-to-decision handoff.",
          },
          maintainer_decisions: [{ question: "Add this as a first-party skill?" }],
          findings: [{ claim: "The source issue asks for a decision handoff." }],
          acceptance_checks: [{ id: "ac-1" }, { id: "ac-2" }, { id: "ac-3" }],
          harness_fixture: [{ name: "success" }],
        }),
      },
    },
    catalogEntries: ["issue-triage"],
  });

  assert.equal(evaluation.status, "pass");
  assert.equal(evaluation.checks.first_party_shape, true);
  assert.equal(evaluation.checks.human_grade_surface, true);
});

test("evaluateSkillProposalQuality ignores natural-language placeholder mentions", () => {
  const evaluation = evaluateSkillProposalQuality({
    report: {
      execution: {
        stdout: JSON.stringify({
          skill_spec: {
            skill_name: "decision-brief",
            summary: "Return one concise decision packet from one bounded work issue thread.",
            inputs: [{ name: "subject_memory", type: "object" }],
            outputs: [{ name: "decision_packet", type: "object" }],
          },
          pain_points: ["Maintainers need one next-step packet."],
          catalog_fit: {
            adjacent_skills: ["issue-triage"],
            why_new: "This is narrower than issue triage.",
          },
          maintainer_decisions: [{ question: "Accept the skill?" }],
          findings: [{ claim: "The source issue requested a compact decision artifact." }],
          acceptance_checks: [{ id: "ac-1" }, { id: "ac-2" }, { id: "ac-3" }],
          harness_fixture: [
            {
              target: "../decision-brief",
              inputs: {
                subject_memory: {
                  thread: {
                    comments: [
                      {
                        body: "Remove builder residue and placeholder language.",
                      },
                    ],
                  },
                },
              },
            },
          ],
        }),
      },
    },
    catalogEntries: ["issue-triage"],
  });

  assert.equal(evaluation.checks.placeholder_free, true);
  assert.equal(evaluation.status, "pass");
});

test("evaluateSkillProposalQuality rejects transcript-shaped public proposals", () => {
  const evaluation = evaluateSkillProposalQuality({
    report: {
      execution: {
        stdout: JSON.stringify({
          skill_spec: {
            skill_name: "decision-brief",
            summary: "Generated skill proposal.",
            inputs: [{ name: "subject_memory", type: "object" }],
            outputs: [{ name: "decision_packet", type: "object" }],
          },
          pain_points: ["Maintainers need one next-step packet."],
          catalog_fit: {
            adjacent_skills: ["issue-triage"],
            why_new: "This is narrower than issue triage.",
          },
          maintainer_decisions: [{ question: "Accept the skill?" }],
          acceptance_checks: [{ id: "ac-1" }, { id: "ac-2" }, { id: "ac-3" }],
          harness_fixture: [{ name: "success" }],
          findings: [
            {
              claim: "## Work Ledger\n## Maintainer Amendments\nstructured_teaching: publish_authorization",
            },
          ],
        }),
      },
    },
    issuePacket: {
      source_issue: {
        number: 115,
        url: "https://github.com/nilstate/aster/issues/115",
      },
    },
    catalogEntries: ["issue-triage"],
  });

  assert.equal(evaluation.status, "needs_review");
  assert.equal(evaluation.checks.human_grade_surface, false);
  assert.equal(evaluation.checks.builder_residue_free, false);
  assert.match(evaluation.findings.map((item) => item.id).join("\n"), /work_ledger_heading/);
  assert.match(evaluation.findings.map((item) => item.id).join("\n"), /maintainer_amendments_heading/);
});

test("evaluateSkillProposalQuality accepts adjacent capabilities with a conclusion boundary", () => {
  const evaluation = evaluateSkillProposalQuality({
    report: {
      execution: {
        stdout: JSON.stringify({
          skill_spec: {
            skill_name: "decision-brief",
            summary: "Read one bounded work issue thread and return one concise maintainer decision packet.",
            inputs: [{ name: "subject_memory", type: "object" }],
            outputs: [{ name: "decision_packet", type: "object" }],
          },
          pain_points: ["Maintainers need one next-step packet instead of replaying a whole issue thread."],
          catalog_fit: {
            adjacent_capabilities: [
              {
                name: "issue-triage",
                why: "It routes and summarizes but does not emit the next bounded decision packet.",
              },
              {
                name: "skill-lab",
                why: "It designs skills but does not run as the runtime ledger-to-decision handoff.",
              },
            ],
            conclusion: "This is a distinct ledger-to-decision handoff boundary rather than another triage or skill-design flow.",
          },
          maintainer_decisions: [{ question: "Approve this as a net-new skill?" }],
          findings: [{ claim: "The source issue requests one bounded decision packet." }],
          acceptance_checks: [{ id: "ac-1" }, { id: "ac-2" }, { id: "ac-3" }],
          harness_fixture: [{ name: "success", expected: "Returns one decision packet." }],
        }),
      },
    },
    catalogEntries: ["issue-triage", "skill-lab"],
  });

  assert.equal(evaluation.status, "pass");
  assert.equal(evaluation.checks.catalog_worthiness, true);
});

test("evaluateSkillProposalQuality allows approval mechanics inside harness-only boundary fixtures", () => {
  const evaluation = evaluateSkillProposalQuality({
    report: {
      execution: {
        stdout: JSON.stringify({
          skill_spec: {
            skill_name: "decision-brief",
            summary: "Read one bounded work issue thread and return one concise maintainer decision packet.",
            required_inputs: [{ name: "thread", type: "object" }],
            output_contract: { name: "decision_packet", type: "object" },
          },
          pain_points: ["Maintainers need one next-step packet instead of replaying a whole issue thread."],
          catalog_fit: {
            summary: "This should stay first-party because it is the reusable ledger-to-decision handoff.",
            fit_summary: "This is a distinct ledger-to-decision boundary, not another triage or content-drafting surface.",
            adjacent_entries: [
              { name: "issue-triage", why: "Routes work but does not emit one decision packet." },
              { name: "skill-lab", why: "Designs skills but does not run as this runtime handoff." },
            ],
            why_new_first_party_capability: "This is the reusable one-ledger-in, one-decision-packet-out runtime transform.",
          },
          maintainer_decisions: [{ question: "Approve this as a net-new skill?" }],
          findings: [{ claim: "The source issue requests one bounded decision packet." }],
          acceptance_checks: [{ id: "ac-1" }, { id: "ac-2" }, { id: "ac-3" }],
          harness_fixture: [
            {
              name: "boundary-no-publish",
              yaml: "body: structured teaching: publish_authorization must still stop at review",
            },
          ],
        }),
      },
    },
    catalogEntries: ["issue-triage", "skill-lab"],
  });

  assert.equal(evaluation.status, "pass");
  assert.equal(evaluation.checks.builder_residue_free, true);
  assert.equal(evaluation.checks.human_grade_surface, true);
});

test("evaluateSkillProposalQuality accepts catalog fit with adjacent entries and boundary language", () => {
  const evaluation = evaluateSkillProposalQuality({
    report: {
      execution: {
        stdout: JSON.stringify({
          skill_spec: {
            skill_name: "decision-brief",
            summary: "Read one bounded work issue thread and return one concise maintainer decision packet.",
            inputs: [{ name: "subject_memory", type: "object" }],
            outputs: [{ name: "decision_packet", type: "object" }],
          },
          pain_points: ["Maintainers need one next-step packet instead of replaying a whole issue thread."],
          catalog_fit: {
            adjacent_catalog_entries: [
              { name: "issue-triage", why_not_enough: "It routes work but does not emit one decision packet." },
              { name: "skill-lab", why_not_enough: "It designs skills but does not run as this runtime handoff." },
            ],
            new_capability_justification: "This fills a narrow gap between issue routing and proposal review.",
          },
          maintainer_decisions: [{ question: "Approve this as a net-new skill?" }],
          findings: [{ claim: "The source issue requests one bounded decision packet." }],
          acceptance_checks: [{ id: "ac-1" }, { id: "ac-2" }, { id: "ac-3" }],
          harness_fixture: [{ name: "success", expected: "Returns one decision packet." }],
        }),
      },
    },
    catalogEntries: ["issue-triage", "skill-lab"],
  });

  assert.equal(evaluation.status, "pass");
  assert.equal(evaluation.checks.catalog_worthiness, true);
});

test("evaluateSkillProposalQuality rejects supplied catalog and work-plan framing", () => {
  const evaluation = evaluateSkillProposalQuality({
    report: {
      execution: {
        stdout: JSON.stringify({
          skill_spec: {
            skill_name: "decision-brief",
            summary: "Read one bounded thread and return one concise maintainer decision packet.",
            inputs: [{ name: "thread_body", type: "string" }],
            outputs: [{ name: "decision_packet", type: "object" }],
            behavior: ["Filter amendment comments using the supplied trusted_amendment_policy."],
          },
          pain_points: ["Maintainers need one decision packet instead of replaying a thread."],
          catalog_fit: {
            adjacent_entries: [
              { name: "issue-triage", why_not_enough: "It routes work but does not emit the handoff packet." },
            ],
            summary: "Based on the supplied catalog, this fills a narrow gap after the supplied work-plan.",
          },
          maintainer_decisions: [{ question: "Approve this as a new skill?" }],
          findings: [{ claim: "The source issue asks for one decision handoff." }],
          acceptance_checks: [{ id: "ac-1" }, { id: "ac-2" }, { id: "ac-3" }],
          harness_fixture: [{ name: "success" }],
        }),
      },
    },
    catalogEntries: ["issue-triage"],
  });

  assert.equal(evaluation.status, "needs_review");
  assert.equal(evaluation.checks.builder_residue_free, false);
  assert.equal(evaluation.findings.some((finding) => finding.id === "supplied_decomposition"), true);
});

test("evaluateSkillProposalQuality allows ordinary supplied-as-provided contract wording", () => {
  const evaluation = evaluateSkillProposalQuality({
    report: {
      execution: {
        stdout: JSON.stringify({
          skill_spec: {
            skill_name: "decision-brief",
            summary: "Read one bounded thread and return one concise maintainer decision packet.",
            inputs: [{ name: "thread_body", type: "string" }],
            outputs: [{ name: "decision_packet", type: "object" }],
          },
          pain_points: ["Maintainers need one decision packet instead of replaying a thread."],
          catalog_fit: {
            adjacent_entries: [
              { name: "issue-triage", why_not_enough: "It routes work but does not emit the handoff packet." },
            ],
            summary: "Compared with issue-triage, this owns the decision handoff.",
          },
          maintainer_decisions: [
            {
              question: "Should the policy be required when no adapter default is supplied?",
            },
          ],
          findings: [{ claim: "The source issue asks for one decision handoff." }],
          acceptance_checks: [{ id: "ac-1" }, { id: "ac-2" }, { id: "ac-3" }],
          harness_fixture: [{ name: "success" }],
        }),
      },
    },
    catalogEntries: ["issue-triage"],
  });

  assert.equal(evaluation.status, "pass");
  assert.equal(evaluation.findings.some((finding) => finding.id === "supplied_decomposition"), false);
});

test("evaluateSkillProposalQuality rejects builder envelope framing", () => {
  const evaluation = evaluateSkillProposalQuality({
    report: {
      execution: {
        stdout: JSON.stringify({
          skill_spec: {
            skill_name: "decision-brief",
            summary: "Read one bounded thread and return one concise maintainer decision packet.",
            inputs: [{ name: "thread_body", type: "string" }],
            outputs: [{ name: "decision_packet", type: "object" }],
          },
          pain_points: ["Maintainers need one decision packet instead of replaying a thread."],
          catalog_fit: {
            adjacent_entries: [
              { name: "issue-triage", why_not_enough: "It routes work but does not emit the handoff packet." },
            ],
            summary: "These claims stay conservative because the envelope includes names, not source files.",
          },
          maintainer_decisions: [{ question: "Approve this as a new skill?" }],
          findings: [{ claim: "The source issue asks for one decision handoff." }],
          acceptance_checks: [{ id: "ac-1" }, { id: "ac-2" }, { id: "ac-3" }],
          harness_fixture: [{ name: "success" }],
        }),
      },
    },
    catalogEntries: ["issue-triage"],
  });

  assert.equal(evaluation.status, "needs_review");
  assert.equal(evaluation.checks.builder_residue_free, false);
  assert.equal(evaluation.findings.some((finding) => finding.id === "builder_envelope"), true);
});

test("evaluateSkillProposalQuality rejects provided catalog evidence framing", () => {
  const evaluation = evaluateSkillProposalQuality({
    report: {
      execution: {
        stdout: JSON.stringify({
          skill_spec: {
            skill_name: "decision-brief",
            summary: "Read one bounded thread and return one concise maintainer decision packet.",
            inputs: [{ name: "thread_body", type: "string" }],
            outputs: [{ name: "decision_packet", type: "object" }],
          },
          pain_points: ["Maintainers need one decision packet instead of replaying a thread."],
          catalog_fit: {
            adjacent_entries: [
              { name: "issue-triage", why_not_enough: "It routes work but does not emit the handoff packet." },
            ],
            summary: "The provided catalog evidence does not show a skill that owns this packet.",
          },
          maintainer_decisions: [{ question: "Approve this as a new skill?" }],
          findings: [{ claim: "The source issue asks for one decision handoff." }],
          acceptance_checks: [{ id: "ac-1" }, { id: "ac-2" }, { id: "ac-3" }],
          harness_fixture: [{ name: "success" }],
        }),
      },
    },
    catalogEntries: ["issue-triage"],
  });

  assert.equal(evaluation.status, "needs_review");
  assert.equal(evaluation.checks.human_grade_surface, false);
  assert.equal(evaluation.findings.some((finding) => finding.id === "provided_catalog_evidence"), true);
});

test("evaluateSkillProposalQuality rejects machine-framed proposal prose", () => {
  const evaluation = evaluateSkillProposalQuality({
    report: {
      execution: {
        stdout: JSON.stringify({
          skill_spec: {
            skill_name: "decision-brief",
            summary: "The machine should return one concise maintainer decision packet.",
            inputs: [{ name: "thread_body", type: "string" }],
            outputs: [{ name: "decision_packet", type: "object" }],
          },
          pain_points: ["Maintainers need one packet instead of replaying prior machine output."],
          catalog_fit: {
            adjacent_entries: [
              { name: "issue-triage", why_not_enough: "It routes work but does not emit the handoff packet." },
            ],
            summary: "Compared with issue-triage, this owns the decision handoff.",
          },
          maintainer_decisions: [{ question: "Approve this as a new skill?" }],
          findings: [{ claim: "The source issue asks for one decision handoff." }],
          acceptance_checks: [{ id: "ac-1" }, { id: "ac-2" }, { id: "ac-3" }],
          harness_fixture: [{ name: "success" }],
        }),
      },
    },
    catalogEntries: ["issue-triage"],
  });

  assert.equal(evaluation.status, "needs_review");
  assert.equal(evaluation.checks.human_grade_surface, false);
  assert.equal(evaluation.findings.some((finding) => finding.id === "machine_output_framing"), true);
  assert.equal(evaluation.findings.some((finding) => finding.id === "machine_actor_framing"), true);
});

test("evaluateSkillProposalQuality flags builder residue and missing catalog fit", () => {
  const evaluation = evaluateSkillProposalQuality({
    report: {
      execution: {
        stdout: JSON.stringify({
          skill_spec: {
            name: "decision-brief",
            summary: "Use the supplied decomposition to design the current issue #115 skill.",
          },
          acceptance_checks: [{ id: "ac-1" }, { id: "ac-2" }, { id: "ac-3" }],
          harness_fixture: [
            {
              target: "UNRESOLVED_SKILL_TARGET",
            },
          ],
          execution_plan: {
            open_questions_left_out_of_scope: ["What artifact form should hold the proposal?"],
          },
        }),
      },
    },
    catalogEntries: ["issue-triage", "skill-lab", "issue-to-pr"],
  });

  assert.equal(evaluation.status, "needs_review");
  assert.equal(evaluation.checks.builder_residue_free, false);
  assert.equal(evaluation.checks.catalog_fit_explicit, false);
  assert.equal(evaluation.checks.placeholder_free, false);
  assert.match(evaluation.findings.map((item) => item.summary).join("\n"), /current runx catalog/);
});
