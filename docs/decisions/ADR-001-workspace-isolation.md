# ADR-001: Workspace Isolation Strategy

**Status**: Accepted  
**Date**: 2026-06-09  
**Author**: Aditya Singh  
**Deciders**: Architecture Team  

---

## Context

CloudVault is a multi-tenant document collaboration platform. Multiple independent users and teams use the same backend infrastructure. Security and data isolation are critical requirements.

We need to prevent:
- User A accessing User B's files
- Team A seeing Team B's comments
- Accidental data leakage across organizational boundaries

---

## Decision

**Implement workspace-scoped isolation at the request middleware level.**

Every request validates:
1. **User Authentication** (JWT is valid)
2. **Workspace Membership** (user is member of workspace)
3. **Resource Ownership** (resource belongs to user's workspace)
4. **Role Permission** (user's role permits the action)

Pattern:
```typescript
// Middleware enforces scope on every request
GET /workspaces/:workspaceId/files/:fileId/comments?page=1

// Validation sequence:
// 1. Authenticate JWT → User ID
// 2. Check: User in WorkspaceMember with workspaceId
// 3. Check: File.workspaceId === request.workspaceId
// 4. Check: User.role ≥ RequiredRole for action
```

---

## Rationale

### Why Not JWT Claims?
❌ Storing workspace IDs in JWT tokens creates synchronization problems:
- User removed from workspace → Token still valid for 15 min
- Role changed → Old token still has old role
- Cross-workspace escalation possible

✅ Database-backed validation always reflects current state

### Why Not Separate Databases?
❌ Separate databases per workspace:
- Operational overhead (N databases to manage)
- Cross-workspace queries impossible (e.g., find all workspaces for user)
- Cost scales with workspace count
- Deployment complexity

✅ Single database with scoped queries is simpler and cheaper

### Why Not Trust User Input?
❌ Trusting request parameters for isolation:
- User could pass another user's workspaceId
- No guarantee user is in workspace
- Classic authorization bypass

✅ Always validate from authenticated user context, never from params

---

## Implementation

### Middleware Pattern
```typescript
// middleware/rbac.ts
export function requireWorkspaceRole(requiredRole: WorkspaceRole) {
  return asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.user?.id; // From JWT
    const workspaceId = req.params.workspaceId;

    // Check membership
    const membership = await WorkspaceMember.findOne({
      workspaceId: new ObjectId(workspaceId),
      userId: new ObjectId(userId),
    });

    if (!membership) {
      return res.status(403).json({ error: 'Access denied. You are not a member of this workspace.' });
    }

    // Check role
    if (!hasPermission(membership.role, requiredRole)) {
      return res.status(403).json({ error: 'Insufficient permissions.' });
    }

    req.membership = membership;
    next();
  });
}
```

### Query Pattern
```typescript
// Always include workspaceId in queries
const file = await File.findOne({
  _id: new ObjectId(fileId),
  workspaceId: new ObjectId(workspaceId), // ← Enforce scope
  deletedAt: null,
});

if (!file) {
  return res.status(404).json({ error: 'File not found.' });
}
```

### Error Handling
```typescript
// 403 for "not a member" (authentication context issue)
// 404 for "resource not found in workspace" (no information leakage)

// Correct:
if (!membership) return 403; // User not in workspace

// Correct:
if (!file) return 404; // File doesn't exist (or not in this workspace)

// Wrong:
if (!file) return 403; // Leaks that file exists in different workspace
```

---

## Consequences

### Positive ✅
- **Strong isolation**: No possibility of cross-workspace data access
- **Granular control**: Role-based permissions per workspace
- **Audit trail**: All access validates membership (loggable)
- **Future-proof**: Easy to add workspace hierarchies, cross-workspace queries

### Negative ⚠️
- **Overhead**: Every request validates membership (10-20ms database query)
- **Complexity**: Must remember to add workspaceId to all queries
- **Testing**: Must set up test workspaces with memberships

### Mitigation
- **Overhead**: Add index on (workspaceId, userId) for O(1) lookup
- **Complexity**: Create utility functions to enforce pattern
- **Testing**: Setup fixtures that create workspace + membership

---

## Status: Implemented

✅ Deployed in Phase 5 (Workspace System)
✅ Verified in Phase 7 (Collaboration Layer tests)
✅ Used in all 40+ API endpoints
✅ Zero known isolation breaches

---

## Related ADRs
- [ADR-003: Storage Strategy](ADR-003-storage-strategy.md) – File storage isolation
- [ADR-004: AI Opt-In Policy](ADR-004-ai-opt-in-policy.md) – AI feature workspace scoping

---

## Future Enhancements
- [ ] Hierarchical workspaces (sub-teams)
- [ ] Cross-workspace file sharing
- [ ] Organization-level audit logs
- [ ] Workspace quotas (storage, users, API calls)
