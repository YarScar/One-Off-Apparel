import { loadEnv } from '@lp-ai/lib-config';
import {
  getPage,
  getUserEmail,
  findPeopleByEmail,
  updatePageProperties,
  type NotionPage,
} from './notion';
import { listEventsForUser, type CalendarEvent } from './google-calendar';

export type Track = 'Programs' | 'Inc. Clients';

// Routing exception set. A meeting routes to Programs when its ORGANIZER (the
// calendar "sender") matches one of these; everything else defaults to Inc. Clients.
const EXCEPTION_EMAILS = new Set(['nick@launchpadphilly.org', 'dannyelle@launchpadphilly.org']);
const EXCEPTION_DOMAINS = new Set(['b-21.org']);

// How far around the recording's timestamp to search for the calendar event.
const MATCH_WINDOW_MS = 2 * 60 * 60 * 1000;

/**
 * The routing rule. Keyed on the meeting ORGANIZER's email (not attendees, not the
 * note's author): anything Christian/others create defaults to Inc. Clients; only
 * meetings sent by Nick, Dannyelle, or anyone @b-21.org go to Programs.
 */
export function routeTrack(organizerEmail: string | null): Track {
  if (!organizerEmail) return 'Inc. Clients';
  const email = organizerEmail.trim().toLowerCase();
  if (EXCEPTION_EMAILS.has(email)) return 'Programs';
  const domain = email.split('@')[1] ?? '';
  if (EXCEPTION_DOMAINS.has(domain)) return 'Programs';
  return 'Inc. Clients';
}

function normalizeId(id: string): string {
  return id.replace(/-/g, '').toLowerCase();
}

/** True when a page's parent is the configured Meetings database/data source. */
export async function pageBelongsToMeetingsDb(page: NotionPage): Promise<boolean> {
  const env = await loadEnv();
  const target = env.NOTION_MEETING_TRANSCRIPTS_DB_ID;
  if (!target) return false;
  const t = normalizeId(target);
  const { database_id, data_source_id } = page.parent;
  return (
    (database_id !== undefined && normalizeId(database_id) === t) ||
    (data_source_id !== undefined && normalizeId(data_source_id) === t)
  );
}

// Google sets `organizer` to the *calendar* an event lives on. For events on a
// shared/group/resource calendar that's not a person — fall back to `creator`
// (the human who made the event), which is the real "sender" for routing.
function isGroupCalendar(email: string | undefined): boolean {
  return !!email && (email.endsWith('@group.calendar.google.com') || email.endsWith('@resource.calendar.google.com'));
}

function pickOrganizerEmail(event: CalendarEvent): string | null {
  const organizer = event.organizer?.email;
  if (!organizer || isGroupCalendar(organizer)) return event.creator?.email ?? organizer ?? null;
  return organizer;
}

function eventTimeMs(event: CalendarEvent, which: 'start' | 'end'): number | null {
  const value = event[which]?.dateTime ?? event[which]?.date;
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/** Pick the event whose time range contains the recording timestamp; else the nearest start. */
function pickMatchingEvent(events: CalendarEvent[], tsMs: number): CalendarEvent | null {
  for (const event of events) {
    const start = eventTimeMs(event, 'start');
    const end = eventTimeMs(event, 'end');
    if (start !== null && end !== null && tsMs >= start && tsMs <= end) return event;
  }
  let best: CalendarEvent | null = null;
  let bestDelta = Infinity;
  for (const event of events) {
    const start = eventTimeMs(event, 'start');
    if (start === null) continue;
    const delta = Math.abs(start - tsMs);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = event;
    }
  }
  return best;
}

interface ResolvedMeeting {
  organizer: string | null;
  attendeeEmails: string[];
  event: CalendarEvent | null;
}

/**
 * Match a meeting note to its calendar event and pull organizer + attendees.
 * Impersonates the user who recorded the note (note.created_by) to read THEIR
 * calendar, searching a window around the note's created_time.
 */
async function resolveMeeting(page: NotionPage): Promise<ResolvedMeeting> {
  const empty: ResolvedMeeting = { organizer: null, attendeeEmails: [], event: null };

  const recorderEmail = await getUserEmail(page.created_by.id);
  if (!recorderEmail) return empty;

  const tsMs = Date.parse(page.created_time);
  if (Number.isNaN(tsMs)) return empty;

  const events = await listEventsForUser(
    recorderEmail,
    new Date(tsMs - MATCH_WINDOW_MS).toISOString(),
    new Date(tsMs + MATCH_WINDOW_MS).toISOString(),
  );
  const event = pickMatchingEvent(events, tsMs);
  if (!event) return empty;

  const organizer = pickOrganizerEmail(event);
  const attendeeEmails = (event.attendees ?? [])
    .filter((a): a is { email: string } => typeof a.email === 'string' && !a.resource)
    .map((a) => a.email.toLowerCase());

  return { organizer, attendeeEmails, event };
}

export interface RoutingResult {
  pageId: string;
  organizer: string | null;
  track: Track | null;
  attendeesLinked?: number;
  applied: boolean;
  skipped?: string;
}

/**
 * Core router step: a page just landed in (or changed within) the Meetings DB.
 * Confirm it belongs to us, resolve its calendar event, then write back:
 *   - Track (from organizer)
 *   - Attendees relation (matched People rows) + Attendee Emails (raw, lossless)
 *   - Calendar Event ID
 * Visibility is intentionally left UNSET (see note below).
 */
export async function applyRouting(pageId: string): Promise<RoutingResult> {
  const page = await getPage(pageId);

  if (!(await pageBelongsToMeetingsDb(page))) {
    return { pageId, organizer: null, track: null, applied: false, skipped: 'not a Meetings DB page' };
  }

  const { organizer, attendeeEmails, event } = await resolveMeeting(page);
  const track = routeTrack(organizer);

  // Link attendees to People by email where a record exists; always keep the raw list.
  const env = await loadEnv();
  const peopleDbId = env.NOTION_PEOPLE_DB_ID;
  const relationIds: string[] = [];
  if (peopleDbId) {
    for (const email of attendeeEmails) {
      relationIds.push(...(await findPeopleByEmail(peopleDbId, email)));
    }
  }
  const uniqueRelationIds = [...new Set(relationIds)];

  const properties: Record<string, unknown> = {
    Track: { select: { name: track } },
    'Attendee Emails': {
      rich_text: attendeeEmails.length ? [{ text: { content: attendeeEmails.join(', ') } }] : [],
    },
  };
  if (uniqueRelationIds.length > 0) {
    properties['Attendees'] = { relation: uniqueRelationIds.map((id) => ({ id })) };
  }
  if (event?.id) {
    properties['Calendar Event ID'] = { rich_text: [{ text: { content: event.id } }] };
  }
  // NOTE: Visibility is deliberately left UNSET. Meeting transcripts can be
  // sensitive, and the Notion→pgvector connector fail-closes (skips pages with no
  // Visibility), so a transcript isn't searchable until a human tags its visibility.
  // A default-visibility policy can be added here later if desired.

  await updatePageProperties(pageId, properties);
  return { pageId, organizer, track, attendeesLinked: uniqueRelationIds.length, applied: true };
}
