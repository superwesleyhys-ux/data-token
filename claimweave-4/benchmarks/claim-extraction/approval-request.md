# Claimweave benchmark approval request — CW-SUP-03 frozen gate

Status: `BLOCKED` pending inspectable CW-SUP-01/CW-SUP-02 artifacts with passing
checks, one current consolidated owner request and cost cap, an explicit
supervising release record, held-out evidence, and a metadata-bearing framework
AI seam.

Frozen specification identity:

- config SHA-256: `f51143094db4404d2ef5bb87d356c6b2f892af765ab8c755deceb5c31e2a9900`
- request-sequence SHA-256: `661a358c30532a8dac6ebca8bf0ba3904e60088164b4a3b9a8d70a52c2f70ce8`
- combined frozen-spec identity: `ff885ee52ed3fd172fb9bf782399abc48336873a304ef8cfd33c1e3fc07f0de4`

## Evidence inventory

The workspace audit found no inspectable artifact for `wi_2799760`, CW-SUP-01
(`wi_2804609`), or CW-SUP-02 (`wi_2804612`), and no authoritative external
release-record contract. They are `BLOCKED` and not reusable. The checked-in
`offline-v1` pack is reusable `PASS` evidence for provider-free cache decisions
only; it is not a live savings result. The durable inventory and gate report is
`evidence/acceptance-gate-v2.json`.

Requested scope is the five-document pilot only: five synthetic/held-out
documents, one cold case, and two variants per document. That is an estimate of
10 logical requests. If `r` parse retries occur, the estimated provider attempt
count is `10 + r`; retries count against the 96-attempt ceiling. The remaining
limit is unknown until the authorized cumulative ledger supplies previous
attempts and retries. Estimated cost is `unknown` because no authorized
provider pricing or spend record is available; this request does not authorize
a purchase, top-up, secret creation, or provider call.

The full independent-document shape is estimated at 10 logical requests per
document (five cases × two variants), so after a zero-retry 10-attempt pilot the
arithmetic ceiling is eight additional documents. This is an arithmetic
estimate, not a usage claim.

Required next action: obtain the prerequisite artifacts/checks, one current
consolidated owner request and positive cost cap, the external supervising
release record, held-out documents/source hashes/independent annotations, and a
framework-owned AI result seam exposing provider request ID, per-attempt count,
nullable usage, cost, and latency at the real fetch boundary. Until those are
supplied, no live benchmark execution is permitted. An old attempt count, queued
status, or this task title is not release authority.
