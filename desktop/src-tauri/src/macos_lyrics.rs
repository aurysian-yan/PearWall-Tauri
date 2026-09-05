use crate::macos_runtime_state;
use crate::MediaArtwork;
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::cmp::Ordering;
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, SendError, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime};
use strsim::jaro_winkler;

const MATCH_THRESHOLD: f64 = 60.0;
const AMLL_BASE_URL: &str =
    "https://raw.githubusercontent.com/amll-dev/amll-ttml-db/refs/heads/main";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum LyricsProvider {
    Amll,
    LrcLib,
    Netease,
    Qq,
    Kugou,
}

impl LyricsProvider {
    const DEFAULT_ORDER: [Self; 5] = [
        Self::Amll,
        Self::LrcLib,
        Self::Netease,
        Self::Qq,
        Self::Kugou,
    ];

    fn from_setting(value: &str) -> Option<Self> {
        match value {
            "AMLL" => Some(Self::Amll),
            "LRCLIB" => Some(Self::LrcLib),
            "NETEASE" => Some(Self::Netease),
            "QQ" => Some(Self::Qq),
            "KUGOU" => Some(Self::Kugou),
            _ => None,
        }
    }

    fn setting_value(self) -> &'static str {
        match self {
            Self::Amll => "AMLL",
            Self::LrcLib => "LRCLIB",
            Self::Netease => "NETEASE",
            Self::Qq => "QQ",
            Self::Kugou => "KUGOU",
        }
    }

    fn search(self, agent: &ureq::Agent, song: &SongMetadata) -> Option<LyricsPayload> {
        match self {
            Self::Amll => search_amll(agent, song),
            Self::LrcLib => search_lrclib(agent, song),
            Self::Netease => search_netease(agent, song),
            Self::Qq => search_qq(agent, song),
            Self::Kugou => search_kugou(agent, song),
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricsPayload {
    version: u32,
    track_id: u64,
    provider: String,
    format: String,
    match_score: f64,
    title: String,
    artist: String,
    album: String,
    duration: f64,
    raw: String,
    translation: String,
    romanization: String,
    reference: String,
    updated_at_milliseconds: u64,
}

impl LyricsPayload {
    fn empty(track_id: u64) -> Self {
        Self {
            version: 2,
            track_id,
            provider: String::new(),
            format: String::new(),
            match_score: 0.0,
            title: String::new(),
            artist: String::new(),
            album: String::new(),
            duration: 0.0,
            raw: String::new(),
            translation: String::new(),
            romanization: String::new(),
            reference: String::new(),
            updated_at_milliseconds: unix_time_milliseconds(),
        }
    }

    fn quality(&self) -> u8 {
        match self.format.as_str() {
            "TTML" | "QRC" | "KRC" | "YRC" => 3,
            "ESLRC" => 2,
            "LRC" => 1,
            _ => 0,
        }
    }
}

#[derive(Clone)]
struct SongMetadata {
    track_id: u64,
    title: String,
    artist: String,
    album: String,
    duration: f64,
}

impl SongMetadata {
    fn from_media(media: &MediaArtwork) -> Self {
        Self {
            track_id: macos_runtime_state::stable_track_id(media),
            title: media.title.trim().to_string(),
            artist: media.artist.trim().to_string(),
            album: media.album.trim().to_string(),
            duration: finite_nonnegative(media.duration),
        }
    }

    fn request_key(&self) -> String {
        format!(
            "{}\u{1f}{}\u{1f}{}\u{1f}{}\u{1f}{}",
            self.track_id,
            self.title,
            self.artist,
            self.album,
            self.duration.round()
        )
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LrcLibItem {
    track_name: String,
    artist_name: String,
    album_name: String,
    duration: f64,
    synced_lyrics: Option<String>,
}

pub struct LyricsWorkerHandle {
    sender: Sender<MediaArtwork>,
    latest_request_key: Arc<Mutex<String>>,
}

impl LyricsWorkerHandle {
    pub fn send(&self, media: MediaArtwork) -> Result<(), SendError<MediaArtwork>> {
        let request_key = SongMetadata::from_media(&media).request_key();
        if let Ok(mut latest) = self.latest_request_key.lock() {
            *latest = request_key;
        }
        self.sender.send(media)
    }
}

pub fn start() -> LyricsWorkerHandle {
    let (sender, receiver) = mpsc::channel();
    let latest_request_key = Arc::new(Mutex::new(String::new()));
    let worker_request_key = latest_request_key.clone();
    let _ = thread::Builder::new()
        .name("pearwall-lyrics".to_string())
        .spawn(move || worker(receiver, worker_request_key));
    LyricsWorkerHandle {
        sender,
        latest_request_key,
    }
}

fn worker(receiver: Receiver<MediaArtwork>, latest_request_key: Arc<Mutex<String>>) {
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(5))
        .timeout_read(Duration::from_secs(18))
        .timeout_write(Duration::from_secs(8))
        .build();
    let mut last_request_key = String::new();
    let mut last_attempt = Instant::now() - Duration::from_secs(60);
    let mut last_enabled = false;

    while let Ok(mut media) = receiver.recv() {
        for next in receiver.try_iter() {
            media = next;
        }
        let enabled = lyrics_feature_enabled();
        let song = SongMetadata::from_media(&media);
        let media_request_key = song.request_key();
        let providers = lyrics_provider_order();
        let provider_key = provider_order_key(&providers);
        let request_key = format!("{media_request_key}\u{1f}{provider_key}");
        if !enabled || song.track_id == 0 {
            if last_enabled || last_request_key != request_key {
                let _ = publish_current(&LyricsPayload::empty(song.track_id));
            }
            last_enabled = enabled;
            last_request_key = request_key;
            continue;
        }
        if last_enabled
            && last_request_key == request_key
            && last_attempt.elapsed() < Duration::from_secs(30)
        {
            continue;
        }
        last_enabled = true;
        last_request_key = request_key;
        last_attempt = Instant::now();

        if let Some(cached) = read_cache(song.track_id, &provider_key) {
            let _ = publish_current(&cached);
            continue;
        }
        let result = search_all(&agent, &song, &providers)
            .unwrap_or_else(|| LyricsPayload::empty(song.track_id));
        let media_changed = latest_request_key
            .lock()
            .is_ok_and(|latest| *latest != media_request_key);
        let provider_order_changed = provider_order_key(&lyrics_provider_order()) != provider_key;
        if media_changed || provider_order_changed {
            continue;
        }
        if !result.raw.is_empty() {
            let _ = write_cache(&result, &provider_key);
        }
        let _ = publish_current(&result);
    }
}

fn search_all(
    agent: &ureq::Agent,
    song: &SongMetadata,
    providers: &[LyricsProvider],
) -> Option<LyricsPayload> {
    let (sender, receiver) = mpsc::channel();
    thread::scope(|scope| {
        for (priority, provider) in providers.iter().copied().enumerate() {
            let sender = sender.clone();
            let agent = agent.clone();
            scope.spawn(move || {
                let result = provider
                    .search(&agent, song)
                    .filter(|payload| reliable_match(song, payload))
                    .map(|payload| (priority, payload));
                let _ = sender.send(result);
            });
        }
    });
    drop(sender);
    let results: Vec<(usize, LyricsPayload)> = receiver
        .into_iter()
        .flatten()
        .filter(|(_, result)| {
            result.match_score >= MATCH_THRESHOLD && !result.raw.trim().is_empty()
        })
        .collect();
    choose_best(results)
}

fn choose_best(results: Vec<(usize, LyricsPayload)>) -> Option<LyricsPayload> {
    results
        .into_iter()
        .min_by(|left, right| {
            left.0
                .cmp(&right.0)
                .then_with(|| compare_results(&right.1, &left.1))
        })
        .map(|(_, payload)| payload)
}

fn reliable_match(song: &SongMetadata, result: &LyricsPayload) -> bool {
    let title_similarity = string_similarity(&song.title, &result.title);
    let artist_similarity = string_similarity(&song.artist, &result.artist);
    let album_similarity = string_similarity(&song.album, &result.album);
    let duration_matches = song.duration <= 0.0
        || result.duration <= 0.0
        || (song.duration - result.duration).abs() <= 10.0;
    let artist_matches = !song.artist.trim().is_empty()
        && !result.artist.trim().is_empty()
        && artist_similarity >= 0.55;
    let album_matches = !song.album.trim().is_empty()
        && !result.album.trim().is_empty()
        && album_similarity >= 0.75;
    title_similarity >= 0.82 && (artist_matches || album_matches) && duration_matches
}

fn compare_results(left: &LyricsPayload, right: &LyricsPayload) -> Ordering {
    let score_difference = (left.match_score - right.match_score).abs();
    if score_difference <= 3.0 {
        left.quality()
            .cmp(&right.quality())
            .then_with(|| left.match_score.total_cmp(&right.match_score))
    } else {
        left.match_score.total_cmp(&right.match_score)
    }
}

fn search_lrclib(agent: &ureq::Agent, song: &SongMetadata) -> Option<LyricsPayload> {
    let response = agent
        .get("https://lrclib.net/api/search")
        .set(
            "User-Agent",
            "PearWall/1.0 (+https://github.com/Nevodev/PearWall)",
        )
        .query("track_name", &song.title)
        .query("artist_name", &song.artist)
        .query("album_name", &song.album)
        .query("duration", &song.duration.round().to_string())
        .call()
        .ok()?;
    let items: Vec<LrcLibItem> = response.into_json().ok()?;
    items
        .into_iter()
        .filter_map(|item| {
            let raw = item.synced_lyrics?.trim().to_string();
            if raw.is_empty() {
                return None;
            }
            Some(payload(
                song,
                "LRCLIB",
                "LRC",
                item.track_name,
                item.artist_name,
                item.album_name,
                item.duration,
                raw,
                String::new(),
                String::new(),
                "https://lrclib.net",
            ))
        })
        .max_by(compare_results)
}

fn search_amll(agent: &ureq::Agent, song: &SongMetadata) -> Option<LyricsPayload> {
    let index_path = ensure_amll_index(agent)?;
    let file = File::open(index_path).ok()?;
    let mut best: Option<(f64, String, String, String, String)> = None;
    for line in BufReader::new(file).lines().map_while(Result::ok) {
        let Ok(value) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let Some(metadata) = value.get("metadata").and_then(Value::as_array) else {
            continue;
        };
        let titles = metadata_values(metadata, "musicName");
        let artists = metadata_values(metadata, "artists");
        let albums = metadata_values(metadata, "album");
        let Some(raw_file) = value
            .get("rawLyricFile")
            .and_then(Value::as_str)
            .map(str::to_string)
        else {
            continue;
        };
        let title = titles.first().cloned().unwrap_or_default();
        let artist = artists.join("/");
        let album = albums.first().cloned().unwrap_or_default();
        let score = metadata_score(song, &title, &artist, &album, 0.0);
        if best.as_ref().is_none_or(|current| score > current.0) {
            best = Some((score, raw_file, title, artist, album));
        }
    }
    let (score, raw_file, title, artist, album) = best?;
    if score < MATCH_THRESHOLD {
        return None;
    }
    let reference = format!("{AMLL_BASE_URL}/raw-lyrics/{raw_file}");
    let raw = agent.get(&reference).call().ok()?.into_string().ok()?;
    if !raw.contains("<tt") {
        return None;
    }
    let mut result = payload(
        song,
        "AMLL TTML DB",
        "TTML",
        title,
        artist,
        album,
        song.duration,
        raw,
        String::new(),
        String::new(),
        &reference,
    );
    result.match_score = score;
    Some(result)
}

fn search_netease(agent: &ureq::Agent, song: &SongMetadata) -> Option<LyricsPayload> {
    let query = format!("{} {}", song.title, song.artist);
    let response: Value = agent
        .post("https://music.163.com/api/search/get/web")
        .set("Referer", "https://music.163.com/")
        .send_form(&[
            ("s", query.as_str()),
            ("type", "1"),
            ("limit", "12"),
            ("offset", "0"),
        ])
        .ok()?
        .into_json()
        .ok()?;
    let candidates = response.pointer("/result/songs")?.as_array()?;
    let candidate = candidates.iter().max_by(|left, right| {
        netease_candidate_score(song, left).total_cmp(&netease_candidate_score(song, right))
    })?;
    let id = candidate.get("id")?.as_i64()?;
    let title = candidate
        .get("name")?
        .as_str()
        .unwrap_or_default()
        .to_string();
    let artist = candidate
        .get("artists")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|value| value.get("name").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join("/");
    let album = candidate
        .pointer("/album/name")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let duration = candidate
        .get("duration")
        .and_then(Value::as_f64)
        .unwrap_or(0.0)
        / 1000.0;
    let lyrics: Value = agent
        .get("https://music.163.com/api/song/lyric")
        .set("Referer", "https://music.163.com/")
        .query("id", &id.to_string())
        .query("lv", "-1")
        .query("kv", "-1")
        .query("tv", "-1")
        .query("rv", "-1")
        .query("yv", "-1")
        .call()
        .ok()?
        .into_json()
        .ok()?;
    let yrc = lyrics
        .pointer("/yrc/lyric")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let lrc = lyrics
        .pointer("/lrc/lyric")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let raw = if yrc.trim().is_empty() { lrc } else { yrc };
    if raw.trim().is_empty() {
        return None;
    }
    Some(payload(
        song,
        "网易云音乐",
        if yrc.trim().is_empty() { "LRC" } else { "YRC" },
        title,
        artist,
        album,
        duration,
        raw.to_string(),
        lyrics
            .pointer("/tlyric/lyric")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        lyrics
            .pointer("/romalrc/lyric")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        &format!("https://music.163.com/song?id={id}"),
    ))
}

fn netease_candidate_score(song: &SongMetadata, value: &Value) -> f64 {
    let title = value
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let artist = value
        .get("artists")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| item.get("name").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join("/");
    let album = value
        .pointer("/album/name")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let duration = value.get("duration").and_then(Value::as_f64).unwrap_or(0.0) / 1000.0;
    metadata_score(song, title, &artist, album, duration)
}

fn search_qq(agent: &ureq::Agent, song: &SongMetadata) -> Option<LyricsPayload> {
    let response: Value = agent
        .get("https://c.y.qq.com/soso/fcgi-bin/client_search_cp")
        .set("Referer", "https://y.qq.com/")
        .query("format", "json")
        .query("p", "1")
        .query("n", "12")
        .query("w", &format!("{} {}", song.title, song.artist))
        .call()
        .ok()?
        .into_json()
        .ok()?;
    let candidates = response.pointer("/data/song/list")?.as_array()?;
    let candidate = candidates.iter().max_by(|left, right| {
        qq_candidate_score(song, left).total_cmp(&qq_candidate_score(song, right))
    })?;
    let mid = candidate.get("songmid")?.as_str()?;
    let title = candidate
        .get("songname")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let artist = candidate
        .get("singer")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|value| value.get("name").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join("/");
    let album = candidate
        .get("albumname")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let duration = candidate
        .get("interval")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    let response: Value = agent
        .get("https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg")
        .set("Referer", "https://y.qq.com/")
        .query("format", "json")
        .query("songmid", mid)
        .call()
        .ok()?
        .into_json()
        .ok()?;
    let raw = decode_base64_field(&response, "lyric")?;
    Some(payload(
        song,
        "QQ 音乐",
        "LRC",
        title,
        artist,
        album,
        duration,
        raw,
        decode_base64_field(&response, "trans").unwrap_or_default(),
        String::new(),
        &format!("https://y.qq.com/n/ryqq/songDetail/{mid}"),
    ))
}

fn qq_candidate_score(song: &SongMetadata, value: &Value) -> f64 {
    let title = value
        .get("songname")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let artist = value
        .get("singer")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| item.get("name").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join("/");
    metadata_score(
        song,
        title,
        &artist,
        value
            .get("albumname")
            .and_then(Value::as_str)
            .unwrap_or_default(),
        value.get("interval").and_then(Value::as_f64).unwrap_or(0.0),
    )
}

fn search_kugou(agent: &ureq::Agent, song: &SongMetadata) -> Option<LyricsPayload> {
    let response: Value = agent
        .get("https://songsearch.kugou.com/song_search_v2")
        .query("keyword", &format!("{} {}", song.title, song.artist))
        .query("page", "1")
        .query("pagesize", "12")
        .call()
        .ok()?
        .into_json()
        .ok()?;
    let candidates = response.pointer("/data/lists")?.as_array()?;
    let candidate = candidates.iter().max_by(|left, right| {
        kugou_candidate_score(song, left).total_cmp(&kugou_candidate_score(song, right))
    })?;
    let hash = candidate.get("FileHash").and_then(Value::as_str)?;
    let title = candidate
        .get("SongName")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let artist = candidate
        .get("SingerName")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let album = candidate
        .get("AlbumName")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let duration = candidate
        .get("Duration")
        .and_then(Value::as_f64)
        .unwrap_or(0.0)
        / 1000.0;
    let search: Value = agent
        .get("https://lyrics.kugou.com/search")
        .query("ver", "1")
        .query("man", "yes")
        .query("client", "pc")
        .query("hash", hash)
        .call()
        .ok()?
        .into_json()
        .ok()?;
    let candidate = search.get("candidates")?.as_array()?.first()?;
    let id = candidate.get("id")?.as_str()?;
    let access_key = candidate.get("accesskey")?.as_str()?;
    let download: Value = agent
        .get("https://lyrics.kugou.com/download")
        .query("ver", "1")
        .query("client", "pc")
        .query("fmt", "lrc")
        .query("charset", "utf8")
        .query("id", id)
        .query("accesskey", access_key)
        .call()
        .ok()?
        .into_json()
        .ok()?;
    let raw = decode_base64_field(&download, "content")?;
    Some(payload(
        song,
        "酷狗音乐",
        "LRC",
        title,
        artist,
        album,
        duration,
        raw,
        String::new(),
        String::new(),
        &format!("https://www.kugou.com/song/#hash={hash}"),
    ))
}

fn kugou_candidate_score(song: &SongMetadata, value: &Value) -> f64 {
    metadata_score(
        song,
        value
            .get("SongName")
            .and_then(Value::as_str)
            .unwrap_or_default(),
        value
            .get("SingerName")
            .and_then(Value::as_str)
            .unwrap_or_default(),
        value
            .get("AlbumName")
            .and_then(Value::as_str)
            .unwrap_or_default(),
        value.get("Duration").and_then(Value::as_f64).unwrap_or(0.0) / 1000.0,
    )
}

#[allow(clippy::too_many_arguments)]
fn payload(
    song: &SongMetadata,
    provider: &str,
    format: &str,
    title: String,
    artist: String,
    album: String,
    duration: f64,
    raw: String,
    translation: String,
    romanization: String,
    reference: &str,
) -> LyricsPayload {
    LyricsPayload {
        version: 1,
        track_id: song.track_id,
        provider: provider.to_string(),
        format: format.to_string(),
        match_score: metadata_score(song, &title, &artist, &album, duration),
        title,
        artist,
        album,
        duration,
        raw,
        translation,
        romanization,
        reference: reference.to_string(),
        updated_at_milliseconds: unix_time_milliseconds(),
    }
}

fn metadata_score(
    song: &SongMetadata,
    title: &str,
    artist: &str,
    album: &str,
    duration: f64,
) -> f64 {
    (0.30 * string_similarity(&song.title, title)
        + 0.30 * string_similarity(&song.artist, artist)
        + 0.10 * string_similarity(&song.album, album)
        + 0.30 * duration_similarity(song.duration, duration))
        * 100.0
}

fn string_similarity(left: &str, right: &str) -> f64 {
    let left = normalized(left);
    let right = normalized(right);
    if left.is_empty() && right.is_empty() {
        return 1.0;
    }
    if left.is_empty() || right.is_empty() {
        return 0.0;
    }
    jaro_winkler(&left, &right)
}

fn duration_similarity(left: f64, right: f64) -> f64 {
    if right <= 0.0 {
        return 0.0;
    }
    let difference = (left - right).abs();
    if difference <= 1.0 {
        1.0
    } else if difference >= 10.0 {
        0.0
    } else {
        1.0 - (difference - 1.0) / 9.0
    }
}

fn normalized(value: &str) -> String {
    let without_suffix = value.split(['(', '（', '[', '【']).next().unwrap_or(value);
    without_suffix
        .to_lowercase()
        .chars()
        .filter(|character| character.is_alphanumeric())
        .collect()
}

fn decode_base64_field(value: &Value, key: &str) -> Option<String> {
    let encoded = value.get(key)?.as_str()?;
    let data = STANDARD.decode(encoded).ok()?;
    String::from_utf8(data).ok()
}

fn metadata_values(metadata: &[Value], key: &str) -> Vec<String> {
    metadata
        .iter()
        .find_map(|entry| {
            let entry = entry.as_array()?;
            if entry.first()?.as_str()? != key {
                return None;
            }
            Some(
                entry
                    .get(1)?
                    .as_array()?
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect(),
            )
        })
        .unwrap_or_default()
}

fn ensure_amll_index(agent: &ureq::Agent) -> Option<PathBuf> {
    let directory = lyrics_directory()?;
    fs::create_dir_all(&directory).ok()?;
    let path = directory.join("amll-lyrics-index.jsonl");
    let fresh = fs::metadata(&path)
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .and_then(|date| SystemTime::now().duration_since(date).ok())
        .is_some_and(|age| age < Duration::from_secs(24 * 60 * 60));
    if fresh {
        return Some(path);
    }
    let mut response = agent
        .get(&format!("{AMLL_BASE_URL}/metadata/raw-lyrics-index.jsonl"))
        .call()
        .ok()?
        .into_reader();
    let temporary = directory.join(format!(".amll-index-{}.tmp", std::process::id()));
    let mut file = secure_file(&temporary).ok()?;
    std::io::copy(&mut response, &mut file).ok()?;
    file.flush().ok()?;
    fs::rename(temporary, &path).ok()?;
    Some(path)
}

fn lyrics_feature_enabled() -> bool {
    let Ok(directory) = macos_runtime_state::application_support_directory() else {
        return false;
    };
    let Ok(data) = fs::read(directory.join("settings.json")) else {
        return false;
    };
    let Ok(value) = serde_json::from_slice::<Value>(&data) else {
        return false;
    };
    let Some(presentation) = value.get("lyricsPresentation") else {
        return false;
    };
    if presentation
        .pointer("/defaultProfile/enabled")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return true;
    }
    presentation
        .get("displayOverrides")
        .and_then(Value::as_object)
        .is_some_and(|overrides| {
            overrides.values().any(|profile| {
                profile
                    .get("enabled")
                    .and_then(Value::as_bool)
                    .unwrap_or(false)
            })
        })
}

fn lyrics_provider_order() -> Vec<LyricsProvider> {
    let configured = macos_runtime_state::application_support_directory()
        .ok()
        .and_then(|directory| fs::read(directory.join("settings.json")).ok())
        .and_then(|data| serde_json::from_slice::<Value>(&data).ok())
        .and_then(|value| {
            value
                .pointer("/lyricsPresentation/sourceOrder")
                .and_then(Value::as_array)
                .cloned()
        })
        .unwrap_or_default();
    let mut providers = configured
        .iter()
        .filter_map(Value::as_str)
        .filter_map(LyricsProvider::from_setting)
        .fold(Vec::new(), |mut order, provider| {
            if !order.contains(&provider) {
                order.push(provider);
            }
            order
        });
    for provider in LyricsProvider::DEFAULT_ORDER {
        if !providers.contains(&provider) {
            providers.push(provider);
        }
    }
    providers
}

fn provider_order_key(providers: &[LyricsProvider]) -> String {
    providers
        .iter()
        .map(|provider| provider.setting_value().to_lowercase())
        .collect::<Vec<_>>()
        .join("-")
}

fn read_cache(track_id: u64, provider_key: &str) -> Option<LyricsPayload> {
    let data = fs::read(cache_path(track_id, provider_key)?).ok()?;
    let value: LyricsPayload = serde_json::from_slice(&data).ok()?;
    (value.version == 2 && value.track_id == track_id && !value.raw.is_empty()).then_some(value)
}

fn write_cache(payload: &LyricsPayload, provider_key: &str) -> std::io::Result<()> {
    let Some(path) = cache_path(payload.track_id, provider_key) else {
        return Ok(());
    };
    write_json_atomically(&path, payload)
}

fn publish_current(payload: &LyricsPayload) -> std::io::Result<()> {
    let Some(directory) = lyrics_directory() else {
        return Ok(());
    };
    fs::create_dir_all(&directory)?;
    fs::set_permissions(&directory, fs::Permissions::from_mode(0o700))?;
    write_json_atomically(&directory.join("current-lyrics.json"), payload)
}

fn cache_path(track_id: u64, provider_key: &str) -> Option<PathBuf> {
    let directory = lyrics_directory()?.join("cache-v2").join(provider_key);
    fs::create_dir_all(&directory).ok()?;
    fs::set_permissions(&directory, fs::Permissions::from_mode(0o700)).ok()?;
    Some(directory.join(format!("{track_id:016x}.json")))
}

fn lyrics_directory() -> Option<PathBuf> {
    macos_runtime_state::application_support_directory()
        .ok()
        .map(|directory| directory.join("lyrics"))
}

fn write_json_atomically(path: &Path, payload: &LyricsPayload) -> std::io::Result<()> {
    let data = serde_json::to_vec(payload)?;
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent)?;
    let temporary = parent.join(format!(".lyrics-{}.tmp", std::process::id()));
    let mut file = secure_file(&temporary)?;
    file.write_all(&data)?;
    file.flush()?;
    fs::rename(temporary, path)
}

fn secure_file(path: &Path) -> std::io::Result<File> {
    OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(path)
}

fn finite_nonnegative(value: f64) -> f64 {
    if value.is_finite() {
        value.max(0.0)
    } else {
        0.0
    }
}

fn unix_time_milliseconds() -> u64 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn duration_score_matches_better_lyrics_tolerances() {
        assert_eq!(duration_similarity(200.0, 201.0), 1.0);
        assert_eq!(duration_similarity(200.0, 210.0), 0.0);
        assert_eq!(duration_similarity(200.0, 0.0), 0.0);
    }

    #[test]
    fn normalization_removes_version_suffixes() {
        assert_eq!(normalized("Example（Live 版）"), "example");
        assert_eq!(normalized("歌 名 [伴奏]"), "歌名");
    }

    #[test]
    fn timing_quality_breaks_near_score_ties() {
        let mut lrc = LyricsPayload::empty(1);
        lrc.format = "LRC".to_string();
        lrc.raw = "[00:01.00]测试".to_string();
        lrc.match_score = 90.0;
        let mut ttml = LyricsPayload::empty(1);
        ttml.format = "TTML".to_string();
        ttml.raw = "<tt/>".to_string();
        ttml.match_score = 88.0;
        assert_eq!(
            choose_best(vec![(0, lrc), (0, ttml)]).map(|item| item.format),
            Some("TTML".to_string())
        );
    }

    #[test]
    fn provider_priority_wins_between_reliable_results() {
        let mut first = LyricsPayload::empty(1);
        first.format = "LRC".to_string();
        first.raw = "[00:01.00]测试".to_string();
        first.match_score = 85.0;
        let mut second = first.clone();
        second.format = "TTML".to_string();
        second.match_score = 95.0;
        assert_eq!(
            choose_best(vec![(0, first), (1, second)]).map(|item| item.format),
            Some("LRC".to_string())
        );
    }

    #[test]
    fn weak_title_match_is_rejected() {
        let song = SongMetadata {
            track_id: 1,
            title: "真实歌名".to_string(),
            artist: "真实歌手".to_string(),
            album: "真实专辑".to_string(),
            duration: 200.0,
        };
        let mut result = LyricsPayload::empty(1);
        result.title = "当前歌词".to_string();
        result.artist = song.artist.clone();
        result.album = song.album.clone();
        result.duration = song.duration;
        assert!(!reliable_match(&song, &result));
    }
}
