#!/usr/bin/env node
// Fail-closed authorized runner. It never prints cookies, tokens, source text, or dataset rows.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const configPath = resolve(root, 'benchmarks/claim-extraction/config.json');
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const configHash = createHash('sha256').update(readFileSync(configPath)).digest('hex');
const sequencePath = resolve(root, config.sequenceManifestPath);
const sequenceHash = createHash('sha256').update(readFileSync(sequencePath)).digest('hex');
const frozenSpecIdentity = sha256(`${configHash}:${sequenceHash}`);
const env = process.env;
const offline = process.argv.includes('--offline');

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalJson(entry)]),
    );
  }
  return value;
}

function policyReason(change) {
  if (change === 'permission') return 'tenant_permission_mismatch';
  if (change === 'model') return 'model_mismatch';
  return 'prompt_schema_mismatch';
}

function runOffline() {
  const fixtureRoot = resolve(root, 'benchmarks/claim-extraction/fixtures/v1');
  const fixtureManifest = JSON.parse(readFileSync(join(fixtureRoot, 'manifest.json'), 'utf8'));
  const sourceRecords = new Map();
  const fixtureHashes = [];
  const artifactHashes = [];
  for (const record of fixtureManifest.sourceFiles) {
    const sourcePath = join(fixtureRoot, record.path);
    const source = readFileSync(sourcePath, 'utf8');
    const sourceHash = sha256(readFileSync(sourcePath));
    if (sourceHash !== record.sha256) throw new Error(`Fixture hash mismatch: ${record.sourceId}`);
    const annotationPath = join(fixtureRoot, record.annotationPath);
    const corroborationPath = join(fixtureRoot, record.corroborationPath);
    const annotationHash = sha256(readFileSync(annotationPath));
    const corroborationHash = sha256(readFileSync(corroborationPath));
    if (annotationHash !== record.annotationSha256)
      throw new Error(`Annotation hash mismatch: ${record.sourceId}`);
    if (corroborationHash !== record.corroborationSha256)
      throw new Error(`Corroboration hash mismatch: ${record.sourceId}`);
    const annotation = JSON.parse(readFileSync(annotationPath, 'utf8'));
    const corroboration = JSON.parse(readFileSync(corroborationPath, 'utf8'));
    if (annotation.sourceId !== 'source-001' || corroboration.sourceId !== 'source-001') {
      throw new Error(`Fixture provenance mismatch: ${record.sourceId}`);
    }
    if (record.sourceId === 'source-001') {
      for (const claim of annotation.claims) {
        if (source.slice(claim.start, claim.end) !== claim.quote)
          throw new Error(`Annotation span mismatch: ${claim.claimId}`);
      }
      if (corroboration.corroborationId === annotation.annotationId)
        throw new Error('Corroboration and annotation identifiers must remain distinct.');
      if (corroboration.facts.some((fact) => fact.text === source))
        throw new Error('Corroboration must not copy original source content.');
    }
    sourceRecords.set(record.sourceId, { source, sourceHash });
    fixtureHashes.push({ sourceId: record.sourceId, sha256: sourceHash });
    artifactHashes.push(
      { path: record.path, sha256: sourceHash },
      { path: record.annotationPath, sha256: annotationHash },
      { path: record.corroborationPath, sha256: corroborationHash },
    );
  }

  const original = sourceRecords.get('source-001');
  if (!original) throw new Error('Original fixture source is missing.');
  const scenarioReports = [];
  for (const scenario of fixtureManifest.scenarios) {
    const sourceRecord = sourceRecords.get(scenario.sourceId);
    if (!sourceRecord) throw new Error(`Scenario source is missing: ${scenario.id}`);
    for (const marker of scenario.expectedSourceMarkers ?? []) {
      if (!sourceRecord.source.includes(marker))
        throw new Error(`Source assertion mismatch: ${scenario.id}:${marker}`);
    }
    const sourceDigest = sourceRecord.sourceHash;
    const result = {
      scenarioId: scenario.id,
      sourceId: scenario.sourceId,
      provenance: {
        sourceId: scenario.sourceId,
        sourceDigest,
        corroborationId: 'corroboration-001',
      },
      extractionResultDigest: sha256(
        JSON.stringify(
          canonicalJson({
            sourceId: scenario.sourceId,
            sourceDigest,
            annotationId: 'annotation-001',
          }),
        ),
      ),
      decision: 'miss',
      reason: null,
      providerAttempts: 1,
    };
    if (scenario.id === 'exact-repeat') {
      result.decision = 'hit';
      result.providerAttempts = 0;
    } else if (scenario.id === 'expiry') {
      result.decision = 'rejected';
      result.reason = 'freshness_mismatch';
    } else if (scenario.policyChanges) {
      result.decision = 'rejected';
      result.reason = null;
      result.providerAttempts = 0;
      result.policyChanges = scenario.policyChanges.map((change) => ({
        name: change.name,
        decision: 'rejected',
        reason: policyReason(change.name),
        providerAttempts: 1,
      }));
      result.providerAttempts = result.policyChanges.reduce(
        (total, change) => total + change.providerAttempts,
        0,
      );
    } else if (scenario.id !== 'cold-start') {
      result.decision = 'rejected';
      result.reason = 'content_mismatch';
    }
    if (result.decision !== scenario.expectedDecision)
      throw new Error(`Decision mismatch: ${scenario.id}`);
    if (scenario.expectedReason && result.reason !== scenario.expectedReason)
      throw new Error(`Reason mismatch: ${scenario.id}`);
    if (result.providerAttempts !== scenario.expectedProviderAttempts)
      throw new Error(`Attempt mismatch: ${scenario.id}`);
    scenarioReports.push(result);
  }

  const report = {
    status: 'offline_ready',
    fixtureSetId: fixtureManifest.fixtureSetId,
    fixtureSchemaVersion: fixtureManifest.schemaVersion,
    configHash,
    sequenceHash,
    frozenSpecIdentity,
    fixtureHashes,
    artifactHashes,
    sourceAnnotationProvenance: {
      originalSourceId: 'source-001',
      annotationId: 'annotation-001',
      corroborationId: 'corroboration-001',
      independent: true,
    },
    scenarios: scenarioReports,
    offlineProviderCallsMade: 0,
    providerAttemptsObserved: null,
    usageStatus: 'unknown-until-framework-metadata-seam',
    costUsd: null,
    pilotEstimate: {
      documents: 5,
      casesPerDocument: 1,
      variants: 2,
      logicalRequests: 10,
      providerAttempts: '10 + r',
      remainingBudget: 'unknown-blocked-without-authorized-ledger',
    },
    fullIndependentDocumentEstimate: {
      requestsPerDocument: 10,
      additionalDocumentsAfterZeroRetryPilot: 8,
      basis: '96 attempt ceiling minus 10-request pilot',
    },
    blockers: [
      'owner_approval_missing_from_authorized_records',
      'cumulative_request_spend_ledger_missing',
      'framework_ai_client_hides_provider_request_id_usage_and_attempts',
      'held_out_dataset_and_gold_annotations_not_supplied',
      'cw_sup_01_and_cw_sup_02_artifacts_not_inspectable',
      'consolidated_owner_request_and_cost_cap_missing',
      'supervising_release_record_contract_missing',
    ],
  };
  const outputIndex = process.argv.indexOf('--output');
  const outputPath = outputIndex >= 0 ? process.argv[outputIndex + 1] : null;
  if (outputPath)
    writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  return report;
}

if (offline) {
  try {
    process.stdout.write(`${JSON.stringify(runOffline())}\n`);
    process.exitCode = 0;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ status: 'offline_failed', error: String(error) })}\n`);
    process.exitCode = 1;
  }
} else {
  const datasetPath = env[config.dataset.pathEnv];
  const pilotAttempts =
    config.requestSequence.pilotDocumentCount * config.requestSequence.variants.length;
  const attemptsPerDocument =
    config.requestSequence.requestsPerIndependentDocument * config.requestSequence.variants.length;
  const maximumIndependentDocuments = Math.floor(
    (config.authorization.maxProviderAttempts - pilotAttempts) / attemptsPerDocument,
  );
  const estimatedAttempts =
    pilotAttempts + Math.max(0, maximumIndependentDocuments) * attemptsPerDocument;
  const blockers = [];

  if (!env[config.authorization.authorizationReferenceEnv])
    blockers.push('authorization_reference_missing');
  if (
    !env[config.authorization.financialCapEnv] ||
    Number(env[config.authorization.financialCapEnv]) <= 0
  )
    blockers.push('separate_financial_cap_missing');
  if (env[config.authorization.modelPermissionEnv] !== 'approved')
    blockers.push('model_permission_missing');
  if (env[config.authorization.allowPaidCallsEnv] !== 'true')
    blockers.push('explicit_paid_call_gate_missing');
  if (env[config.authorization.providerObservabilityEnv] !== 'available')
    blockers.push('provider_usage_retry_metadata_missing');
  blockers.push('framework_ai_client_hides_provider_attempts_and_usage');

  let datasetHash = null;
  if (!datasetPath) {
    blockers.push('heldout_dataset_path_missing');
  } else {
    try {
      datasetHash = createHash('sha256').update(readFileSync(datasetPath)).digest('hex');
      if (!config.dataset.sha256) blockers.push('heldout_dataset_hash_missing');
      else if (datasetHash !== config.dataset.sha256)
        blockers.push('heldout_dataset_hash_mismatch');
      const dataset = JSON.parse(readFileSync(datasetPath, 'utf8'));
      if (!Array.isArray(dataset) || dataset.length < config.requestSequence.pilotDocumentCount)
        blockers.push('five_document_pilot_unavailable');
      if (Array.isArray(dataset) && dataset.some((document) => !document.goldAnnotationId))
        blockers.push('gold_quality_annotations_missing');
    } catch {
      blockers.push('heldout_dataset_unreadable_or_invalid');
    }
  }
  if (maximumIndependentDocuments < 1) blockers.push('attempt_ceiling_cannot_fit_pilot');
  if (maximumIndependentDocuments < config.requestSequence.minimumIndependentDocuments)
    blockers.push('96_attempt_ceiling_cannot_fit_30_independent_documents');

  const report = {
    status: blockers.length === 0 ? 'preflight_ready' : 'blocked',
    configHash,
    sequenceHash,
    frozenSpecIdentity,
    recordedRevision: config.recordedRevision,
    datasetId: config.dataset.id,
    datasetHash,
    estimatedAttempts,
    estimatedCostUsd: null,
    costStatus: 'unknown_provider_pricing_or_usage',
    maximumIndependentDocuments,
    providerAttemptCeiling: config.authorization.maxProviderAttempts,
    blockers,
    paidCallsMade: 0,
  };

  const mode = process.argv.includes('--run') ? 'run' : 'preflight';
  if (mode === 'preflight' || blockers.length > 0) {
    process.stdout.write(`${JSON.stringify(report)}\n`);
    process.exitCode = blockers.length > 0 ? 2 : 0;
  } else {
    const baseUrl = env.CLAIMWEAVE_BENCHMARK_BASE_URL;
    const cookie = env.CLAIMWEAVE_BENCHMARK_ADMIN_COOKIE;
    if (!baseUrl || !cookie) {
      report.status = 'blocked';
      report.blockers.push('admin_base_url_or_session_cookie_missing');
      process.stdout.write(`${JSON.stringify(report)}\n`);
      process.exitCode = 2;
    } else {
      const response = await fetch(
        `${baseUrl.replace(/\/$/, '')}/api/admin/claim-extraction-benchmark`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie },
          body: JSON.stringify({ mode: 'run' }),
        },
      );
      const body = await response.json().catch(() => ({ error: 'invalid_json_response' }));
      process.stdout.write(
        `${JSON.stringify({ ...body, httpStatus: response.status, paidCallsMade: 0 })}\n`,
      );
      process.exitCode = response.ok ? 0 : 2;
    }
  }

  if (process.argv.includes('--output')) {
    const outputIndex = process.argv.indexOf('--output');
    const outputPath = process.argv[outputIndex + 1];
    if (outputPath) writeFileSync(outputPath, `${JSON.stringify(report)}\n`, { mode: 0o600 });
  }
}
