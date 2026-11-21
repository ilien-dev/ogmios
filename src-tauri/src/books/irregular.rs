//! Whether an English verb is irregular: its past or its past participle is
//! not the verb with "-ed". English has a closed list of them, so the code
//! decides, never the model. A verb is looked up by any of its forms, and a
//! phrasal verb by the verb it starts with: "run out" is as irregular as
//! "run".

use crate::domain::{PartOfSpeech, VerbForm};

/// The irregular verbs a reader meets, each as its base form, its past and
/// its past participle, with every form a dictionary gives where there are
/// two ("got", "gotten"). A verb whose usual past ends in "-ed" ("learned",
/// "dreamed", "burned") is left out: a learner who writes "-ed" is right.
const IRREGULAR: &[(&str, &str, &str)] = &[
    ("arise", "arose", "arisen"),
    ("awake", "awoke", "awoken"),
    ("be", "was were", "been"),
    ("bear", "bore", "borne born"),
    ("beat", "beat", "beaten"),
    ("become", "became", "become"),
    ("begin", "began", "begun"),
    ("bend", "bent", "bent"),
    ("bet", "bet", "bet"),
    ("bid", "bid", "bid"),
    ("bind", "bound", "bound"),
    ("bite", "bit", "bitten"),
    ("bleed", "bled", "bled"),
    ("blow", "blew", "blown"),
    ("break", "broke", "broken"),
    ("breed", "bred", "bred"),
    ("bring", "brought", "brought"),
    ("build", "built", "built"),
    ("burst", "burst", "burst"),
    ("buy", "bought", "bought"),
    ("cast", "cast", "cast"),
    ("catch", "caught", "caught"),
    ("choose", "chose", "chosen"),
    ("cling", "clung", "clung"),
    ("come", "came", "come"),
    ("cost", "cost", "cost"),
    ("creep", "crept", "crept"),
    ("cut", "cut", "cut"),
    ("deal", "dealt", "dealt"),
    ("dig", "dug", "dug"),
    ("do", "did", "done"),
    ("draw", "drew", "drawn"),
    ("drink", "drank", "drunk"),
    ("drive", "drove", "driven"),
    ("eat", "ate", "eaten"),
    ("fall", "fell", "fallen"),
    ("feed", "fed", "fed"),
    ("feel", "felt", "felt"),
    ("fight", "fought", "fought"),
    ("find", "found", "found"),
    ("flee", "fled", "fled"),
    ("fling", "flung", "flung"),
    ("fly", "flew", "flown"),
    ("forbid", "forbade", "forbidden"),
    ("forget", "forgot", "forgotten"),
    ("forgive", "forgave", "forgiven"),
    ("freeze", "froze", "frozen"),
    ("get", "got", "got gotten"),
    ("give", "gave", "given"),
    ("go", "went", "gone"),
    ("grind", "ground", "ground"),
    ("grow", "grew", "grown"),
    ("hang", "hung", "hung"),
    ("have", "had", "had"),
    ("hear", "heard", "heard"),
    ("hide", "hid", "hidden"),
    ("hit", "hit", "hit"),
    ("hold", "held", "held"),
    ("hurt", "hurt", "hurt"),
    ("keep", "kept", "kept"),
    ("kneel", "knelt", "knelt"),
    ("know", "knew", "known"),
    ("lay", "laid", "laid"),
    ("lead", "led", "led"),
    ("leave", "left", "left"),
    ("lend", "lent", "lent"),
    ("let", "let", "let"),
    ("lie", "lay", "lain"),
    ("light", "lit", "lit"),
    ("lose", "lost", "lost"),
    ("make", "made", "made"),
    ("mean", "meant", "meant"),
    ("meet", "met", "met"),
    ("mistake", "mistook", "mistaken"),
    ("overcome", "overcame", "overcome"),
    ("pay", "paid", "paid"),
    ("put", "put", "put"),
    ("quit", "quit", "quit"),
    ("read", "read", "read"),
    ("ride", "rode", "ridden"),
    ("ring", "rang", "rung"),
    ("rise", "rose", "risen"),
    ("run", "ran", "run"),
    ("say", "said", "said"),
    ("see", "saw", "seen"),
    ("seek", "sought", "sought"),
    ("sell", "sold", "sold"),
    ("send", "sent", "sent"),
    ("set", "set", "set"),
    ("shake", "shook", "shaken"),
    ("shed", "shed", "shed"),
    ("shine", "shone", "shone"),
    ("shoot", "shot", "shot"),
    ("show", "showed", "shown"),
    ("shrink", "shrank", "shrunk"),
    ("shut", "shut", "shut"),
    ("sing", "sang", "sung"),
    ("sink", "sank", "sunk"),
    ("sit", "sat", "sat"),
    ("slay", "slew", "slain"),
    ("sleep", "slept", "slept"),
    ("slide", "slid", "slid"),
    ("sling", "slung", "slung"),
    ("slit", "slit", "slit"),
    ("speak", "spoke", "spoken"),
    ("speed", "sped", "sped"),
    ("spend", "spent", "spent"),
    ("spin", "spun", "spun"),
    ("spit", "spat", "spat"),
    ("split", "split", "split"),
    ("spread", "spread", "spread"),
    ("spring", "sprang", "sprung"),
    ("stand", "stood", "stood"),
    ("steal", "stole", "stolen"),
    ("stick", "stuck", "stuck"),
    ("sting", "stung", "stung"),
    ("stink", "stank", "stunk"),
    ("stride", "strode", "stridden"),
    ("strike", "struck", "struck"),
    ("string", "strung", "strung"),
    ("strive", "strove", "striven"),
    ("swear", "swore", "sworn"),
    ("sweep", "swept", "swept"),
    ("swell", "swelled", "swollen"),
    ("swim", "swam", "swum"),
    ("swing", "swung", "swung"),
    ("take", "took", "taken"),
    ("teach", "taught", "taught"),
    ("tear", "tore", "torn"),
    ("tell", "told", "told"),
    ("think", "thought", "thought"),
    ("throw", "threw", "thrown"),
    ("thrust", "thrust", "thrust"),
    ("tread", "trod", "trodden"),
    ("understand", "understood", "understood"),
    ("undertake", "undertook", "undertaken"),
    ("upset", "upset", "upset"),
    ("wake", "woke", "woken"),
    ("wear", "wore", "worn"),
    ("weave", "wove", "woven"),
    ("weep", "wept", "wept"),
    ("win", "won", "won"),
    ("wind", "wound", "wound"),
    ("withdraw", "withdrew", "withdrawn"),
    ("wring", "wrung", "wrung"),
    ("write", "wrote", "written"),
];

/// Whether `word` is a form of an irregular verb: its base form, or with
/// `any` its past or its past participle too.
fn listed(word: &str, any: bool) -> bool {
    IRREGULAR.iter().any(|(base, past, participle)| {
        *base == word
            || (any
                && (past.split(' ').any(|form| form == word)
                    || participle.split(' ').any(|form| form == word)))
    })
}

/// The base forms a form ending in "-s" or "-ing" could come from: "spins"
/// and "spinning" from "spin", "makes" and "making" from "make".
fn bases(word: &str) -> Vec<String> {
    let mut found = vec![word.to_owned()];
    for ending in ["ing", "s", "es"] {
        if let Some(stem) = word.strip_suffix(ending).filter(|stem| stem.len() > 1) {
            found.push(stem.to_owned());
            found.push(format!("{stem}e"));
            // "spinning": the consonant doubled before "-ing".
            let mut letters = stem.chars();
            let last = letters.next_back();
            let shorter = letters.as_str().to_owned();
            if last.is_some() && last == letters.next_back() {
                found.push(shorter);
            }
        }
    }
    if let Some(stem) = word.strip_suffix("ies") {
        found.push(format!("{stem}y"));
    }
    found
}

/// Whether a verb, written as `verb` in the form `form`, is irregular; for
/// a phrasal verb, whether the verb it starts with is. A base form of the
/// list is irregular whatever its form. A form that is no past is looked up
/// among base forms alone: "found" in its base form is "to found", which
/// takes "-ed", not the past of "find". A word that is only the past of an
/// irregular verb, in a form nobody said, is none: it may be another verb
/// written alike ("bore", to bore; "wound", to wound), and no chip is
/// better than a wrong one.
pub fn irregular(verb: &str, form: Option<VerbForm>) -> Option<bool> {
    let lower = verb.trim().to_lowercase();
    let head = lower.split_whitespace().next().unwrap_or_default();
    let candidates = bases(head);
    if candidates.iter().any(|each| listed(each, false)) {
        return Some(true);
    }
    let past = candidates.iter().any(|each| listed(each, true));
    match form {
        Some(VerbForm::Base | VerbForm::Present | VerbForm::Ing) => Some(false),
        Some(VerbForm::Past | VerbForm::PastParticiple) => Some(past),
        None => (!past).then_some(false),
    }
}

/// Whether a word is an irregular verb, a regular one, or neither (none): no
/// verb at all, since only a word its chapter calls a verb or a phrasal verb
/// has an answer, or a verb [`irregular`] cannot say of.
pub fn regularity(
    part_of_speech: Option<PartOfSpeech>,
    word: &str,
    form: Option<VerbForm>,
) -> Option<bool> {
    if matches!(
        part_of_speech,
        Some(PartOfSpeech::Verb | PartOfSpeech::PhrasalVerb)
    ) {
        irregular(word, form)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_verb_is_irregular_by_any_of_its_forms() {
        for form in ["tear", "tearing", "tears"] {
            assert_eq!(irregular(form, None), Some(true), "{form}");
        }
        assert_eq!(irregular("tore", Some(VerbForm::Past)), Some(true));
        assert_eq!(
            irregular("torn", Some(VerbForm::PastParticiple)),
            Some(true)
        );
        assert_eq!(irregular("spinning", Some(VerbForm::Ing)), Some(true));
        assert_eq!(irregular("making", Some(VerbForm::Ing)), Some(true));
        assert_eq!(
            irregular("gotten", Some(VerbForm::PastParticiple)),
            Some(true)
        );
    }

    #[test]
    fn a_verb_that_takes_ed_is_regular() {
        for verb in [
            "linger",
            "lingers",
            "lingering",
            "tumbled",
            "wait",
            "carries",
        ] {
            assert_eq!(irregular(verb, None), Some(false), "{verb}");
        }
    }

    #[test]
    fn a_phrasal_verb_is_as_irregular_as_the_verb_it_starts_with() {
        assert_eq!(irregular("run out", Some(VerbForm::Base)), Some(true));
        assert_eq!(irregular("gave up", Some(VerbForm::Past)), Some(true));
        assert_eq!(irregular("look after", Some(VerbForm::Base)), Some(false));
    }

    #[test]
    fn a_base_form_is_looked_up_among_base_forms_alone() {
        // "to found" takes "-ed"; "found", the past of "find", does not.
        assert_eq!(irregular("found", Some(VerbForm::Base)), Some(false));
        assert_eq!(irregular("found", Some(VerbForm::Past)), Some(true));
        assert_eq!(irregular("find", Some(VerbForm::Base)), Some(true));
    }

    #[test]
    fn a_past_written_like_another_verb_says_nothing_when_its_form_is_not_known() {
        // To bore, to wound, to grind meat or the ground, to bind or be bound,
        // to found, to saw: each may be a regular verb of its own.
        for word in ["bore", "wound", "ground", "bound", "found", "saw"] {
            assert_eq!(irregular(word, None), None, "{word}");
        }
    }

    #[test]
    fn only_a_verb_has_a_regularity() {
        let past = Some(VerbForm::Past);
        assert_eq!(
            regularity(Some(PartOfSpeech::Verb), "wept", past),
            Some(true)
        );
        assert_eq!(
            regularity(Some(PartOfSpeech::PhrasalVerb), "pick up", None),
            Some(false)
        );
        assert_eq!(regularity(Some(PartOfSpeech::Noun), "found", past), None);
        assert_eq!(regularity(None, "run", None), None);
    }
}
