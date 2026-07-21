# ADR-002: File Versioning Model

**Status**: Accepted  
**Date**: 2026-06-09  
**Author**: Aditya Singh  
**Deciders**: Architecture Team  

---

## Context

CloudVault stores user documents (PDFs, Word docs, images, etc.). Users need to:
- Upload files
- Track version history
- Download previous versions
- Recover from accidental overwrites

The question: How do we model file metadata vs. file history?

---

## Decision

**Separate File (logical document) from FileVersion (physical version) as distinct models.**

```
File (Logical Document)
├── name: "Resume.pdf"
├── currentVersionId: <FileVersion._id>
├── status: "ACTIVE"
├── createdBy: <User._id>
├── tags: ["resume", "job-search"]
└── summary: "AI-generated summary"

FileVersion (Physical File)
├── fileId: <File._id>
├── versionNumber: 3
├── storageKey: "s3://bucket/user-123/file-456/v3.pdf"
├── mimeType: "application/pdf"
├── fileSize: 245000 bytes
├── uploadedBy: <User._id>
└── createdAt: "2026-06-09T14:00:00Z"
```

---

## Rationale

### Why Not Merge Into Single Model?

❌ **Single File model with version array**:
```javascript
{
  _id: "file-123",
  name: "Resume.pdf",
  versions: [
    { versionNumber: 1, storageKey: "...", uploadedBy: "...", uploadedAt: "..." },
    { versionNumber: 2, storageKey: "...", uploadedBy: "...", uploadedAt: "..." },
    { versionNumber: 3, storageKey: "...", uploadedBy: "...", uploadedAt: "..." }
  ]
}
```

**Problems**:
- Document grows unbounded (large files = large version array)
- MongoDB document size limit (16MB max)
- All version info loaded with file metadata
- Can't query "all versions of file X" efficiently
- Updating one version requires updating entire File doc

❌ **Separate tables but share storage**:
- Complex cleanup logic
- Storage orphans if File deleted but versions remain

✅ **Separate File and FileVersion models**:
- File is lightweight (just metadata)
- FileVersion is immutable (append-only)
- Efficient pagination of versions
- Clean deletion (delete File → cascade delete FileVersion)
- Storage references only in FileVersion

---

## Implementation

### Models
```typescript
// File: Logical document
interface IFile {
  _id: ObjectId;
  name: string;
  workspaceId: ObjectId;
  folderId: ObjectId;
  currentVersionId: ObjectId; // ← Points to latest FileVersion
  status: FileStatus; // PENDING_UPLOAD | ACTIVE | UPLOAD_FAILED | DELETED
  createdBy: ObjectId;
  tags: string[];
  summary: string; // AI-generated
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null; // Soft delete
}

// FileVersion: Physical file instance
interface IFileVersion {
  _id: ObjectId;
  fileId: ObjectId;
  versionNumber: number;
  storageKey: string; // s3://bucket/path/to/file.pdf
  mimeType: string; // application/pdf
  fileSize: number; // bytes
  uploadedBy: ObjectId;
  createdAt: Date;
}
```

### Upload Flow
```typescript
async function uploadFile(workspaceId, folderId, file, userId) {
  // 1. Create File document (PENDING_UPLOAD)
  const file = await File.create({
    name: file.originalname,
    workspaceId,
    folderId,
    status: FileStatus.PENDING_UPLOAD,
    createdBy: userId,
    tags: [],
  });

  try {
    // 2. Upload to Supabase
    const storageKey = await supabase.upload(
      `${workspaceId}/file-${file._id}/v1.pdf`,
      file.buffer
    );

    // 3. Create FileVersion record
    const version = await FileVersion.create({
      fileId: file._id,
      versionNumber: 1,
      storageKey,
      mimeType: file.mimetype,
      fileSize: file.size,
      uploadedBy: userId,
    });

    // 4. Update File with version reference
    file.currentVersionId = version._id;
    file.status = FileStatus.ACTIVE;
    await file.save();

    return file;
  } catch (error) {
    // Cleanup on failure
    file.status = FileStatus.UPLOAD_FAILED;
    await file.save();
    throw error;
  }
}
```

### Version History Query
```typescript
// Get all versions of a file
const versions = await FileVersion.find({ fileId: file._id })
  .sort({ versionNumber: -1 })
  .limit(10);

// Paginate efficiently
const versions = await FileVersion.find({ fileId: file._id })
  .sort({ versionNumber: -1 })
  .skip((page - 1) * limit)
  .limit(limit);
```

### Restore Previous Version
```typescript
async function restoreVersion(fileId, versionNumber, userId) {
  const file = await File.findById(fileId);
  const version = await FileVersion.findOne({ fileId, versionNumber });

  if (!version) throw new Error('Version not found');

  // Create new version from old version
  const restoredVersion = await FileVersion.create({
    fileId,
    versionNumber: file.currentVersion + 1,
    storageKey: version.storageKey, // Same storage
    mimeType: version.mimeType,
    fileSize: version.fileSize,
    uploadedBy: userId, // Restored by current user
  });

  file.currentVersionId = restoredVersion._id;
  await file.save();

  // Log activity
  await ActivityService.createActivity(
    file.workspaceId,
    userId,
    ActivityAction.FILE_RESTORED,
    { fileId, fromVersion: versionNumber, toVersion: restoredVersion.versionNumber },
    fileId,
    'File'
  );
}
```

---

## Consequences

### Positive ✅
- **Scalability**: No document size limits
- **Efficiency**: Query only the metadata needed
- **Cleanup**: Automatic cascade deletion
- **Audit trail**: Clear record of who uploaded each version
- **Recovery**: Easy to restore previous versions
- **Deduplication**: Versions can reference same storage (restore = no new S3 upload)

### Negative ⚠️
- **Complexity**: Two models instead of one
- **Joins**: Version queries require lookup by fileId
- **Cleanup**: Must delete FileVersion when File deleted

### Mitigation
- **Complexity**: Wrapper service abstracts both models
- **Joins**: Index on (fileId, versionNumber) makes lookups O(log n)
- **Cleanup**: MongoDB cascade delete on File deletion

---

## Indexes
```javascript
// FileVersion: Fast version queries
db.fileversions.createIndex({ fileId: 1, versionNumber: -1 })

// File: Fast file queries per workspace
db.files.createIndex({ workspaceId: 1, folderId: 1, createdAt: -1 })
```

---

## Status: Implemented

✅ Deployed in Phase 2 (Database Layer)
✅ Used in all file upload/download operations
✅ Version history working in Phase 6
✅ Foundation for Phase 11 (Semantic Search over versions)

---

## Future Enhancements
- [ ] Automatic version cleanup (keep last 10 versions)
- [ ] Storage deduplication (if two versions have same content hash)
- [ ] Version compression (keep deltas, not full copies)
- [ ] Timeline view (visual version history)
- [ ] Version comparison (diff tool)
- [ ] Branching versions (experimental edits)

---

## Related ADRs
- [ADR-003: Storage Strategy](ADR-003-storage-strategy.md) – How versions are stored
- [ADR-001: Workspace Isolation](ADR-001-workspace-isolation.md) – Workspace scoping
