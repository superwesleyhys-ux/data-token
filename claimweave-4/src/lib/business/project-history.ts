// @polsia:user-owned — pure Claimweave processing-history comparison helpers.
import {
  type EvidenceStateTransition,
  type ProjectHistoryChange,
  ProjectHistoryComparison,
  type ProjectHistoryDiffItem,
  ProjectHistorySnapshot,
  type ProjectHistoryVersion,
} from '@/lib/contracts/project-history';

export function documentRevisionKey(kind: string, documentId: string) {
  return `${kind}:${documentId}`;
}

export function claimRevisionKey(
  kind: string,
  documentId: string,
  sourceStart: number,
  sourceEnd: number,
) {
  return `${kind}:${documentId}:${sourceStart}:${sourceEnd}`;
}

export function evidenceRevisionKey(
  claimId: string,
  evidenceDocumentId: string | null,
  passageId: string | null,
  role: string | null,
) {
  return `${claimId}:${evidenceDocumentId ?? 'none'}:${passageId ?? 'none'}:${role ?? 'result'}`;
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function semanticallyEqual(
  left: unknown,
  right: unknown,
  ignoredKeys: ReadonlySet<string> = new Set(),
) {
  const comparable = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(comparable);
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value)
          .filter(([key]) => !ignoredKeys.has(key))
          .map(([key, child]) => [key, comparable(child)]),
      );
    }
    return value;
  };
  return stableJson(comparable(left)) === stableJson(comparable(right));
}

type PersistedSnapshot = Omit<ProjectHistorySnapshot, 'createdAt' | 'citationLinks'> & {
  createdAt: Date | string;
  citationLinks: unknown;
};

export function snapshotKey(snapshot: Pick<ProjectHistorySnapshot, 'sourceStart' | 'sourceEnd'>) {
  return `${snapshot.sourceStart}:${snapshot.sourceEnd}`;
}

export function serializeCitationLinks(value: unknown) {
  if (!Array.isArray(value) || value.some((link) => typeof link !== 'string')) {
    throw new Error('Snapshot citation links are not serializable.');
  }
  return value.slice();
}

export function serializeSnapshot(snapshot: PersistedSnapshot): ProjectHistorySnapshot {
  const createdAt =
    snapshot.createdAt instanceof Date
      ? snapshot.createdAt.toISOString()
      : new Date(snapshot.createdAt).toISOString();
  return ProjectHistorySnapshot.parse({
    ...snapshot,
    createdAt,
    citationLinks: serializeCitationLinks(snapshot.citationLinks),
  });
}

function sortSnapshots(snapshots: ProjectHistorySnapshot[]) {
  return snapshots.slice().sort((left, right) => {
    const startDelta = left.sourceStart - right.sourceStart;
    if (startDelta !== 0) return startDelta;
    const endDelta = left.sourceEnd - right.sourceEnd;
    if (endDelta !== 0) return endDelta;
    return left.id.localeCompare(right.id);
  });
}

function snapshotValuesEqual(left: ProjectHistorySnapshot, right: ProjectHistorySnapshot) {
  return (
    left.text === right.text &&
    left.sourceQuote === right.sourceQuote &&
    left.sourceUrl === right.sourceUrl &&
    JSON.stringify(left.citationLinks) === JSON.stringify(right.citationLinks)
  );
}

export function compareSnapshots(
  previousSnapshots: ProjectHistorySnapshot[],
  currentSnapshots: ProjectHistorySnapshot[],
) {
  const previousByKey = new Map(
    sortSnapshots(previousSnapshots).map((snapshot) => [snapshotKey(snapshot), snapshot]),
  );
  const currentByKey = new Map(
    sortSnapshots(currentSnapshots).map((snapshot) => [snapshotKey(snapshot), snapshot]),
  );
  const keys = new Set([...previousByKey.keys(), ...currentByKey.keys()]);
  const changes: ProjectHistoryChange[] = [];

  for (const key of keys) {
    const previous = previousByKey.get(key) ?? null;
    const current = currentByKey.get(key) ?? null;
    if (previous && current && snapshotValuesEqual(previous, current)) continue;
    const reference = current ?? previous;
    if (!reference) continue;
    changes.push({
      key,
      sourceStart: reference.sourceStart,
      sourceEnd: reference.sourceEnd,
      previous,
      current,
    });
  }

  changes.sort((left, right) => {
    const startDelta = left.sourceStart - right.sourceStart;
    if (startDelta !== 0) return startDelta;
    return left.sourceEnd - right.sourceEnd;
  });

  return {
    added: changes.filter((change) => change.previous === null),
    removed: changes.filter((change) => change.current === null),
    changed: changes.filter((change) => change.previous !== null && change.current !== null),
  };
}

export function compareEvidenceState(previous: string, current: string): EvidenceStateTransition {
  return { previous, current, changed: previous !== current };
}

export function compareRuns(previous: ProjectHistoryVersion, current: ProjectHistoryVersion) {
  const snapshotDiff = compareSnapshots(previous.snapshots, current.snapshots);
  return {
    previousVersion: previous.version,
    currentVersion: current.version,
    ...snapshotDiff,
    evidenceState: compareEvidenceState(previous.evidenceState, current.evidenceState),
  } satisfies Omit<ProjectHistoryComparison, 'added' | 'removed' | 'changed'> & {
    added: ProjectHistoryChange[];
    removed: ProjectHistoryChange[];
    changed: ProjectHistoryChange[];
  };
}

function projectClaimsHref(projectId: string) {
  return `/projects/${encodeURIComponent(projectId)}#claims`;
}

function projectClaimHref(projectId: string, claimId: string) {
  return `/projects/${encodeURIComponent(projectId)}#claim-${encodeURIComponent(claimId)}`;
}

function addLinks(
  changes: ProjectHistoryChange[],
  projectId: string,
  claimIdByKey: ReadonlyMap<string, string>,
): ProjectHistoryDiffItem[] {
  return changes.map((change) => {
    const currentClaimId = claimIdByKey.get(change.key) ?? null;
    return {
      ...change,
      currentClaimId,
      claimsHref: projectClaimsHref(projectId),
      currentClaimHref:
        currentClaimId === null ? null : projectClaimHref(projectId, currentClaimId),
    };
  });
}

export function addComparisonLinks(
  comparison: ReturnType<typeof compareRuns>,
  projectId: string,
  claimIdByKey: ReadonlyMap<string, string>,
): ProjectHistoryComparison {
  return ProjectHistoryComparison.parse({
    ...comparison,
    added: addLinks(comparison.added, projectId, claimIdByKey),
    removed: addLinks(comparison.removed, projectId, claimIdByKey),
    changed: addLinks(comparison.changed, projectId, claimIdByKey),
  });
}
