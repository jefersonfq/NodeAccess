# Browser and Review Validation

## Browser workflow

For material UI work, when permitted:

1. Start the actual development/runtime path.
2. Open the target route with the relevant role.
3. Exercise the main workflow and applicable state matrix.
4. Inspect console and network requests/errors.
5. Verify loading, refresh, empty, filtered-empty, error, success, permission, disabled/read-only, destructive, and long-running states as applicable.
6. Verify keyboard order, visible focus, dialogs/menus, labels, names, status semantics, contrast, and touch targets.
7. Inspect representative desktop/mobile widths and long/translated content.
8. Check table/chart resizing, viewport containment, scrolling, layout shifts, stale/background updates, and repeated actions.
9. Capture/document before and after when visually material.
10. Classify every check Ran, Skipped, Planned, or Manual.

## Functional review

Confirm primary/secondary actions, input preservation, retry/recovery, filters, sorting, pagination, API errors, permissions, destructive confirmation, and double-submission protection.

## Visual review

Confirm alignment, predictable spacing, typography hierarchy, restrained semantic color, justified surfaces/borders/shadows/badges/icons, balanced density, dominant primary action, intentional empty states, readable tables/charts, and no overflow or unexpected shifts.

## Responsive review

Use applicable widths around 360, 390, 768, 1024, 1366, and 1440+. Confirm intentional navigation/table strategy, usable modals/forms/actions, readable labels/legends, no accidental horizontal scroll, and no hidden critical information.

## Accessibility review

Confirm semantic controls, keyboard operation, visible/managed focus, labels/names, non-color status, understandable errors, adequate contrast, and target sizes.

## Performance review

Check duplicate/stale requests, rerenders, heavy charts/bundles/dependencies, polling, unpaginated data, layout shift, feedback latency, console/hydration warnings, and cleanup of timers/listeners/subscriptions/chart instances.

## Findings

Classify Critical, High, Medium, Low, or Optional. For each finding include evidence, user impact, technical cause when known, correction, location, and whether it blocks acceptance.
