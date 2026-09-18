import { describe, expect, it } from 'vitest';
import {
  ProjectCreate,
  ProjectIntakeResponse,
  ProjectList,
  ProjectProcessRequest,
  ProjectWorkspaceStatus,
} from '@/lib/contracts/projects';
import { demoProject } from '@/lib/demo-project';

describe('ProjectCreate', () => {
  it('accepts one http or https URL', () => {
    expect(ProjectCreate.safeParse({ url: 'https://example.com/article' }).success).toBe(true);
  });

  it('accepts trimmed text while preserving internal whitespace', () => {
    const result = ProjectCreate.safeParse({
      text: '  This source has enough readable text to extract a supported claim.  ',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.text).toBe(
        'This source has enough readable text to extract a supported claim.',
      );
    }
  });

  it('rejects missing, multiple, unsupported, short, and oversized input', () => {
    expect(ProjectCreate.safeParse({}).success).toBe(false);
    expect(
      ProjectCreate.safeParse({ url: 'https://one.example https://two.example' }).success,
    ).toBe(false);
    expect(ProjectCreate.safeParse({ url: 'ftp://example.com/file' }).success).toBe(false);
    expect(
      ProjectCreate.safeParse({ url: 'https://example.com', other: 'https://two.example' }).success,
    ).toBe(false);
    expect(
      ProjectCreate.safeParse({
        url: 'https://example.com',
        text: 'This source has enough readable text to extract a supported claim.',
      }).success,
    ).toBe(false);
    expect(ProjectCreate.safeParse({ text: 'Too short.' }).success).toBe(false);
    expect(ProjectCreate.safeParse({ text: 'x'.repeat(80_001) }).success).toBe(false);
  });

  it('keeps the guided demo seed inside the same project contract', () => {
    expect(ProjectCreate.safeParse({ url: demoProject.url }).success).toBe(true);
    expect(demoProject.entryPoint).toBe('demo');
    expect(demoProject.url).toBe('https://www.rfc-editor.org/rfc/rfc9110.txt');
  });
});

describe('ProjectList', () => {
  const validItem = {
    id: 'project-1',
    sourceUrl: 'https://example.com/article',
    sourceType: 'url',
    createdAt: '2026-09-17T12:00:00.000Z',
    status: 'complete',
  };

  it('accepts a URL, ISO creation time, and persisted status', () => {
    expect(ProjectList.safeParse({ items: [validItem] }).success).toBe(true);
  });

  it('accepts a text project without a source URL', () => {
    expect(
      ProjectList.safeParse({ items: [{ ...validItem, sourceType: 'text', sourceUrl: null }] })
        .success,
    ).toBe(true);
  });

  it('rejects missing fields, invalid dates, invalid URLs, and empty statuses', () => {
    expect(ProjectList.safeParse({ items: [{ ...validItem, sourceUrl: '' }] }).success).toBe(false);
    expect(ProjectList.safeParse({ items: [{ ...validItem, sourceType: 'text' }] }).success).toBe(
      false,
    );
    expect(
      ProjectList.safeParse({ items: [{ ...validItem, createdAt: 'yesterday' }] }).success,
    ).toBe(false);
    expect(ProjectList.safeParse({ items: [{ ...validItem, status: ' ' }] }).success).toBe(false);
    expect(ProjectList.safeParse({ items: [{ id: 'project-1' }] }).success).toBe(false);
  });
});

describe('project processing contracts', () => {
  it('accepts the queued intake response and retry request', () => {
    expect(
      ProjectIntakeResponse.safeParse({
        projectId: 'project-1',
        sourceType: 'text',
        status: 'processing',
      }).success,
    ).toBe(true);
    expect(ProjectProcessRequest.parse({})).toEqual({ retry: false });
  });

  it('requires failure metadata only for failed workspace states', () => {
    const base = {
      projectId: 'project-1',
      sourceType: 'url' as const,
      sourceUrl: 'https://example.com/article',
      createdAt: '2026-09-17T12:00:00.000Z',
    };
    expect(
      ProjectWorkspaceStatus.safeParse({ ...base, status: 'processing', error: null }).success,
    ).toBe(true);
    expect(
      ProjectWorkspaceStatus.safeParse({
        ...base,
        status: 'failed',
        error: 'The source could not be read.',
      }).success,
    ).toBe(true);
    expect(
      ProjectWorkspaceStatus.safeParse({ ...base, status: 'complete', error: 'still working' })
        .success,
    ).toBe(false);
  });
});
