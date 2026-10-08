import { z } from 'zod';

// Exact backend enums (FastAPI migrations/001_initial.sql + routers).
export const RoleSchema = z.enum(['worker', 'master', 'manager', 'admin']);
export type Role = z.infer<typeof RoleSchema>;

export const WorkOrderStatusSchema = z.enum([
  'issued', 'accepted', 'queued', 'rejected', 'in_progress', 'paused',
  'rework', 'done', 'ai_review', 'closed', 'cancelled',
]);
export type WorkOrderStatus = z.infer<typeof WorkOrderStatusSchema>;

export const PrioritySchema = z.enum(['critical', 'high', 'normal', 'planned']);
export type Priority = z.infer<typeof PrioritySchema>;

export const UserSchema = z.object({
  id: z.string(),
  // /me собирает профиль из JWT-контекста, где логина нет → бэкенд отдаёт login: null.
  // Нормализуем в '' в api/auth.ts; на сервер всегда уходят настоящие значения.
  login: z.string().nullable().optional(),
  full_name: z.string(),
  role: RoleSchema,
  area_ids: z.array(z.string()).default([]),
  crew_id: z.string().nullable().optional(),
  lang: z.string().optional(),
  specialty: z.string().nullable().optional(),
  current_status: z.string().nullable().optional(),
});
export type User = z.infer<typeof UserSchema>;

export const WorkOrderSchema = z.object({
  id: z.string(),
  number: z.number().nullable().optional(),
  kind: z.string().optional(),
  status: WorkOrderStatusSchema,
  priority: PrioritySchema,
  description: z.string(),
  area_id: z.string().nullable().optional(),
  area_name: z.string().nullable().optional(),
  equipment_id: z.string().nullable().optional(),
  equipment_name: z.string().nullable().optional(),
  assignee_id: z.string().nullable().optional(),
  assignee_name: z.string().nullable().optional(),
  crew_id: z.string().nullable().optional(),
  due_at: z.string().nullable().optional(),
  norm_minutes: z.number().nullable().optional(),
  equipment_stopped: z.boolean().optional(),
  is_overdue: z.boolean().optional(),
  allowed_actions: z.array(z.string()).default([]),
  photo_count: z.number().optional(),
  created_at: z.string().optional(),
}).passthrough();
export type WorkOrder = z.infer<typeof WorkOrderSchema>;

export const PaginatedSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: z.array(item), next_cursor: z.string().nullable().optional() });

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    translation_key: z.string().optional(),
    details: z.unknown().optional(),
  }),
  request_id: z.string().optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const AIReviewSchema = z.object({
  verdict: z.enum(['accepted', 'accepted_with_remarks', 'needs_rework', 'needs_master_review']).nullable().optional(),
  score: z.number().nullable().optional(),
  confidence: z.number().nullable().optional(),
  explanation: z.string().nullable().optional(),
  strengths: z.array(z.string()).nullable().optional(),
  improvements: z.array(z.string()).nullable().optional(),
  checks: z.unknown().nullable().optional(),
}).passthrough();
export type AIReview = z.infer<typeof AIReviewSchema>;

export const NotificationSchema = z.object({
  id: z.string(),
  type: z.string(),
  title: z.string().optional(),
  body: z.string().optional(),
  is_read: z.boolean().optional(),
  created_at: z.string().optional(),
  data: z.unknown().optional(),
}).passthrough();
export type AppNotification = z.infer<typeof NotificationSchema>;
