// @polsia:user-owned — typed contracts for Claimweave project creation and workspace reads.
import { z } from 'zod';

const httpUrl = z
  .string()
  .trim()
  .min(1, 'A source URL is required.')
  .max(2048, 'That URL is too long.')
  .url('Enter a valid URL.')
  .refine((value) => !/\s/.test(value), 'Submit exactly one URL.')
  .refine((value) => {
    try {
      return /^https?:$/i.test(new URL(value).protocol);
    } catch {
      return false;
    }
  }, 'Use an http or https URL.');

const pastedText = z
  .string()
  .trim()
  .min(40, 'Paste at least 40 characters of source text.')
  .max(80_000, 'Paste no more than 80,000 characters of source text.');

export const ProjectCreate = z
  .object({
    url: httpUrl.optional(),
    text: pastedText.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const hasUrl = value.url !== undefined;
    const hasText = value.text !== undefined;
    if (!hasUrl && !hasText) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['url'],
        message: 'Submit a URL or pasted text.',
      });
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['text'],
        message: 'Submit a URL or pasted text.',
      });
    }
    if (hasUrl && hasText) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['url'],
        message: 'Submit exactly one source.',
      });
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['text'],
        message: 'Submit exactly one source.',
      });
    }
  });

export type ProjectCreate = z.infer<typeof ProjectCreate>;

export const ProjectListItem = z
  .object({
    id: z.string().min(1),
    sourceType: z.enum(['url', 'text']),
    sourceUrl: z.string().trim().min(1).url().nullable(),
    createdAt: z.string().datetime(),
    status: z.string().trim().min(1),
  })
  .superRefine((value, context) => {
    if (value.sourceType === 'url' && value.sourceUrl === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sourceUrl'],
        message: 'URL sources need a source URL.',
      });
    }
    if (value.sourceType === 'text' && value.sourceUrl !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sourceUrl'],
        message: 'Text sources do not have a source URL.',
      });
    }
  });

export const ProjectList = z.object({ items: z.array(ProjectListItem) });

export type ProjectListItem = z.infer<typeof ProjectListItem>;
export type ProjectList = z.infer<typeof ProjectList>;

export const ProjectStatus = z.enum(['processing', 'complete', 'failed']);

export const ProjectIntakeResponse = z.object({
  projectId: z.string().min(1),
  sourceType: z.enum(['url', 'text']),
  status: z.literal('processing'),
});

export const ProjectWorkspaceStatus = z
  .object({
    projectId: z.string().min(1),
    sourceType: z.enum(['url', 'text']),
    sourceUrl: z.string().trim().min(1).url().nullable(),
    createdAt: z.string().datetime(),
    status: ProjectStatus,
    error: z.string().trim().min(1).nullable(),
  })
  .superRefine((value, context) => {
    if (value.sourceType === 'url' && value.sourceUrl === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sourceUrl'],
        message: 'URL sources need a source URL.',
      });
    }
    if (value.sourceType === 'text' && value.sourceUrl !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sourceUrl'],
        message: 'Text sources do not have a source URL.',
      });
    }
    if (value.status !== 'failed' && value.error !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['error'],
        message: 'Only failed projects may expose an error.',
      });
    }
  });

export const ProjectProcessRequest = z.object({
  retry: z.boolean().optional().default(false),
});

export type ProjectStatus = z.infer<typeof ProjectStatus>;
export type ProjectIntakeResponse = z.infer<typeof ProjectIntakeResponse>;
export type ProjectWorkspaceStatus = z.infer<typeof ProjectWorkspaceStatus>;
