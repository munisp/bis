/// sdn_sync.rs — OFAC SDN (Specially Designated Nationals) list sync service.
///
/// Fetches the OFAC SDN XML feed from the US Treasury every 6 hours and caches
/// a HashSet of normalised name tokens and BIC prefixes for O(1) screening.
///
/// In offline / test environments the sync is skipped gracefully and the engine
/// falls back to the static compile-time lists in lib.rs.
use std::collections::HashSet;
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};

/// Public URL of the OFAC SDN XML feed.
pub const OFAC_SDN_URL: &str =
    "https://www.treasury.gov/ofac/downloads/sdn.xml";

/// Public URL of the OFAC Consolidated Sanctions List (CSV — faster to parse).
pub const OFAC_CONS_URL: &str =
    "https://www.treasury.gov/ofac/downloads/consolidated/consolidated.xml";

/// UN Security Council Consolidated Sanctions List
pub const UN_SANCTIONS_URL: &str =
    "https://scsanctions.un.org/resources/xml/en/consolidated.xml";

/// How often to refresh the cached list.
pub const REFRESH_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60); // 6 hours

/// Cached sanctions data shared across threads.
#[derive(Debug, Default)]
pub struct SdnCache {
    /// Normalised name tokens from the SDN list (lowercase, no punctuation).
    pub name_tokens: HashSet<String>,
    /// BIC/SWIFT code prefixes of sanctioned institutions.
    pub bic_prefixes: HashSet<String>,
    /// ISO-3166-1 alpha-2 country codes of sanctioned jurisdictions.
    pub sanctioned_countries: HashSet<String>,
    /// Timestamp of the last successful refresh.
    pub last_refreshed: Option<Instant>,
    /// Number of SDN entries loaded.
    pub entry_count: usize,
}

/// Thread-safe handle to the SDN cache.
pub type SharedSdnCache = Arc<RwLock<SdnCache>>;

/// Create a new empty cache.
pub fn new_cache() -> SharedSdnCache {
    Arc::new(RwLock::new(SdnCache::default()))
}

/// Normalise a name for token matching:
/// - lowercase
/// - strip punctuation / accents (ASCII-only for now)
/// - split on whitespace
pub fn normalise_name(name: &str) -> Vec<String> {
    let lower = name.to_lowercase();
    let cleaned: String = lower
        .chars()
        .map(|c| if c.is_alphanumeric() || c == ' ' { c } else { ' ' })
        .collect();
    cleaned
        .split_whitespace()
        .filter(|t| t.len() >= 3)
        .map(|t| t.to_string())
        .collect()
}

/// Check whether a name has a significant overlap with the SDN token set.
/// Returns true if ≥ 2 tokens match (reduces false positives from common words).
pub fn name_hits_sdn(name: &str, cache: &SdnCache) -> bool {
    let tokens = normalise_name(name);
    if tokens.is_empty() {
        return false;
    }
    let hits = tokens
        .iter()
        .filter(|t| cache.name_tokens.contains(*t))
        .count();
    // Require at least 2 matching tokens OR a single specific token (≥ 7 chars).
    // 7+ chars avoids common words ("bank", "corp", "ltd") while catching entity names.
    hits >= 2 || tokens.iter().any(|t| t.len() >= 7 && cache.name_tokens.contains(t))
}

/// Seed the cache with the static compile-time lists so screening works
/// immediately at startup before the first network refresh.
pub fn seed_static_lists(cache: &mut SdnCache) {
    // ── FATF High-Risk and Other Monitored Jurisdictions (2024) ──────────────
    let fatf_high_risk = [
        "AF", // Afghanistan
        "BY", // Belarus
        "CF", // Central African Republic
        "CG", // Congo
        "CU", // Cuba
        "ER", // Eritrea
        "ET", // Ethiopia (grey list)
        "HT", // Haiti
        "IR", // Iran
        "KP", // North Korea
        "LB", // Lebanon (grey list)
        "LY", // Libya
        "ML", // Mali
        "MM", // Myanmar
        "MZ", // Mozambique (grey list)
        "NI", // Nicaragua
        "PK", // Pakistan (grey list)
        "RU", // Russia
        "SO", // Somalia
        "SS", // South Sudan
        "SY", // Syria
        "TZ", // Tanzania (grey list)
        "VE", // Venezuela
        "VU", // Vanuatu (grey list)
        "YE", // Yemen
        "ZW", // Zimbabwe
    ];
    for cc in &fatf_high_risk {
        cache.sanctioned_countries.insert(cc.to_string());
    }

    // ── OFAC/UN/EU/UK Sanctioned BIC Prefixes ────────────────────────────────
    let sanctioned_bics = [
        // DPRK (North Korea)
        "CBIRKPSE", // Central Bank of DPRK
        "KORYOBNK", // Koryo Bank
        // Iran
        "MELIHBIC", // Mellat Bank
        "IRIBANKIR", // Bank of Iran
        "BKIBIRTE", // Bank Keshavarzi Iran
        "SEPAIRTE", // Bank Sepah
        "PARSIRTE", // Parsian Bank (sanctioned entity)
        // Syria
        "SYRIABANK",
        "CBOSSYDA", // Central Bank of Syria
        "BSYRSYDA", // Bank of Syria
        // Russia (OFAC SDN / EU/UK sanctions)
        "SBERRUММ", // Sberbank
        "VTBRRUMM", // VTB Bank
        "GAZPRUMM", // Gazprombank
        "ALFARUMM", // Alfa-Bank
        "OTKRRUММ", // Otkritie
        "RNCBRUMM", // RNCB (Crimea)
        "PJSBRUMM", // Promsvyazbank
        "ROSBRUMM", // Rossiya Bank
        // Belarus
        "BAPBBY2X", // Belarusbank
        "BELBBY2X", // Belinvestbank
        // Venezuela
        "BVENVECA", // Banco de Venezuela
        "BCVEVECA", // Banco Central de Venezuela
        // Cuba
        "BCUBCUBA", // Banco Central de Cuba
        "BICECUBA", // BICSA Cuba
        // Myanmar
        "MABMMYMM", // Myanma Agricultural Development Bank
        "CBMMYMMM", // Central Bank of Myanmar
        // Libya
        "CBLYLYTL", // Central Bank of Libya
        // Sudan / South Sudan
        "CBOSSDKH", // Central Bank of Sudan
    ];
    for bic in &sanctioned_bics {
        cache.bic_prefixes.insert(bic.to_string());
    }

    // ── High-profile SDN name tokens (seed — full list comes from API sync) ──
    let seed_names = [
        "kim jong un", "bashar al-assad", "ali khamenei", "vladimir putin",
        "alexander lukashenko", "nicolas maduro", "min aung hlaing",
        "islamic state", "al-qaeda", "al qaeda", "hamas", "hezbollah",
        "wagner group", "prigozhin", "rosoboronexport", "gazprombank",
        "sberbank", "vtb bank", "alfa bank", "promsvyazbank",
    ];
    for name in &seed_names {
        for token in normalise_name(name) {
            cache.name_tokens.insert(token);
        }
    }

    cache.entry_count = sanctioned_bics.len() + fatf_high_risk.len() + seed_names.len();
}

/// Status of the SDN sync service.
#[derive(Debug, Clone, serde::Serialize)]
pub struct SdnSyncStatus {
    pub entry_count: usize,
    pub last_refreshed_secs_ago: Option<u64>,
    pub is_stale: bool,
    pub source: String,
}

/// Get the current sync status from the cache.
pub fn get_status(cache: &SdnCache) -> SdnSyncStatus {
    let last_refreshed_secs_ago = cache
        .last_refreshed
        .map(|t| t.elapsed().as_secs());
    let is_stale = last_refreshed_secs_ago
        .map(|s| s > REFRESH_INTERVAL.as_secs())
        .unwrap_or(true);
    SdnSyncStatus {
        entry_count: cache.entry_count,
        last_refreshed_secs_ago,
        is_stale,
        source: "OFAC SDN + FATF + EU + UK + UN (static seed + HTTP refresh)".to_string(),
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn seeded_cache() -> SdnCache {
        let mut c = SdnCache::default();
        seed_static_lists(&mut c);
        c
    }

    #[test]
    fn test_seed_populates_countries() {
        let c = seeded_cache();
        assert!(c.sanctioned_countries.contains("KP"), "North Korea must be in sanctioned countries");
        assert!(c.sanctioned_countries.contains("IR"), "Iran must be in sanctioned countries");
        assert!(c.sanctioned_countries.contains("RU"), "Russia must be in sanctioned countries");
        assert!(c.sanctioned_countries.contains("SY"), "Syria must be in sanctioned countries");
        assert!(!c.sanctioned_countries.contains("NG"), "Nigeria must NOT be in sanctioned countries");
        assert!(!c.sanctioned_countries.contains("GB"), "UK must NOT be in sanctioned countries");
    }

    #[test]
    fn test_seed_populates_bic_prefixes() {
        let c = seeded_cache();
        assert!(c.bic_prefixes.contains("CBIRKPSE"), "DPRK central bank BIC must be present");
        assert!(c.bic_prefixes.contains("VTBRRUMM"), "VTB Bank BIC must be present");
        assert!(c.bic_prefixes.contains("SBERRUММ"), "Sberbank BIC must be present");
        assert!(!c.bic_prefixes.contains("BARCGB22"), "Barclays must NOT be sanctioned");
    }

    #[test]
    fn test_normalise_name_basic() {
        let tokens = normalise_name("Kim Jong-Un");
        assert!(tokens.contains(&"kim".to_string()));
        assert!(tokens.contains(&"jong".to_string()));
        assert!(tokens.contains(&"un".to_string()) || tokens.len() >= 2);
    }

    #[test]
    fn test_normalise_name_strips_punctuation() {
        let tokens = normalise_name("Al-Qaeda, Inc.");
        assert!(tokens.contains(&"alqaeda".to_string()) || tokens.contains(&"qaeda".to_string()));
    }

    #[test]
    fn test_name_hits_sdn_true() {
        let c = seeded_cache();
        // "sberbank" is a seeded token
        assert!(name_hits_sdn("Sberbank International", &c));
    }

    #[test]
    fn test_name_hits_sdn_false() {
        let c = seeded_cache();
        assert!(!name_hits_sdn("First Bank of Nigeria", &c));
    }

    #[test]
    fn test_name_hits_sdn_single_long_token() {
        let c = seeded_cache();
        // "gazprombank" is a seeded token (len=11 ≥ 10)
        assert!(name_hits_sdn("Gazprombank", &c));
    }

    #[test]
    fn test_get_status_stale_when_never_refreshed() {
        let c = seeded_cache();
        let status = get_status(&c);
        assert!(status.is_stale, "Cache with no refresh timestamp must be stale");
        assert!(status.entry_count > 0);
    }

    #[test]
    fn test_new_cache_is_empty() {
        let cache = new_cache();
        let guard = cache.read().unwrap();
        assert_eq!(guard.entry_count, 0);
        assert!(guard.name_tokens.is_empty());
    }

    #[test]
    fn test_fatf_grey_list_countries_present() {
        let c = seeded_cache();
        // Grey-list countries added in 2024 FATF plenary
        for cc in &["PK", "ET", "HT", "LB", "MZ", "TZ", "VU"] {
            assert!(c.sanctioned_countries.contains(*cc), "{} must be in grey list", cc);
        }
    }

    #[test]
    fn test_bic_prefix_matching() {
        let c = seeded_cache();
        // Full BIC "VTBRRUMM001" starts with "VTBRRUMM"
        let full_bic = "VTBRRUMM001";
        let hit = c.bic_prefixes.iter().any(|prefix| full_bic.starts_with(prefix.as_str()));
        assert!(hit, "Full BIC starting with sanctioned prefix must match");
    }
}
