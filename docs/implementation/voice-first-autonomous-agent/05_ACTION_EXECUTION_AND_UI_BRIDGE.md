# Action Execution & UI Bridge Specification

## 1. Real Application Bridge Principle
The assistant's actions must never be "clicking theater" or simulated DOM text injection. All operations must:
1. Trigger real route navigation through the application's React Router.
2. Synchronize with real controlled React component state.
3. Call real authorized Laravel API endpoints.
4. Verify backend database persistence before reporting completion.

## 2. Semantic Anchor Registry
To enable the mascot to visibly travel to relevant parts of the portal, pages expose stable semantic anchors:

| Target Domain | Route | Semantic Anchor ID | Action Highlight Target |
|---|---|---|---|
| **Database Connections** | `/connections` | `connection-form-anchor` | Connection form card & host/port inputs |
| **Schema Explorer** | `/explorer` | `schema-explorer-anchor` | Discovered tables card & relationship viewer |
| **Automation Builder** | `/automations/new` | `automation-builder-anchor` | Target table select & schedule configuration |
| **Approvals Review** | `/approvals` | `approvals-list-anchor` | Pending content version preview card |
| **Knowledge Base** | `/knowledge` | `knowledge-upload-anchor` | Document upload dropzone |
| **AI Providers** | `/ai-providers` | `ai-provider-settings-anchor` | Provider selection & model selector |
| **Executions Feed** | `/executions` | `executions-history-anchor` | Execution status timeline |
| **Dashboard** | `/dashboard` | `dashboard-overview-anchor` | Metric summary cards |

## 3. Dynamic Viewport Travel Math
- At idle dock, the mascot is positioned at:
  - `x = window.innerWidth - 80`
  - `y = window.innerHeight - 80`
- When moving to a semantic anchor:
  1. The hook `useMascotTravel` queries the DOM for `document.getElementById(anchorId)`.
  2. If found, computes `rect = element.getBoundingClientRect()`.
  3. Computes resting position beside the element:
     - `targetX = Math.max(16, rect.left - 64)` (desktop side dock) or `Math.min(window.innerWidth - 72, rect.right + 12)`
     - `targetY = Math.max(16, rect.top + 16)`
  4. Animates Framer Motion `x` and `y` properties with spring easing (`stiffness: 240, damping: 26`).
  5. If the anchor is scrolled out of view, smoothly scrolls the viewport (`element.scrollIntoView({ behavior: 'smooth', block: 'center' })`).
  6. While at target, the target element receives a temporary glowing border (`ring-2 ring-indigo-500/50 shadow-indigo-500/20`).
  7. If anchor cannot be found (e.g. mobile narrow view or element delayed), gracefully stays docked or hovers at safe viewport margin.

## 4. Controlled Form Filling
- When missing connection parameters or automation details are provided by voice:
  - Values are placed directly into React state handlers (e.g. `setFormData(prev => ({ ...prev, [field]: value }))`).
  - Passwords and secrets are entered via the focused `SecureCredentialCard` and masked on entry.
  - Form validation is executed using the application's actual schema validation before submission.
  - The submit action triggers the verified backend API (`api.testConnection` -> `api.saveConnection`).
