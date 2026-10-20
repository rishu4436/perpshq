# PerpsHQ / Perspective

The final polish brings the landing page and all nine workspace screens into one design system. The custom perspective symbol combines four framing corners, a rising path and a focal point. It appears in the website identity, orbital hero, favicon, sidebar and workflow navigation.

## Reading and interaction

- Main explanations use 14px text; tables use 13px data with tabular numerals. Form labels and supporting notes are larger, with brighter contrast against quieter charcoal surfaces.
- Mobile form inputs use 16px text. Chart axes use 12px labels. Small identity labels remain secondary to the actual content.
- Navigation, buttons, input borders, active states and keyboard focus follow the same system. The mobile drawer supports Escape, a closing backdrop and focus return. The skip link focuses the workspace without changing its route.
- Discover, Analyze, Plan, Monitor and Review connect the existing screens while retaining the selected market.
- Wide market tables expose a scrolling hint and retain their market column. Desktop action columns also remain visible while scrolling. Tables can receive keyboard focus.

## Screen-specific refinements

| Screen              | Refinement                                                                       | Desktop                                                       | Mobile                                                       |
| ------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------ |
| Command Center      | Clearer metrics, chart labels and intelligence hierarchy                         | [View](screenshots/workspace-command-center-desktop.png)      | [View](screenshots/workspace-command-center-mobile.png)      |
| Opportunity Scanner | Readable filters, data, score explanations and scrolling tables                  | [View](screenshots/workspace-opportunity-scanner-desktop.png) | [View](screenshots/workspace-opportunity-scanner-mobile.png) |
| Market Intelligence | Roomier market picker, chart and overlay controls; readable analysis panels      | [View](screenshots/workspace-market-intelligence-desktop.png) | [View](screenshots/workspace-market-intelligence-mobile.png) |
| Trade Planner       | Three numbered planning/review sections; useful empty draft guidance             | [View](screenshots/workspace-trade-planner-desktop.png)       | [View](screenshots/workspace-trade-planner-mobile.png)       |
| Positions & Risk    | Account onboarding, clearer exposure cards, alerts and order rows                | [View](screenshots/workspace-positions-risk-desktop.png)      | [View](screenshots/workspace-positions-risk-mobile.png)      |
| Portfolio Analytics | Meaningful account entry point with explicit read-only access                    | [View](screenshots/workspace-portfolio-analytics-desktop.png) | [View](screenshots/workspace-portfolio-analytics-mobile.png) |
| Trade Journal       | Refined toolbar, writing cards and larger editing areas                          | [View](screenshots/workspace-journal-editor-desktop.png)      | [View](screenshots/workspace-journal-editor-mobile.png)      |
| Arena Companion     | Clearer checklist, evidence counters and actual preparation progress             | [View](screenshots/workspace-arena-companion-desktop.png)     | [View](screenshots/workspace-arena-companion-mobile.png)     |
| Settings & Help     | Compact score controls, readable configuration and expandable diagnostic details | [View](screenshots/workspace-settings-help-desktop.png)       | [View](screenshots/workspace-settings-help-mobile.png)       |

The planner keeps uncalculated values unavailable until it has usable inputs. Empty drafts show instructions instead of a raw decimal-library error. Validation, consent, simulation and wallet safeguards remain enforced.

## Verification

The production browser suite passed all 30 cases. It covers desktop and mobile workflows, failure states, wallet safeguards, keyboard navigation, market handoff and real-data visual checks. The all-screen review checks document overflow at 320px, 768px and 1024px in addition to the desktop and phone captures. Focused checks were repeated after refinements to tables and settings.

Screenshots use the actual local application and read-only market sources. The journal editor capture contains an empty browser-local draft. Account screens show the honest disconnected state; no account performance or transaction history is fabricated.
