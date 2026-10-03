//! Home, a conversation from first question to report (SPEC §4, §6, §7, §16).

use std::cmp::Reverse;
use std::collections::HashMap;
use std::path::Path;

use chrono::{DateTime, Utc};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use super::profile::{agent, require_profile};
use super::progress::{local_date, streak};
use super::run;
use crate::agent::protocol::{
    Analysis, AnalyzeParams, AnalyzeTurn, ChallengeRef, ChatContext, ChatParams, ComposeParams,
    Composed, CorrectionInput, EditType, FocusInput, HelpParams, HistoryTurn, KnownPattern,
    Learner, SelfCheckParams, Target,
};
use crate::db::patterns::{ErrorEvent, PatternRow};
use crate::db::sessions::{self, NewTurn, SessionRow};
use crate::db::{new_id, patterns, profile as profile_repo};
use crate::domain::{
    AnalysisProgress, AnalysisStep, ChatDelta, CorrectionRole, ErrorKind, FocusMode, HelpOption,
    HomeState, Level, Mode, NativeRewrite, Profile, Recording, Report, ReportCard, Rewrite, Role,
    SelfCheck, SessionMetrics, SessionSetup, SessionStarted, Turn, TurnReply, UiLang, VocabItem,
};
use crate::error::{Error, Result};
use crate::memory::is_active;
use crate::memory::update::{self as memory_update, Pick};
use crate::metrics::{self, AnalysisCounts, UserTurn};
use crate::Ctx;

/// SPEC §6.2: topics are a short prompt, not an essay.
const MAX_TOPIC_CHARS: usize = 200;
/// Sessions averaged for the "before" side of the metrics card.
const PREVIOUS_SESSIONS: usize = 5;
/// Error examples given to the partner per target structure.
const TARGET_EXAMPLES: usize = 2;

/// Per-level turn guidance (SPEC §4: 5–15, 20–60 and 60–120 words). The
/// meter fills at the low end of the range, so reaching it feels like
/// success, not a quota.
pub struct LevelGuide {
    pub min_words: u32,
    pub hint: &'static str,
}

pub const BASIC: LevelGuide = LevelGuide {
    min_words: 5,
    hint: "Try 1–2 short sentences",
};
pub const INTERMEDIATE: LevelGuide = LevelGuide {
    min_words: 20,
    hint: "Try 2–3 sentences",
};
pub const ADVANCED: LevelGuide = LevelGuide {
    min_words: 60,
    hint: "Tell me more — a few sentences or a short story",
};

pub fn guide(level: Level) -> &'static LevelGuide {
    match level {
        Level::Basic => &BASIC,
        Level::Intermediate => &INTERMEDIATE,
        Level::Advanced => &ADVANCED,
    }
}

/// Sentence starters for basic level only (SPEC §4: advanced gets nothing).
pub fn scaffolds(level: Level, mode: Mode) -> Vec<String> {
    if level != Level::Basic {
        return Vec::new();
    }
    let starters: &[&str] = match mode {
        Mode::Casual => &[
            "I think that…",
            "I like… because…",
            "Last week I…",
            "For me,…",
        ],
        Mode::Interview => &[
            "In my last job, I…",
            "One of my strengths is…",
            "I'm good at…",
        ],
        Mode::Debate => &[
            "I agree because…",
            "I don't agree, because…",
            "On the other hand,…",
        ],
        Mode::Story => &["One day, I…", "First… then…", "In the end,…"],
        Mode::Roleplay => &[
            "Could I have…, please?",
            "I would like…",
            "Excuse me, where is…?",
        ],
        Mode::Material => &[
            "The text says that…",
            "I think the author…",
            "The main idea is…",
        ],
    };
    starters.iter().map(|s| (*s).to_owned()).collect()
}

/// Offered next to the learner's own interests.
const DEFAULT_TOPICS: [&str; 5] = [
    "Your plans for the weekend",
    "A place you would love to visit",
    "Something you learned recently",
    "A meal you will never forget",
    "A small problem you solved this week",
];
const MAX_TOPICS: usize = 6;

/// Modes the rotation suggestion picks from; "material" needs pasted text.
const ROTATION: [Mode; 5] = [
    Mode::Casual,
    Mode::Story,
    Mode::Debate,
    Mode::Roleplay,
    Mode::Interview,
];
/// The same mode this many sessions running prompts a suggestion.
const ROTATION_AFTER: usize = 4;
/// This many estimates in a row outside the chosen level prompt a suggestion.
const LEVEL_AFTER: usize = 3;

// ── Home ──────────────────────────────────────────────────────────────────

/// SPEC §11: after four sessions in the same mode, the mode used least
/// lately; one never used beats one used long ago.
pub fn rotation_suggestion(recent_modes: &[Mode]) -> Option<Mode> {
    let last = recent_modes.get(..ROTATION_AFTER)?;
    if last.iter().any(|m| *m != last[0]) {
        return None;
    }
    ROTATION
        .iter()
        .copied()
        .filter(|m| *m != last[0])
        .min_by_key(|m| {
            Reverse(
                recent_modes
                    .iter()
                    .position(|r| r == m)
                    .unwrap_or(usize::MAX),
            )
        })
}

/// SPEC §4: three estimates in a row outside the level chosen for those
/// sessions, all pointing at the same other level.
pub fn level_suggestion(recent: &[(Level, crate::domain::Cefr)]) -> Option<Level> {
    let last = recent.get(..LEVEL_AFTER)?;
    let suggested = last[0].1.level();
    last.iter()
        .all(|(chosen, cefr)| cefr.level() != *chosen && cefr.level() == suggested)
        .then_some(suggested)
}

fn suggested_topics(profile: &Profile) -> Vec<String> {
    let mut topics: Vec<String> = Vec::new();
    for topic in profile
        .interests
        .iter()
        .map(String::as_str)
        .chain(DEFAULT_TOPICS)
    {
        let topic = topic.trim();
        if !topic.is_empty() && !topics.iter().any(|t| t.eq_ignore_ascii_case(topic)) {
            topics.push(topic.to_owned());
        }
    }
    topics.truncate(MAX_TOPICS);
    topics
}

pub fn home(ctx: Ctx<'_>, now: DateTime<Utc>) -> Result<HomeState> {
    let conn = ctx.conn()?;
    let profile = require_profile(&conn)?;
    let rows = sessions::list_sessions(&conn)?;
    let events = patterns::events_by_pattern(&conn)?;
    let all = patterns::list_patterns(&conn)?;
    let focus = all
        .iter()
        .find(|p| p.is_primary)
        .map(|p| patterns::view(p, events.get(&p.id).map_or(&[][..], Vec::as_slice)));
    let due = all
        .iter()
        .filter(|p| is_active(p.state) && p.next_review_at.is_some_and(|t| t <= now))
        .count();
    let modes: Vec<Mode> = rows.iter().map(|s| s.setup.mode).collect();
    let estimates: Vec<(Level, crate::domain::Cefr)> = rows
        .iter()
        .filter_map(|s| Some((s.setup.level, s.estimated_cefr?)))
        .collect();
    Ok(HomeState {
        suggested_topics: suggested_topics(&profile),
        last_setup: rows.first().map(|s| s.setup.clone()),
        focus,
        due_reviews: u32::try_from(due).unwrap_or(u32::MAX),
        streak: streak(&sessions::practice_days(&conn)?, local_date(now)),
        active_challenge: sessions::active_challenge(&conn)?.map(|c| c.text),
        rotation_suggestion: rotation_suggestion(&modes),
        level_suggestion: level_suggestion(&estimates),
        profile,
    })
}

// ── Conversation ──────────────────────────────────────────────────────────

fn latest_cefr(rows: &[SessionRow]) -> Option<crate::domain::Cefr> {
    rows.iter().find_map(|s| s.estimated_cefr)
}

/// SPEC §8.5: active patterns are targets when the learner chose to practise
/// them; otherwise only those due for review are slipped in.
fn chat_context(
    conn: &Connection,
    setup: &SessionSetup,
    profile: &Profile,
    now: DateTime<Utc>,
) -> Result<ChatContext> {
    let mut targets = Vec::new();
    for p in patterns::list_patterns(conn)?
        .iter()
        .filter(|p| is_active(p.state))
    {
        let due = p.next_review_at.is_some_and(|t| t <= now);
        if setup.focus_mode == FocusMode::Pending || due {
            let examples: Vec<String> = patterns::examples(conn, &p.id, TARGET_EXAMPLES)?
                .into_iter()
                .map(|e| format!("\"{}\"", e.corrected))
                .collect();
            targets.push(Target {
                description: p.description.clone(),
                contexts: if examples.is_empty() {
                    String::new()
                } else {
                    format!("Needed in sentences like {}", examples.join(", "))
                },
            });
        }
    }
    Ok(ChatContext {
        setup: setup.clone(),
        learner: Learner {
            name: profile.name.clone(),
            native_lang: profile.native_lang.clone(),
            goal: profile.goal,
            variant: profile.variant,
            interests: profile.interests.clone(),
            facts: profile_repo::list_facts(conn)?
                .into_iter()
                .map(|f| f.text)
                .collect(),
            cefr: latest_cefr(&sessions::list_sessions(conn)?),
        },
        targets,
        challenge: sessions::active_challenge(conn)?.map(|c| c.text),
    })
}

fn validate(setup: &SessionSetup) -> Result<SessionSetup> {
    let mut setup = setup.clone();
    setup.topic = setup.topic.trim().to_owned();
    if setup.topic.chars().count() > MAX_TOPIC_CHARS {
        return Err(Error::Invalid(format!(
            "topic is longer than {MAX_TOPIC_CHARS} characters"
        )));
    }
    setup.material = setup
        .material
        .map(|m| m.trim().to_owned())
        .filter(|m| !m.is_empty());
    if setup.mode == Mode::Material && setup.material.is_none() {
        return Err(Error::Invalid("paste the material to talk about".into()));
    }
    if setup
        .target_minutes
        .is_some_and(|m| !m.is_finite() || m <= 0.0)
    {
        return Err(Error::Invalid("target minutes must be positive".into()));
    }
    Ok(setup)
}

fn assistant_turn<'a>(session_id: &'a str, text: &'a str) -> NewTurn<'a> {
    NewTurn {
        session_id,
        role: Role::Assistant,
        said_text: None,
        sent_text: text,
        audio_id: None,
        speech_seconds: None,
        words: metrics::count_words(text),
    }
}

/// Streamed partner text: `(session_id, text)`.
pub type OnDelta<'a> = &'a mut dyn FnMut(&str, &str);

pub fn start(ctx: Ctx<'_>, setup: &SessionSetup, on_delta: OnDelta<'_>) -> Result<SessionStarted> {
    let setup = validate(setup)?;
    let now = Utc::now();
    let (session_id, context) = {
        let conn = ctx.conn()?;
        let profile = require_profile(&conn)?;
        let context = chat_context(&conn, &setup, &profile, now)?;
        (sessions::insert_session(&conn, &setup, now)?, context)
    };
    let params = ChatParams {
        context,
        history: Vec::new(),
        provider_ref: None,
    };
    let reply = agent(ctx).and_then(|a| a.chat(&params, &mut |t| on_delta(&session_id, t)));
    let conn = ctx.conn()?;
    // A session without its opening question is useless; starting again
    // makes a new one.
    let reply = reply.or_else(|err| {
        sessions::delete_session(&conn, &session_id)?;
        Err(err)
    })?;
    let opening =
        sessions::insert_turn(&conn, &assistant_turn(&session_id, &reply.text), Utc::now())?;
    sessions::set_provider_ref(&conn, &session_id, reply.provider_ref.as_deref())?;
    let guide = guide(setup.level);
    Ok(SessionStarted {
        session_id,
        opening,
        length_hint: guide.hint.to_owned(),
        turn_word_goal: guide.min_words,
        scaffolds: scaffolds(setup.level, setup.mode),
    })
}

fn user_turns(turns: &[Turn]) -> Vec<UserTurn<'_>> {
    turns
        .iter()
        .filter(|t| t.role == Role::User)
        .map(|t| UserTurn {
            text: &t.sent_text,
            speech_seconds: t.speech_seconds,
        })
        .collect()
}

fn open_session(conn: &Connection, session_id: &str) -> Result<SessionRow> {
    let session = sessions::get_session(conn, session_id)?;
    if session.ended_at.is_some() {
        return Err(Error::Invalid("this conversation has already ended".into()));
    }
    Ok(session)
}

/// Nothing is stored until the partner answers, so a failed call can simply
/// be sent again.
pub fn send(
    ctx: Ctx<'_>,
    session_id: &str,
    sent_text: &str,
    recording: Option<&Recording>,
    on_delta: OnDelta<'_>,
) -> Result<TurnReply> {
    let sent_text = sent_text.trim();
    if sent_text.is_empty() {
        return Err(Error::Invalid("nothing to send".into()));
    }
    let (session, mut turns, params) = {
        let conn = ctx.conn()?;
        let session = open_session(&conn, session_id)?;
        let profile = require_profile(&conn)?;
        let turns = sessions::list_turns(&conn, session_id)?;
        let context = chat_context(&conn, &session.setup, &profile, Utc::now())?;
        let mut history: Vec<HistoryTurn> = turns
            .iter()
            .map(|t| HistoryTurn {
                role: t.role,
                text: t.sent_text.clone(),
            })
            .collect();
        history.push(HistoryTurn {
            role: Role::User,
            text: sent_text.to_owned(),
        });
        let provider_ref = session.provider_ref.clone();
        (
            session,
            turns,
            ChatParams {
                context,
                history,
                provider_ref,
            },
        )
    };
    let reply = agent(ctx)?.chat(&params, &mut |t| on_delta(session_id, t))?;

    let conn = ctx.conn()?;
    let now = Utc::now();
    let user = NewTurn {
        session_id,
        role: Role::User,
        said_text: recording.map(|r| r.text.as_str()),
        sent_text,
        audio_id: recording.map(|r| r.audio_id.as_str()),
        speech_seconds: recording.map(|r| r.speech_seconds),
        words: metrics::count_words(sent_text),
    };
    let user_turn = sessions::insert_turn(&conn, &user, now)?;
    let reply_turn = sessions::insert_turn(&conn, &assistant_turn(session_id, &reply.text), now)?;
    sessions::set_provider_ref(&conn, session_id, reply.provider_ref.as_deref())?;
    turns.push(user_turn.clone());
    let speech_minutes = metrics::speech_minutes(&user_turns(&turns));
    let reached = session
        .setup
        .target_minutes
        .is_some_and(|target| speech_minutes >= target);
    let target_reached = reached && !session.target_notified;
    sessions::set_speech(
        &conn,
        session_id,
        speech_minutes,
        session.target_notified || reached,
    )?;
    Ok(TurnReply {
        user_turn,
        reply: reply_turn,
        length_hint: guide(session.setup.level).hint.to_owned(),
        scaffolds: scaffolds(session.setup.level, session.setup.mode),
        speech_minutes,
        target_reached,
    })
}

/// "¿Cómo digo…?": the one live help (SPEC §6.3). The first option goes to
/// the report's vocabulary; three per question would crowd it.
pub fn help(ctx: Ctx<'_>, session_id: &str, text: &str) -> Result<Vec<HelpOption>> {
    let text = text.trim();
    if text.is_empty() {
        return Err(Error::Invalid("nothing to translate".into()));
    }
    let params = {
        let conn = ctx.conn()?;
        open_session(&conn, session_id)?;
        let profile = require_profile(&conn)?;
        let recent = sessions::list_turns(&conn, session_id)?
            .into_iter()
            .rev()
            .find(|t| t.role == Role::Assistant)
            .map(|t| t.sent_text)
            .unwrap_or_default();
        HelpParams {
            native_lang: profile.native_lang,
            text: text.to_owned(),
            recent,
            variant: profile.variant,
        }
    };
    let options = agent(ctx)?.help(&params)?.options;
    if let Some(first) = options.first() {
        let item = VocabItem {
            asked: Some(text.to_owned()),
            english: first.english.clone(),
            note: first.note.clone(),
        };
        sessions::insert_vocab(&*ctx.conn()?, session_id, &item, Utc::now())?;
    }
    Ok(options)
}

// ── End of session ────────────────────────────────────────────────────────

/// Rule errors are worth trying to fix yourself first (SPEC §3.3); words
/// and collocations are simply given.
fn self_correct(kind: ErrorKind) -> bool {
    matches!(
        kind,
        ErrorKind::GrammarRule | ErrorKind::WordOrder | ErrorKind::Pronoun
    )
}

/// Kept in the UI language: the frontend shows it as is.
fn recurrence_text(ui_lang: UiLang, (hits, window): (u32, u32)) -> String {
    match ui_lang {
        UiLang::En => format!("Appeared in {hits} of your last {window} conversations"),
        UiLang::Es => format!("Apareció en {hits} de tus últimas {window} charlas"),
    }
}

fn previous_metrics(
    rows: &[SessionRow],
    session_id: &str,
    current: &SessionMetrics,
) -> Option<SessionMetrics> {
    let same: Vec<SessionMetrics> = rows
        .iter()
        .filter(|s| s.id != session_id)
        .filter_map(|s| s.metrics.clone())
        .filter(|m| m.modality == current.modality)
        .take(PREVIOUS_SESSIONS)
        .collect();
    metrics::mean(&same)
}

/// What end-of-session needs, read in one go before the analysis call.
struct Snapshot {
    session: SessionRow,
    profile: Profile,
    turns: Vec<Turn>,
    params: AnalyzeParams,
    challenge_id: Option<String>,
}

fn snapshot(conn: &Connection, session_id: &str) -> Result<Snapshot> {
    let session = sessions::get_session(conn, session_id)?;
    let profile = require_profile(conn)?;
    let turns = sessions::list_turns(conn, session_id)?;
    let rows = sessions::list_sessions(conn)?;
    let challenge = sessions::active_challenge(conn)?;
    let params = AnalyzeParams {
        level: session.setup.level,
        cefr: latest_cefr(&rows),
        native_lang: profile.native_lang.clone(),
        goal: profile.goal,
        variant: profile.variant,
        turns: turns
            .iter()
            .map(|t| AnalyzeTurn {
                id: t.id.clone(),
                role: t.role,
                said: t.said_text.clone(),
                sent: t.sent_text.clone(),
            })
            .collect(),
        patterns: patterns::list_patterns(conn)?
            .into_iter()
            .map(|p| KnownPattern {
                id: p.id,
                key: p.key,
                description: p.description,
            })
            .collect(),
        challenge: challenge.as_ref().and_then(|c| {
            Some(ChallengeRef {
                pattern_id: c.pattern_id.clone()?,
                text: c.text.clone(),
            })
        }),
    };
    Ok(Snapshot {
        session,
        profile,
        turns,
        params,
        challenge_id: challenge.map(|c| c.id),
    })
}

/// What the memory update decided, stored in the same transaction, so an
/// end that stopped before its report resumes from here and never applies
/// the analysis twice.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Applied {
    items: Vec<AppliedItem>,
    challenge_pattern_id: Option<String>,
    previous_achieved: Option<bool>,
    metrics: SessionMetrics,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppliedItem {
    item_id: String,
    role: CorrectionRole,
    pattern_id: String,
    event_id: String,
    recurrence: Option<(u32, u32)>,
}

/// A report correction: its role, its report item id and what it shows.
type Correction = (CorrectionRole, String, Pick);
/// The pattern the next challenge is about, with an example of its error.
type ChallengePattern = (PatternRow, Option<ErrorEvent>);

/// The report's corrections and the challenge's pattern, read back from
/// what was applied.
fn applied_picks(
    conn: &Connection,
    applied: &Applied,
) -> Result<(Vec<Correction>, Option<ChallengePattern>)> {
    let picks = applied
        .items
        .iter()
        .map(|i| {
            let pick = Pick {
                pattern: patterns::get_pattern(conn, &i.pattern_id)?,
                event: patterns::get_error_event(conn, &i.event_id)?,
                recurrence: i.recurrence,
            };
            Ok((i.role, i.item_id.clone(), pick))
        })
        .collect::<Result<_>>()?;
    let challenge = match applied.challenge_pattern_id.as_deref() {
        Some(id) => {
            let example = patterns::error_events(conn, Some(id))?.into_iter().next();
            Some((patterns::get_pattern(conn, id)?, example))
        }
        None => None,
    };
    Ok((picks, challenge))
}

/// Everything the analysis changes, in one transaction.
fn remember(
    conn: &mut Connection,
    snap: &Snapshot,
    analysis: &Analysis,
    now: DateTime<Utc>,
) -> Result<Applied> {
    let id = &snap.session.id;
    let tx = conn.transaction()?;
    sessions::save_analysis(&tx, id, &serde_json::to_string(analysis)?)?;
    let outcome = memory_update::apply(&tx, id, analysis, snap.profile.goal, now)?;
    for fact in &analysis.profile_facts {
        profile_repo::add_fact(&tx, fact, id, now)?;
    }
    if let Some(best) = analysis
        .best_sentence
        .as_deref()
        .filter(|b| !b.trim().is_empty())
    {
        sessions::insert_best_sentence(
            &tx,
            id,
            analysis.best_sentence_turn_id.as_deref(),
            best,
            now,
        )?;
    }
    for word in &analysis.partner_vocabulary {
        let item = VocabItem {
            asked: None,
            english: word.english.clone(),
            note: word.note.clone(),
        };
        sessions::insert_vocab(&tx, id, &item, now)?;
    }
    let previous_achieved = match &snap.challenge_id {
        Some(challenge) => {
            let achieved = analysis.challenge_achieved;
            sessions::close_challenge(
                &tx,
                challenge,
                achieved.unwrap_or(false).then_some(id.as_str()),
            )?;
            achieved
        }
        None => None,
    };
    sessions::mark_practice(&tx, local_date(now))?;
    let kept: Vec<_> = analysis
        .errors
        .iter()
        .filter(|e| crate::memory::keep_error(e))
        .collect();
    let counts = AnalysisCounts {
        errors: u32::try_from(kept.len()).unwrap_or(u32::MAX),
        global_errors: u32::try_from(kept.iter().filter(|e| e.global).count()).unwrap_or(u32::MAX),
        clauses_per_unit: analysis.complexity.clauses_per_unit,
        subordination_ratio: analysis.complexity.subordination_ratio,
    };
    let focus = outcome.focus.iter().map(|p| (CorrectionRole::Focus, p));
    let minors = outcome.minors.iter().map(|p| (CorrectionRole::Minor, p));
    let mut items = Vec::new();
    for (role, pick) in focus.chain(minors) {
        let item = patterns::ReportItem {
            id: new_id(),
            session_id: id.clone(),
            pattern_id: pick.pattern.id.clone(),
            event_id: pick.event.id.clone(),
            role,
        };
        patterns::insert_report_item(&tx, &item)?;
        items.push(AppliedItem {
            item_id: item.id,
            role,
            pattern_id: item.pattern_id,
            event_id: item.event_id,
            recurrence: pick.recurrence,
        });
    }
    let applied = Applied {
        items,
        challenge_pattern_id: outcome.challenge_pattern.map(|(p, _)| p.id),
        previous_achieved,
        metrics: session_metrics(&snap.turns, &counts),
    };
    sessions::save_applied(&tx, id, &serde_json::to_string(&applied)?)?;
    tx.commit()?;
    Ok(applied)
}

fn session_metrics(turns: &[Turn], counts: &AnalysisCounts) -> SessionMetrics {
    let partner_words = turns
        .iter()
        .filter(|t| t.role == Role::Assistant)
        .map(|t| t.words)
        .sum();
    metrics::compute(&user_turns(turns), partner_words, counts)
}

/// SPEC §7 order: achievement, focus, minors, could-have-said, vocabulary,
/// metrics, challenge.
struct CardInputs<'a> {
    analysis: &'a Analysis,
    picks: &'a [Correction],
    composed: &'a Composed,
    ui_lang: UiLang,
    vocabulary: Vec<VocabItem>,
    metrics: SessionMetrics,
    previous: Option<SessionMetrics>,
    challenge: Option<(String, Option<bool>)>,
}

fn cards(input: CardInputs<'_>) -> Vec<ReportCard> {
    let a = input.analysis;
    let mut cards = vec![ReportCard::Achievement {
        strengths: a.strengths.clone(),
        best_sentence: a.best_sentence.clone(),
        self_corrections: a
            .edits
            .iter()
            .filter(|e| e.kind == EditType::SelfCorrection)
            .map(|e| format!("{} → {}", e.before, e.after))
            .collect(),
    }];
    let composed: HashMap<&str, _> = input
        .composed
        .corrections
        .iter()
        .map(|c| (c.item_id.as_str(), c))
        .collect();
    for (role, item_id, pick) in input.picks {
        let text = composed.get(item_id.as_str());
        cards.push(ReportCard::Correction {
            role: *role,
            item_id: item_id.clone(),
            pattern_id: pick.pattern.id.clone(),
            original: pick.event.original.clone(),
            highlight: text.map_or_else(|| pick.event.original.clone(), |c| c.highlight.clone()),
            corrected: pick.event.corrected.clone(),
            explanation: text.map_or_else(
                || pick.pattern.description.clone(),
                |c| c.explanation.clone(),
            ),
            hint: text.map(|c| c.hint.clone()).unwrap_or_default(),
            self_correct: self_correct(pick.pattern.kind),
            recurrence: pick.recurrence.map(|r| recurrence_text(input.ui_lang, r)),
        });
    }
    if !a.could_have_said.is_empty() || a.native_rewrite.is_some() {
        cards.push(ReportCard::CouldHaveSaid {
            items: a
                .could_have_said
                .iter()
                .map(|c| Rewrite {
                    original: c.original.clone(),
                    better: c.better.clone(),
                    why: c.why.clone(),
                })
                .collect(),
            native_rewrite: a.native_rewrite.as_ref().map(|n| NativeRewrite {
                original: n.original.clone(),
                rewrite: n.rewrite.clone(),
            }),
        });
    }
    if !input.vocabulary.is_empty() {
        cards.push(ReportCard::Vocabulary {
            items: input.vocabulary,
        });
    }
    cards.push(ReportCard::Metrics {
        current: input.metrics,
        previous: input.previous,
        estimated_cefr: Some(a.cefr.overall),
    });
    if let Some((text, previous_achieved)) = input.challenge {
        cards.push(ReportCard::Challenge {
            text,
            previous_achieved,
        });
    }
    cards
}

/// A session with nothing said still ends, with its metrics only.
fn end_silent(conn: &Connection, snap: &Snapshot, now: DateTime<Utc>) -> Result<Report> {
    let metrics = session_metrics(&snap.turns, &AnalysisCounts::default());
    let report = Report {
        session_id: snap.session.id.clone(),
        cards: vec![ReportCard::Metrics {
            current: metrics.clone(),
            previous: None,
            estimated_cefr: None,
        }],
    };
    sessions::finish_session(conn, &snap.session.id, now, None, &metrics, &report)?;
    Ok(report)
}

fn compose_params(
    snap: &Snapshot,
    challenge: Option<&ChallengePattern>,
    picks: &[Correction],
) -> ComposeParams {
    ComposeParams {
        native_lang: snap.profile.native_lang.clone(),
        level: snap.session.setup.level,
        corrections: picks
            .iter()
            .map(|(_, item_id, p)| CorrectionInput {
                item_id: item_id.clone(),
                original: p.event.original.clone(),
                corrected: p.event.corrected.clone(),
                kind: p.pattern.kind,
                pattern_description: p.pattern.description.clone(),
            })
            .collect(),
        focus: challenge.map(|(p, example)| FocusInput {
            description: p.description.clone(),
            example: example
                .as_ref()
                .map(|e| e.corrected.clone())
                .unwrap_or_default(),
        }),
    }
}

/// Idempotent: a finished session returns its report, and one whose
/// analysis was applied but whose report was never written resumes at
/// composing, without calling the analysis again.
pub fn end(ctx: Ctx<'_>, session_id: &str, progress: &dyn Fn(AnalysisStep)) -> Result<Report> {
    let (snap, stored) = {
        let conn = ctx.conn()?;
        let snap = snapshot(&conn, session_id)?;
        if let Some(report) = snap.session.report.clone() {
            return Ok(report);
        }
        let stored = sessions::get_applied(&conn, session_id)?;
        if !snap.turns.iter().any(|t| t.role == Role::User) {
            let report = end_silent(&conn, &snap, Utc::now())?;
            progress(AnalysisStep::Done);
            return Ok(report);
        }
        (snap, stored)
    };
    let (analysis, applied) = if let Some((analysis, applied)) = stored {
        (
            serde_json::from_str(&analysis)?,
            serde_json::from_str(&applied)?,
        )
    } else {
        progress(AnalysisStep::Analyzing);
        let analysis = agent(ctx)?.analyze(&snap.params)?;
        let applied = remember(&mut *ctx.conn()?, &snap, &analysis, Utc::now())?;
        (analysis, applied)
    };

    progress(AnalysisStep::Composing);
    let (picks, challenge_pattern) = applied_picks(&*ctx.conn()?, &applied)?;
    let compose = compose_params(&snap, challenge_pattern.as_ref(), &picks);
    let composed = if compose.corrections.is_empty() && compose.focus.is_none() {
        Composed {
            corrections: Vec::new(),
            challenge: None,
        }
    } else {
        // The memory is already updated; a report without explanations
        // beats none. The cards fall back to the pattern descriptions.
        agent(ctx)
            .and_then(|a| a.compose(&compose))
            .unwrap_or_else(|err| {
                eprintln!("compose failed, report without explanations: {err}");
                Composed {
                    corrections: Vec::new(),
                    challenge: None,
                }
            })
    };

    let mut conn = ctx.conn()?;
    let tx = conn.transaction()?;
    let challenge = composed.challenge.as_ref().map(|c| {
        let pattern = challenge_pattern.as_ref().map(|(p, _)| p.id.as_str());
        sessions::insert_challenge(&tx, session_id, pattern, &c.text, c.target_count)
            .map(|()| (c.text.clone(), applied.previous_achieved))
    });
    let rows = sessions::list_sessions(&tx)?;
    let report = Report {
        session_id: session_id.to_owned(),
        cards: cards(CardInputs {
            analysis: &analysis,
            picks: &picks,
            composed: &composed,
            ui_lang: snap.profile.ui_lang,
            vocabulary: sessions::list_vocab(&tx, Some(session_id))?
                .into_iter()
                .map(|(v, _)| v)
                .collect(),
            previous: previous_metrics(&rows, session_id, &applied.metrics),
            metrics: applied.metrics.clone(),
            challenge: challenge.transpose()?,
        }),
    };
    sessions::finish_session(
        &tx,
        session_id,
        Utc::now(),
        Some(analysis.cefr.overall),
        &applied.metrics,
        &report,
    )?;
    tx.commit()?;
    progress(AnalysisStep::Done);
    Ok(report)
}

pub fn check_attempt(ctx: Ctx<'_>, item_id: &str, attempt: &str) -> Result<SelfCheck> {
    let attempt = attempt.trim();
    if attempt.is_empty() {
        return Err(Error::Invalid("write or say your attempt first".into()));
    }
    let params = {
        let conn = ctx.conn()?;
        let item = patterns::get_report_item(&conn, item_id)?;
        let event = patterns::get_error_event(&conn, &item.event_id)?;
        SelfCheckParams {
            native_lang: require_profile(&conn)?.native_lang,
            original: event.original,
            corrected: event.corrected,
            attempt: attempt.to_owned(),
        }
    };
    let result = agent(ctx)?.self_check(&params)?;
    patterns::record_attempt(&*ctx.conn()?, item_id, result.correct)?;
    Ok(result)
}

pub fn dispute(ctx: Ctx<'_>, item_id: &str) -> Result<()> {
    let mut conn = ctx.conn()?;
    let tx = conn.transaction()?;
    let item = patterns::get_report_item(&tx, item_id)?;
    memory_update::dispute(&tx, &item.event_id, Utc::now())?;
    Ok(tx.commit()?)
}

/// Removes recordings (`<data_dir>/audio/<audioId>.wav`), for one session or
/// all of them; with no session, stray files go too.
pub fn delete_audio(ctx: Ctx<'_>, session_id: Option<&str>) -> Result<()> {
    let conn = ctx.conn()?;
    let dir = ctx.data_dir.join("audio");
    for id in sessions::audio_ids(&conn, session_id)? {
        remove_if_present(&dir.join(format!("{id}.wav")))?;
    }
    if session_id.is_none() && dir.is_dir() {
        for entry in std::fs::read_dir(&dir)? {
            let path = entry?.path();
            if path.extension().is_some_and(|e| e == "wav") {
                remove_if_present(&path)?;
            }
        }
    }
    sessions::clear_audio(&conn, session_id)
}

fn remove_if_present(path: &Path) -> Result<()> {
    match std::fs::remove_file(path) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.into()),
        _ => Ok(()),
    }
}

// ── Commands ──────────────────────────────────────────────────────────────

fn emit_delta(app: &AppHandle) -> impl FnMut(&str, &str) + '_ {
    move |session_id, text| {
        // A closed window is the only way this fails; the turn goes on.
        let delta = ChatDelta {
            session_id: session_id.to_owned(),
            text: text.to_owned(),
        };
        let _ = app.emit("chat-delta", delta);
    }
}

#[tauri::command]
pub async fn home_state(app: AppHandle) -> Result<HomeState> {
    run(app, |_, ctx| home(ctx, Utc::now())).await
}

#[tauri::command]
pub async fn start_session(app: AppHandle, setup: SessionSetup) -> Result<SessionStarted> {
    run(app, move |app, ctx| {
        start(ctx, &setup, &mut emit_delta(app))
    })
    .await
}

#[tauri::command]
pub async fn send_turn(
    app: AppHandle,
    session_id: String,
    sent_text: String,
    recording: Option<Recording>,
) -> Result<TurnReply> {
    run(app, move |app, ctx| {
        send(
            ctx,
            &session_id,
            &sent_text,
            recording.as_ref(),
            &mut emit_delta(app),
        )
    })
    .await
}

#[tauri::command]
pub async fn help_translate(
    app: AppHandle,
    session_id: String,
    text: String,
) -> Result<Vec<HelpOption>> {
    run(app, move |_, ctx| help(ctx, &session_id, &text)).await
}

#[tauri::command]
pub async fn end_session(app: AppHandle, session_id: String) -> Result<Report> {
    run(app, move |app, ctx| {
        let progress = |step| {
            let _ = app.emit(
                "analysis-progress",
                AnalysisProgress {
                    session_id: session_id.clone(),
                    step,
                },
            );
        };
        end(ctx, &session_id, &progress)
    })
    .await
}

#[tauri::command]
pub async fn get_report(app: AppHandle, session_id: String) -> Result<Option<Report>> {
    run(app, move |_, ctx| {
        Ok(sessions::get_session(&*ctx.conn()?, &session_id)?.report)
    })
    .await
}

#[tauri::command]
pub async fn self_check(app: AppHandle, item_id: String, attempt: String) -> Result<SelfCheck> {
    run(app, move |_, ctx| check_attempt(ctx, &item_id, &attempt)).await
}

#[tauri::command]
pub async fn dispute_item(app: AppHandle, item_id: String) -> Result<()> {
    run(app, move |_, ctx| dispute(ctx, &item_id)).await
}

#[tauri::command]
pub async fn delete_session_audio(app: AppHandle, session_id: Option<String>) -> Result<()> {
    run(app, move |_, ctx| delete_audio(ctx, session_id.as_deref())).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::protocol::ConfigureParams;
    use crate::agent::Agent;
    use crate::db::open_in_memory;
    use crate::domain::{Cefr, ProviderMode};
    use std::sync::Mutex;

    /// An analysis applied, then a crash before the report was written.
    fn applied_but_unreported(ctx: Ctx<'_>) -> String {
        let mut conn = ctx.conn().expect("conn");
        profile_repo::save_profile(&conn, &crate::db::profile::tests::profile()).expect("profile");
        let id = sessions::insert_session(&conn, &sessions::tests::setup(), Utc::now())
            .expect("session");
        sessions::insert_turn(&conn, &assistant_turn(&id, "What did you do?"), Utc::now())
            .expect("opening");
        let user = NewTurn {
            session_id: &id,
            role: Role::User,
            said_text: None,
            sent_text: "Yesterday I go to the market",
            audio_id: None,
            speech_seconds: None,
            words: 6,
        };
        let turn = sessions::insert_turn(&conn, &user, Utc::now()).expect("turn");
        let analysis: Analysis = serde_json::from_value(serde_json::json!({
            "errors": [{
                "turnId": turn.id, "original": "I go", "corrected": "I went",
                "kind": "grammarRule", "global": false, "ruleBased": true, "aboveLevel": false,
                "pattern": {"existingId": null, "newKey": "past-simple", "description": "Pasado"},
                "confidence": 0.9, "asrSuspect": false
            }],
            "correctUses": [], "edits": [], "couldHaveSaid": [], "nativeRewrite": null,
            "strengths": ["On topic"], "bestSentenceTurnId": null, "bestSentence": null,
            "complexity": {"clausesPerUnit": null, "subordinationRatio": null},
            "cefr": {"range": "B1", "accuracy": "B1", "fluency": "B1", "interaction": "B1",
                     "coherence": "B1", "overall": "B1"},
            "profileFacts": [], "partnerVocabulary": [], "challengeAchieved": null
        }))
        .expect("analysis");
        let snap = snapshot(&conn, &id).expect("snapshot");
        remember(&mut conn, &snap, &analysis, Utc::now()).expect("remember");
        id
    }

    fn count(ctx: Ctx<'_>, table: &str) -> i64 {
        ctx.conn()
            .expect("conn")
            .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
            .expect("count")
    }

    #[test]
    fn end_resumes_after_a_crash_without_reapplying_the_analysis() {
        let dir = tempfile::tempdir().expect("tempdir");
        let db = Mutex::new(open_in_memory().expect("db"));
        // No sidecar at all: analyzing would fail, so success proves it was
        // skipped; composing fails too and falls back.
        let agent = Agent::new(None);
        agent.configure(ConfigureParams {
            mode: ProviderMode::ApiKey,
            model: "m".into(),
            effort: None,
            api_key: Some("k".into()),
            claude_path: None,
        });
        let ctx = Ctx {
            db: &db,
            agent: &agent,
            data_dir: dir.path(),
        };
        let id = applied_but_unreported(ctx);
        assert_eq!(
            (count(ctx, "pattern_events"), count(ctx, "report_items")),
            (1, 1)
        );

        let steps = Mutex::new(Vec::new());
        let report = end(ctx, &id, &|s| steps.lock().expect("steps").push(s)).expect("resume");
        assert_eq!(
            *steps.lock().expect("steps"),
            [AnalysisStep::Composing, AnalysisStep::Done]
        );
        assert_eq!(
            (count(ctx, "pattern_events"), count(ctx, "report_items")),
            (1, 1)
        );
        let Some(ReportCard::Correction {
            explanation,
            original,
            ..
        }) = report.cards.get(1)
        else {
            panic!("focus correction second");
        };
        assert_eq!(
            (explanation.as_str(), original.as_str()),
            ("Pasado", "I go")
        );

        // Finished: the stored report comes back, nothing else runs.
        steps.lock().expect("steps").clear();
        let again = end(ctx, &id, &|s| steps.lock().expect("steps").push(s)).expect("again");
        assert_eq!(again, report);
        assert!(steps.lock().expect("steps").is_empty());
        assert_eq!(count(ctx, "pattern_events"), 1);
    }

    #[test]
    fn level_guides_match_the_spec_table() {
        assert_eq!(
            [BASIC.min_words, INTERMEDIATE.min_words, ADVANCED.min_words],
            [5, 20, 60]
        );
        assert_eq!(guide(Level::Intermediate).hint, "Try 2–3 sentences");
    }

    #[test]
    fn scaffolds_only_at_basic_level() {
        assert_ne!(scaffolds(Level::Basic, Mode::Debate), [] as [String; 0]);
        assert_eq!(
            scaffolds(Level::Intermediate, Mode::Debate),
            [] as [String; 0]
        );
    }

    #[test]
    fn suggests_another_mode_after_four_in_a_row() {
        use Mode::{Casual, Debate, Story};
        assert_eq!(rotation_suggestion(&[Casual, Casual, Casual]), None);
        assert_eq!(rotation_suggestion(&[Casual, Casual, Story, Casual]), None);
        // Never-used modes come first, in rotation order.
        assert_eq!(
            rotation_suggestion(&[Casual, Casual, Casual, Casual]),
            Some(Story)
        );
        let all_used = [
            Story,
            Story,
            Story,
            Story,
            Casual,
            Mode::Interview,
            Mode::Roleplay,
            Debate,
        ];
        assert_eq!(
            rotation_suggestion(&all_used),
            Some(Debate),
            "least recently used"
        );
    }

    #[test]
    fn suggests_a_level_after_three_estimates_outside_it() {
        let above = (Level::Basic, Cefr::B1);
        assert_eq!(level_suggestion(&[above, above]), None);
        assert_eq!(
            level_suggestion(&[above, above, above]),
            Some(Level::Intermediate)
        );
        let inside = (Level::Basic, Cefr::A2);
        assert_eq!(level_suggestion(&[above, inside, above]), None);
        let far = (Level::Basic, Cefr::C1);
        assert_eq!(
            level_suggestion(&[above, far, above]),
            None,
            "mixed directions"
        );
    }

    #[test]
    fn topics_mix_interests_and_defaults_without_duplicates() {
        let mut profile = crate::db::profile::tests::profile();
        profile.interests = vec!["Chess".into(), "chess".into(), " ".into()];
        let topics = suggested_topics(&profile);
        assert_eq!(topics.len(), MAX_TOPICS);
        assert_eq!(topics[0], "Chess");
        assert_eq!(topics[1], DEFAULT_TOPICS[0]);
    }

    #[test]
    fn recurrence_speaks_the_ui_language() {
        assert_eq!(
            recurrence_text(UiLang::En, (4, 6)),
            "Appeared in 4 of your last 6 conversations"
        );
        assert_eq!(
            recurrence_text(UiLang::Es, (4, 6)),
            "Apareció en 4 de tus últimas 6 charlas"
        );
    }
}
