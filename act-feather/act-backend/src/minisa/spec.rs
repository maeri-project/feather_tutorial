use serde::Serialize;
use std::sync::atomic::{AtomicI32, Ordering};

const DEFAULT_VN_SIZE: i32 = 16;
const DEFAULT_AH: i32 = 16;
const DEFAULT_AW: i32 = 16;

static VN_SIZE_OVERRIDE: AtomicI32 = AtomicI32::new(DEFAULT_VN_SIZE);
static AH_OVERRIDE: AtomicI32 = AtomicI32::new(DEFAULT_AH);
static AW_OVERRIDE: AtomicI32 = AtomicI32::new(DEFAULT_AW);

pub const D_STAB: i32 = 786432;
pub const D_STRB: i32 = 786432;
pub const D_OB: i32 = 786432;

pub fn set_layout_config(vn_size: i32, ah: i32, aw: i32) {
    VN_SIZE_OVERRIDE.store(vn_size, Ordering::Relaxed);
    AH_OVERRIDE.store(ah, Ordering::Relaxed);
    AW_OVERRIDE.store(aw, Ordering::Relaxed);
}

pub fn vn_size() -> i32 {
    VN_SIZE_OVERRIDE.load(Ordering::Relaxed)
}

pub fn ah() -> i32 {
    AH_OVERRIDE.load(Ordering::Relaxed)
}

pub fn aw() -> i32 {
    AW_OVERRIDE.load(Ordering::Relaxed)
}

#[derive(Debug, Clone, Serialize)]
pub struct FeatherSpec {
    #[serde(rename = "AH")]
    pub ah: i32,
    #[serde(rename = "AW")]
    pub aw: i32,
    #[serde(rename = "D_StaB")]
    pub d_sta_b: i32,
    #[serde(rename = "D_StrB")]
    pub d_str_b: i32,
    #[serde(rename = "D_OB")]
    pub d_ob: i32,
}

pub fn feather_spec() -> FeatherSpec {
    FeatherSpec {
        ah: ah(),
        aw: aw(),
        d_sta_b: D_STAB,
        d_str_b: D_STRB,
        d_ob: D_OB,
    }
}
