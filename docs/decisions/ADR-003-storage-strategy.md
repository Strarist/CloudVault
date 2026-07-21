# ADR-003: Storage Strategy (Metadata / Binary Separation)

## Context & Problem Statement

CloudVault requires a scalable, secure, and cost-effective file storage mechanism. Storing binary files (such as PDFs, large images, and document files) directly inside a database (like MongoDB using GridFS or BSON blobs) causes severe performance bottlenecks, database bloat, slow and expensive database backups, and high memory usage during read operations.

We need a design that separates the metadata queries from physical binary file storage.

## Decision

We will implement a hybrid storage architecture:
1. **Metadata Store**: MongoDB will store all document metadata, folder structures, version histories, permissions, audit trails, and collaboration logs.
2. **Binary Store**: Supabase Storage (backed by AWS S3 infrastructure) will store all raw binary payloads.
3. **Linkage**: The database stores reference paths (storage keys) referencing the exact object key in Supabase Storage.

Every file version upload is stored in a private Supabase bucket and served to authorized users via short-lived, pre-signed download URLs (60-second expiration).

## Rationale

* **Avoid Database Bloat**: By storing binaries outside MongoDB, the database files remain extremely small, ensuring rapid backups and allowing the entire database working set to fit comfortably in RAM for fast indexing.
* **Cost Efficiency**: Cloud object storage (Supabase/S3) is significantly cheaper per gigabyte than database storage (MongoDB Atlas).
* **Better Performance**: Serving files directly from object storage via signed URLs bypasses the Node.js application thread, avoiding server CPU/memory bottlenecks during large file transfers.
* **Separation of Concerns**: The database handles structural relationships, query operations, permissions, and indexing, while Supabase specializes in streaming and serving objects.

## Consequences

### Benefits
* Sub-millisecond database queries.
* Cost-effective storage scaling (handles terabytes of data with minimal MongoDB costs).
* Secure file distribution via pre-signed URLs.
* Simplified database backup and recovery.

### Trade-offs / Mitigations
* **Ref-Integrity Risk**: A file could be deleted from MongoDB but remain orphaned in Supabase (or vice versa).
  * *Mitigation*: We track file deletion states through soft-deletes and queue hard deletions through transaction-like rollbacks and cron-based lifecycle policies (TD-023).
* **Network Latency**: Uploading a file requires contacting both the application server and the Supabase Storage API.
  * *Mitigation*: The backend handles file streaming efficiently using Multer and passes data directly to Supabase via its SDK, minimizing local disk IO.
