# Telegram Rich Messages Evaluation

Source reviewed: [Telegram Bot API](https://core.telegram.org/bots/api#rich-messages) and [Bot API changelog](https://core.telegram.org/bots/api-changelog), through Bot API 10.3.

## Why this matters

Telegram's Rich Messages APIs are explicitly designed for highly structured content and streamed AI-generated replies. They are a better long-term fit for Pi Telegram Extension than legacy `sendMessage` with MarkdownV2.

## Relevant capabilities

### Streaming agent state

`sendRichMessageDraft` sends an ephemeral 30-second preview. Reusing a non-zero `draft_id` animates updates to the same draft. It supports:

- `InputRichBlockThinking` / `<tg-thinking>` as a native `Thinking…` placeholder;
- `can_stop` to show a stop-generation button;
- `keep_on_stop` to retain a stopped preview temporarily; and
- `stopped_message_generation` updates through `MessageGenerationStopped`.

A finalized response must be persisted separately with `sendRichMessage`.

### Final rich responses

`InputRichMessage` accepts exactly one of `markdown`, `html`, or explicit `blocks`. Rich Markdown is GitHub-Flavored Markdown-compatible where possible and supports:

- headings and paragraphs;
- bold, italic, underline through inline HTML, strikethrough, marked text, spoilers, subscript, and superscript;
- inline and fenced code with language labels;
- links, mentions, references, and footnotes;
- ordered, unordered, and task lists;
- block, expandable, and pull quotations;
- native tables, including bordered, striped, and compact variants;
- inline and block LaTeX formulas;
- collapsible details;
- photos, video, audio, voice notes, documents, animations, collages, slideshows, and maps; and
- rich buttons, including URL, callback, Web App, copy-text, and disabled buttons.

Published limits are 32,768 UTF-8 text characters, 500 blocks, 16 nesting levels, 50 media attachments, and 20 table columns.

The tested response lifecycle and rollback baseline are recorded in [`telegram-draft-ux-baseline.md`](telegram-draft-ux-baseline.md).

## Pi Telegram Extension implementation status

The first Rich Messages integration is implemented in the extension:

- one stable draft that begins as native Rich activity and uses an invisibly changing five-second payload heartbeat;
- tool-aware thinking, reading, searching, browsing, running-command, and editing labels/icons until public progress exists;
- replacement of Rich activity by a whitespace-flattened, coalesced one-line plain commentary preview in that same draft;
- continued plain `final_answer` streaming at a non-blocking 1.5-second cadence without switching back to generic Thinking;
- the exact case-insensitive `stop` text command mapped to Pi abort for the current task;
- every completed assistant response persisted immediately through `sendRichMessage` as its own normal unquoted chat message;
- requested project artifacts uploaded through native `sendDocument` with path, credential, size, and caption safeguards.

Controlled tests against a project bot found that official and alternative mobile clients animate long `sendRichMessageDraft` response text too slowly, regardless of stable/rotating IDs or Markdown/explicit blocks. Short native activity blocks render well, and plain `sendMessageDraft` response updates render completely on both clients. A later real-session test found that a separate ordinary commentary message was not reliably visible while a lower activity draft dominated the UI. The production lifecycle therefore replaces Rich activity in the same stable draft as soon as public commentary exists. Mobile expires inactive drafts after roughly eight seconds and ignores identical refreshes, so both Rich and plain drafts use an invisibly changing five-second payload heartbeat. The final persisted response still uses Rich Markdown.

## Recommended Pi Telegram Extension experience

### Implemented: draft lifecycle

1. Receive an owner message.
2. Start a rich draft with a native thinking block and `can_stop: false`; the animated native control disrupted mobile rendering.
3. Keep native activity only until the first public commentary delta, then replace the same draft with a whitespace-flattened one-line plain preview.
4. Coalesce commentary updates at 1.5 seconds, keep the latest evolving line visible, and never switch it back to generic activity.
5. Refresh both Rich and plain drafts every five seconds with an invisibly changing payload marker.
6. At `final_answer`, replace the same plain draft with streamed final text. On completed assistant `message_end`, persist the answer with `sendRichMessage`; use `agent_settled` only as a fallback.
7. Abort the current Pi task when the owner sends the exact case-insensitive keyword `stop`; keep the Pi session and Telegram connection alive.

The thinking block must contain only a generic status label, never hidden reasoning.

### AI Actions custom emoji

Telegram recommends the `AIActions` custom-emoji set for `InputRichBlockThinking`. The set currently resolves through `getStickerSet("AIActions")` as a 48-item `custom_emoji` sticker set.

Rich thinking text can combine ordinary strings with `RichTextCustomEmoji` values containing `type: "custom_emoji"`, `custom_emoji_id`, and `alternative_text`. Production code should resolve and cache identifiers from Telegram rather than treating the PNG as input.

The icon set makes tool-aware status useful without exposing tool details. Candidate states include:

- thinking or planning;
- reading or searching documents;
- browsing the web;
- inspecting images;
- listening to voice input;
- running terminal commands;
- editing or generating code; and
- completing the response.

Only generic labels and icon changes should be shown. Raw tool arguments, results, file contents, and hidden reasoning remain private.

### Implemented: Rich Markdown output

The extension injects the Rich Markdown contract and sends the model's completed public response as:

```json
{
  "chat_id": 123,
  "rich_message": {
    "markdown": "..."
  }
}
```

This provides native tables and raises the practical response-size ceiling. During development, report invalid rich content rather than silently falling back.

### Priority 3: conversation and controls

- Explore rich callback/copy buttons for approvals and common agent actions.
- Add image and document input/output.
- Evaluate voice-note input with transcription and optional voice-note responses.
- Use collapsible details for lengthy diagnostics and tables for structured tool summaries.

## Not priorities

Communities, subscriptions, high-volume paid broadcasts, join-request queries, and group ephemeral messaging do not materially improve the initial owner-to-agent workflow and should not distract from the rich draft and response path.
