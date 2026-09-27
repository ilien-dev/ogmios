//! Two-minute drills (SPEC §9): three warm-up items on one pattern, two
//! mixed with the other active ones, graded one by one.

use chrono::Utc;
use tauri::AppHandle;

use super::profile::{agent, require_profile};
use super::run;
use crate::agent::protocol::{
    DrillGenerateParams, DrillGradeParams, DrillPattern, GeneratedDrillItem,
};
use crate::db::drills::{self, StoredItem};
use crate::db::patterns::{self, PatternRow};
use crate::domain::{Drill, DrillFormat, DrillItem, DrillResult};
use crate::error::{Error, Result};
use crate::memory::{is_active, update as memory_update};
use crate::Ctx;

/// Warm-up items on the target pattern, then interleaved ones (SPEC §9.2).
const BLOCKED: u32 = 3;
const MIXED: u32 = 2;
/// Other active patterns mixed in.
const MIXED_PATTERNS: usize = 2;
/// Error examples the generator sees per pattern.
const EXAMPLES: usize = 3;
/// Formats in the order a pattern cycles through them.
const FORMATS: [DrillFormat; 4] = [
    DrillFormat::SameStructure,
    DrillFormat::Transformation,
    DrillFormat::SpotError,
    DrillFormat::GuidedChat,
];

/// The active pattern whose review is most overdue; unscheduled ones last.
fn most_overdue(all: &[PatternRow]) -> Option<&PatternRow> {
    all.iter()
        .filter(|p| is_active(p.state))
        .min_by_key(|p| (p.next_review_at.is_none(), p.next_review_at))
}

fn drill_pattern(conn: &rusqlite::Connection, p: &PatternRow) -> Result<DrillPattern> {
    Ok(DrillPattern {
        id: p.id.clone(),
        description: p.description.clone(),
        examples: patterns::examples(conn, &p.id, EXAMPLES)?,
    })
}

fn visible(index: usize, item: &GeneratedDrillItem) -> DrillItem {
    DrillItem {
        index: u32::try_from(index).unwrap_or(u32::MAX),
        format: item.format,
        pattern_id: item.pattern_id.clone(),
        prompt: item.prompt.clone(),
        instruction: item.instruction.clone(),
        options: item.options.clone(),
    }
}

pub fn start(ctx: Ctx<'_>, pattern_id: Option<&str>, format: Option<DrillFormat>) -> Result<Drill> {
    let (target, params) = {
        let conn = ctx.conn()?;
        let profile = require_profile(&conn)?;
        let all = patterns::list_patterns(&conn)?;
        let target = match pattern_id {
            Some(id) => patterns::get_pattern(&conn, id)?,
            None => most_overdue(&all)
                .cloned()
                .ok_or_else(|| Error::NotFound("nothing to practise yet".into()))?,
        };
        let format = if let Some(format) = format {
            format
        } else {
            let done = usize::try_from(drills::count_for(&conn, &target.id)?).unwrap_or(0);
            FORMATS[done % FORMATS.len()]
        };
        let mut others: Vec<&PatternRow> = all
            .iter()
            .filter(|p| is_active(p.state) && p.id != target.id)
            .collect();
        others.sort_by_key(|p| (p.next_review_at.is_none(), p.next_review_at));
        others.truncate(MIXED_PATTERNS);
        let mut pats = vec![drill_pattern(&conn, &target)?];
        for p in others {
            pats.push(drill_pattern(&conn, p)?);
        }
        let (blocked, mixed) = if pats.len() > 1 {
            (BLOCKED, MIXED)
        } else {
            (BLOCKED + MIXED, 0)
        };
        let params = DrillGenerateParams {
            native_lang: profile.native_lang,
            level: profile.level,
            format,
            patterns: pats,
            blocked,
            mixed,
        };
        (target, params)
    };
    let items = agent(ctx)?.drill_generate(&params)?.items;
    if items.is_empty() {
        return Err(Error::Provider(
            "Claude returned no exercises; try again".into(),
        ));
    }
    let stored: Vec<StoredItem> = items
        .into_iter()
        .map(|item| StoredItem {
            item,
            retry_of: None,
            correct: None,
        })
        .collect();
    let id = drills::insert_drill(
        &*ctx.conn()?,
        &target.id,
        params.format,
        &stored,
        Utc::now(),
    )?;
    Ok(Drill {
        id,
        items: stored
            .iter()
            .enumerate()
            .map(|(i, s)| visible(i, &s.item))
            .collect(),
    })
}

/// Grades one item. A miss gets one fresh item on the same pattern, once;
/// the finished drill counts as a review of its target.
pub fn answer(ctx: Ctx<'_>, drill_id: &str, index: u32, response: &str) -> Result<DrillResult> {
    let at = usize::try_from(index).unwrap_or(usize::MAX);
    let (item, params) = {
        let conn = ctx.conn()?;
        let drill = drills::get_drill(&conn, drill_id)?;
        let stored = drill
            .items
            .get(at)
            .ok_or_else(|| Error::NotFound("drill item not found".into()))?;
        if stored.correct.is_some() {
            return Err(Error::Invalid("this item is already answered".into()));
        }
        let params = DrillGradeParams {
            native_lang: require_profile(&conn)?.native_lang,
            item: stored.item.clone(),
            response: response.trim().to_owned(),
        };
        (stored.clone(), params)
    };
    let agent = agent(ctx)?;
    let grade = agent.drill_grade(&params)?;

    let needs_retry = !grade.correct && item.retry_of.is_none() && {
        let drill = drills::get_drill(&*ctx.conn()?, drill_id)?;
        !drill.items.iter().any(|s| s.retry_of == Some(index))
    };
    let retry_item = if needs_retry {
        let generate = {
            let conn = ctx.conn()?;
            let pattern = patterns::get_pattern(&conn, &item.item.pattern_id).ok();
            let pattern = match pattern {
                Some(p) => drill_pattern(&conn, &p)?,
                None => DrillPattern {
                    id: item.item.pattern_id.clone(),
                    description: item.item.instruction.clone(),
                    examples: Vec::new(),
                },
            };
            DrillGenerateParams {
                native_lang: params.native_lang.clone(),
                level: require_profile(&conn)?.level,
                format: item.item.format,
                patterns: vec![pattern],
                blocked: 1,
                mixed: 0,
            }
        };
        agent.drill_generate(&generate)?.items.into_iter().next()
    } else {
        None
    };

    let now = Utc::now();
    let mut conn = ctx.conn()?;
    let tx = conn.transaction()?;
    let mut drill = drills::get_drill(&tx, drill_id)?;
    if let Some(stored) = drill.items.get_mut(at) {
        stored.correct = Some(grade.correct);
    }
    let retry = retry_item.map(|item| {
        drill.items.push(StoredItem {
            item,
            retry_of: Some(index),
            correct: None,
        });
        let last = drill.items.len() - 1;
        visible(last, &drill.items[last].item)
    });
    drills::save_items(&tx, drill_id, &drill.items)?;
    if patterns::get_pattern(&tx, &item.item.pattern_id).is_ok() {
        memory_update::record_drill(&tx, &item.item.pattern_id, grade.correct, now)?;
    }
    if let Some(target) = drill.pattern_id.as_deref() {
        if drill.items.iter().all(|s| s.correct.is_some()) {
            memory_update::review_done(&tx, target, now)?;
        }
    }
    tx.commit()?;
    Ok(DrillResult {
        correct: grade.correct,
        explanation: grade.explanation,
        expected: grade.expected,
        retry,
    })
}

#[tauri::command]
pub async fn start_drill(
    app: AppHandle,
    pattern_id: Option<String>,
    format: Option<DrillFormat>,
) -> Result<Drill> {
    run(app, move |_, ctx| start(ctx, pattern_id.as_deref(), format)).await
}

#[tauri::command]
pub async fn answer_drill(
    app: AppHandle,
    drill_id: String,
    index: u32,
    response: String,
) -> Result<DrillResult> {
    run(app, move |_, ctx| answer(ctx, &drill_id, index, &response)).await
}
