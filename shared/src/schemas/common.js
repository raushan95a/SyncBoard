import { z } from 'zod';

/** 24-char hex MongoDB ObjectId, validated before any query runs. */
export const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

/** Optional nanoid the client attaches to a mutation to recognise its echo. */
export const clientMutationId = z.string().min(1).max(64).optional();
