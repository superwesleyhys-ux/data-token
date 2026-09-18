import { describe, expect, it } from 'vitest';
import { addComparisonLinks, compareRuns, compareSnapshots } from '@/lib/business/project-history';
import type {
  ProjectHistorySnapshot,
  ProjectHistoryVersion,
} from '@/lib/contracts/project-history';

const base = {
  sourceUrl: null,
  citationLinks: [],
  createdAt: '2026-09-17T12:00:00.000Z',
};

function snapshot(id: string, start: number, end: number, text: string): ProjectHistorySnapshot {
  return { ...base, id, sourceStart: start, sourceEnd: end, text, sourceQuote: text };
}

function run(
  version: number,
  evidenceState: string,
  snapshots: ProjectHistorySnapshot[],
): ProjectHistoryVersion {
  return {
    id: `run-${version}`,
    version,
    documentId: 'document-1',
    documentKind: 'primary',
    createdAt: `2026-09-1${version}T12:00:00.000Z`,
    evidenceState,
    processingRoute: 'model-fallback',
    claimCount: snapshots.length,
    snapshots,
  };
}

describe('project history comparison', () => {
  it('matches source spans and separates added, removed, changed, and unchanged claims', () => {
    const previous = [
      snapshot('unchanged-before', 0, 10, 'Unchanged'),
      snapshot('changed-before', 20, 30, 'Before text'),
      snapshot('removed', 40, 50, 'Removed claim'),
    ];
    const current = [
      snapshot('changed-after', 20, 30, 'After text'),
      snapshot('added', 60, 70, 'Added claim'),
      snapshot('unchanged-after', 0, 10, 'Unchanged'),
    ];
    const diff = compareSnapshots(previous, current);
    expect(diff.added.map((item) => item.key)).toEqual(['60:70']);
    expect(diff.removed.map((item) => item.key)).toEqual(['40:50']);
    expect(diff.changed.map((item) => item.key)).toEqual(['20:30']);
    expect(diff.changed[0]).toMatchObject({
      previous: expect.objectContaining({ text: 'Before text' }),
      current: expect.objectContaining({ text: 'After text' }),
    });
  });

  it('compares citation and quote changes without treating input order as a change', () => {
    const before = snapshot('claim', 10, 20, 'Same text');
    const after = {
      ...before,
      id: 'claim-new',
      sourceQuote: 'Updated quote',
      citationLinks: ['https://example.com/source'],
    };
    expect(compareSnapshots([before], [after]).changed).toHaveLength(1);
    expect(
      compareSnapshots(
        [before, snapshot('other', 0, 5, 'Other')],
        [snapshot('other-new', 0, 5, 'Other'), after],
      ).changed,
    ).toHaveLength(1);
  });

  it('reports a moved source range as removed plus added', () => {
    const diff = compareSnapshots(
      [snapshot('before', 0, 10, 'Moved claim')],
      [snapshot('after', 2, 12, 'Moved claim')],
    );
    expect(diff.removed.map((item) => item.key)).toEqual(['0:10']);
    expect(diff.added.map((item) => item.key)).toEqual(['2:12']);
    expect(diff.changed).toHaveLength(0);
  });

  it('compares run evidence states and resolves only current claim anchors', () => {
    const previous = run(1, 'complete', [snapshot('old', 0, 5, 'Old')]);
    const current = run(2, 'needs-review', [
      snapshot('new', 0, 5, 'New'),
      snapshot('added', 8, 14, 'Added'),
    ]);
    const comparison = addComparisonLinks(
      compareRuns(previous, current),
      'project-1',
      new Map([['0:5', 'claim-current']]),
    );
    expect(comparison.evidenceState).toEqual({
      previous: 'complete',
      current: 'needs-review',
      changed: true,
    });
    expect(comparison.changed[0]).toMatchObject({
      currentClaimId: 'claim-current',
      currentClaimHref: '/projects/project-1#claim-claim-current',
    });
    expect(comparison.added[0]).toMatchObject({ currentClaimId: null, currentClaimHref: null });
  });

  it('returns no changes for one run and zero snapshots', () => {
    const only = run(1, 'complete', []);
    expect(compareSnapshots([], [])).toEqual({ added: [], removed: [], changed: [] });
    expect(compareRuns(only, only).evidenceState.changed).toBe(false);
  });
});
