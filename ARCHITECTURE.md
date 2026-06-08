# CloudVault Architecture Documentation

## Phase 0 – Architecture Freeze

### Folder Structure (proposed)
```
CloudVault/
├─ src/                       # Application source code
│   ├─ config/                # Configuration (environment, DB, etc.)
│   ├─ controllers/           # Request handlers / business logic
│   ├─ models/                # Mongoose schemas & data models
│   ├─ middleware/            # Express middleware (auth, error, logging)
│   ├─ routes/                # API route definitions
│   ├─ services/              # Service layer (e.g., storage, AI, search)
│   └─ utils/                 # Helper utilities
├─ public/                    # Static assets (images, fonts)
├─ tests/                     # Test suites (unit, integration)
├─ docs/                      # Documentation (API specs, design docs)
├─ .env.example               # Example env file
├─ package.json               # NPM scripts & dependencies
├─ tsconfig.json              # TypeScript configuration
├─ jest.config.js             # Jest configuration
└─ README.md                  # Project overview
```

### Database Design (MongoDB)
- **User**: { email, passwordHash, name, role, createdAt, updatedAt }
- **Workspace**: { name, ownerId, members[], createdAt }
- **WorkspaceMember**: { workspaceId, userId, role }
- **Folder**: { name, workspaceId, parentFolderId, createdAt }
- **File**: { name, folderId, workspaceId, mimeType, size, storageKey, createdBy, createdAt }
- **FileVersion**: { fileId, versionNumber, storageKey, createdAt }
- **Comment**: { fileId, authorId, content, createdAt, mentions[] }
- **Notification**: { userId, type, payload, read: false, createdAt }
- **ActivityLog**: { actorId, action, targetId, targetType, metadata, timestamp }

### RBAC Matrix (Roles & Permissions)
| Role            | Permissions                                                                 |
|-----------------|-----------------------------------------------------------------------------|
| **Admin**       | Full access to all resources, manage users, workspaces, roles, and storage |
| **WorkspaceOwner** | Create/Update/Delete workspace, invite members, manage files within workspace |
| **Editor**      | Read/Write files, add comments, view activity logs                         |
| **Viewer**      | Read‑only access to files and comments                                      |

### API Specification (high‑level)
- **Auth**: `/auth/register`, `/auth/login`, `/auth/logout`, `/auth/me`
- **Workspaces**: `/workspaces`, `/workspaces/:id`, `/workspaces/:id/invite`
- **Files**: `/files/upload`, `/files/:id`, `/files/:id/download`, `/files/:id/delete`
- **Comments**: `/comments`, `/comments/:id`
- **Notifications**: `/notifications`, `/notifications/:id/read`
- **Activity**: `/activity` (read‑only)

### Architecture Documentation
- **Tech Stack**: Node.js (v20), Express, TypeScript, MongoDB, Supabase Storage (later), Next.js (frontend), Tailwind CSS, Zustand, Axios.
- **Design Principles**:
  - *Modular*: Separate concerns into controllers, services, and middleware.
  - *Scalable*: Use async/await, non‑blocking I/O, and a job queue for AI tasks.
  - *Secure*: Helmet, CORS, JWT, httpOnly cookies, input validation.
  - *Testable*: Unit tests with Jest, integration tests with Supertest.
- **Deployment Targets**: Backend on Render/Railway, Frontend on Vercel, DB on MongoDB Atlas, Storage on Supabase.

---

> **Note**: All architectural decisions must be approved before any code is written.
