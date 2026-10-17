//! Ephemeral browser approvals. Store credential hashes only, and tie live
//! requests to a cancellation token that expires/revokes with the device.
use anyhow::{bail, Result};
use base64::Engine;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
};
use subtle::ConstantTimeEq;
use tokio_util::sync::CancellationToken;

pub const INVITE_TTL: u64 = 10 * 60 * 1000;
pub const REQUEST_TTL: u64 = 5 * 60 * 1000;
pub const SESSION_TTL: u64 = 8 * 60 * 60 * 1000;
pub fn random<const N: usize>() -> Result<[u8; N]> {
    let mut bytes = [0; N];
    getrandom::fill(&mut bytes)
        .map_err(|error| anyhow::anyhow!("OS randomness unavailable: {error}"))?;
    Ok(bytes)
}
fn secret() -> Result<String> {
    Ok(base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(random::<32>()?))
}
fn hash(value: &str) -> [u8; 32] {
    Sha256::digest(value.as_bytes()).into()
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    pub id: String,
    pub name: String,
    pub code: String,
    pub status: String,
    pub expires_at: u64,
}
pub struct Authorization {
    pub device: Device,
    pub cancelled: CancellationToken,
}
struct PrivateDevice {
    device: Device,
    credential: [u8; 32],
    cancelled: CancellationToken,
    ordinal: u64,
}
struct Invitation {
    hash: [u8; 32],
    expires_at: u64,
}
#[derive(Default)]
struct State {
    invite: Option<Invitation>,
    devices: BTreeMap<String, PrivateDevice>,
    ordinal: u64,
}
pub struct Sessions {
    state: Mutex<State>,
    now: Arc<dyn Fn() -> u64 + Send + Sync>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Invite {
    pub token: String,
    pub expires_at: u64,
}
impl Default for Sessions {
    fn default() -> Self {
        Self::with_clock(Arc::new(|| {
            chrono::Utc::now().timestamp_millis().max(0) as u64
        }))
    }
}
impl Sessions {
    pub fn with_clock(now: Arc<dyn Fn() -> u64 + Send + Sync>) -> Self {
        Self {
            state: Mutex::default(),
            now,
        }
    }
    pub fn new_invite(&self) -> Result<Invite> {
        let token = secret()?;
        let expires_at = (self.now)() + INVITE_TTL;
        self.state.lock().unwrap().invite = Some(Invitation {
            hash: hash(&token),
            expires_at,
        });
        Ok(Invite { token, expires_at })
    }
    pub fn request(&self, invite: &str, name: &str) -> Result<(String, Device)> {
        let mut state = self.state.lock().unwrap();
        self.prune(&mut state);
        if state
            .invite
            .as_ref()
            .is_none_or(|token| !bool::from(token.hash.ct_eq(&hash(invite))))
        {
            bail!("This invitation has expired. Create a new link on the host computer.");
        }
        if state.devices.len() >= 16 {
            bail!("Too many devices. Remove a device on the host first.");
        }
        let credential = secret()?;
        let id = random::<16>()?
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        let code = random::<4>()?
            .iter()
            .map(|byte| format!("{byte:02X}"))
            .collect::<String>();
        static CONTROL: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
        let clean = CONTROL
            .get_or_init(|| regex::Regex::new(r"\p{C}").unwrap())
            .replace_all(name, "");
        let mut units = 0;
        let name = clean
            .trim()
            .chars()
            .take_while(|ch| {
                units += ch.len_utf16();
                units <= 64
            })
            .collect::<String>();
        let device = Device {
            id: id.clone(),
            code,
            name: if name.is_empty() {
                "Browser".into()
            } else {
                name
            },
            status: "pending".into(),
            expires_at: (self.now)() + REQUEST_TTL,
        };
        let ordinal = state.ordinal;
        state.ordinal += 1;
        state.devices.insert(
            id,
            PrivateDevice {
                device: device.clone(),
                credential: hash(&credential),
                cancelled: CancellationToken::new(),
                ordinal,
            },
        );
        Ok((credential, device))
    }
    pub fn find(&self, credential: Option<&str>) -> Option<Authorization> {
        let mut state = self.state.lock().unwrap();
        self.prune(&mut state);
        let credential = credential.filter(|v| !v.is_empty() && v.len() <= 128)?;
        let digest = hash(credential);
        state
            .devices
            .values()
            .find(|device| bool::from(device.credential.ct_eq(&digest)))
            .map(|device| Authorization {
                device: device.device.clone(),
                cancelled: device.cancelled.clone(),
            })
    }
    pub fn approve(&self, id: &str) -> Result<()> {
        let mut state = self.state.lock().unwrap();
        self.prune(&mut state);
        let Some(device) = state
            .devices
            .get_mut(id)
            .filter(|d| d.device.status == "pending")
        else {
            bail!("This connection request has expired.");
        };
        device.device.status = "approved".into();
        device.device.expires_at = (self.now)() + SESSION_TTL;
        Ok(())
    }
    pub fn revoke(&self, id: &str) {
        if let Some(device) = self.state.lock().unwrap().devices.remove(id) {
            device.cancelled.cancel();
        }
    }
    pub fn clear(&self) {
        let mut state = self.state.lock().unwrap();
        for device in state.devices.values() {
            device.cancelled.cancel();
        }
        state.devices.clear();
        state.invite = None;
    }
    pub fn list(&self) -> Vec<Device> {
        let mut state = self.state.lock().unwrap();
        self.prune(&mut state);
        let mut devices = state.devices.values().collect::<Vec<_>>();
        devices.sort_by_key(|device| device.ordinal);
        devices
            .into_iter()
            .map(|device| device.device.clone())
            .collect()
    }
    fn prune(&self, state: &mut State) {
        let now = (self.now)();
        if state
            .invite
            .as_ref()
            .is_some_and(|invite| invite.expires_at <= now)
        {
            state.invite = None;
        }
        state.devices.retain(|_, device| {
            if device.device.expires_at <= now {
                device.cancelled.cancel();
                false
            } else {
                true
            }
        });
    }
}
impl Drop for Sessions {
    fn drop(&mut self) {
        for device in self.state.get_mut().unwrap().devices.values() {
            device.cancelled.cancel();
        }
    }
}
