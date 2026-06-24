## 1.3.0 — 2026-06-22

### Added
- `LazstreamViewer.getCameraState()` — returns current camera position and
  look-at target in world coordinates. Returns `null` before seeds are loaded.
- `LazstreamViewer.applyCameraState(state)` — restores camera from a saved
  `CameraState`. Must be called after seeds are loaded (see JSDoc timing note).
- `CameraState` type is now re-exported from `@lazstream/viewer` so consumers
  do not need to import it from `@lazstream/core` directly.

### Fixed
- External consumers (e.g. map-synced split viewers) had no supported path to
  control the camera. This release closes that gap.
