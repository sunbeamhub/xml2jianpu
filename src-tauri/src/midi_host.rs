use std::collections::BTreeSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex, OnceLock};
use std::thread::{self, JoinHandle, ThreadId};
use std::time::Duration;

use midir::{Ignore, MidiInput, MidiInputConnection, MidiOutput, MidiOutputConnection};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime};

use crate::midi_bytes::{self, MidiNote};

const CLIENT_NAME: &str = "yipu";

#[derive(Clone, Serialize)]
struct PortDto {
    id: String,
    name: String,
}

#[derive(Clone, Serialize)]
pub(crate) struct ConnectResponse {
    ok: bool,
    inputs: Vec<PortDto>,
    outputs: Vec<PortDto>,
}

#[derive(Clone, Serialize)]
struct NoteEvent {
    #[serde(rename = "type")]
    kind: &'static str,
    midi: u8,
}

struct Session {
    inputs: Vec<MidiInputConnection<()>>,
    outputs: Vec<(String, MidiOutputConnection)>,
    signature: BTreeSet<String>,
}

pub struct MidiHost {
    inner: Arc<MidiInner>,
}

trait MidiApp: Send + Sync {
    fn emit_note(&self, event: &NoteEvent);
    fn emit_ports(&self, event: &ConnectResponse);
    fn on_main(&self, task: Box<dyn FnOnce() + Send>);
}

impl<R: Runtime> MidiApp for AppHandle<R> {
    fn emit_note(&self, event: &NoteEvent) {
        let _ = self.emit("midi-note", event.clone());
    }

    fn emit_ports(&self, event: &ConnectResponse) {
        let _ = self.emit("midi-ports", event.clone());
    }

    fn on_main(&self, task: Box<dyn FnOnce() + Send>) {
        let _ = self.run_on_main_thread(task);
    }
}

struct MidiInner {
    app: Arc<dyn MidiApp>,
    main_id: ThreadId,
    session: Mutex<Option<Session>>,
    stop: AtomicBool,
    poll: Mutex<Option<JoinHandle<()>>>,
}

static MAIN_ID: OnceLock<ThreadId> = OnceLock::new();
static HOST: OnceLock<MidiHost> = OnceLock::new();

pub fn remember_main_thread() {
    let _ = MAIN_ID.set(std::thread::current().id());
}

fn instance<R: Runtime>(app: &AppHandle<R>) -> &'static MidiHost {
    HOST.get_or_init(|| {
        let main_id = MAIN_ID
            .get()
            .copied()
            .unwrap_or_else(|| std::thread::current().id());
        MidiHost::new(Arc::new(app.clone()), main_id)
    })
}

impl MidiHost {
    fn new(app: Arc<dyn MidiApp>, main_id: ThreadId) -> Self {
        Self {
            inner: Arc::new(MidiInner {
                app,
                main_id,
                session: Mutex::new(None),
                stop: AtomicBool::new(true),
                poll: Mutex::new(None),
            }),
        }
    }

    fn connect(&self) -> Result<ConnectResponse, String> {
        self.inner.stop.store(false, Ordering::Relaxed);
        let snapshot = self.with_midi(|inner| inner.open_current())?;
        if snapshot.inputs.is_empty() && snapshot.outputs.is_empty() {
            self.disconnect()?;
            return Ok(ConnectResponse {
                ok: false,
                inputs: Vec::new(),
                outputs: Vec::new(),
            });
        }
        self.ensure_poll();
        Ok(ConnectResponse {
            ok: true,
            inputs: snapshot.inputs,
            outputs: snapshot.outputs,
        })
    }

    fn disconnect(&self) -> Result<(), String> {
        self.inner.stop.store(true, Ordering::Relaxed);
        self.with_midi(|inner| {
            inner.close_session();
            Ok(())
        })?;
        if std::thread::current().id() != self.inner.main_id {
            if let Some(handle) = self
                .inner
                .poll
                .lock()
                .map_err(|err| err.to_string())?
                .take()
            {
                let _ = handle.join();
            }
        }
        Ok(())
    }

    fn send(&self, port_id: String, bytes: Vec<u8>) -> Result<(), String> {
        if bytes.is_empty() || (bytes[0] < 0xF0 && bytes.len() > 3) {
            return Err("MIDI 消息长度不对".into());
        }
        self.with_midi(move |inner| {
            let mut guard = inner.session.lock().map_err(|err| err.to_string())?;
            let Some(session) = guard.as_mut() else {
                return Err("电子琴未连接".into());
            };
            let Some((_, output)) = session.outputs.iter_mut().find(|(id, _)| id == &port_id)
            else {
                return Err("找不到电子琴输出".into());
            };
            output.send(&bytes).map_err(|err| err.to_string())?;
            Ok(())
        })
    }

    fn ensure_poll(&self) {
        let mut slot = match self.inner.poll.lock() {
            Ok(slot) => slot,
            Err(_) => return,
        };
        if let Some(handle) = slot.as_ref() {
            if !handle.is_finished() {
                return;
            }
        }
        if let Some(handle) = slot.take() {
            let _ = handle.join();
        }
        let inner = Arc::clone(&self.inner);
        let handle = thread::Builder::new()
            .name("yipu-midi-poll".into())
            .spawn(move || {
                while !inner.stop.load(Ordering::Relaxed) {
                    thread::sleep(Duration::from_secs(1));
                    if inner.stop.load(Ordering::Relaxed) {
                        break;
                    }
                    let task = Arc::clone(&inner);
                    let (tx, rx) = mpsc::channel();
                    inner.app.on_main(Box::new(move || {
                        if !task.stop.load(Ordering::Relaxed) {
                            let _ = task.refresh();
                        }
                        let _ = tx.send(());
                    }));
                    let _ = rx.recv_timeout(Duration::from_secs(2));
                }
            })
            .ok();
        *slot = handle;
    }

    fn with_midi<T>(
        &self,
        f: impl FnOnce(&MidiInner) -> Result<T, String> + Send + 'static,
    ) -> Result<T, String>
    where
        T: Send + 'static,
    {
        if std::thread::current().id() == self.inner.main_id {
            return f(&self.inner);
        }
        let inner = Arc::clone(&self.inner);
        let (tx, rx) = mpsc::channel();
        self.inner.app.on_main(Box::new(move || {
            let _ = tx.send(f(&inner));
        }));
        rx.recv().map_err(|err| err.to_string())?
    }
}

struct ListedPorts {
    inputs: Vec<PortDto>,
    outputs: Vec<PortDto>,
    signature: BTreeSet<String>,
}

impl MidiInner {
    fn open_current(&self) -> Result<ListedPorts, String> {
        self.close_session();
        let listed = list_ports()?;
        if listed.inputs.is_empty() && listed.outputs.is_empty() {
            return Ok(listed);
        }
        let session = self.open_listed(&listed)?;
        *self.session.lock().map_err(|err| err.to_string())? = Some(session);
        Ok(listed)
    }

    fn refresh(&self) -> Result<(), String> {
        let listed = list_ports()?;
        let unchanged = {
            let guard = self.session.lock().map_err(|err| err.to_string())?;
            match guard.as_ref() {
                Some(session) => session.signature == listed.signature,
                None => listed.inputs.is_empty() && listed.outputs.is_empty(),
            }
        };
        if unchanged {
            return Ok(());
        }
        self.close_session();
        if listed.inputs.is_empty() && listed.outputs.is_empty() {
            self.app.emit_ports(&ConnectResponse {
                ok: false,
                inputs: Vec::new(),
                outputs: Vec::new(),
            });
            return Ok(());
        }
        let session = self.open_listed(&listed)?;
        *self.session.lock().map_err(|err| err.to_string())? = Some(session);
        self.app.emit_ports(&ConnectResponse {
            ok: true,
            inputs: listed.inputs,
            outputs: listed.outputs,
        });
        Ok(())
    }

    fn open_listed(&self, listed: &ListedPorts) -> Result<Session, String> {
        let mut inputs = Vec::new();
        for port in &listed.inputs {
            if let Some(connection) = connect_input(&self.app, &port.id) {
                inputs.push(connection);
            }
        }
        let mut outputs = Vec::new();
        for port in &listed.outputs {
            if let Some(connection) = connect_output(&port.id) {
                outputs.push((port.id.clone(), connection));
            }
        }
        Ok(Session {
            inputs,
            outputs,
            signature: listed.signature.clone(),
        })
    }

    fn close_session(&self) {
        let session = self.session.lock().ok().and_then(|mut guard| guard.take());
        let Some(session) = session else {
            return;
        };
        for (port_id, mut output) in session.outputs {
            silence_output(&port_id, &mut output);
            drop(output);
        }
        drop(session.inputs);
    }
}

fn silence_output(_port_id: &str, output: &mut MidiOutputConnection) {
    for channel in 0..16 {
        let _ = output.send(&[0xB0 | channel, 120, 0]);
        let _ = output.send(&[0xB0 | channel, 123, 0]);
    }
}

fn list_ports() -> Result<ListedPorts, String> {
    let inputs = list_inputs();
    let outputs = list_outputs();
    let mut signature = BTreeSet::new();
    for port in inputs.iter().chain(outputs.iter()) {
        signature.insert(port.id.clone());
    }
    Ok(ListedPorts {
        inputs,
        outputs,
        signature,
    })
}

fn list_inputs() -> Vec<PortDto> {
    let mut input = match MidiInput::new(CLIENT_NAME) {
        Ok(input) => input,
        Err(_) => return Vec::new(),
    };
    input.ignore(Ignore::All);
    input
        .ports()
        .into_iter()
        .map(|port| {
            let id = port.id();
            let name = input.port_name(&port).unwrap_or_default();
            PortDto {
                id,
                name: display_name(name),
            }
        })
        .collect()
}

fn list_outputs() -> Vec<PortDto> {
    let output = match MidiOutput::new(CLIENT_NAME) {
        Ok(output) => output,
        Err(_) => return Vec::new(),
    };
    output
        .ports()
        .into_iter()
        .map(|port| {
            let id = port.id();
            let name = output.port_name(&port).unwrap_or_default();
            PortDto {
                id,
                name: display_name(name),
            }
        })
        .collect()
}

fn display_name(name: String) -> String {
    let name = name.trim();
    if name.is_empty() {
        "电子琴".to_string()
    } else {
        name.to_string()
    }
}

fn connect_input(app: &Arc<dyn MidiApp>, port_id: &str) -> Option<MidiInputConnection<()>> {
    let mut input = MidiInput::new(CLIENT_NAME).ok()?;
    input.ignore(Ignore::All);
    let port = input
        .ports()
        .into_iter()
        .find(|port| port.id() == port_id)?;
    let app = app.clone();
    let mut running = None;
    input
        .connect(
            &port,
            CLIENT_NAME,
            move |_stamp, message, _| {
                for note in midi_bytes::feed(message, &mut running) {
                    let event = match note {
                        MidiNote::On(midi) => NoteEvent { kind: "on", midi },
                        MidiNote::Off(midi) => NoteEvent { kind: "off", midi },
                    };
                    app.emit_note(&event);
                }
            },
            (),
        )
        .ok()
}

fn connect_output(port_id: &str) -> Option<MidiOutputConnection> {
    let output = MidiOutput::new(CLIENT_NAME).ok()?;
    let port = output
        .ports()
        .into_iter()
        .find(|port| port.id() == port_id)?;
    output.connect(&port, CLIENT_NAME).ok()
}

#[tauri::command]
pub fn connect<R: Runtime>(app: AppHandle<R>) -> Result<ConnectResponse, String> {
    instance(&app).connect()
}

#[tauri::command]
pub fn disconnect<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    instance(&app).disconnect()
}

#[tauri::command]
pub fn send<R: Runtime>(app: AppHandle<R>, port_id: String, bytes: Vec<u8>) -> Result<(), String> {
    instance(&app).send(port_id, bytes)
}
