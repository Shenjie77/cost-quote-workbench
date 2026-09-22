# Workbench interface system

## Scope and sources

This is the presentation specification for all existing views: Today, Project List, Project Workflow, Cost, Pricing & Quote, CPQ, Maintenance BOQ, Agent Digest, and Master Data. Business calculations, persistence, workflow rules, data fields, and export contracts remain unchanged.

Design guidance: [UI/UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill), loaded from its official `SKILL.md`; searched with the detected React / Tailwind / Base UI (shadcn) stack. `enterprise quoting dashboard dense` and the narrower `operations dashboard compact` both matched Minimalism & Swiss Style, but returned marketing landing-page patterns. Those patterns and font/network recommendations were rejected. The workspace layout below is an explicitly adapted design, using the skill's verified dense-dashboard, semantic-table, accessibility, and compact-control guidance.

Independent review: [web-design-guidelines](https://github.com/vercel-labs/agent-skills/tree/main/skills/web-design-guidelines), with freshly retrieved [Web Interface Guidelines](https://github.com/vercel-labs/web-interface-guidelines/blob/main/command.md).

## Visual and interaction rules

- Keep navy navigation, white work surfaces, a cool neutral canvas, and teal accents. Reserve success, warning, and danger tones for statuses; always include words or an icon alongside color.
- Use the existing system sans-serif stack, avoiding external font requests. Normal text is 13–14 px; secondary labels and table text are at least 12 px. Financial values use tabular numerals. Headings use weight and alignment instead of large decorative type.
- Use 4/8/12/16 px spacing, 32 px desktop controls, restrained 6–8 px corners, and borders instead of stacked shadows. Touch devices receive larger targets.
- Keep page title, search, save feedback, and primary navigation actions in the shared header. Preserve project tabs, current-view search selection, reload restoration, backup recovery, and all existing action callbacks.
- Keep filters, year selection, import/add/export actions directly beside their table. Use one main action group for each working section. Place explanations after the working area when they are not needed for a decision.
- Preserve semantic HTML tables with visible horizontal and vertical grid lines, shaded headers, aligned numeric columns, and row hover/focus feedback. Wide tables scroll inside their own container; the page itself must fit the viewport. Grid tables do not become a list of cards on small screens.
- Today keeps workflow counts first, clickable pending nodes, then follow-ups before the portfolio. Quote keeps full-width pricing parameters, GP-based allocation, row locks, and customer Preview.
- CPQ keeps selection and calculation close together. Maintenance uses a common BOQ grid, with each row's references attached to that row. Master Data retains all nine tabs, import templates, save actions, and catalog-only input semantics.
- Use native controls and Base UI focus handling; label controls and icon buttons, expose active/expanded states, provide visible keyboard focus and a skip link, contain dialog scroll, and respect reduced motion.
- Preserve business labels and bilingual context. Do not hide errors or remove actions to achieve density. Do not introduce a new router, calculation engine, package, font service, or animation dependency for this redesign.

## Verification

Review every primary view, relevant sub-tabs, customer Preview, project search, workflow drilldown, narrow viewport/table overflow, and keyboard navigation. Run existing behavioral tests, TypeScript, lint, and production build. Record actionable review findings and their resolution in `workbench-ui-review.md`.
