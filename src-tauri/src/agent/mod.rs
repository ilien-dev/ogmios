//! The `ogmios-agent` sidecar: spawned on first use, spoken to in JSON lines
//! (`shared/protocol.ts`), respawned on the next call after it dies.
//!
//! Every call blocks its thread until the response arrives, so commands run
//! it on the blocking pool. Requests carry ids; a reader thread routes each
//! incoming line to the caller waiting on that id.

pub mod protocol;

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::{json, Value};

use crate::domain::{ModelOption, ProviderCheck, SelfCheck};
use crate::error::{Error, Result};
use protocol::{
    Analysis, AnalyzeParams, ChatParams, ChatResult, ComposeParams, Composed, ConfigureParams,
    DrillGenerateParams, DrillGrade, DrillGradeParams, DrillSet, HelpParams, HelpResult,
    SelfCheckParams,
};

/// How long a call may go without any line from the sidecar. Streaming chat
/// resets the clock with every delta.
const CONFIGURE_TIMEOUT: Duration = Duration::from_secs(10);
const CHECK_TIMEOUT: Duration = Duration::from_secs(60);
const MODELS_TIMEOUT: Duration = Duration::from_secs(30);
const CHAT_TIMEOUT: Duration = Duration::from_secs(90);
const HELP_TIMEOUT: Duration = Duration::from_secs(60);
const ANALYZE_TIMEOUT: Duration = Duration::from_secs(300);
const COMPOSE_TIMEOUT: Duration = Duration::from_secs(180);
const DRILL_TIMEOUT: Duration = Duration::from_secs(120);
/// One piece of a chapter at "most words" is a long answer.
const VOCAB_TIMEOUT: Duration = Duration::from_secs(300);
/// A verdict on one answer is two short lines.
const JUDGE_TIMEOUT: Duration = Duration::from_secs(60);
/// A whole chapter is read for its brief; a paragraph is a short answer.
const BRIEF_TIMEOUT: Duration = Duration::from_secs(300);
const PARAGRAPH_TIMEOUT: Duration = Duration::from_secs(120);

/// What a sidecar built from another `shared/protocol.ts` is refused with.
/// In development it is the one `tauri:dev` built when it started.
const STALE_SIDECAR: &str =
    "The ogmios-agent helper is from another build of Ogmios. Restart the app; in development, restart `bun run tauri:dev`.";

/// 32-bit FNV-1a of the text's bytes, whatever its line endings: the hash
/// `sidecar/fingerprint.ts` takes.
fn fingerprint_of(text: &str) -> u32 {
    text.bytes()
        .filter(|byte| *byte != b'\r')
        .fold(2_166_136_261, |hash, byte| {
            (hash ^ u32::from(byte)).wrapping_mul(16_777_619)
        })
}

/// The fingerprint of the protocol this app was built from. A sidecar says
/// its own when it answers `configure`; the two must agree.
fn protocol_fingerprint() -> u32 {
    fingerprint_of(include_str!("../../../shared/protocol.ts"))
}

/// The fingerprint a sidecar answered `configure` with, if it named one.
fn built_from(answer: &Value) -> Option<u32> {
    serde_json::from_value::<protocol::Configured>(answer.clone())
        .ok()
        .map(|configured| configured.protocol)
}

/// A line from the sidecar, as routed to the waiting caller.
enum Incoming {
    Delta(String),
    Result(Value),
    Failed { kind: String, message: String },
}

type Pending = Arc<Mutex<HashMap<u64, Sender<Incoming>>>>;

/// A written request and where its answer will arrive.
struct Sent {
    id: u64,
    rx: Receiver<Incoming>,
}

struct Process {
    child: Child,
    stdin: ChildStdin,
    pending: Pending,
    alive: Arc<AtomicBool>,
    /// The configuration version this process last received.
    config_version: u64,
}

impl Drop for Process {
    fn drop(&mut self) {
        // The process may already be gone; nothing to do about either error.
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[derive(Default)]
struct Config {
    version: u64,
    params: Option<ConfigureParams>,
}

pub struct Agent {
    /// Program and arguments; `None` when no sidecar could be found.
    command: Option<Vec<String>>,
    /// Claude Code keys its resumable sessions by working directory, so the
    /// sidecar always starts in the same one.
    workdir: Option<PathBuf>,
    process: Mutex<Option<Process>>,
    config: Mutex<Config>,
    next_id: AtomicU64,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    // A panic elsewhere must not take the agent down with it; the guarded
    // data stays consistent because every critical section is short.
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

impl Agent {
    pub fn new(command: Option<Vec<String>>) -> Self {
        Self {
            command,
            workdir: None,
            process: Mutex::new(None),
            config: Mutex::new(Config::default()),
            next_id: AtomicU64::new(1),
        }
    }

    pub fn in_dir(self, workdir: PathBuf) -> Self {
        Self {
            workdir: Some(workdir),
            ..self
        }
    }

    /// Remembers the provider settings; they reach the sidecar before the
    /// next call, whether or not it is running now.
    pub fn configure(&self, params: ConfigureParams) {
        let mut config = lock(&self.config);
        if config.params.as_ref() != Some(&params) {
            config.version += 1;
            config.params = Some(params);
        }
    }

    pub fn is_configured(&self) -> bool {
        lock(&self.config).params.is_some()
    }

    pub fn check(&self) -> Result<ProviderCheck> {
        self.call("check", &json!({}), CHECK_TIMEOUT, &mut |_| {})
    }

    pub fn models(&self) -> Result<Vec<ModelOption>> {
        self.call("models", &json!({}), MODELS_TIMEOUT, &mut |_| {})
    }

    pub fn chat(&self, params: &ChatParams, on_delta: &mut dyn FnMut(&str)) -> Result<ChatResult> {
        self.call("chat", params, CHAT_TIMEOUT, on_delta)
    }

    pub fn help(&self, params: &HelpParams) -> Result<HelpResult> {
        self.call("help", params, HELP_TIMEOUT, &mut |_| {})
    }

    pub fn analyze(&self, params: &AnalyzeParams) -> Result<Analysis> {
        self.call("analyze", params, ANALYZE_TIMEOUT, &mut |_| {})
    }

    pub fn compose(&self, params: &ComposeParams) -> Result<Composed> {
        self.call("compose", params, COMPOSE_TIMEOUT, &mut |_| {})
    }

    pub fn self_check(&self, params: &SelfCheckParams) -> Result<SelfCheck> {
        self.call("selfCheck", params, HELP_TIMEOUT, &mut |_| {})
    }

    pub fn drill_generate(&self, params: &DrillGenerateParams) -> Result<DrillSet> {
        self.call("drillGenerate", params, DRILL_TIMEOUT, &mut |_| {})
    }

    pub fn drill_grade(&self, params: &DrillGradeParams) -> Result<DrillGrade> {
        self.call("drillGrade", params, DRILL_TIMEOUT, &mut |_| {})
    }

    pub fn vocab_extract(&self, params: &protocol::VocabExtractParams) -> Result<protocol::Vocab> {
        self.call("vocabExtract", params, VOCAB_TIMEOUT, &mut |_| {})
    }

    pub fn vocab_judge(
        &self,
        params: &protocol::VocabJudgeParams,
    ) -> Result<protocol::VocabVerdict> {
        self.call("vocabJudge", params, JUDGE_TIMEOUT, &mut |_| {})
    }

    pub fn vocab_label(
        &self,
        params: &protocol::VocabLabelParams,
    ) -> Result<protocol::VocabLabels> {
        self.call("vocabLabel", params, VOCAB_TIMEOUT, &mut |_| {})
    }

    pub fn sentence_write(
        &self,
        params: &protocol::SentenceWriteParams,
    ) -> Result<protocol::SentencesWritten> {
        self.call("sentenceWrite", params, VOCAB_TIMEOUT, &mut |_| {})
    }

    pub fn sentence_review(
        &self,
        params: &protocol::SentenceReviewParams,
    ) -> Result<protocol::SentenceVerdicts> {
        self.call("sentenceReview", params, VOCAB_TIMEOUT, &mut |_| {})
    }

    pub fn chapter_brief(
        &self,
        params: &protocol::ChapterBriefParams,
    ) -> Result<protocol::ChapterBrief> {
        self.call("chapterBrief", params, BRIEF_TIMEOUT, &mut |_| {})
    }

    pub fn paragraph_version(
        &self,
        params: &protocol::ParagraphVersionParams,
    ) -> Result<protocol::ParagraphVersion> {
        self.call("paragraphVersion", params, PARAGRAPH_TIMEOUT, &mut |_| {})
    }

    pub fn paragraph_review(
        &self,
        params: &protocol::ParagraphReviewParams,
    ) -> Result<protocol::ParagraphReview> {
        self.call("paragraphReview", params, PARAGRAPH_TIMEOUT, &mut |_| {})
    }

    pub fn attempt_summary(
        &self,
        params: &protocol::AttemptSummaryParams,
    ) -> Result<protocol::AttemptSummary> {
        self.call("attemptSummary", params, PARAGRAPH_TIMEOUT, &mut |_| {})
    }

    pub fn structure_grade(
        &self,
        params: &protocol::StructureGradeParams,
    ) -> Result<protocol::StructureGrade> {
        self.call("structureGrade", params, JUDGE_TIMEOUT, &mut |_| {})
    }

    pub fn structure_detect(
        &self,
        params: &protocol::StructureDetectParams,
    ) -> Result<protocol::StructuresFound> {
        self.call("structureDetect", params, VOCAB_TIMEOUT, &mut |_| {})
    }

    fn call<P: Serialize, R: DeserializeOwned>(
        &self,
        method: &str,
        params: &P,
        timeout: Duration,
        on_delta: &mut dyn FnMut(&str),
    ) -> Result<R> {
        let params = serde_json::to_value(params)?;
        let (configure, request, pending) = self.send(method, params)?;
        if let Some(configure) = configure {
            match wait(&configure.rx, CONFIGURE_TIMEOUT, &mut |_| {}) {
                Ok(answer) if built_from(&answer) == Some(protocol_fingerprint()) => {}
                Ok(_) => {
                    // Gone, so that the next call asks a fresh one the same.
                    *lock(&self.process) = None;
                    return Err(Error::Provider(STALE_SIDECAR.into()));
                }
                Err(err) => {
                    lock(&pending).remove(&configure.id);
                    lock(&pending).remove(&request.id);
                    return Err(err);
                }
            }
        }
        let result = wait(&request.rx, timeout, on_delta);
        lock(&pending).remove(&request.id);
        Ok(serde_json::from_value(result?)?)
    }

    /// Writes the request, preceded by `configure` when the process has not
    /// seen the current settings, and returns the receivers to wait on.
    fn send(&self, method: &str, params: Value) -> Result<(Option<Sent>, Sent, Pending)> {
        let mut slot = lock(&self.process);
        let process = self.running(&mut slot)?;
        let (version, config) = {
            let config = lock(&self.config);
            (config.version, config.params.clone())
        };
        let mut configure_rx = None;
        if process.config_version != version {
            let config = config.ok_or_else(|| Error::Provider("No provider configured".into()))?;
            let configure_id = self.next_id.fetch_add(1, Ordering::Relaxed);
            let rx = write_request(
                process,
                configure_id,
                "configure",
                serde_json::to_value(config)?,
            )?;
            process.config_version = version;
            configure_rx = Some(Sent {
                id: configure_id,
                rx,
            });
        }
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let rx = write_request(process, id, method, params)?;
        Ok((configure_rx, Sent { id, rx }, Arc::clone(&process.pending)))
    }

    /// The live process, spawning a fresh one if there is none or it died.
    fn running<'a>(&self, slot: &'a mut Option<Process>) -> Result<&'a mut Process> {
        if slot
            .as_ref()
            .is_some_and(|p| !p.alive.load(Ordering::Acquire))
        {
            *slot = None;
        }
        if slot.is_none() {
            *slot = Some(self.spawn()?);
        }
        slot.as_mut()
            .ok_or_else(|| Error::Internal("agent process missing".into()))
    }

    fn spawn(&self) -> Result<Process> {
        let command = self.command.as_ref().ok_or_else(|| {
            Error::Provider("The ogmios-agent helper is missing from this installation".into())
        })?;
        let (program, args) = command
            .split_first()
            .ok_or_else(|| Error::Provider("Empty agent command".into()))?;
        let mut cmd = Command::new(program);
        cmd.args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit());
        if let Some(dir) = &self.workdir {
            std::fs::create_dir_all(dir)?;
            cmd.current_dir(dir);
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            // CREATE_NO_WINDOW: no console flashes up next to the app.
            cmd.creation_flags(0x0800_0000);
        }
        let mut child = cmd
            .spawn()
            .map_err(|e| Error::Provider(format!("Could not start the agent ({program}): {e}")))?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| Error::Internal("agent stdin".into()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| Error::Internal("agent stdout".into()))?;
        let pending: Pending = Arc::default();
        let alive = Arc::new(AtomicBool::new(true));
        let reader_pending = Arc::clone(&pending);
        let reader_alive = Arc::clone(&alive);
        std::thread::Builder::new()
            .name("ogmios-agent-reader".into())
            .spawn(move || read_loop(BufReader::new(stdout), &reader_pending, &reader_alive))?;
        Ok(Process {
            child,
            stdin,
            pending,
            alive,
            config_version: 0,
        })
    }
}

fn write_request(
    process: &mut Process,
    id: u64,
    method: &str,
    params: Value,
) -> Result<Receiver<Incoming>> {
    let (tx, rx) = mpsc::channel();
    lock(&process.pending).insert(id, tx);
    let mut line = serde_json::to_string(&json!({ "id": id, "method": method, "params": params }))?;
    line.push('\n');
    let written = process
        .stdin
        .write_all(line.as_bytes())
        .and_then(|()| process.stdin.flush());
    if let Err(err) = written {
        lock(&process.pending).remove(&id);
        process.alive.store(false, Ordering::Release);
        return Err(Error::Provider(format!(
            "The agent stopped responding: {err}"
        )));
    }
    Ok(rx)
}

fn wait(
    rx: &Receiver<Incoming>,
    timeout: Duration,
    on_delta: &mut dyn FnMut(&str),
) -> Result<Value> {
    loop {
        match rx.recv_timeout(timeout) {
            Ok(Incoming::Delta(text)) => on_delta(&text),
            Ok(Incoming::Result(value)) => return Ok(value),
            Ok(Incoming::Failed { kind, message }) => {
                return Err(if kind == "internal" {
                    Error::Internal(message)
                } else {
                    Error::Provider(message)
                })
            }
            Err(RecvTimeoutError::Timeout) => {
                return Err(Error::Provider("Claude took too long to answer".into()))
            }
            Err(RecvTimeoutError::Disconnected) => {
                return Err(Error::Provider("The agent stopped unexpectedly".into()))
            }
        }
    }
}

fn read_loop(stdout: impl BufRead, pending: &Pending, alive: &AtomicBool) {
    for line in stdout.lines() {
        let Ok(line) = line else { break };
        let Ok(message) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let Some(id) = message.get("id").and_then(Value::as_u64) else {
            continue;
        };
        let incoming = if message.get("event").is_some() {
            let text = message
                .get("text")
                .and_then(Value::as_str)
                .unwrap_or_default();
            Incoming::Delta(text.to_owned())
        } else if let Some(error) = message.get("error") {
            let field = |name: &str| {
                error
                    .get(name)
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned()
            };
            Incoming::Failed {
                kind: field("kind"),
                message: field("message"),
            }
        } else {
            Incoming::Result(message.get("result").cloned().unwrap_or(Value::Null))
        };
        let mut pending = lock(pending);
        let is_final = !matches!(incoming, Incoming::Delta(_));
        if let Some(tx) = pending.get(&id) {
            // The caller may have given up already; its entry goes below.
            let _ = tx.send(incoming);
        }
        if is_final {
            pending.remove(&id);
        }
    }
    alive.store(false, Ordering::Release);
    // Dropping the senders wakes every waiting caller with `Disconnected`.
    lock(pending).clear();
}

/// `OGMIOS_AGENT_CMD` (a whole command line, split on whitespace) wins, for
/// development against `bun sidecar/main.ts`; otherwise the bundled
/// `ogmios-agent` that Tauri places beside the executable.
pub fn locate_sidecar() -> Option<Vec<String>> {
    if let Ok(line) = std::env::var("OGMIOS_AGENT_CMD") {
        let parts: Vec<String> = line.split_whitespace().map(str::to_owned).collect();
        if !parts.is_empty() {
            return Some(parts);
        }
    }
    let exe = std::env::current_exe().ok()?;
    let path: PathBuf = exe
        .parent()?
        .join(format!("ogmios-agent{}", std::env::consts::EXE_SUFFIX));
    path.is_file()
        .then(|| vec![path.to_string_lossy().into_owned()])
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::ProviderMode;

    /// A stand-in sidecar written in shell: echoes each request id back with a
    /// fixed result, streaming two deltas first for `chat`.
    fn fake(script: &str) -> Agent {
        fake_built_from(script, protocol_fingerprint())
    }

    /// The same, as a sidecar whose protocol has the fingerprint given.
    fn fake_built_from(script: &str, fingerprint: u32) -> Agent {
        let script = script.replace("PROTOCOL", &fingerprint.to_string());
        let agent = Agent::new(Some(vec!["sh".into(), "-c".into(), script]));
        agent.configure(ConfigureParams {
            mode: ProviderMode::ApiKey,
            model: "claude-sonnet-5".into(),
            effort: None,
            api_key: Some("k".into()),
            claude_path: None,
        });
        agent
    }

    const ECHO: &str = r#"
        while IFS= read -r line; do
          id=$(printf '%s' "$line" | sed 's/.*"id":\([0-9]*\).*/\1/')
          case "$line" in
            *'"method":"chat"'*)
              printf '{"id":%s,"event":"delta","text":"Hel"}\n' "$id"
              printf '{"id":%s,"event":"delta","text":"lo"}\n' "$id"
              printf '{"id":%s,"result":{"text":"Hello","providerRef":null}}\n' "$id" ;;
            *'"method":"check"'*)
              printf '{"id":%s,"error":{"kind":"provider","message":"bad key"}}\n' "$id" ;;
            *'"method":"configure"'*)
              printf '{"id":%s,"result":{"protocol":PROTOCOL}}\n' "$id" ;;
            *) printf '{"id":%s,"result":{}}\n' "$id" ;;
          esac
        done
    "#;

    fn chat_params() -> ChatParams {
        serde_json::from_value(json!({
            "context": {
                "setup": {"topic": "t", "level": "basic", "mode": "casual",
                          "personality": "curiousFriend", "focusMode": "free",
                          "targetMinutes": null, "material": null,
                          "continuePrevious": false},
                "learner": {"name": null, "nativeLang": "es", "goal": "work", "variant": "us",
                            "interests": [], "facts": [], "cefr": null},
                "targets": [], "challenge": null, "recentOpenings": [], "phrases": [],
                "words": [], "previous": null
            },
            "history": [], "providerRef": null
        }))
        .expect("valid chat params")
    }

    #[test]
    fn streams_deltas_and_returns_the_result() {
        let agent = fake(ECHO);
        let mut streamed = String::new();
        let result = agent
            .chat(&chat_params(), &mut |t| streamed.push_str(t))
            .expect("chat");
        assert_eq!(streamed, "Hello");
        assert_eq!(result.text, "Hello");
    }

    #[test]
    fn reports_sidecar_errors_as_provider_errors() {
        let err = fake(ECHO).check().expect_err("check fails");
        assert_eq!(err.kind(), "provider");
        assert_eq!(err.to_string(), "bad key");
    }

    #[test]
    fn restarts_after_the_process_dies() {
        // Answers configure and one call, then exits.
        let agent = fake(
            r#"for n in 1 2; do IFS= read -r line
               id=$(printf '%s' "$line" | sed 's/.*"id":\([0-9]*\).*/\1/')
               printf '{"id":%s,"result":{"ok":true,"message":null,"protocol":PROTOCOL}}\n' "$id"; done"#,
        );
        assert!(agent.check().expect("first").ok);
        // The first process may not have been reaped yet; one call may fail.
        let second = agent.check().or_else(|_| agent.check()).expect("respawned");
        assert!(second.ok);
    }

    #[test]
    fn hashes_the_protocol_as_the_sidecar_does() {
        // `sidecar/fingerprint.test.ts` asserts the same numbers.
        assert_eq!(fingerprint_of(""), 2_166_136_261);
        assert_eq!(fingerprint_of("a"), 3_826_002_220);
        assert_eq!(fingerprint_of("foobar"), 3_214_735_720);
        assert_eq!(fingerprint_of("é"), 513_665_217);
        assert_eq!(fingerprint_of("a\r\nb"), fingerprint_of("a\nb"));
    }

    #[test]
    fn refuses_a_sidecar_from_another_build() {
        let agent = fake_built_from(ECHO, protocol_fingerprint().wrapping_add(1));
        let err = agent.models().expect_err("a stale sidecar");
        assert_eq!(err.kind(), "provider");
        assert_eq!(err.to_string(), STALE_SIDECAR);
        // The next call asks a fresh process, and is refused the same way.
        let again = agent.models().expect_err("still stale");
        assert_eq!(again.to_string(), STALE_SIDECAR);
    }

    #[test]
    fn refuses_a_sidecar_that_names_no_build() {
        // What a sidecar built before the fingerprint answers.
        let agent = fake(
            r#"while IFS= read -r line; do
               id=$(printf '%s' "$line" | sed 's/.*"id":\([0-9]*\).*/\1/')
               printf '{"id":%s,"result":null}\n' "$id"; done"#,
        );
        let err = agent.models().expect_err("an older sidecar");
        assert_eq!(err.to_string(), STALE_SIDECAR);
    }

    #[test]
    fn a_missing_sidecar_is_a_provider_error() {
        let err = Agent::new(None).check().expect_err("no sidecar");
        assert_eq!(err.kind(), "provider");
    }
}
