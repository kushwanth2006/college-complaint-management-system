# Incident workflow contract

- Student submission remains owned by the existing complaint form and POST /api/complaints. Each report belongs to its author; incident summaries expose aggregate counts, not other students' identities.
- Matching requires the same routed department, normalized location, related issue and a ten-minute window anchored to the first report. Missing locations do not auto-merge. Existing historical records are not retrospectively merged.
- Twenty distinct students trigger Critical priority and an immediate SLA deadline. Repeated reports by one student do not inflate affected counts. Critical incidents sort first in the staff queue.
- public/Script.js owns incidentSummary, incidentReports and consolidateTickets. Student lists retain each personal report; staff lists show one card per incident and disclose linked reports. Filters continue to operate on report data before consolidation.
- Staff update controls explicitly say Update incident. Stage, note, category and priority updates apply to all linked complaints; history is recorded for each member. Existing save/error and refresh behavior remains owned by submitAdminStageUpdate.
- Native select remains the established priority control. Native details/summary owns the linked-report disclosure; it must work using keyboard and at narrow widths. Existing global styles own focus and responsive behavior.
- Deleting a report affects only that report, refreshes aggregate counts and selects a surviving representative. An escalation already raised is not automatically withdrawn by deletion.
- MongoDB transactions serialize complaint creation, incident updates and report deletion across server instances. Use MongoDB Atlas or a replica set.
