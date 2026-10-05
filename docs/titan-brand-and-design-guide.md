# Titan brand and design guide

## Purpose

Titan helps teams turn ideas, decisions, work, and evidence into a shared memory that agents can use responsibly. It makes the chain from intent to action visible: what changed, why it changed, and what supports it.

Use this guide whenever you write product copy, design a screen, name an interaction, or add a component. It is the default unless a task provides more specific direction.

## Brand in one sentence

Titan is the calm, trustworthy workspace where people and agents build knowledge with a basis.

## Product principles

1. **Clarity before cleverness.** Help people understand what is happening and what to do next.
2. **Evidence before authority.** Show the basis for a record, interpretation, or change.
3. **Human judgment stays visible.** Agents can organize and prepare work; people can inspect and decide.
4. **Progress without pressure.** Make the next step feel approachable, never urgent or alarming by default.
5. **Connected, not cluttered.** Reveal relationships when they help someone make a decision. Do not decorate the interface with incidental metadata.

## Voice and writing

Titan sounds like a thoughtful collaborator: warm, grounded, concise, and useful. The product is confident about what it knows and explicit about what needs review.

### Voice rules

- Be friendly in every helper text, empty state, confirmation, and error message.
- Start with the outcome or next helpful action.
- Use short, everyday sentences. Prefer active voice.
- Name the actor when it matters: “Titan prepared a draft” is clearer than “A draft was prepared.”
- Say what will happen, what has happened, or what the person can do now.
- Preserve agency. Use “review,” “choose,” “connect,” and “restore” rather than language that implies irreversible automation.
- Be precise without sounding legalistic. When evidence is missing or contested, say so plainly.

### Avoid

- Cold system language: “Operation executed,” “request invalid,” or “resource unavailable.”
- Hype, grand claims, and vague AI promises: “unlock intelligence,” “magic,” or “revolutionary.”
- Blame or urgency: “You failed to,” “must,” or “fix immediately,” unless the risk truly requires it.
- Jargon when a common word works: use “record” before “entity,” “change” before “mutation,” and “connection” before “relationship edge.”
- Overexplaining routine actions. One clear sentence is usually enough.

### Preferred patterns

| Situation           | Use                                                                                          | Avoid                                  |
| ------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------- |
| Empty state         | “Share your idea with the agent. Titan will turn it into a connected record you can review.” | “No data exists. Initialize a record.” |
| Agent progress      | “I prepared a change for you to review. Nothing has been applied yet.”                       | “Draft generated successfully.”        |
| Applied change      | “Applied. Titan is checking related knowledge and recording the change.”                     | “Mutation committed.”                  |
| Missing information | “Add a little more detail so Titan can prepare a useful draft.”                              | “Input validation failed.”             |
| Warning             | “This guidance has been superseded. Review the replacement before using it.”                 | “Deprecated artifact detected.”        |
| Error               | “Titan couldn’t save that change. Try again, or check your connection.”                      | “Error 500.”                           |

### UI copy mechanics

- Use sentence case for labels, buttons, headings, and metadata. “Workspace” and “Draft for review” are easier to scan than uppercase labels.
- Write buttons as clear actions: “New record,” “Apply change,” “Restore and reevaluate.”
- Use `you` for a human action and `Titan` or `the agent` for an automated action.
- Use contractions where they make the sentence warmer: “couldn’t,” “you’re,” and “we’ll.” Do not force them into formal or high-stakes warnings.
- Keep helper text to one or two sentences. If instructions need steps, use a short ordered list.

## Visual direction

Titan should feel like an approachable notebook: light, spacious, familiar, and easy to start using. Borrow the useful cues from Notion’s page-oriented workspace: quiet navigation, clear page titles, neutral surfaces, simple rows, and details revealed when needed. Titan’s own identity comes through in its helpful voice, restrained green accent, and visible connections between ideas.

Reference: [Notion’s sidebar navigation](https://www.notion.com/help/navigate-with-the-sidebar). Apply the principles to Titan’s existing workflows rather than introducing unfamiliar features or duplicating another product’s branding.

### Color

Use the shared CSS tokens in `apps/web/src/style.css` as the implementation source of truth. Neutral surfaces should occupy most of the interface.

| Role          | Token or value        | Use                                                   |
| ------------- | --------------------- | ----------------------------------------------------- |
| Warm ink      | `#37352f`             | Headings and primary text                             |
| Titan green   | `--green: #28785d`    | Primary actions, focus rings, and small brand accents |
| Warm surface  | `--surface: #f7f7f5`  | Sidebar and quiet supporting areas                    |
| Panel white   | `#ffffff`             | Records, forms, and review surfaces                   |
| Soft green    | `#e6eee8`             | Brand mark and agent icon                             |
| Soft border   | `--border: #e9e8e4`   | Essential boundaries                                  |
| Hover surface | `--hover: #efefec`    | Hovered and selected rows                             |
| Muted ink     | `--muted: #73716c`    | Secondary metadata and supporting copy                |
| Review amber  | `#fbefde` / `#865b29` | Superseded or disputed content                        |

Do not introduce saturated gradients, neon accents, or a second dominant brand color. Reserve amber for states that require attention. Color must not be the only way a state is communicated.

### Typography

- Use the native system sans-serif stack for headings, body text, and controls. The interface should feel familiar and render consistently without remote font downloads.
- Use 32px page titles, 28px record titles, 15px document text, 14px controls and helper copy, and 12px supporting metadata.
- Controls share `--control-size`, `--control-line`, and `--control-weight`; metadata shares `--meta-size`. Equivalent controls keep the same size even in the agent panel or mobile navigation.
- Headings have gently compact letter spacing and strong hierarchy. Body copy uses a relaxed line-height and readable contrast.
- Favor short headings. Use supporting text to explain nuance.

### Layout and spacing

- Make the document feel like a page, with quiet navigation beside it and room to read.
- Use simple rows, fine separators, and restrained 5–8px corner radii. Keep the page canvas open; avoid enclosing every section in a card.
- Preserve the working rhythm: browse context, inspect the record, collaborate with the agent. Let people hide the agent panel when reading.
- Keep spacing compact and consistent. Use small gaps within related controls, moderate gaps between sections, and generous space only around the main page title or an empty state.
- Show essential validity next to the record. Put supporting authority, status, and scope behind “Record details”; keep history and evidence accessible.
- Give empty states one friendly invitation and a clear action. Replace slogans and decorative principle lists with useful next steps.

### Iconography and motion

- Use simple geometric symbols and familiar interface icons. They should support scanning, not become the product’s personality.
- Use the Titan `T` mark and the existing geometric symbols consistently; do not mix icon families casually.
- Motion should be brief and functional: state feedback, expanding context, and focus transitions. Avoid decorative movement and attention-seeking animation.

## Components and states

### Primary actions

Use a solid Titan-green button for the single most important next step in a region. Pair it with a specific verb. A secondary action should be neutral and visually quieter.

Do not place several equally weighted primary buttons together. If a choice has meaningful consequences, explain the distinction next to the actions.

### Records and relationships

Records should foreground the title, current validity, and readable content. Relationships are supporting context: show their meaning, destination, and state in plain language. Always make it possible to inspect the evidence behind a consequential connection.

### Agent panel

The agent panel is a conversation, not a command line. It should invite people to think, clarify what the agent will do, and make review easy.

- Opening helper text should welcome an idea or a question.
- Before an action, say what the agent is preparing.
- After an action, say what changed and what Titan is checking next.
- A proposed change must be visibly distinct from an applied change.

### Empty states

Empty states should make a blank space feel like an invitation, not a failure. Include a clear, low-effort next step and only the context needed to take it.

### Errors and warnings

Errors should be calm and actionable. State the problem in plain language, preserve the person’s work whenever possible, and offer the recovery action.

Warnings should explain the consequence before asking for a decision. Use amber sparingly for disputed, superseded, or otherwise review-worthy information.

## Accessibility and quality bar

- Maintain readable contrast for text, controls, status badges, and focus states.
- Keep visible keyboard focus on every interactive element.
- Pair color with text, icon, or shape for all meaningful state.
- Use semantic labels and direct control names; avoid placeholder-only instructions.
- Keep interactions understandable at narrow widths. On mobile, preserve task flow over desktop density.
- Use concise content that can be localized without relying on wordplay or layout-dependent phrasing.

## Implementation checklist for agents

Before shipping a Titan UI or copy change, check the following:

- Does the copy sound friendly, direct, and useful?
- Does it explain the next action or current state without unnecessary jargon?
- Does it preserve human review for consequential changes?
- Does the visual treatment use warm neutrals, readable ink, a small green accent, and purposeful amber states?
- Are controls at the shared 14px baseline and supporting metadata at 12px?
- Can people focus on a record and reveal supporting details when they need them?
- Is there one clear primary action in the relevant region?
- Are states understandable without color alone and reachable by keyboard?
- Does the change keep relationships and evidence easy to inspect?

When a request conflicts with this guide, follow the request and explain the deliberate departure in the implementation notes.
