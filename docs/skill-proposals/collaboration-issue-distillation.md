---
title: "collaboration-issue-distillation"
description: "Distill a bounded collaboration subject into separate canonical evidence, distilled findings, and publish/build readiness artifacts before any publish or build gate proceeds."
---

# collaboration-issue-distillation

## Work Ledger

- Work issue: `nilstate/aster#110`
- Work issue URL: https://github.com/nilstate/aster/issues/110
- Ledger revision: `63983af249f7f32a`
- Maintainer amendments stay on the same work issue thread.
- Draft PR refresh requires `skill-lab.publish` authorization on the same work issue.

## Maintainer Amendments

Later maintainer amendments on the living ledger take precedence over stale original wording when they conflict.

### Amendment 1
- recorded_at: 2026-04-21T12:30:59Z
- author: auscaster
- url: https://github.com/nilstate/aster/issues/110#issuecomment-4288534647
- structured_teaching: publish_authorization — Refresh the single rolling skill-lab draft PR for this issue from the same work ledger.
Applies to: skill-lab.publish
Decisions:
- skill-lab.publish = allow | refresh the existing rolling draft PR from the same issue ledger

### Amendment 2
- recorded_at: 2026-04-21T12:24:06Z
- author: auscaster
- url: https://github.com/nilstate/aster/issues/110#issuecomment-4288494563
Amendment for this proposal:

- hard-cut the core contract to `subject_locator`, `subject_memory`, and `publication_target`; GitHub issue is only one adapter surface, not the core noun
- keep the GitHub issue thread as the living ledger for the GitHub adapter, but explicitly explain how the same skill can run from chat or CLI/agent context against the same contract
- separate canonical evidence, distilled findings, and publish/build readiness instead of collapsing them into one packet
- add at least one non-GitHub fixture that proves the skill can distill the same bounded collaboration subject outside GitHub while preserving the same approval semantics
- call out how maintainer amendments in the living ledger feed the next run without becoming hidden prompt-only state


## Objective

Distill a bounded collaboration subject into separate canonical evidence, distilled findings, and publish/build readiness artifacts before any publish or build gate proceeds.

## Original Request

Add a governed runx skill proposal for a collaboration issue distillation skill that turns a bounded GitHub issue thread into a reusable approval packet and maintainer recap before any publish or build gate proceeds.

## Why It Matters

We want issue review to train the operator. Human rationale should become explicit, rebuildable context rather than hidden prompt sprawl. This run should tell us whether skill-lab can produce a useful design for issue-shaped learning and approval work.

## Constraints

- proposal only, no implementation code
- output stays under `docs/skill-proposals/`
- skill output should be markdown/json artifacts, not direct GitHub mutation
- treat issue comments and GitHub Actions receipts as canonical evidence; derived memory must stay rebuildable
- call out approval boundaries explicitly and keep any publish surface draft-only
- acceptance checks should cover missing rationale, conflicting comments, and stale evidence

## Evidence

- `state/thread-teaching.json` is the current derived teaching surface
- `docs/philosophy.md` says repeated work should become explicit skills, not prompt sprawl
- `docs/operations.md` says every lane has an approval mode and memory effect
- collaboration issues are becoming a core review surface for bounded approvals

## Skill Contract

- name: `collaboration-issue-distillation`
- description: Distill a bounded collaboration subject into separate canonical evidence, distilled findings, and publish/build readiness artifacts before any publish or build gate proceeds.

## Execution Plan

```json
{
  "proposed_path": "docs/skill-proposals/collaboration-issue-distillation/execution-profile.yaml",
  "kind": "chain",
  "chain_name": "collaboration-issue-distillation",
  "objective": "Produce separate evidence, findings, and readiness artifacts from a bounded collaboration subject before any publish/build gate proceeds.",
  "default_completion_point": "emit-artifact-packet",
  "required_inputs": [
    "subject_locator",
    "subject_memory",
    "publication_target"
  ],
  "policy": {
    "core_chain_mutation": false,
    "draft_only_publication": true,
    "stop_condition": "Return needs_resolution when rationale is missing, guidance conflicts, or evidence is stale.",
    "follow_on_publication": {
      "included_in_core_chain": false,
      "allowed_only_with": "workflow_gate approval",
      "description": "Refreshing the single rolling skill-lab draft PR from the same work ledger is a separate approval-gated follow-on."
    }
  },
  "steps": [
    {
      "id": "normalize-subject-contract",
      "skill": "objective-decompose",
      "mutating": false,
      "description": "Normalize the bounded subject around subject_locator, subject_memory, and publication_target, while preserving adapter-specific details inside subject_memory.",
      "outputs": [
        "normalized_subject"
      ]
    },
    {
      "id": "assemble-canonical-evidence",
      "skill": "skill-lab",
      "mutating": false,
      "description": "Extract the canonical evidence refs and emit a separate canonical evidence manifest.",
      "context_from": [
        "normalize-subject-contract"
      ],
      "outputs": [
        "canonical_evidence"
      ]
    },
    {
      "id": "distill-collaboration-findings",
      "skill": "skill-lab",
      "mutating": false,
      "description": "Produce a maintainer recap and distilled findings without collapsing them into the evidence manifest.",
      "context_from": [
        "normalize-subject-contract",
        "assemble-canonical-evidence"
      ],
      "outputs": [
        "distilled_findings"
      ]
    },
    {
      "id": "assess-publish-build-readiness",
      "skill": "skill-lab",
      "mutating": false,
      "description": "Evaluate rationale completeness, comment consistency, evidence freshness, and approval semantics for the requested publication_target.",
      "context_from": [
        "assemble-canonical-evidence",
        "distill-collaboration-findings"
      ],
      "outputs": [
        "publish_build_readiness"
      ],
      "gate_checks": [
        "missing_rationale",
        "conflicting_comments",
        "stale_evidence",
        "draft_only_publication_target"
      ]
    },
    {
      "id": "emit-artifact-packet",
      "skill": "skill-lab",
      "mutating": false,
      "description": "Emit the three outputs as separate artifacts even when readiness is blocked, so the result remains inspectable and rebuildable.",
      "context_from": [
        "assemble-canonical-evidence",
        "distill-collaboration-findings",
        "assess-publish-build-readiness"
      ],
      "outputs": [
        "canonical_evidence",
        "distilled_findings",
        "publish_build_readiness"
      ]
    }
  ],
  "open_questions": [
    {
      "id": "oq-non-github-fixture-source",
      "blocking": false,
      "question": "Whether the non-GitHub fixture should remain synthetic or be derived from an existing chat or CLI subject."
    },
    {
      "id": "oq-proposal-file-convention",
      "blocking": false,
      "question": "Whether docs/skill-proposals/ already has a required naming or template convention."
    },
    {
      "id": "oq-draft-pr-authority",
      "blocking": true,
      "question": "Whether workflow-gate approval is available for any draft PR refresh follow-on."
    }
  ]
}
```

## Harness Fixtures

```json
[
  {
    "name": "github-issue-distillation-happy-path",
    "kind": "chain",
    "target": "../docs/skill-proposals/collaboration-issue-distillation/execution-profile.yaml",
    "inputs": {
      "subject_locator": "https://github.com/nilstate/aster/issues/110",
      "subject_memory": {
        "provider": "github_issue_thread",
        "canonical_evidence_refs": [
          "https://github.com/nilstate/aster/issues/110",
          "https://github.com/nilstate/aster/issues/110#issuecomment-4288494563",
          "https://github.com/nilstate/aster/issues/110#issuecomment-4288534647"
        ],
        "adapter_snapshot": {
          "title": "[skill] Add a collaboration issue distillation skill",
          "objective": "Add a governed runx skill proposal for a collaboration issue distillation skill that turns a bounded GitHub issue thread into a reusable approval packet and maintainer recap before any publish or build gate proceeds.",
          "rationale_excerpt": "We want issue review to train the operator. Human rationale should become explicit, rebuildable context rather than hidden prompt sprawl.",
          "amendments": [
            "hard-cut the core contract to subject_locator, subject_memory, and publication_target",
            "separate canonical evidence, distilled findings, and publish/build readiness",
            "publish_authorization — Refresh the single rolling skill-lab draft PR for this issue from the same work ledger"
          ]
        },
        "derived_context_refs": [
          "state/thread-teaching.json",
          "docs/philosophy.md",
          "docs/operations.md"
        ],
        "snapshot_generated_at": "2026-04-21T13:11:10Z"
      },
      "publication_target": {
        "target": "single rolling skill-lab draft PR for issue #110",
        "mode": "draft-only",
        "approval_mode": "workflow_gate",
        "draft_only": true
      }
    },
    "expect": {
      "status": "success",
      "receipt": {
        "kind": "chain_execution",
        "status": "success",
        "subject": {
          "chain_name": "collaboration-issue-distillation"
        }
      },
      "steps": [
        "normalize-subject-contract",
        "assemble-canonical-evidence",
        "distill-collaboration-findings",
        "assess-publish-build-readiness",
        "emit-artifact-packet"
      ],
      "outputs": {
        "canonical_evidence": {
          "present": true,
          "separate_from_findings": true
        },
        "distilled_findings": {
          "present": true,
          "separate_from_readiness": true
        },
        "publish_build_readiness": {
          "present": true,
          "publication_mode": "draft-only",
          "authorization_state": "approval_required"
        }
      }
    }
  },
  {
    "name": "non-github-chat-adapter-happy-path",
    "kind": "chain",
    "target": "../docs/skill-proposals/collaboration-issue-distillation/execution-profile.yaml",
    "inputs": {
      "subject_locator": "chat-review-issue-110-equivalent",
      "subject_memory": {
        "provider": "chat_thread",
        "canonical_evidence_refs": [
          "message-1",
          "message-2",
          "message-3"
        ],
        "adapter_snapshot": {
          "objective": "Distill a bounded collaboration review into reusable approval artifacts before publication.",
          "messages": [
            {
              "id": "message-1",
              "author_role": "maintainer",
              "body": "Keep the core contract to subject_locator, subject_memory, and publication_target."
            },
            {
              "id": "message-2",
              "author_role": "maintainer",
              "body": "Separate canonical evidence, findings, and readiness."
            },
            {
              "id": "message-3",
              "author_role": "maintainer",
              "body": "Any publication remains draft-only and approval-gated."
            }
          ]
        },
        "snapshot_generated_at": "2026-04-21T13:11:10Z"
      },
      "publication_target": {
        "target": "draft-only collaboration recap",
        "mode": "draft-only",
        "approval_mode": "workflow_gate",
        "draft_only": true
      }
    },
    "expect": {
      "status": "success",
      "receipt": {
        "kind": "chain_execution",
        "status": "success",
        "subject": {
          "chain_name": "collaboration-issue-distillation"
        }
      },
      "steps": [
        "normalize-subject-contract",
        "assemble-canonical-evidence",
        "distill-collaboration-findings",
        "assess-publish-build-readiness",
        "emit-artifact-packet"
      ],
      "outputs": {
        "canonical_evidence": {
          "present": true
        },
        "distilled_findings": {
          "present": true
        },
        "publish_build_readiness": {
          "present": true,
          "publication_mode": "draft-only",
          "authorization_state": "approval_required"
        }
      }
    }
  },
  {
    "name": "missing-rationale-needs-resolution",
    "kind": "chain",
    "target": "../docs/skill-proposals/collaboration-issue-distillation/execution-profile.yaml",
    "inputs": {
      "subject_locator": "https://github.com/nilstate/aster/issues/110",
      "subject_memory": {
        "provider": "github_issue_thread",
        "canonical_evidence_refs": [
          "https://github.com/nilstate/aster/issues/110"
        ],
        "adapter_snapshot": {
          "title": "[skill] Add a collaboration issue distillation skill",
          "objective": "Draft the proposal.",
          "comments": [
            {
              "id": "issue-body-only",
              "body": "Please draft this proposal."
            }
          ]
        },
        "snapshot_generated_at": "2026-04-21T13:11:10Z"
      },
      "publication_target": {
        "target": "single rolling skill-lab draft PR for issue #110",
        "mode": "draft-only",
        "approval_mode": "workflow_gate",
        "draft_only": true
      }
    },
    "expect": {
      "status": "needs_resolution",
      "receipt": {
        "kind": "chain_execution",
        "status": "needs_resolution",
        "subject": {
          "chain_name": "collaboration-issue-distillation"
        }
      },
      "steps": [
        "normalize-subject-contract",
        "assemble-canonical-evidence",
        "distill-collaboration-findings",
        "assess-publish-build-readiness",
        "emit-artifact-packet"
      ],
      "outputs": {
        "publish_build_readiness": {
          "present": true,
          "decision": "blocked",
          "blocking_reason": "missing_rationale"
        }
      }
    }
  },
  {
    "name": "conflicting-comments-needs-resolution",
    "kind": "chain",
    "target": "../docs/skill-proposals/collaboration-issue-distillation/execution-profile.yaml",
    "inputs": {
      "subject_locator": "https://github.com/nilstate/aster/issues/110",
      "subject_memory": {
        "provider": "github_issue_thread",
        "canonical_evidence_refs": [
          "https://github.com/nilstate/aster/issues/110",
          "https://github.com/nilstate/aster/issues/110#issuecomment-4288494563"
        ],
        "adapter_snapshot": {
          "title": "[skill] Add a collaboration issue distillation skill",
          "comments": [
            {
              "id": "c1",
              "body": "Keep the core contract to subject_locator, subject_memory, and publication_target."
            },
            {
              "id": "c2",
              "body": "Make GitHub issue the primary contract noun."
            }
          ]
        },
        "snapshot_generated_at": "2026-04-21T13:11:10Z"
      },
      "publication_target": {
        "target": "single rolling skill-lab draft PR for issue #110",
        "mode": "draft-only",
        "approval_mode": "workflow_gate",
        "draft_only": true
      }
    },
    "expect": {
      "status": "needs_resolution",
      "receipt": {
        "kind": "chain_execution",
        "status": "needs_resolution",
        "subject": {
          "chain_name": "collaboration-issue-distillation"
        }
      },
      "steps": [
        "normalize-subject-contract",
        "assemble-canonical-evidence",
        "distill-collaboration-findings",
        "assess-publish-build-readiness",
        "emit-artifact-packet"
      ],
      "outputs": {
        "publish_build_readiness": {
          "present": true,
          "decision": "blocked",
          "blocking_reason": "conflicting_comments"
        }
      }
    }
  },
  {
    "name": "stale-evidence-needs-resolution",
    "kind": "chain",
    "target": "../docs/skill-proposals/collaboration-issue-distillation/execution-profile.yaml",
    "inputs": {
      "subject_locator": "https://github.com/nilstate/aster/issues/110",
      "subject_memory": {
        "provider": "github_issue_thread",
        "canonical_evidence_refs": [
          "https://github.com/nilstate/aster/issues/110",
          "https://github.com/nilstate/aster/issues/110#issuecomment-4288494563",
          "https://github.com/nilstate/aster/issues/110#issuecomment-4288534647"
        ],
        "adapter_snapshot": {
          "title": "[skill] Add a collaboration issue distillation skill",
          "rationale_excerpt": "We want issue review to train the operator.",
          "amendments": [
            "hard-cut the core contract",
            "keep publication draft-only"
          ]
        },
        "snapshot_generated_at": "2026-04-20T00:00:00Z"
      },
      "publication_target": {
        "target": "single rolling skill-lab draft PR for issue #110",
        "mode": "draft-only",
        "approval_mode": "workflow_gate",
        "draft_only": true,
        "required_evidence_after": "2026-04-21T12:30:59Z"
      }
    },
    "expect": {
      "status": "needs_resolution",
      "receipt": {
        "kind": "chain_execution",
        "status": "needs_resolution",
        "subject": {
          "chain_name": "collaboration-issue-distillation"
        }
      },
      "steps": [
        "normalize-subject-contract",
        "assemble-canonical-evidence",
        "distill-collaboration-findings",
        "assess-publish-build-readiness",
        "emit-artifact-packet"
      ],
      "outputs": {
        "publish_build_readiness": {
          "present": true,
          "decision": "blocked",
          "blocking_reason": "stale_evidence"
        }
      }
    }
  }
]
```

## Acceptance Checks

- `ac-core-contract-only`: The skill requires only subject_locator, subject_memory, and publication_target as top-level inputs; adapter-specific details remain nested under subject_memory.
- `ac-github-is-adapter-not-core-noun`: A GitHub issue thread is treated as one adapter surface and the same chain succeeds for a non-GitHub bounded subject with the same approval semantics.
- `ac-separate-artifact-classes`: The chain emits separate canonical_evidence, distilled_findings, and publish_build_readiness outputs rather than one collapsed packet.
- `ac-canonical-over-derived`: Canonical evidence refs are preserved in output and derived context does not replace them.
- `ac-missing-rationale-blocks-readiness`: If the bounded subject lacks explicit rationale, the chain returns needs_resolution and marks publish_build_readiness as blocked for missing_rationale.
- `ac-conflicting-comments-block-readiness`: If comments or amendments conflict on the governing direction, the chain returns needs_resolution and marks publish_build_readiness as blocked for conflicting_comments.
- `ac-stale-evidence-blocks-readiness`: If subject_memory is older than publication_target.required_evidence_after, the chain returns needs_resolution and marks publish_build_readiness as blocked for stale_evidence.
- `ac-draft-only-publication-semantics`: Successful distillation preserves draft-only publication semantics and does not imply publish authorization; readiness records approval_required when workflow-gated publication is requested.
- `ac-amendments-remain-rebuildable`: Maintainer amendments are carried through explicit canonical_evidence_refs or adapter_snapshot content in subject_memory, not hidden prompt-only state.

## Raw Packet

See [collaboration-issue-distillation.json](./collaboration-issue-distillation.json).

