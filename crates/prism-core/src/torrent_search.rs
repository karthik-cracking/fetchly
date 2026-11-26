//! Torrent search: query multiple torrent sites in parallel and return
//! aggregated results sorted by seeders. Users can add custom sites.

use anyhow::{Context, Result};
use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;

/// A torrent site that can be searched.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TorrentSite {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub search_path: String,
    pub enabled: bool,
    pub is_builtin: bool,
}

/// One search result from a torrent site.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TorrentSearchResult {
    pub title: String,
    pub magnet_link: Option<String>,
    pub info_hash: Option<String>,
    pub seeders: u32,
    pub leechers: u32,
    /// Human-readable size, e.g. "1.4 GB".
    pub size: String,
    pub size_bytes: Option<u64>,
    pub uploaded: Option<String>,
    pub site_name: String,
    pub detail_url: Option<String>,
}

/// Torrent search engine: holds a shared HTTP client and the list of sites.
pub struct TorrentSearchEngine {
    client: reqwest::Client,
    sites: Arc<Mutex<Vec<TorrentSite>>>,
}

impl TorrentSearchEngine {
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            .user_agent(crate::DEFAULT_USER_AGENT)
            .timeout(Duration::from_secs(15))
            .connect_timeout(Duration::from_secs(8))
            .redirect(reqwest::redirect::Policy::limited(5))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());
        Self {
            client,
            sites: Arc::new(Mutex::new(builtin_sites())),
        }
    }

    pub async fn sites(&self) -> Vec<TorrentSite> {
        self.sites.lock().await.clone()
    }

    pub async fn search(
        &self,
        query: &str,
        site_id: Option<&str>,
    ) -> Result<Vec<TorrentSearchResult>> {
        let sites = self.sites.lock().await.clone();
        let targets: Vec<_> = sites
            .iter()
            .filter(|s| s.enabled)
            .filter(|s| site_id.is_none_or(|id| s.id == id))
            .cloned()
            .collect();

        if targets.is_empty() {
            return Ok(Vec::new());
        }

        let query = query.to_string();
        let mut handles = Vec::new();
        for site in targets {
            let client = self.client.clone();
            let q = query.clone();
            handles.push(tokio::spawn(async move {
                let result = search_site(&client, &site, &q).await;
                match result {
                    Ok(r) => r,
                    Err(e) => {
                        tracing::warn!(site = %site.name, "torrent search failed: {e:#}");
                        Vec::new()
                    }
                }
            }));
        }

        let mut all = Vec::new();
        for handle in handles {
            match handle.await {
                Ok(results) => all.extend(results),
                Err(e) => tracing::warn!("torrent search task panicked: {e}"),
            }
        }
        all.sort_by(|a, b| b.seeders.cmp(&a.seeders));
        Ok(all)
    }

    pub async fn add_site(&self, site: TorrentSite) -> Result<Vec<TorrentSite>> {
        let mut sites = self.sites.lock().await;
        if sites.iter().any(|s| s.id == site.id) {
            anyhow::bail!("a site with id '{}' already exists", site.id);
        }
        sites.push(site);
        Ok(sites.clone())
    }

    pub async fn remove_site(&self, id: &str) -> Result<Vec<TorrentSite>> {
        let mut sites = self.sites.lock().await;
        let before = sites.len();
        sites.retain(|s| s.id != id || s.is_builtin);
        if sites.len() == before {
            anyhow::bail!("cannot remove builtin site or unknown id '{id}'");
        }
        Ok(sites.clone())
    }

    pub async fn toggle_site(&self, id: &str, enabled: bool) -> Result<Vec<TorrentSite>> {
        let mut sites = self.sites.lock().await;
        let site = sites
            .iter_mut()
            .find(|s| s.id == id)
            .context("unknown site")?;
        site.enabled = enabled;
        Ok(sites.clone())
    }

    /// Fetch the magnet link from a detail page (1337x, Nyaa, etc.).
    pub async fn fetch_magnet(&self, detail_url: &str) -> Result<String> {
        let html = self
            .client
            .get(detail_url)
            .send()
            .await?
            .error_for_status()?
            .text()
            .await?;
        let doc = Html::parse_document(&html);
        // Look for magnet: links in <a href="magnet:...">
        let sel = Selector::parse("a[href^='magnet:']").unwrap();
        doc.select(&sel)
            .next()
            .and_then(|el| el.value().attr("href"))
            .map(|s| s.to_string())
            .context("no magnet link found on the page")
    }
}

fn builtin_sites() -> Vec<TorrentSite> {
    vec![
        TorrentSite {
            id: "1337x".into(),
            name: "1337x".into(),
            base_url: "https://1337x.to".into(),
            search_path: "/search/{query}/1/".into(),
            enabled: true,
            is_builtin: true,
        },
        TorrentSite {
            id: "tpb".into(),
            name: "The Pirate Bay".into(),
            base_url: "https://apibay.org".into(),
            search_path: "/q.php?q={query}".into(),
            enabled: true,
            is_builtin: true,
        },
        TorrentSite {
            id: "yts".into(),
            name: "YTS".into(),
            base_url: "https://yts.mx".into(),
            search_path: "/api/v2/list_movies.json?query_term={query}&sort_by=seeds&limit=40".into(),
            enabled: true,
            is_builtin: true,
        },
        TorrentSite {
            id: "nyaa".into(),
            name: "Nyaa".into(),
            base_url: "https://nyaa.si".into(),
            search_path: "/?f=0&c=0_0&q={query}".into(),
            enabled: true,
            is_builtin: true,
        },
        TorrentSite {
            id: "eztv".into(),
            name: "EZTV".into(),
            base_url: "https://eztv.re".into(),
            search_path: "/api/get-torrents?imdb_id=0&limit=40&page=1&search={query}".into(),
            enabled: true,
            is_builtin: true,
        },
    ]
}

async fn search_site(
    client: &reqwest::Client,
    site: &TorrentSite,
    query: &str,
) -> Result<Vec<TorrentSearchResult>> {
    match site.id.as_str() {
        "1337x" => search_1337x(client, site, query).await,
        "tpb" => search_tpb(client, site, query).await,
        "yts" => search_yts(client, site, query).await,
        "nyaa" => search_nyaa(client, site, query).await,
        "eztv" => search_eztv(client, site, query).await,
        _ => search_generic(client, site, query).await,
    }
}

// ---- 1337x -------------------------------------------------------------------------

async fn search_1337x(
    client: &reqwest::Client,
    site: &TorrentSite,
    query: &str,
) -> Result<Vec<TorrentSearchResult>> {
    let encoded = percent_encoding::utf8_percent_encode(
        query,
        percent_encoding::NON_ALPHANUMERIC,
    )
    .to_string();
    let url = format!(
        "{}{}",
        site.base_url,
        site.search_path.replace("{query}", &encoded)
    );
    let html = client.get(&url).send().await?.error_for_status()?.text().await?;
    let doc = Html::parse_document(&html);
    let row_sel = Selector::parse("table.table-list tbody tr").unwrap();
    let name_sel = Selector::parse("td.name a:nth-child(2)").unwrap();
    let seed_sel = Selector::parse("td.seeds").unwrap();
    let leech_sel = Selector::parse("td.leeches").unwrap();
    let size_sel = Selector::parse("td.size").unwrap();
    let time_sel = Selector::parse("td.coll-date").unwrap();

    let mut results = Vec::new();
    for row in doc.select(&row_sel) {
        let name_el = match row.select(&name_sel).next() {
            Some(el) => el,
            None => continue,
        };
        let title = name_el.text().collect::<String>().trim().to_string();
        let href = name_el.value().attr("href").unwrap_or("").to_string();
        let detail_url = if href.starts_with('/') {
            format!("{}{}", site.base_url, href)
        } else {
            href
        };
        let seeders = row
            .select(&seed_sel)
            .next()
            .map(|e| e.text().collect::<String>().trim().parse().unwrap_or(0))
            .unwrap_or(0);
        let leechers = row
            .select(&leech_sel)
            .next()
            .map(|e| e.text().collect::<String>().trim().parse().unwrap_or(0))
            .unwrap_or(0);
        let size = row
            .select(&size_sel)
            .next()
            .map(|e| {
                e.text()
                    .collect::<String>()
                    .trim()
                    .split('\n')
                    .next()
                    .unwrap_or("")
                    .trim()
                    .to_string()
            })
            .unwrap_or_default();
        let uploaded = row
            .select(&time_sel)
            .next()
            .map(|e| e.text().collect::<String>().trim().to_string());

        results.push(TorrentSearchResult {
            title,
            magnet_link: None, // requires detail page
            info_hash: None,
            seeders,
            leechers,
            size,
            size_bytes: None,
            uploaded,
            site_name: site.name.clone(),
            detail_url: Some(detail_url),
        });
    }
    Ok(results)
}

// ---- The Pirate Bay (apibay.org) ---------------------------------------------------

#[derive(Deserialize)]
struct TpbItem {
    #[serde(default)]
    name: String,
    #[serde(default)]
    info_hash: String,
    #[serde(default, deserialize_with = "de_u32")]
    seeders: u32,
    #[serde(default, deserialize_with = "de_u32")]
    leechers: u32,
    #[serde(default, deserialize_with = "de_u64")]
    size: u64,
    #[serde(default)]
    added: String,
}

fn de_u32<'de, D: serde::Deserializer<'de>>(d: D) -> std::result::Result<u32, D::Error> {
    let v = serde_json::Value::deserialize(d)?;
    Ok(match &v {
        serde_json::Value::Number(n) => n.as_u64().unwrap_or(0) as u32,
        serde_json::Value::String(s) => s.parse().unwrap_or(0),
        _ => 0,
    })
}

fn de_u64<'de, D: serde::Deserializer<'de>>(d: D) -> std::result::Result<u64, D::Error> {
    let v = serde_json::Value::deserialize(d)?;
    Ok(match &v {
        serde_json::Value::Number(n) => n.as_u64().unwrap_or(0),
        serde_json::Value::String(s) => s.parse().unwrap_or(0),
        _ => 0,
    })
}

fn human_size(bytes: u64) -> String {
    const UNITS: &[&str] = &["B", "KB", "MB", "GB", "TB"];
    if bytes < 1024 {
        return format!("{bytes} B");
    }
    let mut v = bytes as f64;
    let mut i = 0;
    while v >= 1024.0 && i < UNITS.len() - 1 {
        v /= 1024.0;
        i += 1;
    }
    if v >= 100.0 {
        format!("{:.0} {}", v, UNITS[i])
    } else {
        format!("{:.1} {}", v, UNITS[i])
    }
}

async fn search_tpb(
    client: &reqwest::Client,
    site: &TorrentSite,
    query: &str,
) -> Result<Vec<TorrentSearchResult>> {
    let encoded = percent_encoding::utf8_percent_encode(
        query,
        percent_encoding::NON_ALPHANUMERIC,
    )
    .to_string();
    let url = format!(
        "{}{}",
        site.base_url,
        site.search_path.replace("{query}", &encoded)
    );
    let text = client.get(&url).send().await?.error_for_status()?.text().await?;
    let items: Vec<TpbItem> = serde_json::from_str(&text).context("parse TPB JSON")?;

    Ok(items
        .into_iter()
        .filter(|i| !i.name.is_empty() && i.name != "No results returned")
        .map(|i| {
            let trackers = "&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337%2Fannounce\
                &tr=udp%3A%2F%2Fopen.stealth.si%3A80%2Fannounce\
                &tr=udp%3A%2F%2Ftracker.torrent.eu.org%3A451%2Fannounce\
                &tr=udp%3A%2F%2Ftracker.bittor.pw%3A1337%2Fannounce\
                &tr=udp%3A%2F%2Fpublic.popcorn-tracker.org%3A6969%2Fannounce";
            let magnet = format!(
                "magnet:?xt=urn:btih:{}&dn={}{}",
                i.info_hash,
                percent_encoding::utf8_percent_encode(
                    &i.name,
                    percent_encoding::NON_ALPHANUMERIC
                ),
                trackers
            );
            TorrentSearchResult {
                title: i.name,
                magnet_link: Some(magnet),
                info_hash: Some(i.info_hash),
                seeders: i.seeders,
                leechers: i.leechers,
                size: human_size(i.size),
                size_bytes: Some(i.size),
                uploaded: if i.added.is_empty() {
                    None
                } else {
                    Some(i.added)
                },
                site_name: site.name.clone(),
                detail_url: None,
            }
        })
        .collect())
}

// ---- YTS ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct YtsResponse {
    data: Option<YtsData>,
}

#[derive(Deserialize)]
struct YtsData {
    movies: Option<Vec<YtsMovie>>,
}

#[derive(Deserialize)]
struct YtsMovie {
    #[serde(default)]
    title_long: String,
    torrents: Option<Vec<YtsTorrent>>,
}

#[derive(Deserialize)]
struct YtsTorrent {
    #[serde(default)]
    hash: String,
    #[serde(default)]
    quality: String,
    #[serde(rename = "type", default)]
    kind: String,
    #[serde(default)]
    size: String,
    #[serde(default)]
    size_bytes: u64,
    #[serde(default)]
    seeds: u32,
    #[serde(default)]
    peers: u32,
    #[serde(default)]
    date_uploaded: String,
}

async fn search_yts(
    client: &reqwest::Client,
    site: &TorrentSite,
    query: &str,
) -> Result<Vec<TorrentSearchResult>> {
    let encoded = percent_encoding::utf8_percent_encode(
        query,
        percent_encoding::NON_ALPHANUMERIC,
    )
    .to_string();
    let url = format!(
        "{}{}",
        site.base_url,
        site.search_path.replace("{query}", &encoded)
    );
    let resp: YtsResponse = client
        .get(&url)
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;

    let movies = resp
        .data
        .and_then(|d| d.movies)
        .unwrap_or_default();
    let trackers = "&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337%2Fannounce\
        &tr=udp%3A%2F%2Fopen.stealth.si%3A80%2Fannounce\
        &tr=udp%3A%2F%2Ftracker.leechers-paradise.org%3A6969%2Fannounce\
        &tr=udp%3A%2F%2Fp4p.arenabg.com%3A1337%2Fannounce";

    let mut results = Vec::new();
    for movie in movies {
        for t in movie.torrents.unwrap_or_default() {
            let title = format!("{} [{}] {}", movie.title_long, t.quality, t.kind);
            let dn = percent_encoding::utf8_percent_encode(
                &title,
                percent_encoding::NON_ALPHANUMERIC,
            );
            let magnet = format!("magnet:?xt=urn:btih:{}&dn={}{}", t.hash, dn, trackers);
            results.push(TorrentSearchResult {
                title,
                magnet_link: Some(magnet),
                info_hash: Some(t.hash),
                seeders: t.seeds,
                leechers: t.peers,
                size: t.size.clone(),
                size_bytes: Some(t.size_bytes),
                uploaded: Some(t.date_uploaded),
                site_name: site.name.clone(),
                detail_url: None,
            });
        }
    }
    Ok(results)
}

// ---- Nyaa --------------------------------------------------------------------------

async fn search_nyaa(
    client: &reqwest::Client,
    site: &TorrentSite,
    query: &str,
) -> Result<Vec<TorrentSearchResult>> {
    let encoded = percent_encoding::utf8_percent_encode(
        query,
        percent_encoding::NON_ALPHANUMERIC,
    )
    .to_string();
    let url = format!(
        "{}{}",
        site.base_url,
        site.search_path.replace("{query}", &encoded)
    );
    let html = client.get(&url).send().await?.error_for_status()?.text().await?;
    let doc = Html::parse_document(&html);
    let row_sel = Selector::parse("table.torrent-list tbody tr").unwrap();
    let title_sel = Selector::parse("td:nth-child(2) a:not(.comments)").unwrap();
    let magnet_sel = Selector::parse("td:nth-child(3) a[href^='magnet:']").unwrap();
    let size_sel = Selector::parse("td:nth-child(4)").unwrap();
    let date_sel = Selector::parse("td:nth-child(5)").unwrap();
    let seed_sel = Selector::parse("td:nth-child(6)").unwrap();
    let leech_sel = Selector::parse("td:nth-child(7)").unwrap();

    let mut results = Vec::new();
    for row in doc.select(&row_sel) {
        let title_el = match row.select(&title_sel).last() {
            Some(el) => el,
            None => continue,
        };
        let title = title_el.text().collect::<String>().trim().to_string();
        let href = title_el.value().attr("href").unwrap_or("");
        let detail_url = if href.starts_with('/') {
            format!("{}{}", site.base_url, href)
        } else {
            href.to_string()
        };
        let magnet = row
            .select(&magnet_sel)
            .next()
            .and_then(|e| e.value().attr("href"))
            .map(|s| s.to_string());
        let size = row
            .select(&size_sel)
            .next()
            .map(|e| e.text().collect::<String>().trim().to_string())
            .unwrap_or_default();
        let uploaded = row
            .select(&date_sel)
            .next()
            .map(|e| e.text().collect::<String>().trim().to_string());
        let seeders = row
            .select(&seed_sel)
            .next()
            .map(|e| e.text().collect::<String>().trim().parse().unwrap_or(0))
            .unwrap_or(0);
        let leechers = row
            .select(&leech_sel)
            .next()
            .map(|e| e.text().collect::<String>().trim().parse().unwrap_or(0))
            .unwrap_or(0);

        results.push(TorrentSearchResult {
            title,
            magnet_link: magnet,
            info_hash: None,
            seeders,
            leechers,
            size,
            size_bytes: None,
            uploaded,
            site_name: site.name.clone(),
            detail_url: Some(detail_url),
        });
    }
    Ok(results)
}

// ---- EZTV --------------------------------------------------------------------------

#[derive(Deserialize)]
struct EztvResponse {
    torrents: Option<Vec<EztvTorrent>>,
}

#[derive(Deserialize)]
struct EztvTorrent {
    #[serde(default)]
    title: String,
    #[serde(default)]
    magnet_url: String,
    #[serde(default)]
    hash: String,
    #[serde(default)]
    seeds: u32,
    #[serde(default)]
    peers: u32,
    #[serde(default)]
    size_bytes: String,
    #[serde(default)]
    date_released_unix: u64,
}

async fn search_eztv(
    client: &reqwest::Client,
    site: &TorrentSite,
    query: &str,
) -> Result<Vec<TorrentSearchResult>> {
    let encoded = percent_encoding::utf8_percent_encode(
        query,
        percent_encoding::NON_ALPHANUMERIC,
    )
    .to_string();
    let url = format!(
        "{}{}",
        site.base_url,
        site.search_path.replace("{query}", &encoded)
    );
    let resp: EztvResponse = client
        .get(&url)
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;

    let query_tokens: Vec<String> = query
        .split_whitespace()
        .map(|w| {
            w.chars()
                .filter(|c| c.is_alphanumeric())
                .flat_map(|c| c.to_lowercase())
                .collect::<String>()
        })
        .filter(|w| !w.is_empty())
        .collect();

    Ok(resp
        .torrents
        .unwrap_or_default()
        .into_iter()
        .filter(|t| {
            if t.title.is_empty() {
                return false;
            }
            if query_tokens.is_empty() {
                return true;
            }
            let norm_title: String = t
                .title
                .chars()
                .filter(|c| c.is_alphanumeric())
                .flat_map(|c| c.to_lowercase())
                .collect();
            query_tokens.iter().all(|tok| norm_title.contains(tok))
        })
        .map(|t| {
            let bytes: u64 = t.size_bytes.parse().unwrap_or(0);
            TorrentSearchResult {
                title: t.title,
                magnet_link: if t.magnet_url.is_empty() {
                    None
                } else {
                    Some(t.magnet_url)
                },
                info_hash: if t.hash.is_empty() {
                    None
                } else {
                    Some(t.hash)
                },
                seeders: t.seeds,
                leechers: t.peers,
                size: human_size(bytes),
                size_bytes: Some(bytes),
                uploaded: if t.date_released_unix > 0 {
                    Some(
                        chrono::DateTime::from_timestamp(t.date_released_unix as i64, 0)
                            .map(|dt| dt.format("%Y-%m-%d").to_string())
                            .unwrap_or_default(),
                    )
                } else {
                    None
                },
                site_name: site.name.clone(),
                detail_url: None,
            }
        })
        .collect())
}

// ---- Generic (custom sites: best-effort HTML scrape) --------------------------------

async fn search_generic(
    client: &reqwest::Client,
    site: &TorrentSite,
    query: &str,
) -> Result<Vec<TorrentSearchResult>> {
    let encoded = percent_encoding::utf8_percent_encode(
        query,
        percent_encoding::NON_ALPHANUMERIC,
    )
    .to_string();
    let url = format!(
        "{}{}",
        site.base_url,
        site.search_path.replace("{query}", &encoded)
    );
    let html = client.get(&url).send().await?.error_for_status()?.text().await?;
    let doc = Html::parse_document(&html);

    // Best-effort: find magnet links in <a> tags.
    let magnet_sel = Selector::parse("a[href^='magnet:']").unwrap();
    let mut results = Vec::new();
    for el in doc.select(&magnet_sel) {
        let href = el.value().attr("href").unwrap_or("").to_string();
        let title = el.text().collect::<String>().trim().to_string();
        let title = if title.is_empty() {
            // Try the dn= parameter.
            href.split("&dn=")
                .nth(1)
                .and_then(|s| s.split('&').next())
                .map(|s| {
                    percent_encoding::percent_decode_str(s)
                        .decode_utf8_lossy()
                        .to_string()
                })
                .unwrap_or_else(|| "Unknown".into())
        } else {
            title
        };
        results.push(TorrentSearchResult {
            title,
            magnet_link: Some(href),
            info_hash: None,
            seeders: 0,
            leechers: 0,
            size: String::new(),
            size_bytes: None,
            uploaded: None,
            site_name: site.name.clone(),
            detail_url: None,
        });
    }
    Ok(results)
}
