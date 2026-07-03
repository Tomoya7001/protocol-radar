/**
 * F-035 — UI string bundles. Japanese ("ja") is the DEFAULT and complete bundle; English
 * ("en") is the optional secondary bundle. Both MUST have identical key shapes (enforced by
 * the `Dictionary` type at compile time and by a parity test at runtime). No third language.
 *
 * Templated strings use `{name}` placeholders resolved by `interpolate()` (see index.ts).
 * Code identifiers stay English even for the Japanese bundle.
 */

export interface Dictionary {
  appName: string;
  tagline: string;
  nav: { dashboard: string; verify: string };
  dashboard: {
    title: string;
    subtitle: string;
    empty: string;
    lastChange: string;
    noEvents: string;
    sources: string;
    events: string;
    viewDetail: string;
  };
  detail: {
    backToDashboard: string;
    timeline: string;
    verifyLink: string;
    noEvents: string;
    sources: string;
    sourceInactive: string;
    hash: string;
    prevHash: string;
    notFound: string;
  };
  verify: {
    title: string;
    subtitle: string;
    ok: string;
    tampered: string; // {seq}
    unavailable: string;
    checked: string; // {n}
    modeRaw: string;
    modeChain: string;
  };
  status: { active: string; inactive: string; vanished: string };
  freshness: {
    fresh: string;
    stale: string;
    pending: string;
    vanished: string;
    unknown: string;
  };
  eventType: {
    appeared: string;
    version_bump: string;
    spec_change: string;
    vanished: string;
  };
  common: { copy: string; copied: string; language: string };
}

export const ja: Dictionary = {
  appName: "Protocol Radar",
  tagline: "AIエージェント・プロトコルの観測インデックス",
  nav: { dashboard: "ダッシュボード", verify: "台帳検証" },
  dashboard: {
    title: "プロトコル一覧",
    subtitle: "各プロトコルの状態・最終変更・鮮度",
    empty: "まだ観測されたプロトコルはありません。",
    lastChange: "最終変更",
    noEvents: "変更履歴なし",
    sources: "ソース",
    events: "イベント",
    viewDetail: "詳細を見る",
  },
  detail: {
    backToDashboard: "ダッシュボードへ戻る",
    timeline: "イベント時系列",
    verifyLink: "この台帳を検証する",
    noEvents: "記録されたイベントはありません。",
    sources: "監視ソース",
    sourceInactive: "停止中",
    hash: "ハッシュ",
    prevHash: "前ハッシュ",
    notFound: "指定されたプロトコルは見つかりませんでした。",
  },
  verify: {
    title: "台帳検証",
    subtitle: "ハッシュチェーンを原本から再計算し、改ざんの有無を確認します。",
    ok: "台帳は無改ざんです。",
    tampered: "改ざんを検知しました（seq {seq}）。",
    unavailable: "台帳の鍵（HMAC）が未設定のため検証できません。",
    checked: "{n} 件のイベントを検証しました。",
    modeRaw: "原本から再計算",
    modeChain: "チェーン検証",
  },
  status: { active: "稼働中", inactive: "停止中", vanished: "消失" },
  freshness: {
    fresh: "最新",
    stale: "更新停滞",
    pending: "観測待ち",
    vanished: "消失",
    unknown: "不明",
  },
  eventType: {
    appeared: "出現",
    version_bump: "バージョン更新",
    spec_change: "仕様変更",
    vanished: "消失",
  },
  common: { copy: "コピー", copied: "コピーしました", language: "言語" },
};

export const en: Dictionary = {
  appName: "Protocol Radar",
  tagline: "Observation index for AI-agent protocols",
  nav: { dashboard: "Dashboard", verify: "Verify ledger" },
  dashboard: {
    title: "Protocols",
    subtitle: "State, last change and freshness per protocol",
    empty: "No protocols have been observed yet.",
    lastChange: "Last change",
    noEvents: "No changes recorded",
    sources: "sources",
    events: "events",
    viewDetail: "View detail",
  },
  detail: {
    backToDashboard: "Back to dashboard",
    timeline: "Event timeline",
    verifyLink: "Verify this ledger",
    noEvents: "No events have been recorded.",
    sources: "Monitored sources",
    sourceInactive: "inactive",
    hash: "hash",
    prevHash: "prev hash",
    notFound: "The requested protocol was not found.",
  },
  verify: {
    title: "Ledger verification",
    subtitle:
      "Recomputes the hash chain from the raw records to detect any tampering.",
    ok: "The ledger is intact — no tampering.",
    tampered: "Tampering detected (seq {seq}).",
    unavailable: "Cannot verify: the ledger HMAC secret is not configured.",
    checked: "Verified {n} event(s).",
    modeRaw: "Recompute from raw",
    modeChain: "Chain check",
  },
  status: { active: "Active", inactive: "Inactive", vanished: "Vanished" },
  freshness: {
    fresh: "Fresh",
    stale: "Stale",
    pending: "Pending",
    vanished: "Vanished",
    unknown: "Unknown",
  },
  eventType: {
    appeared: "Appeared",
    version_bump: "Version bump",
    spec_change: "Spec change",
    vanished: "Vanished",
  },
  common: { copy: "Copy", copied: "Copied", language: "Language" },
};
