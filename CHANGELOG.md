# Changelog

## [1.0.0] - 2025-11-22

### Added
-   **file-direct-download**: New node to download files directly from the filesystem via HTTP GET. Supports `basePath` configuration for security.
-   **stream-upload**: Added support for capturing additional multipart fields. Fields are available in `msg.fields`. **Note:** Fields must be sent *before* the file in the request body.
-   **stream-upload**: Added support for raw binary uploads (e.g., `application/octet-stream`). Filename can be provided via `Content-Disposition` or `x-filename` headers.

### Fixed
-   **pg-direct-download**: Fixed a crash caused by a race condition when the cleanup function was called multiple times (e.g., on stream end and request close). Added re-entry guard and null checks.
