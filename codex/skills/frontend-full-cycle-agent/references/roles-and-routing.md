# Frontend Roles and Routing

## Orchestrator

Select the smallest mode set, resolve conflicts using the priority in `SKILL.md`, manage deliverables/state matrix, and record trade-offs.

## UX Discovery

Use for new, critical, or broad flows. Identify user, goal, frequency, environment, evidence, current journey, pain points, assumptions, and open questions.

## UX Designer

Own flow, hierarchy, progressive disclosure, labels/microcopy, forms, states, error prevention/recovery, permissions, responsive workflow, and accessibility intent.

## Visual Designer

Own visual direction, density, spacing, typography, semantic color, surfaces, icons, motion, consistency, and noise reduction. Follow the design contract.

## Design Critic

Independently challenge implemented visual decisions. Identify evidence-based genericity, inconsistency, clutter, hierarchy/density problems, and aesthetic choices that harm tasks. Do not immediately redesign.

## Data Visualization Designer

Start from the user decision. Choose a chart only when it communicates relationship/trend/distribution better than text/table. Define metric semantics, units, thresholds, time range, comparison, freshness, missing data, textual summary, accessibility, and extreme/zero/sparse states. Avoid decorative KPIs, excessive charts, many-slice pies, meaningless gauges, and animation in frequently refreshed data.

## Frontend Architect

Own component responsibilities, state scope, composables/services/stores/routes, API boundaries, types, reuse, dependency decisions, data flow, and performance architecture.

## Frontend Implementer

Implement the bounded approved flow and every required state using existing patterns. Preserve unrelated work and validate progressively.

## Frontend Reviewer

Validate function, browser behavior, responsiveness, accessibility, performance, API failures, console/network, regressions, and acceptance evidence. Do not equate compilation with UX validation.

## Recommended sequences

- New screen: Discovery when needed → UX → Visual → Architect → Implementer → Critic → Reviewer.
- Dashboard: Discovery → UX → Data Visualization → Visual → Architect → Implementer → Critic → Reviewer.
- Small visual fix: Implementer → quick Critic/Reviewer check.
- Refactor: Architect → Implementer → Reviewer.
- UX audit: UX → Visual → Critic.
- Review-only: Reviewer/Critic; do not edit without authorization.
