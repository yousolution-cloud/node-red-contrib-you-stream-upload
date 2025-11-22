# Changelog

## [1.0.0-dev-2] - 2025-11-22

### Added
-   **file-direct-download**: New node to download files directly from the filesystem via HTTP GET. Supports `basePath` configuration for security.

### Fixed
-   **pg-direct-download**: Fixed a crash caused by a race condition when the cleanup function was called multiple times (e.g., on stream end and request close). Added re-entry guard and null checks.
