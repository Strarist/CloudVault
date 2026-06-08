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
### Database Design (MongoDB)
- **User**: { _id, email, passwordHash, name, avatar, createdAt, updatedAt }
- **Workspace**: { _id, name, description, ownerId, type, aiEnabled, createdAt, updatedAt, deletedAt }
- **WorkspaceMember**: { _id, workspaceId, userId, role, joinedAt }
- **Folder**: { _id, name, workspaceId, parentFolderId, createdBy, createdAt, updatedAt, deletedAt }
- **File**: { _id, name, workspaceId, folderId, currentVersionId, createdBy, status, summary, tags, aiStatus, createdAt, updatedAt, deletedAt }
- **FileVersion**: { _id, fileId, versionNumber, storageKey, mimeType, fileSize, uploadedBy, createdAt }
- **Comment**: { _id, fileId, authorId, content, createdAt, mentions[] }
- **Notification**: { _id, userId, type, payload, isRead, createdAt }
- **ActivityLog**: { _id, actorId, action, targetId, targetType, metadata, timestamp }
- **Indexes**:
  - User: unique email
  - WorkspaceMember: compound unique (workspaceId, userId)
  - Folder: workspaceId
  - File: workspaceId, folderId, createdBy
  - Notification: userId, isRead
  - ActivityLog: workspaceId, timestamp

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

### Workspace Ownership Rules
- A workspace owner **cannot** leave the workspace.
- A workspace owner **cannot** delete their account.
- **Ownership Transfer Flow**:
  1. Owner requests ownership transfer to another member.
  2. New owner is assigned the `OWNER` role.
  3. Old owner is demoted to a regular role (e.g., `ADMIN` or `EDITOR`).
  4. Only after this transfer is complete can the old owner leave the workspace or delete their account.

### Soft Delete Policy
- Soft delete applies to **Workspace**, **Folder**, and **File** models.
- These models include a `deletedAt` field (Date type).
- When a resource is deleted, `deletedAt` is set to the current timestamp.
- For the MVP, all queries for active resources must exclude records where `deletedAt` is present (i.e. `deletedAt: null` or `{ $exists: false }`).
- This facilitates future recovery/restoration features.

### Notification Types
The application supports the following notification types:
- `COMMENT`: Triggered when a comment is added to a file.
- `MENTION`: Triggered when a user is @mentioned in a comment.
- `INVITATION`: Triggered when a user is invited to a workspace.
- `ROLE_CHANGED`: Triggered when a user's role in a workspace is changed.
- `FILE_SHARED`: Triggered when a file is explicitly shared or access is updated.

### Upload Failure Recovery Architecture
- **Upload Flow**:
  1. Create database `File` record with `status = "PENDING_UPLOAD"`.
  2. Upload the physical file to Supabase Storage.
  3. Create database `FileVersion` record referencing the file metadata.
  4. Update database `File` record setting `status = "ACTIVE"` and linking `currentVersionId`.
- **Failure Handling**:
  - *Storage Failure*: If upload to Supabase fails, update the database `File` record `status = "UPLOAD_FAILED"`. Do not create a `FileVersion` record.
  - *Database Failure after Upload*: If updating `FileVersion` or `File` fails after a successful upload to Supabase, delete the uploaded object from Supabase Storage to avoid orphaned files in cloud storage.

### Security Rules
- **Storage Security**:
  - All Supabase storage buckets must be configured as **Private**.
  - Public file URLs are **never** permitted.
- **Download Flow**:
  1. User requests file download.
  2. Perform authentication and workspace permission checks.
  3. Generate a signed Supabase URL with a short expiry (recommended: **60 seconds**).
  4. Return the signed URL to the user.

### Workspace Isolation Rule
- Every protected API and resource query must validate that the user has permission for that specific workspace.
- **Invalid Pattern**: `File.findById(fileId)` (this allows ID enumeration across workspaces).
- **Correct Pattern**: `File.findOne({ _id: fileId, workspaceId: workspaceId })`

### AI Architecture (Future Phase 8+)
- Supported fields in File schema: `summary` (string), `tags` (array of strings), `aiStatus` (enum: `NOT_STARTED`, `PROCESSING`, `READY`, `FAILED`).
- **Processing Pipeline**:
  `Upload` -> `Queue Job` -> `Extract Text` -> `Generate Summary` -> `Generate Tags` -> `Store Metadata`

### Service Layer Validation & Design Invariants
- **Workspace Owner Invariant**: Every workspace must always contain **exactly one** member with the role `OWNER`. This rule is enforced in the Application Service Layer, not at the database level.
- **Folder Naming Rules**: Folder names must be unique within the same parent folder (and same workspace) to prevent user confusion. This uniqueness is validated in the Folder Service.
- **File Naming Rules**: CloudVault allows duplicate file names within the same folder (similar to Google Drive). Files are uniquely identified by their database `_id` and storage keys, permitting multiple separate files named `Resume.pdf` to coexist.

### Schema Structure & Metadata Specifications
- **ActivityLog metadata field expected structures**:
  - *Role Change*: `{ "oldRole": "EDITOR", "newRole": "ADMIN" }`
  - *File Upload*: `{ "fileName": "resume.pdf", "fileSize": 51200 }`
  - *Member Invite*: `{ "inviteeEmail": "user@domain.com", "role": "EDITOR" }`
- **Notification payload field expected structures**:
  - *Comment Notification*: `{ "fileId": "ObjectIdString", "commentId": "ObjectIdString", "actorId": "ObjectIdString" }`
  - *Workspace Invitation*: `{ "workspaceId": "ObjectIdString", "inviterId": "ObjectIdString" }`
  - *Role Change*: `{ "workspaceId": "ObjectIdString", "oldRole": "EDITOR", "newRole": "ADMIN" }`

---

> **Note**: All architectural decisions must be approved before any code is written.
