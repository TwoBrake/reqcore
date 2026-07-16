# Simplified Interview Scheduling

## Goal

Make interview scheduling a natural part of the existing candidate conversation. Recruiters should not have to choose between email, calendar notifications, templates, or delivery methods.

## Core Approach

- Send every interview proposal through the two-way Reqcore inbox.
- Use the recruiter as the visible sender and route candidate replies back to the existing conversation.
- Attach an ICS calendar invitation so candidates can add the interview to Google Calendar, Outlook, Apple Calendar, or another calendar without a Reqcore calendar integration.
- Keep Reqcore as the source of truth for the interview and its confirmation state.
- Remove the separate no-reply invitation flow.

## Recruiter Experience

The scheduling form should ask only for:

- Date and time
- Duration
- Interview format or location
- Interviewers
- An optional personal note

Reqcore should automatically apply the organization defaults, detect the timezone, generate the message, attach the ICS invitation, and send it through the candidate conversation.

## Candidate Experience

The candidate receives one email containing the interview details, calendar invitation, and clear actions:

- Confirm
- Request another time
- Decline

They can also reply normally. Replies and interview responses remain visible in the same Reqcore conversation.

Reschedules and cancellations should be sent through the same thread with an updated ICS invitation, using the same event identifier so calendar applications update the existing event.

## Recruiter Outcome Actions

- Cancelling an interview is candidate-facing after a proposal has been sent. Reqcore sends a cancellation message and calendar cancellation through the existing conversation.
- Marking an interview completed or no-show is an internal recruiting outcome. It does not contact the candidate.
- Recruiter controls must state whether the candidate will be contacted before the action is confirmed.
- A status change and its candidate-message delivery are separate outcomes. If delivery fails, the status remains accurate while the failed message stays visible and retryable.
- Deleting an interview is administrative and never contacts the candidate. A scheduled interview with a sent proposal must be cancelled before it can be deleted.

## Calendar Integrations

Google Calendar integration should be optional. The ICS invitation covers the candidate-facing calendar experience without OAuth or calendar webhooks.

A connected calendar may later synchronize recruiter availability and internal events, but candidate communication and confirmation should continue to flow through Reqcore.

## Reliability

Interview state, message delivery, and calendar delivery should be tracked separately. Reqcore should never report that a proposal was sent when only the interview record was created.

Failed messages should remain visible and retryable. Calendar attachment or synchronization failures should not lose the interview or conversation.

## Free Plan

The free plan can limit the number of tracked candidate conversations or interview processes. When the limit is reached:

- Make upgrading the primary action.
- Explain that upgrading preserves replies, confirmations, calendar updates, and shared history.
- Allow the recruiter to continue outside Reqcore through a less convenient manual fallback.
- Never hide existing replies or block critical updates to an interview already in progress.

The upgrade should sell a coordinated and reliable workflow rather than create a dead end during active hiring.
