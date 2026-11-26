import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../design/icons";
import { api } from "../lib/api";
import { t } from "../lib/i18n";
import { hexEncode } from "../lib/route";
import { attempt, toast } from "../lib/ui";

interface TorrentSearchResult {
  title: string;
  magnetLink: string | null;
  infoHash: string | null;
  seeders: number;
  leechers: number;
  size: string;
  sizeBytes: number | null;
  uploaded: string | null;
  siteName: string;
  detailUrl: string | null;
}

interface TorrentSite {
  id: string;
  name: string;
  baseUrl: string;
  searchPath: string;
  enabled: boolean;
  isBuiltin: boolean;
}

type SortBy = "seeders" | "leechers" | "sizeDesc" | "sizeAsc" | "title";

const QUALITY_FILTERS: { id: string; label: string; pattern: RegExp }[] = [
  { id: "2160p", label: "4K / 2160p", pattern: /\b(2160p|4k|uhd)\b/i },
  { id: "1080p", label: "1080p", pattern: /\b1080p\b/i },
  { id: "720p", label: "720p", pattern: /\b720p\b/i },
  { id: "480p", label: "480p", pattern: /\b480p\b/i },
];

const AUDIO_FILTERS: { id: string; label: string; pattern: RegExp }[] = [
  { id: "dual", label: "Dual Audio", pattern: /\b(dual[\s._-]?audio|dual)\b/i },
  { id: "multi", label: "Multi Audio", pattern: /\b(multi[\s._-]?(audio|lang)|multi)\b/i },
  { id: "dubbed", label: "Dubbed", pattern: /\b(dub|dubbed)\b/i },
  { id: "hindi", label: "Hindi", pattern: /\b(hindi|hin)\b/i },
  { id: "english", label: "English", pattern: /\b(english|eng)\b/i },
  { id: "japanese", label: "Japanese", pattern: /\b(japanese|jpn|jap)\b/i },
  { id: "spanish", label: "Spanish", pattern: /\b(spanish|esp|latino|castellano)\b/i },
  { id: "french", label: "French", pattern: /\b(french|fre|vff|truefrench)\b/i },
  { id: "korean", label: "Korean", pattern: /\b(korean|kor)\b/i },
  { id: "subs", label: "Subtitles", pattern: /\b(subs|subbed|esub|esubs|multisub)\b/i },
];

const FORMAT_FILTERS: { id: string; label: string; pattern: RegExp }[] = [
  { id: "x265", label: "x265 / HEVC", pattern: /\b(x265|h\.?265|hevc)\b/i },
  { id: "x264", label: "x264 / AVC", pattern: /\b(x264|h\.?264|avc)\b/i },
  { id: "av1", label: "AV1", pattern: /\bav1\b/i },
  { id: "bluray", label: "BluRay", pattern: /\b(blu[\s._-]?ray|bdrip|brrip)\b/i },
  { id: "webdl", label: "WEB-DL / WEBRip", pattern: /\b(web[\s._-]?dl|web[\s._-]?rip|web)\b/i },
  { id: "hdr", label: "HDR / DV", pattern: /\b(hdr|hdr10|dolby[\s._-]?vision|dv)\b/i },
  { id: "10bit", label: "10-bit", pattern: /\b10[\s._-]?bit\b/i },
];

function parseSizeBytes(r: TorrentSearchResult): number {
  if (r.sizeBytes != null && r.sizeBytes > 0) return r.sizeBytes;
  const m = r.size.match(/([\d.]+)\s*(B|KB|KiB|MB|MiB|GB|GiB|TB|TiB)/i);
  if (!m) return 0;
  const val = parseFloat(m[1]);
  const unit = m[2].toUpperCase();
  const mult: Record<string, number> = {
    B: 1,
    KB: 1024,
    KIB: 1024,
    MB: 1024 ** 2,
    MIB: 1024 ** 2,
    GB: 1024 ** 3,
    GIB: 1024 ** 3,
    TB: 1024 ** 4,
    TIB: 1024 ** 4,
  };
  return val * (mult[unit] ?? 1);
}

export default function TorrentSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TorrentSearchResult[]>([]);
  const [sites, setSites] = useState<TorrentSite[]>([]);
  const [activeSite, setActiveSite] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [showManage, setShowManage] = useState(false);
  const [showFilters, setShowFilters] = useState(true);
  const [fetchingMagnet, setFetchingMagnet] = useState<string | null>(null);

  // Filters
  const [qualityFilter, setQualityFilter] = useState("");
  const [audioFilter, setAudioFilter] = useState("");
  const [formatFilter, setFormatFilter] = useState("");
  const [minSeeders, setMinSeeders] = useState(0);
  const [textFilter, setTextFilter] = useState("");
  const [sortBy, setSortBy] = useState<SortBy>("seeders");

  // New site form
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [newPath, setNewPath] = useState("");

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void api.torrentSites().then(setSites).catch(() => {});
  }, []);

  const search = useCallback(
    async (q: string, siteId: string | null) => {
      const trimmed = q.trim();
      if (!trimmed) return;
      setSearching(true);
      setSearched(true);
      try {
        const r = await api.torrentSearch(trimmed, siteId ?? undefined);
        setResults(r);
      } catch (e) {
        toast(t("Search failed"), {
          kind: "error",
          body: e instanceof Error ? e.message : String(e),
        });
      } finally {
        setSearching(false);
      }
    },
    [],
  );

  const download = async (result: TorrentSearchResult) => {
    let magnet = result.magnetLink;
    if (!magnet && result.detailUrl) {
      setFetchingMagnet(result.detailUrl);
      try {
        magnet = await api.torrentMagnet(result.detailUrl);
      } catch (e) {
        toast(t("Could not fetch magnet link"), {
          kind: "error",
          body: e instanceof Error ? e.message : String(e),
        });
        setFetchingMagnet(null);
        return;
      }
      setFetchingMagnet(null);
    }
    if (magnet) {
      await attempt(
        api.openWindow("torrent", hexEncode(magnet)),
        t("Could not open the torrent"),
      );
    }
  };

  const toggleSite = async (id: string, enabled: boolean) => {
    const r = await attempt(
      api.torrentToggleSite(id, enabled),
      t("Could not update site"),
    );
    if (r) setSites(r);
  };

  const removeSite = async (id: string) => {
    const r = await attempt(
      api.torrentRemoveSite(id),
      t("Could not remove site"),
    );
    if (r) setSites(r);
  };

  const addSite = async () => {
    if (!newName.trim() || !newUrl.trim()) return;
    const site: TorrentSite = {
      id: newName.toLowerCase().replace(/\s+/g, "-"),
      name: newName.trim(),
      baseUrl: newUrl.trim().replace(/\/+$/, ""),
      searchPath: newPath.trim() || "/search/{query}",
      enabled: true,
      isBuiltin: false,
    };
    const r = await attempt(
      api.torrentAddSite(site),
      t("Could not add site"),
    );
    if (r) {
      setSites(r);
      setNewName("");
      setNewUrl("");
      setNewPath("");
    }
  };

  const enabledSites = useMemo(
    () => sites.filter((s) => s.enabled),
    [sites],
  );

  const activeFilterCount =
    (qualityFilter ? 1 : 0) +
    (audioFilter ? 1 : 0) +
    (formatFilter ? 1 : 0) +
    (minSeeders > 0 ? 1 : 0) +
    (textFilter.trim() ? 1 : 0);

  const clearFilters = () => {
    setQualityFilter("");
    setAudioFilter("");
    setFormatFilter("");
    setMinSeeders(0);
    setTextFilter("");
  };

  const filteredResults = useMemo(() => {
    const qRule = QUALITY_FILTERS.find((f) => f.id === qualityFilter);
    const aRule = AUDIO_FILTERS.find((f) => f.id === audioFilter);
    const fRule = FORMAT_FILTERS.find((f) => f.id === formatFilter);
    const kw = textFilter.trim().toLowerCase();

    const list = results.filter((r) => {
      if (r.seeders < minSeeders) return false;
      if (qRule && !qRule.pattern.test(r.title)) return false;
      if (aRule && !aRule.pattern.test(r.title)) return false;
      if (fRule && !fRule.pattern.test(r.title)) return false;
      if (kw && !r.title.toLowerCase().includes(kw)) return false;
      return true;
    });

    if (sortBy === "seeders") return list;
    return [...list].sort((a, b) => {
      switch (sortBy) {
        case "leechers":
          return b.leechers - a.leechers;
        case "sizeDesc":
          return parseSizeBytes(b) - parseSizeBytes(a);
        case "sizeAsc":
          return parseSizeBytes(a) - parseSizeBytes(b);
        case "title":
          return a.title.localeCompare(b.title);
        default:
          return b.seeders - a.seeders;
      }
    });
  }, [results, qualityFilter, audioFilter, formatFilter, minSeeders, textFilter, sortBy]);

  return (
    <div className="tsearch">
      {/* Search bar */}
      <div className="tsearch__bar">
        <div className="tsearch__input-wrap">
          <Icon name="search" size={16} className="tsearch__input-icon" />
          <input
            ref={inputRef}
            type="text"
            className="tsearch__input"
            placeholder={t("Search torrents across all sites…")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void search(query, activeSite);
            }}
          />
          {searching && (
            <Icon
              name="retry"
              size={14}
              className="anim-spin tsearch__spinner"
            />
          )}
        </div>
        <button
          type="button"
          className="btn btn--primary"
          disabled={!query.trim() || searching}
          onClick={() => void search(query, activeSite)}
        >
          <Icon name="search" size={15} /> {t("Search")}
        </button>
        <button
          type="button"
          className={`btn btn--ghost${showFilters ? " is-active" : ""}`}
          data-tip={t("Filters")}
          onClick={() => setShowFilters((v) => !v)}
        >
          <Icon name="filter" size={16} />
          {activeFilterCount > 0 && (
            <span className="badge badge--accent">{activeFilterCount}</span>
          )}
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          data-tip={t("Manage sites")}
          onClick={() => setShowManage((v) => !v)}
        >
          <Icon name="settings" size={16} />
        </button>
      </div>

      {/* Filters bar */}
      {showFilters && (
        <div className="tsearch__filters">
          <select
            className="tsearch__select"
            aria-label={t("Quality")}
            value={qualityFilter}
            onChange={(e) => setQualityFilter(e.target.value)}
          >
            <option value="">{t("Quality: All")}</option>
            {QUALITY_FILTERS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>

          <select
            className="tsearch__select"
            aria-label={t("Audio / Language")}
            value={audioFilter}
            onChange={(e) => setAudioFilter(e.target.value)}
          >
            <option value="">{t("Audio / Lang: All")}</option>
            {AUDIO_FILTERS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>

          <select
            className="tsearch__select"
            aria-label={t("Video format")}
            value={formatFilter}
            onChange={(e) => setFormatFilter(e.target.value)}
          >
            <option value="">{t("Format: All")}</option>
            {FORMAT_FILTERS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>

          <select
            className="tsearch__select"
            aria-label={t("Minimum seeders")}
            value={minSeeders}
            onChange={(e) => setMinSeeders(Number(e.target.value))}
          >
            <option value={0}>{t("Seeders: Any")}</option>
            <option value={1}>{t("Seeders: 1+")}</option>
            <option value={10}>{t("Seeders: 10+")}</option>
            <option value={50}>{t("Seeders: 50+")}</option>
            <option value={100}>{t("Seeders: 100+")}</option>
          </select>

          <select
            className="tsearch__select"
            aria-label={t("Sort by")}
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortBy)}
          >
            <option value="seeders">{t("Sort: Seeders")}</option>
            <option value="sizeDesc">{t("Sort: Largest")}</option>
            <option value="sizeAsc">{t("Sort: Smallest")}</option>
            <option value="leechers">{t("Sort: Leechers")}</option>
            <option value="title">{t("Sort: Name")}</option>
          </select>

          <input
            type="text"
            className="tsearch__filter-input"
            placeholder={t("Filter keyword (e.g. mkv, 60fps)…")}
            value={textFilter}
            onChange={(e) => setTextFilter(e.target.value)}
          />

          {activeFilterCount > 0 && (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={clearFilters}
            >
              {t("Clear")}
            </button>
          )}
        </div>
      )}

      {/* Site filter chips */}
      <div className="tsearch__sites">
        <button
          type="button"
          className={`tsearch__chip${activeSite === null ? " on" : ""}`}
          onClick={() => {
            setActiveSite(null);
            if (searched) void search(query, null);
          }}
        >
          {t("All sites")}
        </button>
        {enabledSites.map((site) => (
          <button
            key={site.id}
            type="button"
            className={`tsearch__chip${activeSite === site.id ? " on" : ""}`}
            onClick={() => {
              setActiveSite(site.id);
              if (searched) void search(query, site.id);
            }}
          >
            {site.name}
          </button>
        ))}
      </div>

      {/* Manage sites */}
      <AnimatePresence>
        {showManage && (
          <motion.div
            className="tsearch__manage"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="tsearch__manage-inner">
              <span className="t-overline">{t("Torrent sites")}</span>
              {sites.map((site) => (
                <div key={site.id} className="tsearch__site-row">
                  <label className="tsearch__site-toggle">
                    <input
                      type="checkbox"
                      checked={site.enabled}
                      onChange={(e) =>
                        void toggleSite(site.id, e.target.checked)
                      }
                    />
                    <span className="tsearch__site-name">
                      {site.name}
                      <span className="text-tertiary t-small">
                        {" "}
                        {site.baseUrl}
                      </span>
                    </span>
                  </label>
                  {!site.isBuiltin && (
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => void removeSite(site.id)}
                    >
                      <Icon name="delete" size={14} />
                    </button>
                  )}
                  {site.isBuiltin && (
                    <span className="badge badge--accent t-small">
                      {t("Built-in")}
                    </span>
                  )}
                </div>
              ))}

              <div className="tsearch__add-site">
                <span className="t-overline">{t("Add custom site")}</span>
                <div className="tsearch__add-row">
                  <input
                    className="input"
                    placeholder={t("Site name")}
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                  />
                  <input
                    className="input"
                    placeholder="https://example.com"
                    value={newUrl}
                    onChange={(e) => setNewUrl(e.target.value)}
                  />
                  <input
                    className="input"
                    placeholder="/search/{query}"
                    value={newPath}
                    onChange={(e) => setNewPath(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn btn--sm"
                    disabled={!newName.trim() || !newUrl.trim()}
                    onClick={() => void addSite()}
                  >
                    <Icon name="plus" size={14} /> {t("Add")}
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Results */}
      <div className="tsearch__results">
        {/* Header */}
        {filteredResults.length > 0 && (
          <div className="tsearch__header">
            <span className="tsearch__col-title">
              {t("Name")}
              {results.length > 0 && (
                <span className="text-tertiary">
                  {" "}
                  ({filteredResults.length}
                  {filteredResults.length !== results.length
                    ? ` / ${results.length}`
                    : ""}
                  )
                </span>
              )}
            </span>
            <span className="tsearch__col-size">{t("Size")}</span>
            <span className="tsearch__col-seed">
              <Icon name="upload" size={11} /> {t("S")}
            </span>
            <span className="tsearch__col-leech">
              <Icon name="download" size={11} /> {t("L")}
            </span>
            <span className="tsearch__col-site">{t("Site")}</span>
            <span className="tsearch__col-act" />
          </div>
        )}

        {/* Rows */}
        {filteredResults.map((r, i) => {
          const isFetching =
            fetchingMagnet !== null && fetchingMagnet === r.detailUrl;
          return (
            <div
              key={`${r.siteName}-${r.title}-${i}`}
              className="tsearch__row"
            >
              <div className="tsearch__col-title">
                <Icon name="torrent" size={14} className="text-tertiary" />
                <span className="ellipsis" title={r.title}>
                  {r.title}
                </span>
              </div>
              <span className="tsearch__col-size tnum">{r.size || "—"}</span>
              <span className="tsearch__col-seed tnum text-success">
                {r.seeders}
              </span>
              <span className="tsearch__col-leech tnum text-danger">
                {r.leechers}
              </span>
              <span className="tsearch__col-site">
                <span className="badge">{r.siteName}</span>
              </span>
              <span className="tsearch__col-act">
                <button
                  type="button"
                  className="btn btn--sm btn--primary"
                  disabled={isFetching}
                  onClick={() => void download(r)}
                  data-tip={t("Download this torrent")}
                >
                  {isFetching ? (
                    <Icon
                      name="retry"
                      size={13}
                      strokeWidth={2.2}
                      className="anim-spin"
                    />
                  ) : (
                    <Icon name="magnet" size={13} />
                  )}
                </button>
              </span>
            </div>
          );
        })}

        {/* Empty / loading states */}
        {!searching && searched && results.length === 0 && (
          <div className="tsearch__empty">
            <Icon name="search" size={36} />
            <b>{t("No torrents found")}</b>
            <span className="text-tertiary">
              {t("Try a different search or enable more sites")}
            </span>
          </div>
        )}

        {!searching && searched && results.length > 0 && filteredResults.length === 0 && (
          <div className="tsearch__empty">
            <Icon name="filter" size={36} />
            <b>{t("No results match your filters")}</b>
            <span className="text-tertiary">
              {t("{count} results hidden by active filters", {
                count: results.length,
              })}
            </span>
            <button
              type="button"
              className="btn btn--sm"
              onClick={clearFilters}
            >
              {t("Clear filters")}
            </button>
          </div>
        )}

        {!searched && !searching && (
          <div className="tsearch__empty">
            <Icon name="magnet" size={40} className="text-accent" />
            <b>{t("Search for torrents")}</b>
            <span className="text-tertiary">
              {t(
                "Search across {count} sites at once. Results are sorted by seeders.",
                { count: enabledSites.length },
              )}
            </span>
          </div>
        )}

        {searching && results.length === 0 && (
          <div className="tsearch__empty">
            <Icon
              name="retry"
              size={28}
              strokeWidth={2}
              className="anim-spin text-accent"
            />
            <b>{t("Searching…")}</b>
            <span className="text-tertiary">
              {t("Querying {count} torrent sites", {
                count: enabledSites.length,
              })}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
