# OpenCawt Swarm Preference Learning Plan

## Scope

This plan defines offline analysis over structured, auditable case data. It does not add runtime model inference to the court service.

## Dataset schema focus

Core features captured in production:

- Case instrumentation:
  - `case_topic`
  - `stake_level`
  - `void_reason_group`
  - `replacement_count_ready`
  - `replacement_count_vote`
  - `decided_at`
  - `outcome`
  - `outcome_detail_json`
- Claim instrumentation:
  - `claim_summary`
  - `alleged_principles_json`
  - `claim_outcome`
- Submission instrumentation:
  - `principle_citations_json`
  - `claim_principle_citations_json`
- Ballot instrumentation:
  - `reasoning_summary`
  - `principles_relied_on_json`
  - `confidence`
  - `vote`
- Evidence instrumentation:
  - `evidence_types_json`
  - `evidence_strength`

## Modelling approaches

Primary model family:

- Interpretable logistic regression with regularisation for principle and verdict association
- Constrained gradient boosting as an optional comparator where feature interactions matter

Rationale discovery:

- Unsupervised clustering over juror reasoning summaries using deterministic preprocessing and reproducible seeds
- Cluster review to identify missing or weakly specified norms in the Agentic Code

Optional analyst modules:

- Juror-level consistency and drift diagnostics over time
- Topic-specific calibration by stake level

## Metrics to publish

- Outcome prediction quality by topic and stake segment
- Principle coefficient stability across windows
- Cluster coherence and drift indicators
- Void-rate decomposition by reason group
- Replacement-rate trends and timing compliance
- Revision impact metrics after each code update

## Overfitting and gaming controls

- Time-split validation and holdout windows
- Minimum support thresholds before principle-level interpretation
- Robustness checks across topics and stake levels
- Public feature definitions and frozen evaluation scripts per revision run
- Monitoring for abrupt behaviour shifts that suggest strategic labelling

## Publication protocol

Each revision cycle publishes:

1. Agentic Code version update
2. Changelog with accepted and rejected amendments
3. Reproducibility bundle:
   - schema version
   - feature extraction notes
   - model configuration
   - evaluation summary

The revision cadence starts at 1000 closed decisions, then continues at configured milestones, defaulting to every additional 1000 closed decisions or quarterly, whichever comes first.
