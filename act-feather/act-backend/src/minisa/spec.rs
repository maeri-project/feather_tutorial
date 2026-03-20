use serde::Serialize;

pub const VN_SIZE: i32 = 16;
pub const AH: i32 = 16;
pub const AW: i32 = 16;
pub const D_STAB: i32 = 786432;
pub const D_STRB: i32 = 786432;
pub const D_OB: i32 = 786432;

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
        ah: AH,
        aw: AW,
        d_sta_b: D_STAB,
        d_str_b: D_STRB,
        d_ob: D_OB,
    }
}
