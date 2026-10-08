# E2E hackathon demo (manual + Playwright outline)

Seeded dev backend required (`admin/1234`, `master1/3333`, `manager1/2222`, `worker01/1001`).
Live prod (`79.108.160.125:8080`) intentionally rejects demo PINs — run E2E against local seed.

## Script (25 steps condensed)

1. master1 login → `/master` shows shift KPIs (issued/done/overdue/down).
2. Master → New order: area=ДРБ, equipment=ГрАТ-250, priority=critical, desc="Течь масла", due +40min.
3. AI suggest-assignee → top candidate → assign.
4. worker01 login → urgent card visible + notification unread=1.
5. Worker accept → status accepted; start → in_progress.
6. Upload after-photo (compress → progress → id).
7. Complete with `{work_done_text, fault_code_id}` → status ai_review.
8. Poll `GET /ai/work-orders/:id/inspection` ≤30s → verdict+score.
9. master1 → notification AI_READY → open `/master/review/:id` → agree → closed.
10. Create overdue order (due_at past) → overdue chip + board filter.
11. Poor AI order → rework with comment → worker sees rework status.
12. manager1 → `/manager`: dashboard KPIs, trend, insights (repeat/post_ppr/shift/material/unplanned_growth), ratings.
13. Admin → dict CRUD areas/equipment, audit visible.
14. Offline: airplane mode → accept queued (same Idempotency-Key) → online → replayed, no duplicates.
15. WS: two browsers (master+worker) — accept on worker instantly moves card on master board.

## Playwright sketch

```ts
// login As(page, 'master1', '3333'); createOrder({...}); expect(board).toContain('Течь масла');
// loginAs(page, 'worker01', '1001'); accept(); start(); uploadPhoto('after'); complete({...});
// await expect.poll(inspectionVerdict).not.toBeNull(); masterReview('agree_ai');
// managerDashboard(); expect(kpis.total).toBeGreaterThan(0);
```
